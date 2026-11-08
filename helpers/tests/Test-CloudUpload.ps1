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
$response = @{ Status = 201; Receipt = $null; RetrySeconds = 0; Offline = $false }
$requests = [Collections.Generic.List[string]]::new()
$transport = {
    param($Settings, [string]$Body)
    $requests.Add($Body)
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
        ForceRetry = $ForceRetry; Transport = $transport }
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
        capturedAt = $CapturedAt.ToString('o'); source = 'windows-helper'; helperVersion = '0.1.0'
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

    Set-FateUploadConfiguration -StateDirectory $stateDirectory -Origin $origin -Key $key -AllowLocalTestEndpoint
    $initial = Get-FateUploadConfiguration $stateDirectory -AllowLocalTestEndpoint
    $scope = Join-Path $stateDirectory $initial.Scope
    $configPath = Join-Path $stateDirectory 'upload.clixml'
    Assert-True (![IO.File]::ReadAllText($configPath).Contains($keyText)) 'Upload key was persisted in plain text.'
    Assert-True (([PSCredential]::new('test', $initial.Key)).GetNetworkCredential().Password -ceq $keyText) 'The saved key could not be loaded.'
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
    $response.Offline = $true
    Invoke-Upload
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
    Set-FateUploadConfiguration -StateDirectory $stateDirectory -Origin "$origin/" -Key $key -AllowLocalTestEndpoint
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
    Set-FateUploadConfiguration -StateDirectory $stateDirectory -Origin 'http://127.0.0.1:9798' -Key $key -AllowLocalTestEndpoint
    $other = Get-FateUploadConfiguration $stateDirectory -AllowLocalTestEndpoint
    $response.Offline = $false
    $response.Status = 201
    Invoke-Upload -ForceRetry
    Assert-True ($other.Scope -ne $initial.Scope -and $requests.Count -eq 12) 'Changing endpoint forwarded old captures.'
    Disable-FateUpload $stateDirectory
    [void](Write-TestCapture)
    Invoke-Upload -ForceRetry
    Set-FateUploadConfiguration -StateDirectory $stateDirectory -Origin 'http://127.0.0.1:9798' -Key $key -AllowLocalTestEndpoint
    $enabledAgain = Get-FateUploadConfiguration $stateDirectory -AllowLocalTestEndpoint
    Invoke-Upload -ForceRetry
    Assert-True ($enabledAgain.Scope -ne $other.Scope -and $requests.Count -eq 12) 'Re-enabling uploaded captures from when upload was disabled.'

    [void](Write-TestCapture)
    $lock = Enter-FateUploadLock $stateDirectory
    try {
        Invoke-Upload
        Assert-True ($requests.Count -eq 12) 'The uploader ignored the cross-process lock.'
    } finally { $lock.Dispose() }
    Invoke-Upload
    Assert-True ($requests.Count -eq 13) 'Uploader did not recover after the lock was released.'
    Write-Output 'PASS: endpoint and enable sessions are isolated; the process lock prevents overlapping sends.'
} finally {
    $key.Dispose()
    $resolved = [IO.Path]::GetFullPath($testDirectory)
    if ([IO.Path]::GetDirectoryName($resolved) -eq $temporaryRoot -and
        [IO.Path]::GetFileName($resolved) -match '\AFateCollector test [0-9a-f-]{36}\z' -and
        [IO.Directory]::Exists($resolved)) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
