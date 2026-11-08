Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'CloudUpload.Common.ps1')

function Assert-True($Condition, [string]$Message) {
    if (!$Condition) { throw $Message }
}

function Assert-Throws([scriptblock]$Action, [string]$Message) {
    try { & $Action } catch { return }
    throw $Message
}

$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$testDirectory = Join-Path $temporaryRoot ("FateCollector test " + [Guid]::NewGuid())
$stateDirectory = Join-Path $testDirectory 'state'
$capturesDirectory = Join-Path $testDirectory 'captures'
[void][IO.Directory]::CreateDirectory($capturesDirectory)
$origin = 'http://127.0.0.1:9797'
$keyText = 'test-key-never-written-in-plain-text'
$key = ConvertTo-SecureString $keyText -AsPlainText -Force
$response = @{ Status = 201; Receipt = $null; RetrySeconds = 0; Offline = $false; WithdrawDuringSend = $false }
$requests = [Collections.Generic.List[string]]::new()
$consentResponse = @{ Offline = $false; BadReceipt = $false; BadWithdrawal = $false; Status = 201 }
$consentRequests = [Collections.Generic.List[object]]::new()
$consentTransport = {
    param($Consent, [Security.SecureString]$Key, $Withdrawal)
    $consentRequests.Add([PSCustomObject]@{ Consent = $Consent; HasKey = $null -ne $Key; Withdrawal = $Withdrawal })
    if ($consentResponse.Offline) { throw 'Test network unavailable.' }
    $now = [DateTime]::UtcNow.ToString('o')
    if ($Withdrawal) {
        $status = if ($consentResponse.BadWithdrawal) { 'pending' } else { 'withdrawn' }
        return @{ Status = 200; Receipt = [PSCustomObject]@{ id = $Consent.Id; status = $status; withdrawnAt = $now } }
    }
    $scope = if ($consentResponse.BadReceipt) { 'observations' } else { $Consent.Scope }
    return @{ Status = $consentResponse.Status; RetrySeconds = 0; Receipt = [PSCustomObject]@{
        id = $Consent.Id; scope = $scope; policyVersion = $Consent.PolicyVersion; text = $Consent.Text
        acceptedAt = $Consent.AcceptedAt; recordedAt = $now; withdrawnAt = $null; token = (Get-FateUploadSecretText $Consent.Token)
    } }
}
$transport = {
    param($Settings, [string]$Body)
    $requests.Add($Body)
    if ($response.WithdrawDuringSend) {
        Disable-FateUpload $stateDirectory -ConsentId $Settings.Scope -AllowLocalTestEndpoint
    }
    if ($response.Offline) { throw 'Test network unavailable.' }
    if ($response.Status -in 200, 201 -and !$response.Receipt) {
        $id = (ConvertFrom-Json -InputObject $Body).captureId
        $status = if ($response.Status -eq 200) { 'duplicate' } else { 'accepted' }
        return @{ Status = $response.Status; Receipt = [PSCustomObject]@{ id = $id; status = $status; reviewed = $false }; RetrySeconds = 0 }
    }
    return $response
}

function Invoke-Upload([switch]$ForceRetry) {
    $params = @{ CapturesDirectory = $capturesDirectory; StateDirectory = $stateDirectory; AllowLocalTestEndpoint = $true
        ForceRetry = $ForceRetry; Transport = $transport; ConsentTransport = $consentTransport }
    Invoke-FateCaptureUploads @params
}

