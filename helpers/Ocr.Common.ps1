# Windows OCR with multiple passes. Component attribution: THIRD_PARTY_NOTICES.md.
# Exact candidate text is retained; this module never fills in names, tiers or rewards.
$script:FateOcrDirectory = $PSScriptRoot

function Wait-WinRtResult($Operation, [type]$ResultType) {
    $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    return $task.GetAwaiter().GetResult()
}

function Invoke-FateOcrPass([byte[]]$Png, $Engine, [int]$ImageWidth, [int]$ImageHeight,
                            [double]$ScaleX = 1, [double]$ScaleY = 1, [int]$Padding = 0) {
    $memory = [IO.MemoryStream]::new($Png, $false)
    try {
        $stream = [IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($memory)
        try {
            $decoder = Wait-WinRtResult ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
            $bitmap = Wait-WinRtResult ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
            try { $recognized = Wait-WinRtResult ($Engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult]) }
            finally { $bitmap.Dispose() }
        } finally { $stream.Dispose() }
    } finally { $memory.Dispose() }
    $lines = @(
        foreach ($line in $recognized.Lines) {
            $left = [double]$ImageWidth; $top = [double]$ImageHeight; $right = $bottom = 0.0
            foreach ($word in $line.Words) {
                $rect = $word.BoundingRect
                $left = [Math]::Min($left, [Math]::Max(0, ($rect.X - $Padding) / $ScaleX))
                $top = [Math]::Min($top, [Math]::Max(0, ($rect.Y - $Padding) / $ScaleY))
                $right = [Math]::Max($right, [Math]::Min($ImageWidth, ($rect.X + $rect.Width - $Padding) / $ScaleX))
                $bottom = [Math]::Max($bottom, [Math]::Min($ImageHeight, ($rect.Y + $rect.Height - $Padding) / $ScaleY))
            }
            if ($right -gt $left -and $bottom -gt $top) {
                [ordered]@{ text = [string]$line.Text; x = $left; y = $top; width = $right - $left; height = $bottom - $top }
            }
        }
    )
    $text = [string](($lines | ForEach-Object { $_.text }) -join "`n")
    if ($lines.Count -gt 500 -or $text.Length -gt 20000 -or @($lines | Where-Object { $_.text.Length -gt 2000 }).Count -gt 0) {
        throw 'Windows OCR returned too much text. Choose a tighter crop.'
    }
    return @{ text = $text; lines = $lines }
}

function Select-FateOcrPass($Original, $Normalized, [string[]]$Names) {
    if ($null -eq $Normalized -or !$Normalized.text.Trim()) { return $Original }
    $known = @{}; foreach ($name in $Names) { $known[$name.ToLowerInvariant()] = $true }
    $newHeaders = @($Normalized.lines | Where-Object { $known.ContainsKey(($_.text.ToLowerInvariant() -replace '[^a-z]', '')) })
    for ($leftIndex = 0; $leftIndex -lt $newHeaders.Count; $leftIndex++) {
        for ($rightIndex = $leftIndex + 1; $rightIndex -lt $newHeaders.Count; $rightIndex++) {
            $a = $newHeaders[$leftIndex]; $b = $newHeaders[$rightIndex]
            $overlapX = [Math]::Min($a.x + $a.width, $b.x + $b.width) - [Math]::Max($a.x, $b.x)
            $overlapY = [Math]::Min($a.y + $a.height, $b.y + $b.height) - [Math]::Max($a.y, $b.y)
            if ($overlapX -gt 0 -and $overlapY -gt 0 -and
                $overlapX * $overlapY -gt 0.5 * [Math]::Min($a.width * $a.height, $b.width * $b.height)) { return $Original }
        }
    }
    if ($null -eq $Original -or !$Original.text.Trim()) { return $Normalized }
    $originalHeaders = @($Original.lines | Where-Object { $known.ContainsKey(($_.text.ToLowerInvariant() -replace '[^a-z]', '')) })
    # Extra recognized headers are useful only if no original header is lost or
    # moved to another card. Ties, conflicts and unknown-only output keep raw OCR.
    if ($newHeaders.Count -le $originalHeaders.Count) { return $Original }
    $used = @{}
    foreach ($header in $originalHeaders) {
        $match = -1
        for ($index = 0; $index -lt $newHeaders.Count; $index++) {
            $candidate = $newHeaders[$index]
            if (!$used.ContainsKey($index) -and
                ($header.text.ToLowerInvariant() -replace '[^a-z]', '') -ceq ($candidate.text.ToLowerInvariant() -replace '[^a-z]', '') -and
                [Math]::Abs(($header.x + $header.width / 2) - ($candidate.x + $candidate.width / 2)) -le [Math]::Max($header.width, $candidate.width) / 2 -and
                [Math]::Abs(($header.y + $header.height / 2) - ($candidate.y + $candidate.height / 2)) -le [Math]::Max($header.height, $candidate.height)) {
                $match = $index; break
            }
        }
        if ($match -lt 0) { return $Original }
        $used[$match] = $true
    }
    return $Normalized
}

