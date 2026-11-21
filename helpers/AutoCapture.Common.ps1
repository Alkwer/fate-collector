. (Join-Path $PSScriptRoot 'CaptureContext.Common.ps1')
. (Join-Path $PSScriptRoot 'AreaContext.Common.ps1')
. (Join-Path $PSScriptRoot 'Ocr.Common.ps1')
. (Join-Path $PSScriptRoot 'WindowCapture.Common.ps1')

$script:FateAutoUtf8 = [Text.UTF8Encoding]::new($false, $true)
$script:FateAutoMaxAgeMs = 5000
$script:FateAutoNames = $null

function Get-FateAutoNames {
    if ($null -eq $script:FateAutoNames) {
        $path = Join-Path $script:FateOcrDirectory 'fate-names.json'
        if (![IO.File]::Exists($path)) { $path = Join-Path (Split-Path $script:FateOcrDirectory -Parent) 'shared/fate-names.json' }
        $catalog = Read-FateAutoText $path 16KB | ConvertFrom-Json
        $names = @{}
        foreach ($name in $catalog) {
            if ($name -isnot [string] -or $name -cnotmatch '\A[A-Za-z]+(?: [A-Za-z]+)*\z') { throw 'Invalid Fate names.' }
            $names[($name.ToLowerInvariant() -replace ' ', '')] = $true
        }
        if (!$names.Count) { throw 'Missing Fate names.' }
        $script:FateAutoNames = $names
    }
    return $script:FateAutoNames
}

