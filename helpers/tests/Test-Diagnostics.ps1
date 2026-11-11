Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../CloudUpload.Common.ps1')

function Assert-Diagnostic([bool]$Condition, [string]$Message) {
    if (!$Condition) { throw $Message }
}

function Assert-DiagnosticThrows([scriptblock]$Action, [string]$Message) {
    try { & $Action | Out-Null } catch { return }
    throw $Message
}

$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$testDirectory = Join-Path $temporaryRoot "FateCollector diagnostics test $([Guid]::NewGuid())"
$state = Join-Path $testDirectory 'state'
$captures = Join-Path $testDirectory 'captures'
$events = Join-Path $state 'diagnostic-events'
$origin = 'http://127.0.0.1:9797'
$policy = Get-FateDiagnosticPolicy $origin
$key = ConvertTo-SecureString 'canary-collection-key' -AsPlainText -Force
$canaries = @('canary-collection-key', 'Bearer canary-auth', 'alice@example.invalid', 'canary-ocr',
    'canary-screenshot', 'canary-notes', 'canary-offer', 'canary-user', 'C:\private\canary', $origin)
$sensitive = $canaries -join '|'
$captureId = [Guid]::NewGuid().ToString()
$scope = [Guid]::NewGuid().ToString()
$queue = Join-Path $state "$scope/queue"
$states = Join-Path $state "$scope/states"
$requests = [Collections.Generic.List[object]]::new()
$response = @{ Mode = 'offline' }
$transport = {
    param($Record, $Key, $Body, $WithdrawalPath)
    $requests.Add(@{ HasKey = $null -ne $Key; Body = $Body; Id = $Record.Id; Origin = $Record.Origin
            Token = Get-FateUploadSecretText $Record.Token; WithdrawalPath = $WithdrawalPath })
    Assert-Diagnostic ([IO.File]::Exists((Get-FateDiagnosticPath $state $Record.Id 'clixml'))) 'Contacted the collection before recording the local credential.'
    if ($response.Mode -eq 'offline') { throw 'canary exception text' }
    if ($response.Mode -eq 'limited') { return @{ Status = 429; RetrySeconds = 240; Receipt = $null } }
    if (!$Key) {
        $receipt = [PSCustomObject]@{ id = $Record.Id; status = 'withdrawn'; withdrawnAt = Get-FateDiagnosticTime }
        if ($response.Mode -eq 'wrong') { $receipt.withdrawnAt = 'wrong timestamp' }
        return @{ Status = 200; Receipt = $receipt }
    }
    $receivedAt = Get-FateDiagnosticTime
    $expiry = (ConvertTo-FateUploadTime $receivedAt).UtcDateTime.AddDays(30).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
    $receipt = [PSCustomObject]@{
        id = $Record.Id; status = 'received'; receivedAt = $receivedAt; expiresAt = $expiry
        consent = [PSCustomObject]@{ version = $Record.ConsentVersion; text = $Record.ConsentText; acceptedAt = $Record.AcceptedAt; recordedAt = $receivedAt }
    }
    switch ($response.Mode) {
        'wrong-id' { $receipt.id = [Guid]::NewGuid().ToString() }
        'wrong-text' { $receipt.consent.text = 'wrong consent text' }
        'wrong-expiry' { $receipt.expiresAt = $receipt.receivedAt }
    }
    return @{ Status = 200; Receipt = $receipt }
}

function Get-TestDiagnosticStatus($Report) {
    $record = Read-FateDiagnosticRecord $state $Report.id -AllowLocalTestEndpoint
    try { Get-FateDiagnosticStatus $state $record } finally { $record.Token.Dispose() }
}

