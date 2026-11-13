param(
    [Parameter(Mandatory)][ValidateSet('Offline', 'Online', 'LostReceipt', 'WithdrawOffline', 'WithdrawOnline')][string]$Phase,
    [Parameter(Mandatory)][string]$StateDirectory,
    [Parameter(Mandatory)][string]$Origin
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
. (Join-Path $root 'helpers/CloudUpload.Common.ps1')
$captures = Join-Path $StateDirectory 'captures'
function Assert-Integration($Condition, [string]$Message) { if (!$Condition) { throw $Message } }

if ($Phase -eq 'Offline') {
    [void][IO.Directory]::CreateDirectory($captures)
    $key = ConvertTo-SecureString 'e2e-local-capture' -AsPlainText -Force
    try { Set-FateUploadConfiguration -StateDirectory $StateDirectory -Origin $Origin -Key $key -ConsentAccepted -AllowLocalTestEndpoint }
    finally { $key.Dispose() }
    $config = Get-FateUploadConfiguration $StateDirectory -AllowLocalTestEndpoint
    $ocr = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'fixtures/presskit-ocr.json') | ConvertFrom-Json
    $ids = @()
    $sessionId = [guid]::NewGuid().ToString()
    $startedAt = [DateTimeOffset]::UtcNow.ToString('o')
    foreach ($mode in 'ok', 'error', 'repeat', 'fixture', 'old') {
        $id = [guid]::NewGuid().ToString()
        $ids += $id
        $bundle = [ordered]@{
            kind = 'fate-collector.capture'; schemaVersion = 1; captureId = $id
            capturedAt = if ($mode -eq 'old') { [DateTimeOffset]::UtcNow.AddDays(-1).ToString('o') } else { [DateTimeOffset]::UtcNow.ToString('o') }
            source = 'windows-helper'; helperVersion = '0.2.0'
            context = @{ captureMode = if ($mode -eq 'fixture') { 'fixture' } else { 'game' } }
            # Only a transport fixture. No actual screen capture is performed in this test.
            image = @{ mimeType = 'image/png'; width = 3840; height = 2160; dataBase64 = 'LOCAL_IMAGE_SENTINEL' }
            ocr = if ($mode -eq 'error') { @{ status = 'error'; text = ''; lines = @(); language = $null } } else { $ocr }
        }
        if ($mode -in 'ok', 'error', 'repeat') {
            $bundle.context.session = @{ id = $sessionId; startedAt = $startedAt; sequence = $ids.Count }
            $bundle.context.area = @{ source = 'client-log'; category = 'map'; areaId = 'MapWorldsDunes'; areaLevel = 83; rawLog = 'LOCAL_LOG_SENTINEL' }
        }
        if ($mode -eq 'repeat') {
            $bundle.context.possibleDuplicate = @{ ofCaptureId = $ids[0]; reason = 'same-ocr-within-15s' }
        }
        Write-FateUploadAtomicText (Join-Path $captures "fate-$id.json") ($bundle | ConvertTo-Json -Depth 8 -Compress)
    }
    Write-FateUploadState (Join-Path $StateDirectory 'test-ids.json') $ids
}
$config = Get-FateUploadConfiguration $StateDirectory -AllowLocalTestEndpoint
$scope = Join-Path $StateDirectory $config.Scope
$ids = Read-FateUploadState (Join-Path $StateDirectory 'test-ids.json')
if ($Phase -eq 'WithdrawOffline') { Disable-FateUpload $StateDirectory -AllowLocalTestEndpoint }
if ($Phase -eq 'WithdrawOnline') {
    $retryPath = Get-FateConsentPath $StateDirectory $config.Scope 'withdrawal-retry.json'
    $retry = Read-FateUploadState $retryPath
    Assert-Integration ($retry.attempt -eq 1) 'The offline withdrawal did not persist a retry.'
    $retry.retryAt = [DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('o')
    Write-FateUploadState $retryPath $retry
}
if ($Phase -eq 'LostReceipt') {
    foreach ($id in $ids[0..2]) {
        # Simulate a process crash after remote commit, before a durable local receipt.
        $bundle = Read-FateCaptureBundle (Join-Path $captures "fate-$id.json") | ConvertFrom-Json
        $payload = ConvertTo-FateUploadPayload $bundle $id (ConvertTo-FateUploadTime $config.EnabledSince)
        Write-FateUploadAtomicText (Join-Path $scope "queue/$id.json") ($payload | ConvertTo-Json -Depth 6 -Compress)
        [IO.File]::Delete((Join-Path $scope "states/$id.json"))
    }
}
# Launch the actual one-shot CLI in a separate Windows PowerShell process.
& "$PSHOME/powershell.exe" -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'helpers/Upload-FateCaptures.ps1') `
    -CapturesDirectory $captures -StateDirectory $StateDirectory -AllowLocalTestEndpoint -ForceRetry `
    -FeedbackCaptureId $ids[0] -FeedbackPath (Join-Path $StateDirectory 'feedback.txt')
