# Shared by the configuration dialog, the background uploader, and their tests.
. (Join-Path $PSScriptRoot 'CaptureContext.Common.ps1')
$script:FateUploadGuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
$script:FateUploadUtf8 = [Text.UTF8Encoding]::new($false, $true)
. (Join-Path $PSScriptRoot 'Consent.Common.ps1')

function Get-FateUploadStateDirectory {
    Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'FateCollector'
}

function Resolve-FateUploadOrigin([string]$Origin, [switch]$AllowLocalTestEndpoint) {
    $Origin = $Origin.Trim()
    $uri = $null
    if ($Origin -match '\Ahttps://(?:[a-zA-Z0-9.-]+|\[[0-9a-fA-F:]+\])(?::[0-9]{1,5})?/?\z' -and
        [Uri]::TryCreate($Origin, [UriKind]::Absolute, [ref]$uri) -and $uri.Port -gt 0) {
        return $uri.GetLeftPart([UriPartial]::Authority)
    }
    if ($AllowLocalTestEndpoint -and $Origin -cmatch '\Ahttp://127\.0\.0\.1:[0-9]{1,5}/?\z' -and
        [Uri]::TryCreate($Origin, [UriKind]::Absolute, [ref]$uri) -and $uri.Port -gt 0) {
        return "http://127.0.0.1:$($uri.Port)"
    }
    throw 'Enter the HTTPS site origin, without a path, query, or fragment.'
}