function Write-TestCapture {
    param([string]$Mode = 'game', [string]$Directory = $capturesDirectory,
        [DateTime]$CapturedAt = [DateTime]::UtcNow, [string]$Id = ([Guid]::NewGuid().ToString()),
        [switch]$MismatchedId, [switch]$OversizedOcr, [string]$Text = 'Test OCR', [string]$OcrStatus = 'ok', [switch]$WithContext)
    [void][IO.Directory]::CreateDirectory($Directory)
    $lines = @([ordered]@{ text = $Text; x = 1.25; y = 1; width = 78.5; height = 5; extra = 'LOCAL ONLY' })
    if ($OversizedOcr) {
        $Text = [string][char]0 * 20000
        $lines = @($lines[0], [ordered]@{ text = [string][char]0 * 2000; x = 1; y = 7; width = 80; height = 5 })
    }
    $value = [ordered]@{
        kind = 'fate-collector.capture'; schemaVersion = 1
        captureId = if ($MismatchedId) { [Guid]::NewGuid().ToString() } else { $Id }
        capturedAt = $CapturedAt.ToString('o'); source = 'windows-helper'; helperVersion = '0.2.0'
        context = [ordered]@{ captureMode = $Mode; extra = 'LOCAL ONLY' }
        image = [ordered]@{ width = 150; height = 100; mimeType = 'image/png'; dataBase64 = 'DO-NOT-SEND' }
        ocr = if ($OcrStatus -eq 'ok') {
            [ordered]@{ status = 'ok'; text = $Text; language = 'en-US'; lines = $lines }
        } else { [ordered]@{ status = $OcrStatus; text = ''; language = $null; lines = @() } }
    }
    if ($WithContext) {
        $value.context.session = @{ id = [guid]::NewGuid().ToString(); startedAt = $CapturedAt.AddMinutes(-1).ToString('o'); sequence = 2; extra = 'LOCAL ONLY' }
        $value.context.possibleDuplicate = @{ ofCaptureId = [guid]::NewGuid().ToString(); reason = 'same-ocr-within-15s'; extra = 'LOCAL ONLY' }
    }
    $path = Join-Path $Directory "fate-$Id.json"
    [IO.File]::WriteAllText($path, (ConvertTo-Json -InputObject $value -Depth 6), [Text.UTF8Encoding]::new($false))
    # Exercise the capturedAt filter even for old backups copied after enabling upload.
    [IO.File]::SetLastWriteTimeUtc($path, [DateTime]::UtcNow.AddSeconds(1))
    return $Id
}

function Get-TestState([string]$Id) {
    Read-FateUploadState (Join-Path (Join-Path $scope 'states') "$Id.json")
}
function Get-Feedback([string]$Id) {
    Get-FateCaptureUploadStatus -StateDirectory $stateDirectory -CaptureId $Id -AllowLocalTestEndpoint
}

