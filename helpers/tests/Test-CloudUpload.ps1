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
    $retryPath = Get-FateConsentPath $stateDirectory $initial.Scope 'withdrawal-retry.json'
    Write-FateUploadState $retryPath @{ retryAt = [DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('o') }
    Invoke-Upload -ForceRetry
    Assert-True ($other.Scope -ne $initial.Scope -and $requests.Count -eq 12 -and ![IO.File]::Exists($receiptPath)) 'Changing endpoint forwarded old captures or accepted a malformed withdrawal receipt.'
    $consentResponse.BadWithdrawal = $false
    Write-FateUploadState $retryPath @{ retryAt = [DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('o') }
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

    $repairState = Join-Path $testDirectory 'repair-state'
    $repairCaptures = Join-Path $testDirectory 'repair-captures'
    Set-FateUploadConfiguration -StateDirectory $repairState -Origin $origin -Key $key -ConsentAccepted -AllowLocalTestEndpoint
    $repairConfig = Get-FateUploadConfiguration $repairState -AllowLocalTestEndpoint
    $repairScope = Join-Path $repairState $repairConfig.Scope
    $repairParams = @{ CapturesDirectory = $repairCaptures; StateDirectory = $repairState; AllowLocalTestEndpoint = $true
        Transport = $transport; ConsentTransport = $consentTransport }
    [void](Write-TestCapture -Directory $repairCaptures)
    [void](Write-TestCapture -Directory $repairCaptures)
    $response.WithdrawDuringSend = $false
    $consentResponse.Offline = $true
    Invoke-FateCaptureUploads @repairParams
    $queuedFiles = @([IO.Directory]::EnumerateFiles((Join-Path $repairScope 'queue'), '*.json'))
    Assert-True ($queuedFiles.Count -eq 2) 'The test could not prepare two queued captures.'
    $firstQueued = $queuedFiles[0]
    $firstId = [IO.Path]::GetFileNameWithoutExtension($firstQueued)
    $secondId = [IO.Path]::GetFileNameWithoutExtension($queuedFiles[1])
    $firstState = Join-Path $repairScope "states/$firstId.json"
    $originalPayload = [IO.File]::ReadAllText($firstQueued)
    $changedPayload = $originalPayload.Insert(1, '"unexpected":"LOCAL_IMAGE_SENTINEL",')
    $damagedState = '{"status":'
    [IO.File]::WriteAllText($firstState, $damagedState)
    [IO.File]::WriteAllText($firstQueued, $changedPayload)
    $consentResponse.Offline = $false
    $requestStart = $requests.Count
    Invoke-FateCaptureUploads @repairParams -ForceRetry
    Assert-True ($requests.Count -eq ($requestStart + 1) -and
        (ConvertFrom-Json -InputObject $requests[$requestStart]).captureId -ceq $secondId) 'The bad entry blocked or was sent before the valid entry.'
    Assert-True ([IO.File]::ReadAllText($firstState) -ceq $damagedState -and
        [IO.File]::ReadAllText($firstQueued) -ceq $changedPayload) 'A damaged entry was overwritten or removed.'
    [IO.File]::WriteAllText($firstQueued, $originalPayload)
    Invoke-FateCaptureUploads @repairParams
    $preserved = @([IO.Directory]::EnumerateFiles((Join-Path $repairScope 'states'), "$firstId.json.*.corrupt"))
    Assert-True ($requests.Count -eq ($requestStart + 2) -and
        $requests[$requestStart + 1] -ceq $originalPayload) 'A verified original payload was not retried unchanged.'
    Assert-True ((Read-FateUploadState $firstState).status -ceq 'accepted') 'The recovered request did not record the new receipt.'
    Assert-True ($preserved.Count -eq 1 -and [IO.File]::ReadAllText($preserved[0]) -ceq $damagedState) 'Recovery did not preserve the damaged state.'
    Write-Output 'PASS: a corrupt state cannot block other uploads or send altered data, and a verified payload can recover.'

    $batchState = Join-Path $testDirectory 'withdrawal-batch'
    $batchCaptures = Join-Path $testDirectory 'withdrawal-batch-captures'
    $blockedCapture = $null
    $batchIds = @(foreach ($entry in 1..4) {
        Set-FateUploadConfiguration -StateDirectory $batchState -Origin $origin -Key $key -ConsentAccepted -AllowLocalTestEndpoint
        (Get-FateUploadConfiguration $batchState -AllowLocalTestEndpoint).Scope
        if ($entry -eq 4) { $blockedCapture = Write-TestCapture -Directory $batchCaptures }
        Disable-FateUpload $batchState -AllowLocalTestEndpoint
    })
    $batchCalls = [Collections.Generic.List[string]]::new()
    $standardConsentTransport = $consentTransport
    $batchTransport = {
        param($Consent, [Security.SecureString]$Key, $Withdrawal)
        $batchCalls.Add($Consent.Id)
        if ($batchCalls.Count -eq 1) { throw [TimeoutException]::new('Test timeout.') }
        if ($batchCalls.Count -eq 2) { return @{ Status = 503; RetrySeconds = 120; Receipt = $null } }
        & $standardConsentTransport $Consent $Key $Withdrawal
    }
    $batchParams = @{ CapturesDirectory = $batchCaptures; StateDirectory = $batchState; AllowLocalTestEndpoint = $true
        Transport = $transport; ConsentTransport = $batchTransport }
    $requestStart = $requests.Count
    Invoke-FateCaptureUploads @batchParams
    Assert-True ($batchCalls.Count -eq 2) 'One cycle exceeded the consent withdrawal batch size.'
    $retryPaths = @($batchCalls | ForEach-Object { Get-FateConsentPath $batchState $_ 'withdrawal-retry.json' })
    $retries = @($retryPaths | ForEach-Object { Read-FateUploadState $_ })
    $now = [DateTimeOffset]::UtcNow
    Assert-True ($retries.Count -eq 2 -and $retries[0].attempt -eq 1 -and
        ((ConvertTo-FateUploadTime $retries[0].retryAt) - $now).TotalSeconds -gt 20 -and
        ((ConvertTo-FateUploadTime $retries[1].retryAt) - $now).TotalSeconds -gt 110) 'Timeout or HTTP 503 Retry-After was not recorded.'
    Invoke-FateCaptureUploads @batchParams -ForceRetry
    Assert-True ($batchCalls.Count -eq 4 -and @($batchCalls | Select-Object -Unique).Count -eq 4) 'Backoff was bypassed or later withdrawals were starved.'
    Invoke-FateCaptureUploads @batchParams -ForceRetry
    Assert-True ($batchCalls.Count -eq 4 -and $requests.Count -eq $requestStart) 'An unexpired withdrawal or a withdrawn scope was retried.'
    for ($index = 0; $index -lt $retryPaths.Count; $index++) {
        $retries[$index].retryAt = [DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('o')
        Write-FateUploadState $retryPaths[$index] $retries[$index]
    }
    Invoke-FateCaptureUploads @batchParams
    Assert-True ($batchCalls.Count -eq 6 -and $requests.Count -eq $requestStart -and
        [IO.File]::Exists((Join-Path $batchCaptures "fate-$blockedCapture.json"))) 'Expired withdrawal retries did not resume without sending or removing the capture.'
    foreach ($batchId in $batchIds) {
        Assert-True ((Test-FateConsentWithdrawnLocally $batchState $batchId) -and
            (Test-FateWithdrawalReceipt (Read-FateUploadState (Get-FateConsentPath $batchState $batchId 'withdrawn.json')) $batchId)) 'A withdrawal marker or receipt is missing.'
    }
    Write-Output 'PASS: consent withdrawals are bounded, back off durably after a timeout or 503, and resume without sending captures.'

    $damagedConsentState = Join-Path $testDirectory 'damaged-consent-state'
    $damagedConsentCaptures = Join-Path $testDirectory 'damaged-consent-captures'
    $metadataParams = @{
        CapturesDirectory = $damagedConsentCaptures; StateDirectory = $damagedConsentState
        AllowLocalTestEndpoint = $true; Transport = $transport; ConsentTransport = $consentTransport
    }
    $consentResponse.Status = 200
    Set-FateUploadConfiguration -StateDirectory $damagedConsentState -Origin $origin -Key $key -ConsentAccepted -AllowLocalTestEndpoint
    $config = Get-FateUploadConfiguration $damagedConsentState -AllowLocalTestEndpoint
    $recordedPath = Get-FateConsentPath $damagedConsentState $config.Scope 'recorded.json'
    [IO.File]::WriteAllText($recordedPath, '{"recordedAt":')
    $repairCaptureId = Write-TestCapture -Directory $damagedConsentCaptures
    $requestStart = $requests.Count
    $consentStart = $consentRequests.Count
    $busy = [IO.File]::Open($recordedPath, 'Open', 'ReadWrite', 'None')
    try {
        Assert-Throws { Invoke-FateCaptureUploads @metadataParams } 'An unreadable receipt was treated as missing or corrupt.'
        Assert-True ($requests.Count -eq $requestStart -and $consentRequests.Count -eq $consentStart) 'A locked receipt allowed a request.'
    } finally { $busy.Dispose() }
    $consentResponse.Offline = $true
    Invoke-FateCaptureUploads @metadataParams
    Assert-True ($requests.Count -eq $requestStart -and
        (Get-FateCaptureUploadStatus $damagedConsentState $repairCaptureId -AllowLocalTestEndpoint) -eq 'offline') 'A corrupt receipt let unconfirmed data through or hid the retry status.'
    $consentResponse.Offline = $false
    Invoke-FateCaptureUploads @metadataParams -ForceRetry
    $recordedBackups = @([IO.Directory]::EnumerateFiles([IO.Path]::GetDirectoryName($recordedPath), "$($config.Scope).recorded.json.*.corrupt"))
    $replayed = $consentRequests[$consentRequests.Count - 1].Consent
    Assert-True ($requests.Count -eq ($requestStart + 1) -and $replayed.Id -ceq $config.Scope -and
        (Get-FateUploadSecretText $replayed.Token) -ceq (Get-FateUploadSecretText $config.Consent.Token) -and
        (Test-FateConsentReceipt (Read-FateUploadState $recordedPath) $config.Consent) -and
        $recordedBackups.Count -eq 1 -and [IO.File]::ReadAllText($recordedBackups[0]) -ceq '{"recordedAt":') 'The corrupt receipt was not recovered idempotently.'

    foreach ($isConsentGate in @($true, $false)) {
        $gatePath = if ($isConsentGate) { Get-FateConsentPath $damagedConsentState $config.Scope 'gate.json' }
            else { Join-Path $damagedConsentState "$($config.Scope)/gate.json" }
        $damagedGate = if ($isConsentGate) { '{"revision":' } else { '{"status":"throttle","retryAt":"invalid"}' }
        [IO.File]::WriteAllText($gatePath, $damagedGate)
        $captureId = Write-TestCapture -Directory $damagedConsentCaptures
        $requestStart = $requests.Count
        Invoke-FateCaptureUploads @metadataParams -ForceRetry
        Assert-True ($requests.Count -eq $requestStart -and
            (Get-FateCaptureUploadStatus $damagedConsentState $captureId -AllowLocalTestEndpoint) -eq 'settings-damaged') 'A corrupt gate did not fail closed with a repair status.'
        Set-FateUploadConfiguration -StateDirectory $damagedConsentState -Origin $origin -Key $key -ConsentAccepted -AllowLocalTestEndpoint
        $previousScope = $config.Scope
        $config = Get-FateUploadConfiguration $damagedConsentState -AllowLocalTestEndpoint
        Invoke-FateCaptureUploads @metadataParams
        Assert-True ($config.Scope -cne $previousScope -and [IO.File]::ReadAllText($gatePath) -ceq $damagedGate -and
            $requests.Count -eq $requestStart) 'Reconfiguration reused a damaged scope, discarded evidence or sent its earlier captures.'
    }
    [void](Write-TestCapture -Directory $damagedConsentCaptures)
    Invoke-FateCaptureUploads @metadataParams
    Assert-True ($requests.Count -eq ($requestStart + 1)) 'New captures did not resume under repaired settings.'
    Write-Output 'PASS: damaged consent receipts replay the same consent before sending; damaged gates require fresh opt-in.'

    Disable-FateUpload $damagedConsentState -AllowLocalTestEndpoint
    $withdrawalMarker = $config.WithdrawalPath
    $withdrawalTokenPath = Get-FateConsentPath $damagedConsentState $config.Scope 'clixml'
    $withdrawalReceipt = Get-FateConsentPath $damagedConsentState $config.Scope 'withdrawn.json'
    $withdrawalRetry = Get-FateConsentPath $damagedConsentState $config.Scope 'withdrawal-retry.json'
    [IO.File]::Delete((Join-Path $damagedConsentState 'upload.clixml'))
    [IO.File]::WriteAllText($withdrawalReceipt, '{"status":')
    $invalidBytes = [byte[]]@(0xef, 0xbb, 0xbf, 0xff)
    [IO.File]::WriteAllBytes($withdrawalRetry, $invalidBytes)
    $consentStart = $consentRequests.Count
    $consentResponse.Offline = $true
    Invoke-FateCaptureUploads @metadataParams
    Assert-True ($consentRequests.Count -eq ($consentStart + 1) -and
        (Read-FateUploadState $withdrawalRetry).attempt -eq 1) 'Corrupt withdrawal retry prevented replay and durable backoff.'
    $consentResponse.Offline = $false
    Invoke-FateCaptureUploads @metadataParams -ForceRetry
    Assert-True ($consentRequests.Count -eq ($consentStart + 1)) 'Recovery bypassed a newly persisted withdrawal backoff.'
    Write-FateUploadState $withdrawalRetry @{ retryAt = [DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('o'); attempt = 1 }
    Invoke-FateCaptureUploads @metadataParams
    $withdrawalAttempt = $consentRequests[$consentRequests.Count - 1]
    $backupDirectory = [IO.Path]::GetDirectoryName($withdrawalReceipt)
    $receiptBackups = @([IO.Directory]::EnumerateFiles($backupDirectory, "$($config.Scope).withdrawn.json.*.corrupt"))
    $retryBackups = @([IO.Directory]::EnumerateFiles($backupDirectory, "$($config.Scope).withdrawal-retry.json.*.corrupt"))
    Assert-True ($consentRequests.Count -eq ($consentStart + 2) -and $requests.Count -eq ($requestStart + 1) -and
        !$withdrawalAttempt.HasKey -and $withdrawalAttempt.Consent.Id -ceq $config.Scope -and
        $withdrawalAttempt.Withdrawal.withdrawnAt -ceq (Read-FateUploadState $withdrawalMarker).withdrawnAt -and
        (Test-FateWithdrawalReceipt (Read-FateUploadState $withdrawalReceipt) $config.Scope) -and
        [IO.File]::Exists($withdrawalTokenPath) -and $receiptBackups.Count -eq 1 -and
        [IO.File]::ReadAllText($receiptBackups[0]) -ceq '{"status":' -and $retryBackups.Count -eq 1 -and
        [Convert]::ToBase64String([IO.File]::ReadAllBytes($retryBackups[0])) -ceq [Convert]::ToBase64String($invalidBytes)) 'Damaged withdrawal metadata did not recover without the active settings or lost evidence.'
    Write-Output 'PASS: corrupt withdrawal receipt and UTF-8 retry are preserved and reconstructed without sending captures.'

    Set-FateUploadConfiguration -StateDirectory $damagedConsentState -Origin $origin -Key $key -ConsentAccepted -AllowLocalTestEndpoint
    $config = Get-FateUploadConfiguration $damagedConsentState -AllowLocalTestEndpoint
    $brokenId = Write-TestCapture -Directory $damagedConsentCaptures
    $lockedId = Write-TestCapture -Directory $damagedConsentCaptures
    $otherId = Write-TestCapture -Directory $damagedConsentCaptures
    $consentResponse.Offline = $true
    Invoke-FateCaptureUploads @metadataParams
    $consentResponse.Offline = $false
    $statePath = Join-Path $damagedConsentState "$($config.Scope)/states/$brokenId.json"
    $lockedPath = Join-Path $damagedConsentState "$($config.Scope)/states/$lockedId.json"
    $queuedPath = Join-Path $damagedConsentState "$($config.Scope)/queue/$brokenId.json"
    $originalPayload = [IO.File]::ReadAllText($queuedPath)
    [IO.File]::WriteAllBytes($statePath, $invalidBytes)
    [IO.File]::WriteAllText($queuedPath, $originalPayload.Insert(1, '"unexpected":"LOCAL_IMAGE_SENTINEL",'))
    $requestStart = $requests.Count
    $busy = [IO.File]::Open($lockedPath, 'CreateNew', 'ReadWrite', 'None')
    try {
        Invoke-FateCaptureUploads @metadataParams -ForceRetry
        Assert-True ($requests.Count -eq ($requestStart + 1) -and
            (ConvertFrom-Json -InputObject $requests[$requestStart]).captureId -ceq $otherId) 'Invalid UTF-8 or a locked state blocked a valid entry or let altered data through.'
        [IO.File]::WriteAllText($queuedPath, $originalPayload)
        Invoke-FateCaptureUploads @metadataParams
        Assert-True ($requests.Count -eq ($requestStart + 2) -and $requests[$requestStart + 1] -ceq $originalPayload) 'An invalid UTF-8 state did not recover the verified payload.'
    } finally { $busy.Dispose() }
    $stateBackups = @([IO.Directory]::EnumerateFiles([IO.Path]::GetDirectoryName($statePath), "$brokenId.json.*.corrupt"))
    Assert-True ((Read-FateUploadState $statePath).status -ceq 'accepted' -and $stateBackups.Count -eq 1 -and
        [Convert]::ToBase64String([IO.File]::ReadAllBytes($stateBackups[0])) -ceq [Convert]::ToBase64String($invalidBytes)) 'Recovery did not keep the damaged bytes and the new receipt.'
    Write-Output 'PASS: invalid UTF-8 is recoverable, while a sharing violation leaves its position untouched.'
} finally {
    $key.Dispose()
    $resolved = [IO.Path]::GetFullPath($testDirectory)
    if ([IO.Path]::GetDirectoryName($resolved) -eq $temporaryRoot -and
        [IO.Path]::GetFileName($resolved) -match '\AFateCollector test [0-9a-f-]{36}\z' -and
        [IO.Directory]::Exists($resolved)) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