function Get-FateOfferProbe($Ocr, [int]$Width, [int]$Height) {
    $uncertain = @{ Status = 'uncertain'; Signature = '' }
    if ($null -eq $Ocr -or $Ocr.status -cne 'ok' -or $Ocr.text.Length -gt 20000 -or
        $Ocr.lines.Count -lt 1 -or $Ocr.lines.Count -gt 500) { return $uncertain }
    $names = Get-FateAutoNames
    $lines = [Collections.Generic.List[object]]::new()
    foreach ($line in $Ocr.lines) {
        if ($line.text.Length -gt 2000 -or $line.x -lt 0 -or $line.y -lt 0 -or $line.width -le 0 -or $line.height -le 0 -or
            !($line.x + $line.width -le $Width) -or !($line.y + $line.height -le $Height)) { return $uncertain }
        $key = $line.text.ToLowerInvariant() -replace '[^a-z]', ''
        if (!$key) { continue }
        $lines.Add([pscustomobject]@{
            text = $line.text; key = $key; x = $line.x; y = $line.y; width = $line.width; height = $line.height
            center = $line.x + $line.width / 2; bottom = $line.y + $line.height
            known = $line.text.Trim() -cmatch '\A[A-Za-z]+(?:\s+[A-Za-z]+)*\z' -and $names.ContainsKey($key)
        })
    }
    # A blank OCR pass is not evidence that the panel closed.
    if (!$lines.Count) { return $uncertain }
    if (Test-FateInvocation $lines) { return $uncertain }
    $headings = @($lines | Where-Object { $_.key -in 'fates', 'selectafate' })
    $confirms = @($lines | Where-Object key -EQ 'confirm')
    if (!$headings.Count -and !$confirms.Count) {
        # Fragments and catalog names can survive when the controls do not.
        if (@($lines | Where-Object { $_.known -or $_.key -match '\A(?:fat|fate|selecta|selectaf[a-t]*|conf(?:i(?:r)?)?|invoke|invokefat?)\z' }).Count) {
            return $uncertain
        }
        return @{ Status = 'empty'; Signature = '' }
    }
    $pairs = @(
        foreach ($heading in $headings) {
            foreach ($confirm in $confirms) {
                if ($heading.bottom -lt $confirm.y -and (Test-FateControlAlignment $heading $confirm)) {
                    @{ Heading = $heading; Confirm = $confirm }
                }
            }
        }
    )
    if ($pairs.Count -ne 1) { return $uncertain }

    # Use the same control bounds and raised card allowance as shared/recognition.ts.
    $pair = $pairs[0]
    $region = @($lines | Where-Object {
        $_.y -ge $pair.Heading.bottom -and $_.bottom -lt $pair.Confirm.y -and $_.key -notin 'fates', 'selectafate', 'confirm'
    } | Sort-Object y, x)
    if (!$region.Count) { return $uncertain }
    $first = $region[0]
    $row = @($region | Where-Object { $_.y - $first.y -le [Math]::Max($first.height * 4, $Height * 0.06) })
    $headers = @($row | Where-Object known | Sort-Object center)
    if ($headers.Count -lt 1 -or $headers.Count -gt 9) { return $uncertain }
    $spacing = 0.0
    if ($headers.Count -gt 1) {
        $spacing = [double]::MaxValue
        $largestGap = 0.0
        for ($i = 1; $i -lt $headers.Count; $i++) {
            $left = $headers[$i - 1]; $right = $headers[$i]
            if ($left.x + $left.width -gt $right.x) { return $uncertain }
            $gap = $right.center - $left.center
            $spacing = [Math]::Min($spacing, $gap)
            $largestGap = [Math]::Max($largestGap, $gap)
        }
        # A missing middle header changes the regular column spacing.
        if ($largestGap -gt $spacing * 1.55) { return $uncertain }
    }
    $axisDistance = [Math]::Abs(($headers[0].center + $headers[-1].center) / 2 - $pair.Confirm.center)
    # A missing outer header shifts the row away from the panel axis.
    if ($axisDistance -gt [Math]::Max($pair.Confirm.width / 2, $spacing * 0.32)) { return $uncertain }
    $columnRadius = [Math]::Max($spacing * 0.48, $pair.Confirm.width)
    $headerBottom = ($headers | Measure-Object bottom -Maximum).Maximum
    $headerHeight = ($headers | Measure-Object height -Minimum).Minimum
    foreach ($line in $row | Where-Object { !$_.known }) {
        # The raised-card allowance may reach the first description line. Text
        # clearly below every header in an identified column is body copy, not
        # an unknown card. A separate column still abstains below.
        if ($line.y -gt $headerBottom + $headerHeight -and
            @($headers | Where-Object { [Math]::Abs($line.center - $_.center) -le $columnRadius }).Count) { continue }
        # Menu/selection glyphs above a named column can be OCR noise. A
        # same-row unknown or a separate text column may be a missing name.
        $aboveKnown = @($headers | Where-Object {
            $line.bottom -le $_.y -and [Math]::Abs($line.center - $_.center) -le $columnRadius
        })
        if (!$aboveKnown.Count -or $line.text -notmatch "[^A-Za-z0-9\s'-]") { return $uncertain }
    }
    foreach ($line in $region | Where-Object { $_.y -gt $headerBottom + $first.height -and $_.text.Trim().Length -gt 2 }) {
        if (!@($headers | Where-Object { [Math]::Abs($line.center - $_.center) -le $columnRadius }).Count) { return $uncertain }
    }
    # Keep selection motion, body OCR jitter, tooltip text and background pixels
    # out of the identifier. F9 remains available for same-name offers.
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $signature = [BitConverter]::ToString($sha.ComputeHash($script:FateAutoUtf8.GetBytes(($headers.key -join '|')))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
    return @{ Status = 'offer'; Signature = $signature }
}

function Read-FateAutoText([string]$Path, [int]$MaxBytes) {
    $fileInfo = [IO.FileInfo]::new($Path)
    if ($fileInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected scan file.' }
    # A writer renames complete files; permit replacement while reading a snapshot.
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::Read -bor [IO.FileShare]::Delete))
    try {
        if ($stream.Length -gt $MaxBytes) { throw 'Scan input is too large.' }
        $bytes = [byte[]]::new([int]$stream.Length)
        $position = 0
        while ($position -lt $bytes.Length) {
            $read = $stream.Read($bytes, $position, $bytes.Length - $position)
            if (!$read) { throw 'Scan input changed while reading.' }
            $position += $read
        }
        return $script:FateAutoUtf8.GetString($bytes).TrimStart([char]0xfeff)
    } finally { $stream.Dispose() }
}