function Get-OcrResult([byte[]]$Png, [int]$ImageWidth, [int]$ImageHeight, [string]$OcrLanguage,
                       [ValidateSet('auto', 'original', 'normalized')][string]$OcrMode = 'auto') {
    $ocr = [ordered]@{ status = 'unavailable'; text = ''; lines = @(); language = $null }
    try {
        Add-Type -AssemblyName System.Runtime.WindowsRuntime
        [void][Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
        [void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
        [void][Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
        [void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
        [void][Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]
        $languages = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages)
        $engine = $null
        if ($OcrLanguage) {
            $language = $languages | Where-Object LanguageTag -EQ $OcrLanguage | Select-Object -First 1
            if ($null -eq $language) { return $ocr }
            $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
        } else {
            $english = $languages | Where-Object LanguageTag -Match '^en(-|$)' |
                Sort-Object { if ($_.LanguageTag -eq 'en-US') { 0 } else { 1 } } | Select-Object -First 1
            if ($null -ne $english) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($english) }
            if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
            if ($null -eq $engine -and $languages.Count -gt 0) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($languages[0]) }
        }
        if ($null -eq $engine) { return $ocr }
    } catch { Write-Verbose ("Windows OCR is unavailable. " + $_.Exception.Message); return $ocr }
    $ocr.status = 'error'
    $ocr.language = [string]$engine.RecognizerLanguage.LanguageTag
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1
    } | Select-Object -First 1
    $original = $normalized = $null
    if ($OcrMode -ne 'normalized') {
        try { $original = Invoke-FateOcrPass $Png $engine $ImageWidth $ImageHeight }
        catch { Write-Verbose ("Original OCR failed. " + $_.Exception.Message) }
    }
    if ($OcrMode -ne 'original') {
        try {
            if (-not ('FateOcrImage' -as [type])) {
                Add-Type -Path (Join-Path $script:FateOcrDirectory 'OcrImage.cs') -ReferencedAssemblies System.Drawing
            }
            $prepared = [FateOcrImage]::Prepare($Png, [Windows.Media.Ocr.OcrEngine]::MaxImageDimension)
            $normalized = Invoke-FateOcrPass $prepared.Png $engine $ImageWidth $ImageHeight $prepared.ScaleX $prepared.ScaleY $prepared.Padding
        } catch { Write-Verbose ("Normalized OCR failed. " + $_.Exception.Message) }
    }
    $selected = $original
    if ($OcrMode -eq 'normalized') { $selected = $normalized }
    elseif ($OcrMode -eq 'auto') {
        try {
            $catalogPath = Join-Path $script:FateOcrDirectory 'fate-names.json'
            if (![IO.File]::Exists($catalogPath)) { $catalogPath = Join-Path (Split-Path $script:FateOcrDirectory -Parent) 'shared/fate-names.json' }
            $names = [IO.File]::ReadAllText($catalogPath) | ConvertFrom-Json
            $selected = Select-FateOcrPass $original $normalized $names
        } catch {
            Write-Verbose ("OCR comparison unavailable; retaining original pass. " + $_.Exception.Message)
            if ($null -eq $original) { $selected = $normalized }
        }
    }
    if ($null -ne $selected) {
        $ocr.status = 'ok'; $ocr.text = $selected.text; $ocr.lines = $selected.lines
        Write-Verbose $(if ([Object]::ReferenceEquals($selected, $normalized)) { 'Selected normalized OCR.' } else { 'Selected original OCR.' })
    }
    return $ocr
}