try {
    Assert-True ((Resolve-FateUploadOrigin 'HTTPS://Collector.Example/') -ceq 'https://collector.example') 'HTTPS origin was not normalized.'
    Assert-True ((Resolve-FateUploadOrigin 'http://127.0.0.1:80/' -AllowLocalTestEndpoint) -ceq 'http://127.0.0.1:80') 'Explicit local port was not preserved.'
    foreach ($invalid in 'http://collector.example:9797', 'http://localhost:9797', 'http://127.1:9797', 'http://127.0.0.2:9797',
        'http://127.0.0.1', 'http://127.0.0.1:9797/captures', 'http://127.0.0.1:9797#', 'https://collector.example?',
        'https://someone@collector.example', 'https://collector.example\', 'https://collector.example/.') {
        Assert-Throws { Resolve-FateUploadOrigin $invalid -AllowLocalTestEndpoint } "Accepted invalid origin: $invalid"
    }
    Assert-Throws { Resolve-FateUploadOrigin $origin } 'Production accepted the local HTTP origin.'

    $old = Write-TestCapture -CapturedAt ([DateTime]::UtcNow.AddDays(-1))
    Invoke-Upload -ForceRetry
    Assert-True ($requests.Count -eq 0) 'Sent a capture before opt-in.'
    Assert-True ((Get-Feedback $old) -eq 'local') 'Disabled upload did not report local-only capture.'

    Assert-Throws { Set-FateUploadConfiguration -StateDirectory $stateDirectory -Origin $origin -Key $key -AllowLocalTestEndpoint } 'Enabled without explicit consent.'
    $configPath = Join-Path $stateDirectory 'upload.clixml'
    [void][IO.Directory]::CreateDirectory($stateDirectory)
    Write-FateUploadProtectedState $configPath ([PSCustomObject]@{
        Version = 1; Origin = $origin; Key = $key; Scope = [guid]::NewGuid().ToString()
        Revision = [guid]::NewGuid().ToString(); EnabledSince = [DateTime]::UtcNow.AddDays(-1).ToString('o')
    })
    [void](Write-TestCapture)
    Invoke-Upload -ForceRetry
    Assert-True ($requests.Count -eq 0 -and $consentRequests.Count -eq 0) 'Legacy settings authorized a network request.'

    Set-FateUploadConfiguration -StateDirectory $stateDirectory -Origin $origin -Key $key -ConsentAccepted -AllowLocalTestEndpoint
    $initial = Get-FateUploadConfiguration $stateDirectory -AllowLocalTestEndpoint
    $scope = Join-Path $stateDirectory $initial.Scope
    Assert-True (![IO.File]::ReadAllText($configPath).Contains($keyText)) 'Upload key was persisted in plain text.'
    Assert-True (([PSCredential]::new('test', $initial.Key)).GetNetworkCredential().Password -ceq $keyText) 'The saved key could not be loaded.'
    $token = Get-FateUploadSecretText $initial.Consent.Token
    $consentPath = Get-FateConsentPath $stateDirectory $initial.Scope 'clixml'
    Assert-True ($token -cmatch '\A[0-9a-f]{64}\z' -and ![IO.File]::ReadAllText($consentPath).Contains($token) -and
        ![IO.File]::ReadAllText($configPath).Contains($token)) 'Consent token was not saved with DPAPI protection.'
    $policy = Get-FateCaptureConsentPolicy $origin
    Assert-True ($initial.Consent.Text -ceq $policy.Text -and $initial.Consent.Text.EndsWith("Destination: $origin") -and
        $initial.Consent.PolicyVersion -ceq $policy.Version -and $initial.Consent.AcceptedAt -ceq $initial.EnabledSince -and
        (ConvertTo-FateUploadTime $initial.Consent.AcceptedAt) -gt [DateTimeOffset]::UtcNow.AddMinutes(-1)) 'Consent did not retain the exact policy text, destination and acceptance time.'
    Assert-Throws { Get-FateUploadConfiguration $stateDirectory } 'Production loaded local HTTP settings.'
    Write-Output 'PASS: HTTPS-only production settings, explicit loopback test override, and DPAPI key round trip.'

    $fixture = Write-TestCapture -Mode 'fixture'
    $pending = Write-TestCapture -Directory (Join-Path $capturesDirectory '.pending')
    $wrongId = Write-TestCapture -MismatchedId
    $largePayload = Write-TestCapture -OversizedOcr
    $largeFile = [Guid]::NewGuid().ToString()
    $largePath = Join-Path $capturesDirectory "fate-$largeFile.json"
    $stream = [IO.File]::Create($largePath)
    try { $stream.SetLength(12MB + 1) } finally { $stream.Dispose() }

    $id = Write-TestCapture -WithContext
    $consentResponse.Offline = $true
    Invoke-Upload
    Assert-True ($requests.Count -eq 0 -and $consentRequests.Count -eq 1 -and (Get-Feedback $id) -eq 'offline') 'Tried to send a capture without a consent receipt.'
    Invoke-Upload
    Assert-True ($consentRequests.Count -eq 1) 'Consent registration did not respect retry backoff.'
    $consentResponse.Offline = $false
    $consentResponse.BadReceipt = $true
    Invoke-Upload -ForceRetry
    Assert-True ($requests.Count -eq 0 -and $consentRequests.Count -eq 2) 'A receipt for the wrong scope authorized a capture.'
    $consentResponse.BadReceipt = $false
    $response.Offline = $true
    Invoke-Upload -ForceRetry
    Assert-True ($consentRequests.Count -eq 3 -and $consentRequests[2].HasKey) 'A fresh consent was not registered with the collection key.'
    $recordedPath = Get-FateConsentPath $stateDirectory $initial.Scope 'recorded.json'
    Assert-True (![IO.File]::ReadAllText($recordedPath).Contains($token)) 'The server response put a plain-text token on disk.'
    Write-Output 'PASS: explicit opt-in, no legacy authorization, protected token, saved policy and date, and receipt required before data.'
    Assert-True ($requests.Count -eq 1) 'Expected one eligible upload attempt.'
    $attempt = Get-TestState $id
    Assert-True ($attempt.status -eq 'retry' -and $attempt.attempt -eq 1 -and $attempt.httpStatus -eq 0) 'Network failure did not schedule retry.'
    Assert-True ((Get-Feedback $id) -eq 'offline') 'Offline capture was not reported as queued/offline.'
    $queuedPath = Join-Path (Join-Path $scope 'queue') "$id.json"
    $original = [IO.File]::ReadAllText($queuedPath)
    $payload = ConvertFrom-Json -InputObject $original
    Assert-True ($payload.captureId -ceq $id -and $payload.kind -eq 'fate-collector.upload' -and $payload.context.captureMode -eq 'game' -and
        $payload.image.width -eq 150 -and $payload.image.height -eq 100 -and $payload.ocr.lines.Count -eq 1 -and
        $payload.ocr.lines[0].x -eq 1.25 -and $payload.ocr.language -eq 'en-US') 'Incorrect projected transport data.'
    Assert-True ($original -notmatch 'dataBase64|DO-NOT-SEND|mimeType|LOCAL ONLY') 'The payload contains local image data or extra fields.'
    Assert-True ($payload.context.session.sequence -eq 2 -and $payload.context.possibleDuplicate.reason -ceq 'same-ocr-within-15s') 'Upload lost session/repeat metadata.'
    Assert-True ((Get-TestState $fixture).status -eq 'ignored' -and (Get-TestState $old).status -eq 'ignored' -and
        $null -eq (Get-TestState $pending) -and (Get-TestState $wrongId).status -eq 'rejected' -and
        (Get-TestState $largeFile).status -eq 'rejected' -and (Get-TestState $largePayload).status -eq 'rejected') 'Invalid, old, staged, or fixture filtering failed.'
    Write-Output 'PASS: only recent finalized game captures enter the bounded OCR-only queue.'

    [void](Write-TestCapture -Id $id -Text 'Edited local backup')
    $response.Offline = $false
    $response.Status = 429
    $response.RetrySeconds = 240
    Invoke-Upload
    Assert-True ($requests.Count -eq 1) 'Retried before backoff expired.'
    Invoke-Upload -ForceRetry
    $attempt = Get-TestState $id
    Assert-True ($attempt.attempt -eq 2 -and $attempt.httpStatus -eq 429 -and
        ((ConvertTo-FateUploadTime $attempt.retryAt) - [DateTimeOffset]::UtcNow).TotalSeconds -ge 230) 'Retry-After was not honored.'
    Assert-True ($requests[1] -ceq $original) 'Retry changed an immutable queued payload.'
    $response.Status = 201
    $response.Receipt = [PSCustomObject]@{ id = $id; status = 'accepted'; reviewed = $true }
    Invoke-Upload -ForceRetry
    Assert-True ((Get-TestState $id).status -eq 'retry' -and [IO.File]::Exists($queuedPath)) 'Accepted a receipt with invalid review state.'
    Assert-True ((Get-Feedback $id) -eq 'retry') 'Invalid success receipt incorrectly displayed Uploaded.'
    $response.Receipt = [PSCustomObject]@{ id = [Guid]::NewGuid().ToString(); status = 'accepted'; reviewed = $false }
    Invoke-Upload -ForceRetry
    Assert-True ((Get-TestState $id).status -eq 'retry') 'Accepted a receipt with the wrong capture ID.'
    $response.Receipt = $null
    $response.Status = 200
    Invoke-Upload -ForceRetry
    Assert-True ((Get-TestState $id).status -eq 'duplicate' -and ![IO.File]::Exists($queuedPath)) 'Duplicate receipt did not finalize the upload.'
    Assert-True ((Get-Feedback $id) -eq 'uploaded') 'Validated duplicate receipt did not display Uploaded.'
    $feedbackPath = Join-Path $testDirectory 'feedback.txt'
    Write-FateCaptureUploadFeedback -StateDirectory $stateDirectory -CaptureId $id -Path $feedbackPath -AllowLocalTestEndpoint
    Assert-True ([IO.File]::ReadAllText($feedbackPath) -ceq "$id`nuploaded") 'Feedback is not bound to the confirmed capture ID.'
    # Simulate a process dying after saving the receipt but before removing the queued payload.
    [IO.File]::WriteAllText($queuedPath, $original)
    Invoke-Upload -ForceRetry
    Assert-True ($requests.Count -eq 5 -and ![IO.File]::Exists($queuedPath) -and
        [IO.File]::Exists((Join-Path $capturesDirectory "fate-$id.json"))) 'A receipt did not prevent another upload, or the backup was removed.'
    Write-Output 'PASS: network retry, Retry-After, immutable request bytes, validated receipts, and restart-safe deduplication.'

    $auth = Write-TestCapture -OcrStatus 'error'
    $response.Status = 401
    Invoke-Upload -ForceRetry
    Assert-True ($requests.Count -eq 6 -and $null -eq (Get-TestState $auth)) 'Auth error marked the capture as processed.'
    Assert-True ((Get-Feedback $auth) -eq 'authorization') 'Auth pause was not surfaced to the helper.'
    Assert-True ((Get-Feedback $id) -eq 'uploaded') 'An unrelated auth failure overwrote a confirmed capture status.'
    Assert-True ((ConvertFrom-Json -InputObject $requests[5]).ocr.status -eq 'error') 'The exporter OCR error status was not preserved.'
    Invoke-Upload -ForceRetry
    Assert-True ($requests.Count -eq 6) 'Repeated an unauthorized upload before reconfiguration.'
    Set-FateUploadConfiguration -StateDirectory $stateDirectory -Origin "$origin/" -Key $key -ConsentAccepted -AllowLocalTestEndpoint
    $rotated = Get-FateUploadConfiguration $stateDirectory -AllowLocalTestEndpoint
    Assert-True ($rotated.Scope -eq $initial.Scope -and $rotated.EnabledSince -eq $initial.EnabledSince -and
        $rotated.Revision -ne $initial.Revision) 'Same-origin reconfiguration lost its scope or did not unblock the queue.'
    $response.Status = 201
    Invoke-Upload
    Assert-True ((Get-TestState $auth).status -eq 'accepted') 'Reconfiguration did not resume the auth-paused upload.'

    foreach ($code in 400, 409, 413, 422) {
        $invalid = Write-TestCapture
        $response.Status = $code
        Invoke-Upload
        $rejection = Get-TestState $invalid
        Assert-True ($rejection.status -eq 'rejected' -and $rejection.httpStatus -eq $code) "HTTP $code was not permanently rejected."
        Assert-True ((Get-Feedback $invalid) -eq 'rejected') 'Permanent rejection was not surfaced.'
    }
    Invoke-Upload -ForceRetry
    Assert-True ($requests.Count -eq 11) 'Resent a permanent rejection.'
    Write-Output 'PASS: auth pause resumes after same-origin reconfiguration; permanent rejection stops retries.'

    $unsent = Write-TestCapture
    $response.Offline = $true
    Invoke-Upload
    Assert-True ((Get-TestState $unsent).status -eq 'retry') 'Failed to create a pending capture for endpoint isolation test.'
    $consentResponse.Offline = $true
    $lock = Enter-FateUploadLock $stateDirectory
    try {
        Disable-FateUpload $stateDirectory -AllowLocalTestEndpoint
        Assert-True ((Get-Feedback $unsent) -eq 'local') 'Withdrawal did not block capture feedback while the uploader held its lock.'
    } finally { $lock.Dispose() }
    Invoke-Upload -ForceRetry
    $marker = Read-FateUploadState (Get-FateConsentPath $stateDirectory $initial.Scope 'withdrawal.json')
    $receiptPath = Get-FateConsentPath $stateDirectory $initial.Scope 'withdrawn.json'
    Assert-True ($requests.Count -eq 12 -and $marker.withdrawnAt -and ![IO.File]::Exists($receiptPath) -and
        [IO.File]::Exists($consentPath)) 'Offline withdrawal lost the consent record, sent data, or confirmed remote deletion.'
    Set-FateUploadConfiguration -StateDirectory $stateDirectory -Origin 'http://127.0.0.1:9798' -Key $key -ConsentAccepted -AllowLocalTestEndpoint
    $other = Get-FateUploadConfiguration $stateDirectory -AllowLocalTestEndpoint
    $response.Offline = $false
    $response.Status = 201
    $consentResponse.Offline = $false
    $consentResponse.BadWithdrawal = $true
    Invoke-Upload -ForceRetry
    Assert-True ($other.Scope -ne $initial.Scope -and $requests.Count -eq 12 -and ![IO.File]::Exists($receiptPath)) 'Changing endpoint forwarded old captures or accepted a malformed withdrawal receipt.'
    $consentResponse.BadWithdrawal = $false
    $configurationBackup = "$configPath.test"
    [IO.File]::Move($configPath, $configurationBackup)
    try { Invoke-Upload -ForceRetry } finally { [IO.File]::Move($configurationBackup, $configPath) }
    $withdrawalAttempt = $consentRequests[$consentRequests.Count - 1]
    Assert-True ((Test-FateWithdrawalReceipt (Read-FateUploadState $receiptPath) $initial.Scope) -and
        !$withdrawalAttempt.HasKey -and $withdrawalAttempt.Consent.Id -ceq $initial.Scope -and
        $withdrawalAttempt.Consent.Origin -ceq $origin -and $withdrawalAttempt.Withdrawal.withdrawnAt -ceq $marker.withdrawnAt) 'The pending withdrawal did not survive without an active configuration.'
    Disable-FateUpload $stateDirectory -AllowLocalTestEndpoint
    [void](Write-TestCapture)
    Invoke-Upload -ForceRetry
    Assert-True (![IO.File]::Exists($configPath)) 'Confirmed withdrawal left a configuration that keeps the tray uploader running.'
    Set-FateUploadConfiguration -StateDirectory $stateDirectory -Origin 'http://127.0.0.1:9798' -Key $key -ConsentAccepted -AllowLocalTestEndpoint
    $enabledAgain = Get-FateUploadConfiguration $stateDirectory -AllowLocalTestEndpoint
    Invoke-Upload -ForceRetry
    Assert-True ($enabledAgain.Scope -ne $other.Scope -and
        (Get-FateUploadSecretText $enabledAgain.Consent.Token) -cne (Get-FateUploadSecretText $other.Consent.Token) -and
        (ConvertTo-FateUploadTime $enabledAgain.EnabledSince) -gt (ConvertTo-FateUploadTime $other.EnabledSince) -and
        $requests.Count -eq 12) 'Re-enabling reused a consent or included captures from when upload was disabled.'

    [void](Write-TestCapture)
    $lock = Enter-FateUploadLock $stateDirectory
    try {
        Invoke-Upload
        Assert-True ($requests.Count -eq 12) 'The uploader ignored the cross-process lock.'
    } finally { $lock.Dispose() }
    Invoke-Upload
    Assert-True ($requests.Count -eq 13) 'Uploader did not recover after the lock was released.'
    Write-Output 'PASS: withdrawal under the uploader lock, offline retry without a collection key, isolated endpoints and fresh consent.'

    $readPolicy = ${function:Get-FateCaptureConsentPolicy}
    try {
        function Get-FateCaptureConsentPolicy([string]$Origin) {
            [PSCustomObject]@{ Version = 'revised-policy'; Text = "Revised policy for $Origin" }
        }
        $policyChanged = Write-TestCapture
        Invoke-Upload -ForceRetry
        Assert-True ($requests.Count -eq 13 -and (Get-Feedback $policyChanged) -eq 'consent-required') 'A policy update allowed sends under an outdated consent.'
        Set-FateUploadConfiguration -StateDirectory $stateDirectory -Origin $other.Origin -Key $key -ConsentAccepted -AllowLocalTestEndpoint
        $updated = Get-FateUploadConfiguration $stateDirectory -AllowLocalTestEndpoint
        Assert-True ($updated.Scope -ne $enabledAgain.Scope -and $updated.Consent.PolicyVersion -ceq 'revised-policy') 'A revised policy reused an old consent.'
        $newCapture = Write-TestCapture
        $consentResponse.Status = 409
        Invoke-Upload -ForceRetry
        Assert-True ($requests.Count -eq 13 -and (Get-Feedback $newCapture) -eq 'consent-required') 'Server policy rejection authorized a capture.'
    } finally { Set-Item Function:Get-FateCaptureConsentPolicy $readPolicy }
    Write-Output 'PASS: local and remote policy changes pause capture sends.'

    Set-FateUploadConfiguration -StateDirectory $stateDirectory -Origin $other.Origin -Key $key -ConsentAccepted -AllowLocalTestEndpoint
    $raceConfig = Get-FateUploadConfiguration $stateDirectory -AllowLocalTestEndpoint
    $raceIds = @(Write-TestCapture; Write-TestCapture)
    $consentResponse.Status = 201
    $response.WithdrawDuringSend = $true
    Invoke-Upload -ForceRetry
    Assert-True ($requests.Count -eq 14 -and (Test-FateConsentWithdrawnLocally $stateDirectory $raceConfig.Scope)) 'A withdrawal during transport did not block the next queued request.'
    foreach ($raceId in $raceIds) {
        Assert-True ([IO.File]::Exists((Join-Path $capturesDirectory "fate-$raceId.json"))) 'A race with withdrawal removed a local capture.'
    }
    Write-Output 'PASS: withdrawal during an in-flight request blocks the rest of the queue.'

    $limitedState = Join-Path $testDirectory 'withdrawal-limits'
    Set-FateUploadConfiguration -StateDirectory $limitedState -Origin $origin -Key $key -ConsentAccepted -AllowLocalTestEndpoint
    $limitedConfig = Get-FateUploadConfiguration $limitedState -AllowLocalTestEndpoint
    Disable-FateUpload $limitedState -AllowLocalTestEndpoint
    $withdrawalCalls = [Collections.Generic.List[object]]::new()
    $limitedTransport = {
        param($Consent, [Security.SecureString]$Key, $Withdrawal)
        $withdrawalCalls.Add($Consent.Id)
        Assert-True (!$Key -and $Withdrawal) 'Withdrawal sent a collection key or lost its marker.'
        return @{ Status = 429; RetrySeconds = 3600; Receipt = $null }
    }
    Invoke-FateCaptureUploads -CapturesDirectory $capturesDirectory -StateDirectory $limitedState -ConsentTransport $limitedTransport -AllowLocalTestEndpoint
    $retryPath = Get-FateConsentPath $limitedState $limitedConfig.Scope 'withdrawal-retry.json'
    $retry = Read-FateUploadState $retryPath
    Assert-True (((ConvertTo-FateUploadTime $retry.retryAt) - [DateTimeOffset]::UtcNow).TotalSeconds -gt 3500) 'Withdrawal ignored Retry-After.'
    Invoke-FateCaptureUploads -CapturesDirectory $capturesDirectory -StateDirectory $limitedState -ConsentTransport $limitedTransport -AllowLocalTestEndpoint -ForceRetry
    Assert-True ($withdrawalCalls.Count -eq 1 -and [IO.File]::Exists((Join-Path $limitedState 'upload.clixml'))) 'A retry bypassed the limit or discarded pending withdrawal settings.'
    Write-FateUploadState $retryPath @{ retryAt = [DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('o') }
    Invoke-FateCaptureUploads -CapturesDirectory $capturesDirectory -StateDirectory $limitedState -ConsentTransport $consentTransport -AllowLocalTestEndpoint
    Assert-True (![IO.File]::Exists((Join-Path $limitedState 'upload.clixml')) -and
        (Test-FateWithdrawalReceipt (Read-FateUploadState (Get-FateConsentPath $limitedState $limitedConfig.Scope 'withdrawn.json')) $limitedConfig.Scope)) 'Withdrawal did not resume and clear only the confirmed configuration.'
    Write-Output 'PASS: durable withdrawal Retry-After and cleanup of confirmed inactive settings.'
} finally {
    $key.Dispose()
    $resolved = [IO.Path]::GetFullPath($testDirectory)
    if ([IO.Path]::GetDirectoryName($resolved) -eq $temporaryRoot -and
        [IO.Path]::GetFileName($resolved) -match '\AFateCollector test [0-9a-f-]{36}\z' -and
        [IO.Directory]::Exists($resolved)) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