function Get-FateAutoRequestId([string]$Text) {
    $ids = [regex]::Matches($Text, "(?m)^Id=($script:FateContextGuid)\r?$", [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($ids.Count -eq 1) { return $ids[0].Groups[1].Value.ToLowerInvariant() }
    return ''
}

function ConvertFrom-FateAutoRequest([string]$Text, [string]$CaptureDirectory) {
    if ($Text.Length -gt 4096) { throw 'Scan request is too large.' }
    $fields = @('Version', 'Id', 'WindowHandle', 'WindowPid', 'ClientWidth', 'ClientHeight', 'X', 'Y', 'Width', 'Height',
        'CaptureBackend', 'CandidateSignature', 'PublishedSignature', 'SessionId', 'SessionStartedAt', 'CaptureSequence', 'PreviousCapturePath')
    $lines = $Text.TrimEnd("`r", "`n") -split '\r?\n'
    if ($lines[0] -cne '[scan]') { throw 'Missing scan request header.' }
    $request = @{}
    foreach ($line in $lines | Select-Object -Skip 1) {
        $kv = $line.Split('=', 2)
        if ($kv.Count -ne 2 -or $kv[0] -cnotin $fields -or $request.ContainsKey($kv[0]) -or $kv[1] -match '[\x00-\x1F\x7F]') {
            throw 'Invalid scan request field.'
        }
        $request[$kv[0]] = $kv[1]
    }
    foreach ($field in $fields) {
        if (!$request.ContainsKey($field)) {
            if ($field -eq 'PreviousCapturePath') { $request[$field] = ''; continue }
            throw 'Missing scan request field.'
        }
    }
    if ($request.Version -cne '1' -or $request.Id -notmatch "\A$script:FateContextGuid\z" -or
        $request.SessionId -cnotmatch "\A$script:FateContextGuid\z" -or $request.CaptureBackend -cnotin 'auto', 'gdi', 'wgc' -or
        $request.CandidateSignature -notmatch '\A(?:[0-9a-f]{64})?\z' -or $request.PublishedSignature -notmatch '\A(?:[0-9a-f]{64})?\z') {
        throw 'Invalid scan request identity or mode.'
    }
    $sessionStarted = [DateTimeOffset]::MinValue
    if (![DateTimeOffset]::TryParseExact($request.SessionStartedAt, 'yyyyMMddHHmmss', [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$sessionStarted) -or $sessionStarted -gt [DateTimeOffset]::UtcNow) {
        throw 'Invalid scan session time.'
    }
    $hwnd = 0L
    if ($request.WindowHandle -notmatch '\A[0-9]{1,19}\z' -or ![long]::TryParse($request.WindowHandle, [ref]$hwnd) -or
        $hwnd -lt 1 -or ([IntPtr]::Size -eq 4 -and $hwnd -gt [int]::MaxValue)) { throw 'Invalid window handle.' }
    $request.WindowHandle = $hwnd
    foreach ($field in 'WindowPid', 'ClientWidth', 'ClientHeight', 'X', 'Y', 'Width', 'Height', 'CaptureSequence') {
        $value = 0
        if ($request[$field] -notmatch '\A[0-9]{1,10}\z' -or ![int]::TryParse($request[$field], [ref]$value)) {
            throw 'Invalid scan request number.'
        }
        $request[$field] = $value
    }
    if ($request.WindowPid -lt 1 -or $request.CaptureSequence -lt 1 -or $request.CaptureSequence -gt 1000000000 -or
        $request.ClientWidth -lt 1 -or $request.ClientWidth -gt 32768 -or $request.ClientHeight -lt 1 -or $request.ClientHeight -gt 32768 -or
        $request.Width -lt 1 -or $request.Width -gt 8192 -or $request.Height -lt 1 -or $request.Height -gt 8192 -or
        ([long]$request.Width * $request.Height) -gt 16777216 -or
        ([long]$request.X + $request.Width) -gt $request.ClientWidth -or ([long]$request.Y + $request.Height) -gt $request.ClientHeight) {
        throw 'Invalid scan geometry or capture sequence.'
    }
    if ($request.PreviousCapturePath) {
        $prior = $request.PreviousCapturePath
        if ($prior -notmatch '\A[A-Za-z]:[\\/]' -or
            [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($prior)) -ine $CaptureDirectory -or
            [IO.Path]::GetFileName($prior) -notmatch "\A(?:auto-)?fate-$script:FateContextGuid\.json\z") {
            throw 'Invalid previous capture path.'
        }
        $request.PreviousCapturePath = [IO.Path]::GetFullPath($prior)
    }
    $request.Id = $request.Id.ToLowerInvariant()
    $request.CandidateSignature = $request.CandidateSignature.ToLowerInvariant()
    $request.PublishedSignature = $request.PublishedSignature.ToLowerInvariant()
    return $request
}

function Write-FateAutoFile([string]$Path, [byte[]]$Bytes, [switch]$Replace) {
    $pending = $Path + '.part'
    $file = [IO.File]::Open($pending, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        try { $file.Write($Bytes, 0, $Bytes.Length) }
        finally { $file.Dispose() }
        if ($Replace -and [IO.File]::Exists($Path)) {
            [IO.File]::Replace($pending, $Path, [NullString]::Value)
        } else {
            [IO.File]::Move($pending, $Path)
        }
    } finally { [IO.File]::Delete($pending) }
}

function Write-FateAutoResult([string]$Directory, [string]$Id, $Result) {
    $value = "[scan]`r`nVersion=1`r`nId=$Id`r`nStatus=$($Result.Status)`r`nSignature=$($Result.Signature)`r`nSaved=$($Result.Saved)`r`nObservedAt=$($Result.ObservedAt)`r`n"
    Write-FateAutoFile (Join-Path $Directory 'result.ini') ($script:FateAutoUtf8.GetBytes($value)) -Replace
}

function Write-FateAutoBundle($Request, [string]$Directory, [string]$HelperVersion, [DateTimeOffset]$CapturedAt, [byte[]]$Png, $Ocr, $Area) {
    $prior = $null
    if ($Request.PreviousCapturePath) {
        try {
            $prior = Read-FateAutoText $Request.PreviousCapturePath 12MB | ConvertFrom-Json
            # Newer PowerShell versions can deserialize ISO 8601 strings as DateTime.
            if ($prior.capturedAt -is [DateTime]) { $prior.capturedAt = $prior.capturedAt.ToString('o') }
        }
        catch { $prior = $null } # The prior capture is optional evidence.
    }
    $context = New-FateCaptureContext -Mode 'game' -CaptureId $Request.Id -CapturedAt $CapturedAt -SessionId $Request.SessionId `
        -SessionStartedAt $Request.SessionStartedAt -Sequence $Request.CaptureSequence -Ocr $Ocr -Width $Request.Width -Height $Request.Height -Previous $prior -Area $Area
    $bundle = [ordered]@{
        kind = 'fate-collector.capture'; schemaVersion = 1; captureId = $Request.Id
        capturedAt = $CapturedAt.UtcDateTime.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
        source = 'windows-helper'; helperVersion = $HelperVersion
        image = [ordered]@{
            mimeType = 'image/png'; width = $Request.Width; height = $Request.Height; frameHeight = $Request.ClientHeight
            dataBase64 = [Convert]::ToBase64String($Png)
        }
        ocr = $Ocr; context = $context
    }
    $bytes = $script:FateAutoUtf8.GetBytes(($bundle | ConvertTo-Json -Depth 6 -Compress))
    if ($bytes.Length -gt 12MB) { throw 'Scan bundle exceeds the size limit.' }
    $path = Join-Path $Directory ("fate-" + $Request.Id + '.json')
    Write-FateAutoFile $path $bytes
    return $path
}

function Invoke-FateAutoScan($Request, [string]$Directory, [string]$HelperVersion, $Parent) {
    $observedAt = 0
    $candidate = $null
    try {
        $coordinates = @{
            WindowHandle = $Request.WindowHandle; WindowPid = $Request.WindowPid; ClientWidth = $Request.ClientWidth
            ClientHeight = $Request.ClientHeight; X = $Request.X; Y = $Request.Y; Width = $Request.Width; Height = $Request.Height
        }
        $failureCode = 1
        $areaBefore = Get-FateAreaSnapshot $Request.WindowPid
        $clock = [Diagnostics.Stopwatch]::StartNew()
        $capturedAt = [DateTimeOffset]::UtcNow
        $png = Get-FateWindowPng @coordinates -CaptureBackend $Request.CaptureBackend -CompilerDirectory $Directory -FailureCode ([ref]$failureCode)
        $observedAt = $capturedAt.ToUnixTimeMilliseconds()
        $origin = Get-FateAutoOrigin $Request
        $area = Resolve-FateCapturedArea $areaBefore (Get-FateAreaSnapshot $Request.WindowPid)
        if (!$png.Length -or $png.Length -ge 9MB) { throw 'Scan image is outside size limits.' }
        $ocr = Get-OcrResult -Png $png -ImageWidth $Request.Width -ImageHeight $Request.Height
        $probe = Get-FateOfferProbe $ocr $Request.Width $Request.Height
        Confirm-FateAutoFrame $Request $origin $Parent $clock
        $saved = 0
        if ($probe.Status -eq 'offer' -and $probe.Signature -ceq $Request.CandidateSignature -and $probe.Signature -cne $Request.PublishedSignature) {
            $candidate = Write-FateAutoBundle $Request $Directory $HelperVersion $capturedAt $png $ocr $area
            Confirm-FateAutoFrame $Request $origin $Parent $clock
            $saved = 1
        }
        return @{ Status = $probe.Status; Signature = $probe.Signature; Saved = $saved; ObservedAt = $observedAt }
    } catch {
        if ($candidate) { [IO.File]::Delete($candidate) }
        return @{ Status = 'error'; Signature = ''; Saved = 0; ObservedAt = $observedAt }
    }
}

function Get-FateAutoOrigin($Request) {
    return [FateCaptureWindow]::GetCrop([IntPtr]$Request.WindowHandle, $Request.WindowPid, $Request.ClientWidth, $Request.ClientHeight,
        $Request.X, $Request.Y, $Request.Width, $Request.Height)
}

function Confirm-FateAutoFrame($Request, $Origin, $Parent, [Diagnostics.Stopwatch]$Clock) {
    if ($Parent.HasExited -or $Clock.ElapsedMilliseconds -gt $script:FateAutoMaxAgeMs) { throw 'Scan frame expired.' }
    $now = Get-FateAutoOrigin $Request
    if ($now.X -ne $Origin.X -or $now.Y -ne $Origin.Y) { throw 'Game window moved during scan.' }
}
