# Windows OCR with multiple passes. Component attribution: THIRD_PARTY_NOTICES.md.
# Counter glyphs can be read from the PNG. This module never fills in names, tiers or rewards.
$script:FateOcrDirectory = $PSScriptRoot
. (Join-Path $PSScriptRoot 'OcrCardText.Common.ps1')

function Wait-WinRtResult($Operation, [type]$ResultType) {
    $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    return $task.GetAwaiter().GetResult()
}

function New-PositionedOcrLine($Words, [string]$Text) {
    $left = $top = [double]::PositiveInfinity
    $right = $bottom = 0.0
    foreach ($word in $Words) {
        $left = [Math]::Min($left, $word.x)
        $top = [Math]::Min($top, $word.y)
        $right = [Math]::Max($right, $word.x + $word.width)
        $bottom = [Math]::Max($bottom, $word.y + $word.height)
    }
    return [ordered]@{ text = $Text; x = $left; y = $top; width = $right - $left; height = $bottom - $top; words = $Words }
}

function Invoke-FateOcrPass([byte[]]$Png, $Engine, [int]$ImageWidth, [int]$ImageHeight,
                            [double]$ScaleX = 1, [double]$ScaleY = 1, [int]$Padding = 0,
                            [int]$OffsetX = 0, [int]$OffsetY = 0) {
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
            $words = @(
                foreach ($word in $line.Words) {
                    $rect = $word.BoundingRect
                    $left = [Math]::Max(0, $OffsetX + ($rect.X - $Padding) / $ScaleX)
                    $top = [Math]::Max(0, $OffsetY + ($rect.Y - $Padding) / $ScaleY)
                    $right = [Math]::Min($ImageWidth, $OffsetX + ($rect.X + $rect.Width - $Padding) / $ScaleX)
                    $bottom = [Math]::Min($ImageHeight, $OffsetY + ($rect.Y + $rect.Height - $Padding) / $ScaleY)
                    if ($right -gt $left -and $bottom -gt $top) {
                        @{ text = [string]$word.Text; x = $left; y = $top; width = $right - $left; height = $bottom - $top }
                    }
                }
            )
            if ($words.Count) { New-PositionedOcrLine $words $line.Text }
        }
    )
    $text = [string](($lines | ForEach-Object { $_.text }) -join "`n")
    if ($lines.Count -gt 500 -or $text.Length -gt 20000 -or @($lines | Where-Object { $_.text.Length -gt 2000 }).Count -gt 0) {
        throw 'Windows OCR returned too much text. Choose a tighter crop.'
    }
    return @{ text = $text; lines = $lines }
}

function Test-FateControlAlignment($A, $B) {
    return [Math]::Abs(($A.x + $A.width / 2) - ($B.x + $B.width / 2)) -le [Math]::Max($A.width, $B.width) / 2
}

function Test-FateInvocation($Lines) {
    if (@($Lines | Where-Object { ($_.text -replace '[^a-z]', '') -eq 'invokefates' }).Count) { return $true }
    $fates = @($Lines | Where-Object { ($_.text -replace '[^a-z]', '') -eq 'fates' })
    foreach ($invoke in $Lines | Where-Object { ($_.text -replace '[^a-z]', '') -eq 'invoke' }) {
        foreach ($heading in $fates) {
            $height = [Math]::Max($heading.height, $invoke.height)
            $gap = $heading.x - ($invoke.x + $invoke.width)
            if ($gap -ge 0 -and $gap -le $height * 2 -and [Math]::Abs($heading.y - $invoke.y) -le $height / 2) { return $true }
            if ($heading.y -ge $invoke.y -and
                $heading.y - ($invoke.y + $invoke.height) -le [Math]::Max($invoke.height, $heading.height) * 1.5 -and
                (Test-FateControlAlignment $invoke $heading)) { return $true }
        }
    }
    return $false
}