function Enter-FateUploadLock([string]$StateDirectory) {
    [void][IO.Directory]::CreateDirectory($StateDirectory)
    try {
        return [IO.File]::Open((Join-Path $StateDirectory 'upload.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    } catch [IO.IOException] {
        # This lock file stays on disk; Windows releases the lock even after a crash.
        $win32 = $_.Exception.HResult -band 0xffff
        if ($win32 -notin 32, 33) { throw }
    }
}

function Move-FateUploadAtomicFile([string]$TemporaryPath, [string]$Path) {
    if ([IO.File]::Exists($Path)) {
        [IO.File]::Replace($TemporaryPath, $Path, [NullString]::Value)
    } else {
        [IO.File]::Move($TemporaryPath, $Path)
    }
}

function Write-FateUploadAtomicText([string]$Path, [string]$Text) {
    $temporary = "$Path.$([guid]::NewGuid().ToString('N')).part"
    try {
        $bytes = $script:FateUploadUtf8.GetBytes($Text)
        $stream = [IO.File]::Open($temporary, 'CreateNew', 'Write', 'None')
        try {
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.Flush($true)
        } finally { $stream.Dispose() }
        Move-FateUploadAtomicFile $temporary $Path
    } finally {
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}

function Write-FateUploadState([string]$Path, $Value) {
    Write-FateUploadAtomicText $Path (ConvertTo-Json -InputObject $Value -Compress -Depth 6)
}

function Read-FateUploadState([string]$Path) {
    if ([IO.File]::Exists($Path)) {
        $stream = [IO.File]::Open($Path, 'Open', 'Read', ([IO.FileShare]::Read -bor [IO.FileShare]::Delete))
        try {
            $reader = [IO.StreamReader]::new($stream, $script:FateUploadUtf8)
            try { ConvertFrom-Json -InputObject $reader.ReadToEnd() } finally { $reader.Dispose() }
        } finally { $stream.Dispose() }
    }
}

function Write-FateUploadProtectedState([string]$Path, $Value) {
    $temporary = "$Path.$([guid]::NewGuid().ToString('N')).part"
    try {
        # Windows PowerShell protects SecureString with DPAPI for the current user.
        Export-Clixml -InputObject $Value -LiteralPath $temporary -ErrorAction Stop
        $stream = [IO.File]::Open($temporary, 'Open', 'Write', 'None')
        try { $stream.Flush($true) } finally { $stream.Dispose() }
        Move-FateUploadAtomicFile $temporary $Path
    } finally { [IO.File]::Delete($temporary) }
}

function ConvertTo-FateUploadTime($Value) {
    if ($Value -is [DateTime]) { return [DateTimeOffset]$Value }
    $time = [DateTimeOffset]::MinValue
    if ($Value -isnot [string] -or $Value -cnotmatch '\A\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|[+-]\d\d:\d\d)\z' -or
        ![DateTimeOffset]::TryParse($Value, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$time)) {
        throw 'Invalid timestamp.'
    }
    return $time
}

function Get-FateUploadConfiguration([string]$StateDirectory = (Get-FateUploadStateDirectory), [switch]$AllowLocalTestEndpoint) {
    $path = Join-Path $StateDirectory 'upload.clixml'
    if (![IO.File]::Exists($path)) { return }
    $configuration = Import-Clixml -LiteralPath $path
    if ($configuration.Version -eq 1) { return } # Old upload settings did not record explicit consent.
    if ($configuration.Version -ne 2 -or $configuration.Scope -cnotmatch "\A${script:FateUploadGuid}\z" -or
        $configuration.Revision -cnotmatch "\A${script:FateUploadGuid}\z" -or
        $configuration.Key -isnot [Security.SecureString]) {
        throw 'Cloud upload settings are invalid.'
    }
    $consent = Get-FateCaptureConsent $StateDirectory $configuration.Scope -AllowLocalTestEndpoint:$AllowLocalTestEndpoint
    if (!$consent) { throw 'Cloud upload consent is missing.' }
    [PSCustomObject]@{
        Scope = $configuration.Scope
        Revision = $configuration.Revision
        Key = $configuration.Key
        Origin = $consent.Origin
        EnabledSince = $consent.AcceptedAt
        Consent = $consent
        WithdrawalPath = Get-FateConsentPath $StateDirectory $configuration.Scope 'withdrawal.json'
    }
}

function Get-FateUploadSecretText([Security.SecureString]$Secret) {
    $handle = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secret)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($handle) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($handle) }
}

function Assert-FateUploadKey([Security.SecureString]$Key) {
    if ((Get-FateUploadSecretText $Key) -cnotmatch '\A[\x21-\x7e]{1,512}\z') {
        throw 'Enter a valid upload key without spaces.'
    }
}

function Test-FateUploadConsentActive($Configuration, [string]$StateDirectory) {
    !(Test-FateConsentWithdrawnLocally $StateDirectory $Configuration.Scope) -and
        (Test-FateCaptureConsentCurrent $Configuration.Consent (Get-FateCaptureConsentPolicy $Configuration.Origin))
}

function Get-FateCurrentUploadGate($Configuration, [string]$StateDirectory) {
    $paths = @(
        Get-FateConsentPath $StateDirectory $Configuration.Scope 'gate.json'
        Join-Path $StateDirectory "$($Configuration.Scope)/gate.json"
    )
    foreach ($path in $paths) {
        $gate = Read-FateUploadState $path
        if ($gate -and $gate.revision -ceq $Configuration.Revision -and $gate.status -in 'authorization', 'consent-required') {
            return $gate.status
        }
    }
}

function Set-FateUploadConfiguration {
    param(
        [string]$StateDirectory = (Get-FateUploadStateDirectory),
        [Parameter(Mandatory)][string]$Origin,
        [Parameter(Mandatory)][Security.SecureString]$Key,
        [switch]$ConsentAccepted,
        $DisplayedPolicy,
        [switch]$AllowLocalTestEndpoint
    )
    if (!$ConsentAccepted) { throw 'Explicit consent is required to enable cloud upload.' }
    $Origin = Resolve-FateUploadOrigin $Origin -AllowLocalTestEndpoint:$AllowLocalTestEndpoint
    $policy = Get-FateCaptureConsentPolicy $Origin
    if ($DisplayedPolicy -and ($DisplayedPolicy.Version -cne $policy.Version -or $DisplayedPolicy.Text -cne $policy.Text)) {
        throw 'The policy changed. Read the new consent text.'
    }
    Assert-FateUploadKey $Key
    $lock = Enter-FateUploadLock $StateDirectory
    if (!$lock) { throw 'The uploader is busy. Try again in a few seconds.' }
    try {
        # Broken settings can be replaced with a new configuration.
        $old = $null
        try { $old = Get-FateUploadConfiguration $StateDirectory -AllowLocalTestEndpoint:$AllowLocalTestEndpoint } catch {}
        $reuseConsent = $old -and $old.Origin -ceq $Origin -and
            (Test-FateUploadConsentActive $old $StateDirectory) -and
            (Get-FateCurrentUploadGate $old $StateDirectory) -ne 'consent-required'
        $configuration = [PSCustomObject]@{
            Version = 2
            Key = $Key
            Scope = if ($reuseConsent) { $old.Scope } else { New-FateCaptureConsent $StateDirectory $Origin $policy }
            Revision = [guid]::NewGuid().ToString()
        }
        Write-FateUploadProtectedState (Join-Path $StateDirectory 'upload.clixml') $configuration
    } finally { $lock.Dispose() }
}

function Disable-FateUpload([string]$StateDirectory = (Get-FateUploadStateDirectory), [string]$ConsentId, [switch]$AllowLocalTestEndpoint) {
    if (!$ConsentId) {
        $configuration = Get-FateUploadConfiguration $StateDirectory -AllowLocalTestEndpoint:$AllowLocalTestEndpoint
        if (!$configuration) { return }
        $ConsentId = $configuration.Scope
    }
    Save-FateCaptureConsentWithdrawal $StateDirectory $ConsentId -AllowLocalTestEndpoint:$AllowLocalTestEndpoint
}

function Read-FateCaptureBundle([string]$Path) {
    $stream = [IO.File]::Open($Path, 'Open', 'Read', 'Read')
    try {
        if ($stream.Length -gt 12MB) { return }
        $reader = [IO.StreamReader]::new($stream, $script:FateUploadUtf8)
        try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
    } finally { $stream.Dispose() }
}

function ConvertTo-FateUploadPayload($Bundle, [string]$Id, [DateTimeOffset]$EnabledSince) {
    if ($Bundle.kind -isnot [string] -or $Bundle.kind -cne 'fate-collector.capture' -or
        $Bundle.schemaVersion -isnot [int] -or $Bundle.schemaVersion -ne 1 -or
        $Bundle.source -isnot [string] -or $Bundle.source -cne 'windows-helper' -or
        $Bundle.captureId -isnot [string] -or $Bundle.captureId -ne $Id -or
        $Bundle.context.captureMode -isnot [string]) {
        throw 'Invalid bundle header.'
    }
    if ($Bundle.context.captureMode -ceq 'fixture') { return }
    if ($Bundle.context.captureMode -cne 'game') { throw 'Invalid capture mode.' }
    $capturedAt = ConvertTo-FateUploadTime $Bundle.capturedAt
    if ($capturedAt -le $EnabledSince) { return }
    if ($Bundle.helperVersion -isnot [string] -or $Bundle.helperVersion.Length -notin 1..40 -or
        $Bundle.image.width -isnot [int] -or $Bundle.image.width -lt 1 -or $Bundle.image.width -gt 8192 -or
        $Bundle.image.height -isnot [int] -or $Bundle.image.height -lt 1 -or $Bundle.image.height -gt 8192 -or
        $Bundle.image.width * $Bundle.image.height -gt 16777216 -or
        $Bundle.ocr.status -isnot [string] -or $Bundle.ocr.status -cnotin 'ok', 'unavailable', 'error' -or
        $Bundle.ocr.text -isnot [string] -or $Bundle.ocr.text.Length -gt 20000 -or
        $Bundle.ocr.lines -isnot [array] -or $Bundle.ocr.lines.Count -gt 500 -or
        ($null -ne $Bundle.ocr.language -and ($Bundle.ocr.language -isnot [string] -or $Bundle.ocr.language.Length -gt 40))) {
        throw 'Invalid capture data.'
    }
    $lines = @(
        foreach ($line in $Bundle.ocr.lines) {
            if ($line.text -isnot [string] -or $line.text.Length -gt 2000) { throw 'Invalid OCR line text.' }
            foreach ($key in 'x', 'y', 'width', 'height') {
                $value = $line.$key
                if (($value -isnot [int] -and $value -isnot [double] -and $value -isnot [long] -and $value -isnot [decimal]) -or
                    [double]::IsNaN($value) -or $value -lt 0 -or $value -gt 16384) { throw 'Invalid OCR line geometry.' }
            }
            [ordered]@{ text = $line.text; x = $line.x; y = $line.y; width = $line.width; height = $line.height }
        }
    )
    # Copy only the transport contract fields. Never serialize the source image or arbitrary extra properties.
    [ordered]@{
        kind = 'fate-collector.upload'
        schemaVersion = 1
        captureId = $Id
        capturedAt = $capturedAt.UtcDateTime.ToString('o')
        source = 'windows-helper'
        helperVersion = $Bundle.helperVersion
        context = ConvertTo-FateCaptureContext $Bundle.context $Id
        image = [ordered]@{ width = $Bundle.image.width; height = $Bundle.image.height }
        ocr = [ordered]@{ status = $Bundle.ocr.status; text = $Bundle.ocr.text; lines = $lines; language = $Bundle.ocr.language }
    }
}

function Invoke-FateUploadRequest($Configuration, [string]$Payload) {
    Invoke-FateCloudRequest -Origin $Configuration.Origin -Path '/api/captures' -Payload $Payload `
        -Key $Configuration.Key -ConsentId $Configuration.Scope -ConsentToken $Configuration.Consent.Token `
        -CancelIfExists $Configuration.WithdrawalPath
}

function Invoke-FateCloudRequest {
    param([string]$Origin, [string]$Path, [string]$Payload, [Security.SecureString]$Key,
        [string]$ConsentId, [Security.SecureString]$ConsentToken, [string]$CancelIfExists)
    Add-Type -AssemblyName System.Net.Http
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $handler.UseCookies = $false
    if ($Origin.StartsWith('http://')) { $handler.UseProxy = $false }
    $client = [Net.Http.HttpClient]::new($handler)
    try {
        $client.Timeout = [TimeSpan]::FromSeconds(5)
        $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, "$Origin$Path")
        try {
            if ($Key) {
                $request.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', (Get-FateUploadSecretText $Key))
            }
            if ($ConsentId) { $request.Headers.Add('X-Consent-Id', $ConsentId) }
            if ($ConsentToken) { $request.Headers.Add('X-Consent-Token', (Get-FateUploadSecretText $ConsentToken)) }
            $request.Content = [Net.Http.StringContent]::new($Payload, $script:FateUploadUtf8, 'application/json')
            if ($CancelIfExists -and [IO.File]::Exists($CancelIfExists)) { return }
            $response = $client.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
            try {
                $status = [int]$response.StatusCode
                $retryAfter = $response.Headers.RetryAfter
                $retrySeconds = 0
                if ($retryAfter) {
                    if ($retryAfter.Delta) { $retrySeconds = $retryAfter.Delta.TotalSeconds }
                    elseif ($retryAfter.Date) { $retrySeconds = ($retryAfter.Date - [DateTimeOffset]::UtcNow).TotalSeconds }
                }
                $receipt = $null
                if ($status -in 200, 201 -and ($null -eq $response.Content.Headers.ContentLength -or $response.Content.Headers.ContentLength -le 32KB)) {
                    $buffer = [byte[]]::new(32KB + 1)
                    $length = 0
                    $deadline = [Diagnostics.Stopwatch]::StartNew()
                    $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
                    try {
                        while ($length -lt $buffer.Length) {
                            $task = $stream.ReadAsync($buffer, $length, $buffer.Length - $length)
                            if (!$task.Wait([Math]::Max(0, 2000 - [int]$deadline.ElapsedMilliseconds))) { break }
                            if ($task.Result -eq 0) {
                                try { $receipt = ConvertFrom-Json -InputObject ($script:FateUploadUtf8.GetString($buffer, 0, $length)) } catch {}
                                break
                            }
                            $length += $task.Result
                        }
                    } finally { $stream.Dispose() }
                }
                return @{ Status = $status; Receipt = $receipt; RetrySeconds = $retrySeconds }
            } finally { $response.Dispose() }
        } finally { $request.Dispose() }
    } finally { $client.Dispose() }
}