Assert-Integration ($LASTEXITCODE -eq 0) 'The uploader CLI failed.'
$feedback = [IO.File]::ReadAllText((Join-Path $StateDirectory 'feedback.txt')) -split "`n"
Assert-Integration ($feedback[0] -ceq $ids[0]) 'Feedback refers to a different capture.'
if ($Phase -in 'WithdrawOffline', 'WithdrawOnline') {
    $receipt = Read-FateUploadState (Get-FateConsentPath $StateDirectory $config.Scope 'withdrawn.json')
    Assert-Integration ($feedback[1] -eq 'local') 'A locally withdrawn consent must immediately stop upload.'
    Assert-Integration (Test-FateConsentWithdrawnLocally $StateDirectory $config.Scope) 'Withdrawal was not persisted.'
    if ($Phase -eq 'WithdrawOffline') {
        Assert-Integration (!$receipt) 'Withdrawal was confirmed while the collection was unreachable.'
    } else {
        Assert-Integration (Test-FateWithdrawalReceipt $receipt $config.Scope) 'The pending withdrawal was not confirmed after restart.'
    }
    foreach ($id in $ids) {
        Assert-Integration ([IO.File]::Exists((Join-Path $captures "fate-$id.json"))) 'Withdrawal removed a local capture.'
    }
    Write-Host "Native uploader integration: $Phase passed."
    return
}
$queued = @(Get-ChildItem -LiteralPath (Join-Path $scope 'queue') -Filter '*.json')
if ($Phase -eq 'Offline') {
    Assert-Integration ($queued.Count -eq 3) 'All game captures, including possible repeat, must survive the outage.'
    Assert-Integration ($feedback[1] -eq 'offline') 'Offline feedback incorrectly reports success.'
    $gate = Read-FateUploadState (Get-FateConsentPath $StateDirectory $config.Scope 'gate.json')
    Assert-Integration ($gate.status -eq 'offline') 'Connection failure must schedule a consent retry.'
    Assert-Integration (@($ids[0..2] | ForEach-Object { Read-FateUploadState (Join-Path $scope "states/$_.json") }).Count -eq 0) 'Tried to send capture data without a consent receipt.'
    foreach ($file in $queued) {
        Assert-Integration (!(Get-Content -Raw -LiteralPath $file.FullName).Contains('LOCAL_IMAGE_SENTINEL')) 'An image leaked into the queue.'
    }
} else {
    $receipt = Read-FateUploadState (Get-FateConsentPath $StateDirectory $config.Scope 'recorded.json')
    Assert-Integration (Test-FateConsentReceipt $receipt $config.Consent) 'Collection consent receipt was not persisted.'
    Assert-Integration ($queued.Count -eq 0) 'Confirmed uploads should leave no pending payloads.'
    Assert-Integration ($feedback[1] -eq 'uploaded') 'Confirmed online upload did not report Uploaded.'
    $expected = if ($Phase -eq 'Online') { 'accepted' } else { 'duplicate' }
    foreach ($id in $ids[0..2]) {
        $receipt = Read-FateUploadState (Join-Path $scope "states/$id.json")
        Assert-Integration ($receipt.status -eq $expected) "Expected a $expected receipt."
        Assert-Integration ([IO.File]::Exists((Join-Path $captures "fate-$id.json"))) 'The original capture must remain local.'
    }
}
foreach ($id in $ids[3..4]) {
    Assert-Integration ((Read-FateUploadState (Join-Path $scope "states/$id.json")).status -eq 'ignored') 'Fixtures and older captures must stay local.'
}
Write-Host "Native uploader integration: $Phase passed."