function Find-FateConfirmLine($Candidates, $HeadingLines, [string]$Pattern = '^\s*confirm\s*$') {
    $headings = @($HeadingLines | Where-Object { ($_.text -replace '[^a-z]', '') -in 'fates', 'selectafate' })
    $aligned = @(
        foreach ($candidate in $Candidates | Where-Object { $_.text -match $Pattern }) {
            foreach ($heading in $headings) {
                if ($heading.y + $heading.height -lt $candidate.y -and (Test-FateControlAlignment $heading $candidate)) {
                    $candidate
                }
            }
        }
    )
    if ($aligned.Count -eq 1) { return $aligned[0] }
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
    if ($newHeaders.Count -lt $originalHeaders.Count) { return $Original }
    $originalInvocation = Test-FateInvocation $Original.lines
    $normalizedInvocation = Test-FateInvocation $Normalized.lines
    if ($originalInvocation -and !$normalizedInvocation) { return $Original }
    # On a tie, use the new pass only if it reads the button below the panel heading.
    if ($newHeaders.Count -eq $originalHeaders.Count) {
        if ($originalInvocation -or $normalizedInvocation -or
            @($Original.lines | Where-Object { $_.text -match '^\s*confirm\s*$' }).Count) { return $Original }
        $confirm = Find-FateConfirmLine $Normalized.lines $Normalized.lines
        if ($null -eq $confirm -or !(Find-FateConfirmLine $confirm $Original.lines)) { return $Original }
    }
    # Preserve every original header at its card position, even when the new pass reads the button.
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

function Merge-FateConfirmLine($Selected, $Fragment, $ReadLines) {
    $confirm = Find-FateConfirmLine $ReadLines $Selected.lines
    if ($null -eq $confirm) { return $Selected }
    $overlapX = [Math]::Min($Fragment.x + $Fragment.width, $confirm.x + $confirm.width) - [Math]::Max($Fragment.x, $confirm.x)
    $overlapY = [Math]::Min($Fragment.y + $Fragment.height, $confirm.y + $confirm.height) - [Math]::Max($Fragment.y, $confirm.y)
    if ($overlapX -lt $Fragment.width / 2 -or $overlapY -lt $Fragment.height / 2) { return $Selected }
    $lines = @(
        foreach ($line in $Selected.lines) {
            if ([Object]::ReferenceEquals($line, $Fragment)) { $confirm } else { $line }
        }
    )
    $text = [string](($lines | ForEach-Object { $_.text }) -join "`n")
    if ($text.Length -gt 20000) { return $Selected }
    return @{ text = $text; lines = $lines }
}

function Read-FateConfirm($Selected, $Other, [byte[]]$Png, $Engine, [int]$ImageWidth, [int]$ImageHeight) {
    if ($null -eq $Selected -or @($Selected.lines | Where-Object { $_.text -match '^\s*confirm\s*$' }).Count -or
        (Test-FateInvocation $Selected.lines) -or ($null -ne $Other -and (Test-FateInvocation $Other.lines))) { return $Selected }
    $fragment = Find-FateConfirmLine $Selected.lines $Selected.lines '^\s*confir\s*$'
    if ($null -eq $fragment) { return $Selected }
    # Re-read the pixels around the truncated label once. The fragment only locates the crop.
    $margin = 3 * $fragment.height
    $x = [int][Math]::Max(0, [Math]::Floor($fragment.x - $margin))
    $y = [int][Math]::Max(0, [Math]::Floor($fragment.y - $margin))
    $width = [int][Math]::Min($ImageWidth, [Math]::Ceiling($fragment.x + $fragment.width + $margin)) - $x
    $height = [int][Math]::Min($ImageHeight, [Math]::Ceiling($fragment.y + $fragment.height + $margin)) - $y
    if ($width -gt 512 -or $height -gt 256) { return $Selected }
    $region = [Drawing.Rectangle]::new($x, $y, $width, $height)
    $prepared = [FateOcrImage]::Prepare($Png, [Windows.Media.Ocr.OcrEngine]::MaxImageDimension, $region)
    $button = Invoke-FateOcrPass $prepared.Png $Engine $ImageWidth $ImageHeight $prepared.ScaleX $prepared.ScaleY $prepared.Padding $x $y
    $merged = Merge-FateConfirmLine $Selected $fragment $button.lines
    if (![Object]::ReferenceEquals($merged, $Selected)) { Write-Verbose 'Read Confirm from the cropped button.' }
    return $merged
}

function Test-FatePanelCounter($Counter, $Lines) {
    $centerX = $Counter.Bounds.X + $Counter.Bounds.Width / 2
    $centerY = $Counter.Bounds.Y + $Counter.Bounds.Height / 2
    $scale = $Counter.SlashHeight
    foreach ($line in $Lines) {
        $offsetX = ($line.x + $line.width / 2 - $centerX) / $scale
        $offsetY = ($line.y + $line.height / 2 - $centerY) / $scale
        if ($offsetX -lt 5.0 -or $offsetX -gt 9.6) { continue }
        if ($line.text -match '^\s*confirm\s*$' -and $offsetX -le 8.1 -and $offsetY -ge -.35 -and $offsetY -le .65 -and
            $line.width -ge 3 * $scale -and $line.width -le 6 * $scale) { return $true }
        $title = $line.text -replace '[^a-z]', ''
        # OCR can retain only the rightmost word of "Invoke Fates". Its center is farther right.
        $maxTitleOffset = if ($title -eq 'fates') { 9.6 } else { 8.1 }
        if ($title -in 'fates', 'invokefates', 'selectafate' -and $offsetX -le $maxTitleOffset -and
            $offsetY -ge -30 -and $offsetY -le -10) { return $true }
    }
    return $false
}

function Get-FateDimCounterRegion($Lines) {
    $titles = @($Lines | Where-Object { $_.text -match '^\s*(?:invoke\s+)?fates\s*$' })
    if ($titles.Count -ne 1) { return [Drawing.Rectangle]::Empty }
    $title = $titles[0]
    $unit = $title.height
    if ($unit -lt 6 -or $unit -gt 80) { return [Drawing.Rectangle]::Empty }
    $axis = $title.x + $title.width / 2
    $leftUnits = if ($title.text -match '^\s*fates\s*$') { 13 } else { 10 }
    return [Drawing.Rectangle]::FromLTRB([int]($axis - $leftUnits * $unit), [int]($title.y + 9 * $unit),
        [int]($axis - 3 * $unit), [int]($title.y + 32 * $unit))
}

function Read-FateCounterButton($Counters, $Selected, $Other, [byte[]]$Png, $Engine, [int]$ImageWidth, [int]$ImageHeight) {
    $candidates = @($Counters | Where-Object { $_.HasPlaqueTrim -and !$_.IsIsolatedPlaque })
    if ($candidates.Count -ne 1) { return $null }
    $counter = $candidates[0]
    $lines = @($Selected.lines)
    if ($null -ne $Other) { $lines += @($Other.lines) }
    if (Test-FatePanelCounter $counter $lines) { return $null }

    # Read the adjacent button at the scale of the verified plaque lettering.
    $scale = $counter.SlashHeight
    $centerX = $counter.Bounds.X + $counter.Bounds.Width / 2
    $centerY = $counter.Bounds.Y + $counter.Bounds.Height / 2
    $x = [int][Math]::Max(0, [Math]::Floor($centerX + 3.7 * $scale))
    $y = [int][Math]::Max(0, [Math]::Floor($centerY - .59 * $scale))
    $right = [int][Math]::Min($ImageWidth, [Math]::Ceiling($centerX + 9.3 * $scale))
    $bottom = [int][Math]::Min($ImageHeight, [Math]::Ceiling($centerY + .59 * $scale))
    if ($right -le $x -or $bottom -le $y) { return $null }
    $region = [Drawing.Rectangle]::FromLTRB($x, $y, $right, $bottom)
    $prepared = [FateOcrImage]::Prepare($Png, [Windows.Media.Ocr.OcrEngine]::MaxImageDimension, $region)
    $result = Invoke-FateOcrPass $prepared.Png $Engine $ImageWidth $ImageHeight $prepared.ScaleX $prepared.ScaleY $prepared.Padding $x $y
    $exact = @($result.lines | Where-Object { $_.text -match '^\s*confirm\s*$' })
    if ($exact.Count -eq 1 -and (Test-FatePanelCounter $counter $exact)) { return $exact[0] }
    return $null
}

function Test-FateCounterOverlap($Word, [Drawing.Rectangle]$Bounds) {
    $centerX = $Word.x + $Word.width / 2
    $centerY = $Word.y + $Word.height / 2
    if ($centerX -lt $Bounds.Left -or $centerX -ge $Bounds.Right -or
        $centerY -lt $Bounds.Top -or $centerY -ge $Bounds.Bottom) { return $false }
    $width = [Math]::Max(0, [Math]::Min($Word.x + $Word.width, $Bounds.Right) - [Math]::Max($Word.x, $Bounds.Left))
    $height = [Math]::Max(0, [Math]::Min($Word.y + $Word.height, $Bounds.Bottom) - [Math]::Max($Word.y, $Bounds.Top))
    return $width * $height -ge .55 * $Word.width * $Word.height
}

function Merge-FateCounterLines($Selected, $Other, $Counters, $CounterButton = $null) {
    $contextLines = @($Selected.lines)
    if ($null -ne $Other) { $contextLines += @($Other.lines) }
    if ($null -ne $CounterButton) { $contextLines += $CounterButton }
    $panel = @($Counters | Where-Object { !$_.HasHudCards -and (Test-FatePanelCounter $_ $contextLines) })
    $hud = @($Counters | Where-Object HasHudCards)
    $accepted = @()
    if ($panel.Count -eq 1) { $accepted += $panel[0] }
    if ($hud.Count -eq 1) { $accepted += $hud[0] }
    if ($accepted.Count -eq 0 -and $Counters.Count -eq 1 -and $Counters[0].IsIsolatedPlaque) { $accepted += $Counters[0] }
    if ($accepted.Count -eq 0) { return $Selected }

    $lines = @($Selected.lines)
    foreach ($counter in $accepted) {
        $bounds = $counter.Bounds
        $positioned = [ordered]@{ text = $counter.Text; x = $bounds.X; y = $bounds.Y; width = $bounds.Width; height = $bounds.Height }
        $lines = @(
            foreach ($line in $lines) {
                if (!$line.Contains('words')) { $line; continue }
                $remaining = @($line.words | Where-Object { !(Test-FateCounterOverlap $_ $bounds) })
                if ($remaining.Count -eq $line.words.Count) { $line }
                else {
                    if ($null -ne $positioned) { $positioned; $positioned = $null }
                    if ($remaining.Count) { New-PositionedOcrLine $remaining ($remaining.text -join ' ') }
                }
            }
            if ($null -ne $positioned) { $positioned }
        )
    }
    $text = [string](($lines | ForEach-Object { $_.text }) -join "`n")
    if ($text.Length -gt 20000 -or $lines.Count -gt 500) { return $Selected }
    return @{ text = $text; lines = $lines }
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
        $usingNormalized = [Object]::ReferenceEquals($selected, $normalized)
        Write-Verbose $(if ($usingNormalized) { 'Selected normalized OCR.' } else { 'Selected original OCR.' })
        if ($OcrMode -eq 'auto') {
            $other = if ($usingNormalized) { $original } else { $normalized }
            try {
                $selected = Read-FateConfirm $selected $other $Png $engine $ImageWidth $ImageHeight
            } catch { Write-Verbose ("Confirm OCR retry failed. " + $_.Exception.Message) }
            try {
                $region = Get-FateDimCounterRegion $selected.lines
                $counters = [FateOcrImage]::ReadCounters($Png, $region)
                $button = $null
                try {
                    $button = Read-FateCounterButton $counters $selected $other $Png $engine $ImageWidth $ImageHeight
                } catch { Write-Verbose ("Counter context OCR failed. " + $_.Exception.Message) }
                $selected = Merge-FateCounterLines $selected $other $counters $button
            } catch { Write-Verbose ("Counter OCR failed. " + $_.Exception.Message) }
            try {
                $selected = Read-FateCardText $selected $other $Png $engine $ImageWidth $ImageHeight
            } catch { Write-Verbose ("Card text retry failed. " + $_.Exception.Message) }
        }
        foreach ($line in $selected.lines) { $line.Remove('words') }
        $ocr.status = 'ok'; $ocr.text = $selected.text; $ocr.lines = $selected.lines
    }
    return $ocr
}