# Read only durable uploader outcomes. An HTTP success without a validated receipt is never Uploaded.
function Get-FateCaptureUploadStatus {
    param([string]$StateDirectory, [string]$CaptureId, [switch]$AllowLocalTestEndpoint)
    if ($CaptureId -cnotmatch "\A$script:FateUploadGuid\z") { throw 'Invalid feedback capture ID.' }
    $configuration = Get-FateUploadConfiguration $StateDirectory -AllowLocalTestEndpoint:$AllowLocalTestEndpoint
    if (!$configuration) { return 'local' }
    if (Test-FateConsentWithdrawnLocally $StateDirectory $configuration.Scope) { return 'local' }
    if (!(Test-FateUploadConsentActive $configuration $StateDirectory)) { return 'consent-required' }
    $scope = Join-Path $StateDirectory $configuration.Scope
    $state = Read-FateUploadState (Join-Path $scope "states/$CaptureId.json")
    if ($state) {
        if ($state.status -in 'accepted', 'duplicate') { return 'uploaded' }
        if ($state.status -eq 'rejected') { return 'rejected' }
        if ($state.status -eq 'ignored') { return 'local' }
    }
    $pause = Get-FateCurrentUploadGate $configuration $StateDirectory
    if ($pause) { return $pause }
    if (!(Test-FateConsentReceipt (Read-FateUploadState (Get-FateConsentPath $StateDirectory $configuration.Scope 'recorded.json')) $configuration.Consent)) {
        $consentGate = Read-FateUploadState (Get-FateConsentPath $StateDirectory $configuration.Scope 'gate.json')
        if ($consentGate -and $consentGate.revision -ceq $configuration.Revision -and $consentGate.status -in 'offline', 'retry') {
            return $consentGate.status
        }
        return 'consent-pending'
    }
    if ($state -and $state.status -eq 'retry') {
        if ($state.httpStatus -eq 0) { return 'offline' }
        return 'retry'
    }
    return 'queued'
}