function Send-TestDiagnostic($Report, [switch]$ConsentAccepted, $DisplayedPolicy = $policy, [string]$Destination = $origin) {
    Send-FateDiagnosticReport -StateDirectory $state -Report $Report -Origin $Destination -Key $key `
        -DisplayedPolicy $DisplayedPolicy -ConsentAccepted:$ConsentAccepted -AllowLocalTestEndpoint -Transport $transport
}

try {
    foreach ($directory in $captures, $events, $queue, $states) { [void][IO.Directory]::CreateDirectory($directory) }
    $capturePath = Join-Path $captures "fate-$captureId.json"
    [IO.File]::WriteAllText($capturePath, $sensitive)
    $pendingId = [Guid]::NewGuid().ToString()
    [IO.File]::WriteAllText((Join-Path $queue "$pendingId.json"), $sensitive)
    [IO.File]::WriteAllText((Join-Path $queue "$captureId.json"), $sensitive)
    Write-FateUploadState (Join-Path $states "$captureId.json") @{ status = 'accepted'; token = $sensitive; id = $captureId }
    Write-FateUploadState (Join-Path $states "$([Guid]::NewGuid()).json") @{ status = 'rejected'; details = $sensitive }
    Write-FateUploadState (Join-Path $states "$([Guid]::NewGuid()).json") @{ status = 'ignored'; text = $sensitive }
    Write-FateUploadState (Join-Path $events 'capture.error.json') @{ code = 'capture'; outcome = 'error'; at = Get-FateDiagnosticTime; httpStatus = $null; raw = $sensitive }
    Write-FateUploadState (Join-Path $events 'capture.ok.json') @{ code = 'capture'; outcome = 'ok'; at = $sensitive; httpStatus = $null }
    Write-FateUploadState (Join-Path $events 'upload.error.json') @{ code = 'upload'; outcome = 'error'; at = Get-FateDiagnosticTime; httpStatus = '503' }
    Write-FateUploadState (Join-Path $events 'upload.ok.json') @{ code = 'upload'; outcome = 'ok'; at = Get-FateDiagnosticTime; httpStatus = 200; unknown = ('x' * 4096) }
    Write-FateUploadState (Join-Path $events 'runtime-error.ok.json') @{ code = $sensitive; outcome = 'ok'; at = Get-FateDiagnosticTime; httpStatus = 200 }
    [IO.File]::WriteAllText((Join-Path $state 'upload.clixml'), $sensitive)
    Write-FateUploadState (Join-Path $state 'diagnostic-sharing.json') @{ sharing = 'pending'; arbitrary = $sensitive }

    $report = New-FateDiagnosticReport $state $captures $origin
    Assert-Diagnostic ($report.state.storage -ceq 'available' -and $report.state.sharing -ceq 'pending' -and
        $report.state.queue.pending -eq 1 -and $report.state.queue.accepted -eq 1 -and
        $report.state.queue.rejected -eq 1 -and $report.state.queue.ignored -eq 1) 'Diagnostic queue snapshot is incorrect.'
    Assert-Diagnostic ($report.environment -ceq 'local' -and $report.events.Count -eq 2 -and $report.events[0].code -ceq 'capture') 'Invalid event survived projection or known event was lost.'
    Assert-Diagnostic ($report.id -cne (New-FateDiagnosticReport $state $captures).id) 'Generation reused a report identifier.'
    $reportJson = ConvertTo-Json -InputObject $report -Depth 8
    foreach ($canary in $canaries + @($captureId, $pendingId, $scope)) {
        Assert-Diagnostic (!$reportJson.Contains($canary)) 'Sensitive state entered diagnostic report.'
    }
    [IO.File]::Delete((Join-Path $state 'upload.clixml'))
    Write-Output 'PASS: bounded queue snapshot and allowlisted diagnostics exclude capture bodies, credentials, IDs and arbitrary events.'

    $zipPath = Join-Path $testDirectory 'diagnostic.zip'
    Export-FateDiagnosticZip $zipPath $report
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        Assert-Diagnostic ($zip.Entries.Count -eq 1 -and $zip.Entries[0].FullName -ceq 'diagnostics.json') 'Unexpected data in the ZIP.'
        $reader = [IO.StreamReader]::new($zip.Entries[0].Open())
        try { Assert-Diagnostic ($reader.ReadToEnd() -ceq $reportJson) 'ZIP differs from the preview.' } finally { $reader.Dispose() }
    } finally { $zip.Dispose() }
    Assert-DiagnosticThrows { Send-TestDiagnostic $report } 'Sent a report without explicit consent.'
    Assert-DiagnosticThrows { Send-TestDiagnostic $report -ConsentAccepted -Destination 'http://127.0.0.1:9798' } 'Accepted consent for a different destination.'
    Assert-Diagnostic ($requests.Count -eq 0 -and ![IO.Directory]::Exists((Join-Path $state 'diagnostics'))) 'Local ZIP export or unchecked consent attempted a send.'
    Write-Output 'PASS: ZIP contains exactly the preview. No network or credential state before explicit consent for this destination.'

    Assert-Diagnostic ((Send-TestDiagnostic $report -ConsentAccepted) -eq 'pending') 'Lost receipt incorrectly confirmed upload.'
    $recordPath = Get-FateDiagnosticPath $state $report.id 'clixml'
    $firstRequest = ConvertFrom-FateDiagnosticJson $requests[0].Body
    $plainRecord = [IO.File]::ReadAllText($recordPath)
    Assert-Diagnostic ($firstRequest.consent.version -ceq $policy.Version -and $firstRequest.consent.text -ceq $policy.Text -and
        $firstRequest.token -cmatch '\A[0-9a-f]{64}\z' -and !$plainRecord.Contains($firstRequest.token) -and
        !$plainRecord.Contains('canary-collection-key') -and $requests[0].HasKey -and
        ![IO.File]::Exists((Join-Path $state 'upload.clixml'))) 'Exact consent, DPAPI, or separation from gameplay was lost.'
    Invoke-FateCaptureUploads -CapturesDirectory $captures -StateDirectory $state -AllowLocalTestEndpoint -DiagnosticTransport $transport
    Assert-Diagnostic ($requests.Count -eq 1) 'Background uploader sent a pending report without a new explicit action.'
    foreach ($mode in 'wrong-id', 'wrong-text', 'wrong-expiry') {
        $response.Mode = $mode
        Assert-Diagnostic ((Send-TestDiagnostic $report -ConsentAccepted) -eq 'pending') 'Incorrect receipt confirmed delivery.'
        Assert-Diagnostic ((Get-TestDiagnosticStatus $report) -eq 'pending') 'Incorrect receipt became durable.'
    }
    $response.Mode = 'ok'
    Assert-Diagnostic ((Send-TestDiagnostic $report -ConsentAccepted) -eq 'received' -and (Get-TestDiagnosticStatus $report) -eq 'received') 'Valid receipt did not confirm delivery.'
    foreach ($request in $requests) {
        Assert-Diagnostic ($request.Body -ceq $requests[0].Body -and $request.Origin -ceq $origin) 'Retry changed immutable report, policy, date or token.'
    }
    Assert-Diagnostic ((Send-TestDiagnostic $report -ConsentAccepted) -eq 'received' -and $requests.Count -eq 5) 'Sent a report already confirmed.'
    Write-Output 'PASS: no automatic sends, immutable retry bytes, exact receipts and DPAPI-protected local token.'

    $unconfirmed = New-FateDiagnosticReport $state $captures $origin
    $response.Mode = 'offline'
    Assert-Diagnostic ((Send-TestDiagnostic $unconfirmed -ConsentAccepted) -eq 'pending') 'Test could not prepare a lost acknowledgement.'
    $lock = Enter-FateUploadLock $state
    try { Save-FateDiagnosticWithdrawal $state $unconfirmed.id -AllowLocalTestEndpoint } finally { $lock.Dispose() }
    Save-FateDiagnosticWithdrawal $state $report.id -AllowLocalTestEndpoint
    $markerPath = Get-FateDiagnosticPath $state $unconfirmed.id 'withdrawal.json'
    $marker = [IO.File]::ReadAllText($markerPath)
    Invoke-FateCaptureUploads -CapturesDirectory $captures -StateDirectory $state -AllowLocalTestEndpoint -DiagnosticTransport $transport
    Assert-Diagnostic ((Get-TestDiagnosticStatus $unconfirmed) -eq 'withdrawal-pending') 'Offline withdrawal showed remote deletion.'
    $count = $requests.Count
    Assert-Diagnostic ((Send-TestDiagnostic $unconfirmed -ConsentAccepted) -eq 'withdrawal-pending' -and $requests.Count -eq $count) 'Withdrawal marker allowed a report retry.'
    Save-FateDiagnosticWithdrawal $state $unconfirmed.id -AllowLocalTestEndpoint
    Assert-Diagnostic ([IO.File]::ReadAllText($markerPath) -ceq $marker) 'Local withdrawal timestamp changed on retry.'
    $response.Mode = 'wrong'
    foreach ($item in $unconfirmed, $report) {
        Write-FateUploadState (Get-FateDiagnosticPath $state $item.id 'withdrawal-retry.json') @{
            retryAt = [DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('o')
        }
    }
    Invoke-FateCaptureUploads -CapturesDirectory $captures -StateDirectory $state -AllowLocalTestEndpoint -DiagnosticTransport $transport
    Assert-Diagnostic ((Get-TestDiagnosticStatus $unconfirmed) -eq 'withdrawal-pending') 'Invalid deletion receipt confirmed withdrawal.'
    $response.Mode = 'ok'
    foreach ($item in $unconfirmed, $report) {
        Write-FateUploadState (Get-FateDiagnosticPath $state $item.id 'withdrawal-retry.json') @{
            retryAt = [DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('o')
        }
    }
    Invoke-FateCaptureUploads -CapturesDirectory $captures -StateDirectory $state -AllowLocalTestEndpoint -DiagnosticTransport $transport
    Assert-Diagnostic ((Get-TestDiagnosticStatus $unconfirmed) -eq 'withdrawn' -and (Get-TestDiagnosticStatus $report) -eq 'withdrawn') 'Restart retry without gameplay settings failed.'
    foreach ($request in ($requests | Where-Object { !$_.HasKey })) {
        $deletion = ConvertFrom-FateDiagnosticJson $request.Body
        Assert-Diagnostic (@($deletion.PSObject.Properties).Count -eq 1 -and (Test-FateDiagnosticTime $deletion.withdrawnAt) -and
            $request.Origin -ceq $origin -and $request.Token -cmatch '\A[0-9a-f]{64}\z') 'Deletion resent report data or used the wrong collection.'
    }
    Assert-Diagnostic ([IO.File]::Exists($recordPath) -and [IO.File]::Exists($zipPath) -and [IO.File]::ReadAllText($capturePath) -ceq $sensitive) 'Withdrawal removed a local report, ZIP or capture.'
    Write-Output 'PASS: offline withdrawal survives a restart, blocks resend and preserves all local copies.'

    $limited = New-FateDiagnosticReport $state $captures $origin
    $response.Mode = 'limited'
    Assert-Diagnostic ((Send-TestDiagnostic $limited -ConsentAccepted) -eq 'rate-limited') 'Rate limit was not surfaced.'
    $count = $requests.Count
    $retry = Get-FateDiagnosticRetryTime (Get-FateDiagnosticPath $state $limited.id 'send-retry.json')
    Assert-Diagnostic (($retry - [DateTimeOffset]::UtcNow).TotalSeconds -ge 230) 'Upload did not retain Retry-After.'
    Assert-Diagnostic ((Send-TestDiagnostic $limited -ConsentAccepted) -eq 'rate-limited' -and $requests.Count -eq $count) 'Sent again before Retry-After.'
    Save-FateDiagnosticWithdrawal $state $limited.id -AllowLocalTestEndpoint
    Invoke-FateCaptureUploads -CapturesDirectory $captures -StateDirectory $state -AllowLocalTestEndpoint -DiagnosticTransport $transport
    $retryPath = Get-FateDiagnosticPath $state $limited.id 'withdrawal-retry.json'
    $retry = Get-FateDiagnosticRetryTime $retryPath
    Assert-Diagnostic (($retry - [DateTimeOffset]::UtcNow).TotalSeconds -ge 230 -and $requests.Count -eq ($count + 1)) 'Withdrawal did not retain Retry-After.'
    $response.Mode = 'ok'
    Invoke-FateCaptureUploads -CapturesDirectory $captures -StateDirectory $state -AllowLocalTestEndpoint -DiagnosticTransport $transport
    Assert-Diagnostic ((Get-TestDiagnosticStatus $limited) -eq 'withdrawal-pending' -and $requests.Count -eq ($count + 1)) 'Retried deletion before Retry-After.'
    Write-FateUploadState $retryPath @{ retryAt = [DateTime]::UtcNow.AddSeconds(-1).ToString('o') }
    Invoke-FateCaptureUploads -CapturesDirectory $captures -StateDirectory $state -AllowLocalTestEndpoint -DiagnosticTransport $transport
    Assert-Diagnostic ((Get-TestDiagnosticStatus $limited) -eq 'withdrawn' -and $requests.Count -eq ($count + 2)) 'Withdrawal did not resume after Retry-After.'
    Write-Output 'PASS: HTTP 429 prevents send and automatic withdrawal retries until the collection asks us to retry.'

    $batch = @(foreach ($entry in 1..4) {
        $item = New-FateDiagnosticReport $state $captures $origin
        Assert-Diagnostic ((Send-TestDiagnostic $item -ConsentAccepted) -eq 'received') 'Could not create a report for withdrawal batch.'
        Save-FateDiagnosticWithdrawal $state $item.id -AllowLocalTestEndpoint
        $item
    })
    $batchCalls = [Collections.Generic.List[string]]::new()
    $standardDiagnosticTransport = $transport
    $batchTransport = {
        param($Record, $Key, $Body, $WithdrawalPath)
        $batchCalls.Add($Record.Id)
        if ($batchCalls.Count -eq 1) { throw [TimeoutException]::new('Test timeout.') }
        if ($batchCalls.Count -eq 2) { return @{ Status = 503; RetrySeconds = 120; Receipt = $null } }
        & $standardDiagnosticTransport $Record $Key $Body $WithdrawalPath
    }
    $batchParams = @{ CapturesDirectory = $captures; StateDirectory = $state; AllowLocalTestEndpoint = $true; DiagnosticTransport = $batchTransport }
    Invoke-FateCaptureUploads @batchParams
    Assert-Diagnostic ($batchCalls.Count -eq 2) 'One cycle exceeded the diagnostic withdrawal batch size.'
    $retryPaths = @($batchCalls | ForEach-Object { Get-FateDiagnosticPath $state $_ 'withdrawal-retry.json' })
    $now = [DateTimeOffset]::UtcNow
    Assert-Diagnostic (((Get-FateDiagnosticRetryTime $retryPaths[0]) - $now).TotalSeconds -gt 20 -and
        ((Get-FateDiagnosticRetryTime $retryPaths[1]) - $now).TotalSeconds -gt 110) 'Timeout or HTTP 503 Retry-After was not recorded.'
    Invoke-FateCaptureUploads @batchParams
    Assert-Diagnostic ($batchCalls.Count -eq 4 -and @($batchCalls | Select-Object -Unique).Count -eq 4) 'Backoff was bypassed or later withdrawals were starved.'
    Invoke-FateCaptureUploads @batchParams
    Assert-Diagnostic ($batchCalls.Count -eq 4) 'A pending diagnostic withdrawal retried before its deadline.'
    foreach ($retryPath in $retryPaths) {
        Write-FateUploadState $retryPath @{ retryAt = [DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('o') }
    }
    Invoke-FateCaptureUploads @batchParams
    Assert-Diagnostic ($batchCalls.Count -eq 6) 'Expired diagnostic withdrawal retries did not resume.'
    foreach ($item in $batch) {
        Assert-Diagnostic ((Get-TestDiagnosticStatus $item) -eq 'withdrawn' -and
            [IO.File]::Exists((Get-FateDiagnosticPath $state $item.id 'withdrawal.json'))) 'A diagnostic withdrawal marker or receipt is missing.'
    }
    Write-Output 'PASS: diagnostic withdrawals are bounded, back off after a timeout or 503, and resume after the deadline.'
    foreach ($damage in 'json', 'utf8', 'missing-time') {
        $item = New-FateDiagnosticReport $state $captures $origin
        $response.Mode = 'received'
        Assert-Diagnostic ((Send-TestDiagnostic $item -ConsentAccepted) -eq 'received') 'Could not prepare damaged withdrawal test.'
        Save-FateDiagnosticWithdrawal $state $item.id -AllowLocalTestEndpoint
        $damagedMarker = Get-FateDiagnosticPath $state $item.id 'withdrawal.json'
        switch ($damage) {
            'json' { [IO.File]::WriteAllText($damagedMarker, '{broken') }
            'utf8' { [IO.File]::WriteAllBytes($damagedMarker, [byte[]]@(0xff)) }
            'missing-time' { [IO.File]::WriteAllText($damagedMarker, '{}') }
        }
        $requestCount = $requests.Count
        Invoke-FateDiagnosticWithdrawals -StateDirectory $state -Id $item.id -AllowLocalTestEndpoint -Transport $transport
        Assert-Diagnostic ($requests.Count -eq $requestCount + 1 -and (Get-TestDiagnosticStatus $item) -eq 'withdrawn') 'Damaged withdrawal marker was not recovered and sent.'
        Assert-Diagnostic (@([IO.Directory]::EnumerateFiles([IO.Path]::GetDirectoryName($damagedMarker), "$($item.id).withdrawal.json.*.corrupt")).Count -eq 1) 'Damaged withdrawal evidence was lost.'
        $recovered = Read-FateDiagnosticJson $damagedMarker
        Assert-Diagnostic ($recovered.timestampSource -eq 'recovered-at') 'Recovery misrepresented the original withdrawal timestamp.'
    }
    Write-Output 'PASS: malformed JSON, invalid UTF-8 and missing withdrawal timestamps preserve originals and recover deletion.'
} finally {
    $key.Dispose()
    $resolved = [IO.Path]::GetFullPath($testDirectory)
    if ([IO.Path]::GetDirectoryName($resolved) -eq $temporaryRoot -and
        [IO.Path]::GetFileName($resolved) -match '\AFateCollector diagnostics test [0-9a-f-]{36}\z' -and
        [IO.Directory]::Exists($resolved)) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