function Write-FateCaptureUploadFeedback {
    param([string]$StateDirectory, [string]$CaptureId, [string]$Path, [switch]$AllowLocalTestEndpoint, [switch]$Failed)
    $status = 'error'
    try {
        $status = Get-FateCaptureUploadStatus -StateDirectory $StateDirectory -CaptureId $CaptureId -AllowLocalTestEndpoint:$AllowLocalTestEndpoint
        if ($Failed -and $status -notin 'uploaded', 'rejected', 'authorization', 'consent-required') { $status = 'error' }
    } catch { $status = 'error' } # A settings/read failure must be visible, never a false success.
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Path)))
    Write-FateUploadAtomicText $Path "$CaptureId`n$status"
}

function Invoke-FateCaptureUploads {
    param(
        [Parameter(Mandatory)][string]$CapturesDirectory,
        [string]$StateDirectory = (Get-FateUploadStateDirectory),
        [switch]$AllowLocalTestEndpoint,
        [switch]$ForceRetry,
        [scriptblock]$Transport = ${function:Invoke-FateUploadRequest},
        [scriptblock]$ConsentTransport = ${function:Invoke-FateConsentRequest}
    )
    if (![IO.Directory]::Exists($StateDirectory)) { return }
    $lock = Enter-FateUploadLock $StateDirectory
    if (!$lock) { return }
    try {
        Invoke-FatePendingWithdrawals $StateDirectory $ConsentTransport -AllowLocalTestEndpoint:$AllowLocalTestEndpoint
        $configuration = Get-FateUploadConfiguration $StateDirectory -AllowLocalTestEndpoint:$AllowLocalTestEndpoint
        if (!$configuration) { return }
        if (!(Test-FateUploadConsentActive $configuration $StateDirectory)) {
            $receipt = Read-FateUploadState (Get-FateConsentPath $StateDirectory $configuration.Scope 'withdrawn.json')
            if ((Test-FateConsentWithdrawnLocally $StateDirectory $configuration.Scope) -and
                (Test-FateWithdrawalReceipt $receipt $configuration.Scope)) {
                # The uploader lock also excludes settings changes. Remove only the
                # current, confirmed-withdrawn configuration so the tray timer can stop.
                [IO.File]::Delete((Join-Path $StateDirectory 'upload.clixml'))
            }
            return
        }
        $scope = Join-Path $StateDirectory $configuration.Scope
        $queue = Join-Path $scope 'queue'
        $states = Join-Path $scope 'states'
        $gatePath = Join-Path $scope 'gate.json'
        [void][IO.Directory]::CreateDirectory($queue)
        [void][IO.Directory]::CreateDirectory($states)
        $since = ConvertTo-FateUploadTime $configuration.EnabledSince
        # A coarse filesystem timestamp can be slightly older than the actual capture.
        $fileCutoff = $since.UtcDateTime.AddSeconds(-2)
        $examined = 0
        if ([IO.Directory]::Exists($CapturesDirectory)) {
            foreach ($path in [IO.Directory]::EnumerateFiles($CapturesDirectory, 'fate-*.json')) {
                if ([IO.Path]::GetFileName($path) -notmatch "\Afate-($script:FateUploadGuid)\.json\z") { continue }
                $id = $Matches[1].ToLowerInvariant()
                $file = [IO.FileInfo]::new($path)
                if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
                    $file.LastWriteTimeUtc -lt $fileCutoff) { continue }
                $queuedPath = Join-Path $queue "$id.json"
                $statePath = Join-Path $states "$id.json"
                if ([IO.File]::Exists($queuedPath) -or [IO.File]::Exists($statePath)) { continue }
                $source = $null
                try { $source = Read-FateCaptureBundle $path }
                catch [IO.IOException] { continue }
                catch [UnauthorizedAccessException] { continue }
                catch [Text.DecoderFallbackException] {}
                $examined++
                try {
                    if (!$source) { throw 'Missing or oversized bundle.' }
                    $bundle = ConvertFrom-Json -InputObject $source
                    $payload = ConvertTo-FateUploadPayload $bundle $id $since
                    if ($payload) {
                        $serialized = ConvertTo-Json -InputObject $payload -Compress -Depth 6
                        if ($script:FateUploadUtf8.GetByteCount($serialized) -gt 128KB) { throw 'Oversized upload.' }
                    }
                } catch {
                    Write-FateUploadState $statePath @{ status = 'rejected'; reason = 'invalid-local-capture' }
                    if ($examined -ge 32) { break }
                    continue
                }
                if ($payload) {
                    Write-FateUploadAtomicText $queuedPath $serialized
                } else {
                    Write-FateUploadState $statePath @{ status = 'ignored' }
                }
                if ($examined -ge 32) { break }
            }
        }
        $gate = Read-FateUploadState $gatePath
        if ($gate -and $gate.revision -ceq $configuration.Revision) {
            if ($gate.status -in 'authorization', 'consent-required') { return }
            if (!$ForceRetry -and (ConvertTo-FateUploadTime $gate.retryAt) -gt [DateTimeOffset]::UtcNow) { return }
        }
        if (!(Confirm-FateUploadConsent $configuration $StateDirectory $ConsentTransport -ForceRetry:$ForceRetry)) { return }
        $attempted = 0
        foreach ($path in [IO.Directory]::EnumerateFiles($queue, '*.json')) {
            $id = [IO.Path]::GetFileNameWithoutExtension($path)
            if ($id -notmatch "\A$script:FateUploadGuid\z") { continue }
            $statePath = Join-Path $states "$id.json"
            $state = Read-FateUploadState $statePath
            if ($state) {
                if ($state.status -ne 'retry') {
                    Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
                    continue
                }
                if (!$ForceRetry -and (ConvertTo-FateUploadTime $state.retryAt) -gt [DateTimeOffset]::UtcNow) { continue }
            }
            $payload = [IO.File]::ReadAllText($path, $script:FateUploadUtf8)
            $attempted++
            $result = $null
            if (Test-FateConsentWithdrawnLocally $StateDirectory $configuration.Scope) { return }
            try { $result = & $Transport $configuration $payload } catch {}
            $status = if ($result) { [int]$result.Status } else { 0 }
            $receipt = if ($result) { $result.Receipt }
            $expected = if ($status -eq 201) { 'accepted' } elseif ($status -eq 200) { 'duplicate' }
            if ($expected -and $receipt -is [PSCustomObject] -and
                $receipt.PSObject.Properties['id'] -and $receipt.PSObject.Properties['status'] -and $receipt.PSObject.Properties['reviewed'] -and
                $receipt.id -is [string] -and $receipt.id -ceq $id -and
                $receipt.status -is [string] -and $receipt.status -ceq $expected -and
                $receipt.reviewed -is [bool] -and !$receipt.reviewed) {
                Write-FateUploadState $statePath @{ status = $expected; at = [DateTimeOffset]::UtcNow.ToString('o') }
                Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            } elseif ($status -in 400, 409, 413, 422) {
                Write-FateUploadState $statePath @{ status = 'rejected'; httpStatus = $status; at = [DateTimeOffset]::UtcNow.ToString('o') }
                Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            } elseif ($status -in 401, 403, 428) {
                $pause = if ($status -eq 401) { 'authorization' } else { 'consent-required' }
                Write-FateUploadState $gatePath @{ status = $pause; revision = $configuration.Revision }
                break
            } else {
                # Unknown responses, including redirects and malformed receipts, never acknowledge a capture.
                $attempt = if ($state) { [Math]::Min(10, 1 + [int]$state.attempt) } else { 1 }
                $backoff = [Math]::Min(900, 30 * [Math]::Pow(2, $attempt - 1))
                if ($result -and $result.RetrySeconds) {
                    $backoff = [Math]::Max($backoff, [Math]::Min(86400, [double]$result.RetrySeconds))
                }
                $retryAt = [DateTimeOffset]::UtcNow.AddSeconds($backoff).ToString('o')
                Write-FateUploadState $statePath @{ status = 'retry'; retryAt = $retryAt; attempt = $attempt; httpStatus = $status }
                if ($status -eq 429) {
                    Write-FateUploadState $gatePath @{ status = 'throttle'; revision = $configuration.Revision; retryAt = $retryAt }
                }
                break
            }
            if ($attempted -ge 4) { break }
        }
    } finally { $lock.Dispose() }
}
