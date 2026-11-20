# Retry only within a confirmed offer. Keep the original screenshot coordinates
# and emit only text that Windows actually read in this card's own column.
function Get-FateCardDescriptions {
    if ($null -eq (Get-Variable -Name FateCardDescriptions -Scope Script -ErrorAction SilentlyContinue)) {
        $path = Join-Path $script:FateOcrDirectory 'screenshot-catalog.json'
        if (![IO.File]::Exists($path)) { $path = Join-Path (Split-Path $script:FateOcrDirectory -Parent) 'shared/screenshot-catalog.json' }
        $catalog = [IO.File]::ReadAllText($path) | ConvertFrom-Json
        $descriptions = @{}
        foreach ($fate in $catalog.fates) {
            $descriptions[($fate.name -replace '[^a-z]', '')] = @($fate.variants | ForEach-Object {
                if ($_.shortDescription) { ConvertTo-FateDescriptionKey $_.shortDescription }
            })
        }
        $namesPath = Join-Path (Split-Path $path -Parent) 'fate-names.json'
        foreach ($name in ([IO.File]::ReadAllText($namesPath) | ConvertFrom-Json)) {
            $key = $name -replace '[^a-z]', ''
            if (!$descriptions.ContainsKey($key)) { $descriptions[$key] = @() }
        }
        $script:FateCardDescriptions = $descriptions
    }
    return $script:FateCardDescriptions
}

function ConvertTo-FateDescriptionKey([string]$Text) {
    return (($Text.ToLowerInvariant() -replace '(?<!\d)[.,](?!\d)', '') -replace '\s+', ' ').Trim()
}

function Get-FateCaptionScore([string]$Words, $Variants) {
    if (!$Words) { return -1 }
    $seen = $Words -split ' '
    $best = -1
    foreach ($variant in $Variants) {
        if ($Words -ceq $variant) { return 1.0 }
        $expected = $variant -split ' '
        if ($seen.Count -ne $expected.Count) { continue }
        $matches = 0
        for ($i = 0; $i -lt $seen.Count; $i++) {
            if ($seen[$i] -ceq $expected[$i]) { $matches++ }
        }
        if ($matches -ge [Math]::Ceiling($seen.Count / 2)) { $best = [Math]::Max([double]$best, $matches / $seen.Count) }
    }
    return $best
}

function Get-FateCardLines($Lines, $Center, $Pitch, $Top, $Bottom) {
    return $Lines | Where-Object {
        $_.y -ge $Top -and $_.y -lt $Bottom -and $_.width -lt $Pitch -and
        [Math]::Abs($_.x + $_.width / 2 - $Center) -lt .43 * $Pitch -and $_.text -match '[a-z]'
    } | Sort-Object { $_.y }, { $_.x }
}

function Test-FateCaptionAgreement([string]$Original, [string]$Regional, [string]$Contrast) {
    $before = $Original -split ' '
    $read = $Regional -split ' '
    $check = $Contrast -split ' '
    if ($read.Count -lt 3 -or $read.Count -ne $before.Count -or $read.Count -ne $check.Count) { return $false }
    $changes = 0
    for ($i = 0; $i -lt $read.Count; $i++) {
        if ($read[$i] -ceq $before[$i]) { continue }
        # A changed word needs both independent regional passes. Keep numeric
        # conflicts and truncated or extended captions for manual review.
        if ($read[$i] -cne $check[$i] -or ($read[$i] + $before[$i]) -match '\d') { return $false }
        $changes++
    }
    return $changes -gt 0 -and $changes -le $read.Count / 4
}

function Test-FateOfferFraction($Fraction, $Lines, $Dictionary) {
    $unit = $Fraction.height
    $x = $Fraction.x + $Fraction.width / 2
    $y = $Fraction.y + $unit / 2
    $namesAbove = @($Lines | Where-Object {
        $_.y -gt $y - 24 * $unit -and $_.y -lt $y - 12 * $unit -and
        [Math]::Abs($_.x + $_.width / 2 - $x) -lt 40 * $unit -and $dictionary.ContainsKey(($_.text -replace '[^a-z]', ''))
    })
    $titles = @($Lines | Where-Object { $_.text -match '^\s*fates\s*$' -and
        $_.y -gt $y - 30 * $unit -and $_.y -lt $y - 15 * $unit -and
        [Math]::Abs($_.x + $_.width / 2 - $x - 6.5 * $unit) -lt 1.6 * $unit })
    $axis = $x + 6.5 * $unit
    $left = @($namesAbove | Where-Object { $_.x + $_.width / 2 -lt $axis })
    $right = @($namesAbove | Where-Object { $_.x + $_.width / 2 -gt $axis })
    return ($left.Count -gt 0 -and $right.Count -gt 0) -or $titles.Count -eq 1
}

function Read-FateOfferButton($Selected, $Other, [byte[]]$Png, $Engine, [int]$ImageWidth, [int]$ImageHeight) {
    if (@($Selected.lines | Where-Object { $_.text -match '^\s*confirm\s*$' }).Count) { return $Selected }
    $dictionary = Get-FateCardDescriptions
    $fractions = @($Selected.lines | Where-Object {
        $_.text -match '^\s*(\d{1,2})\s*/\s*(\d{1,2})\s*$' -and [int]$Matches[1] -lt [int]$Matches[2] -and
        (Test-FateOfferFraction $_ $Selected.lines $dictionary)
    })
    if ($fractions.Count -ne 1) { return $Selected }
    $fraction = $fractions[0]
    $unit = $fraction.height
    $x = $fraction.x + $fraction.width / 2
    $y = $fraction.y + $unit / 2
    $left = [int][Math]::Max(0, [Math]::Floor($x + 2 * $unit))
    $right = [int][Math]::Min($ImageWidth, [Math]::Ceiling($x + 12 * $unit))
    $top = [int][Math]::Max(0, [Math]::Floor($y - 1.5 * $unit))
    $bottom = [int][Math]::Min($ImageHeight, [Math]::Ceiling($y + 1.9 * $unit))
    if ($right -le $left -or $bottom -le $top) { return $Selected }
    $isButton = {
        $_.text -match '^\s*confirm\s*$' -and $_.x -ge $left -and $_.x + $_.width -le $right -and
        [Math]::Abs($_.y + $_.height / 2 - $y) -lt $unit
    }
    $found = @()
    if ($null -ne $Other) { $found = @($Other.lines | Where-Object $isButton) }
    if (!$found.Count) {
        $region = [Drawing.Rectangle]::FromLTRB($left, $top, $right, $bottom)
        $prepared = [FateOcrImage]::Prepare($Png, [Windows.Media.Ocr.OcrEngine]::MaxImageDimension, $region, 3)
        $read = Invoke-FateOcrPass $prepared.Png $Engine $ImageWidth $ImageHeight $prepared.ScaleX $prepared.ScaleY $prepared.Padding $left $top
        $found = @($read.lines | Where-Object $isButton)
    }
    if ($found.Count -ne 1 -or $Selected.lines.Count -ge 500 -or $Selected.text.Length + $found[0].text.Length + 1 -gt 20000) { return $Selected }
    return @{ lines = @($Selected.lines) + $found; text = $Selected.text + "`n" + $found[0].text }
}

function Get-FateHeaderGrid($Band, $Axis, $Pitch, $Dictionary) {
    foreach ($slots in @(5, 6)) {
        $cells = @(for ($i = 0; $i -lt $slots; $i++) {
            $center = $Axis + ($i - ($slots - 1) / 2) * $Pitch
            $headers = @($Band | Where-Object { $_.width -lt .85 * $Pitch -and
                [Math]::Abs($_.x + $_.width / 2 - $center) -lt .16 * $Pitch })
            if ($headers.Count -eq 1) { @{ center = $center; header = $headers[0] } }
        })
        if (@($cells | Where-Object { $Dictionary.ContainsKey(($_.header.text -replace '[^a-z]', '')) }).Count -ge 2) {
            @{ cells = $cells }
        }
    }
}

function Read-FateCardText($Selected, $Other, [byte[]]$Png, $Engine, [int]$ImageWidth, [int]$ImageHeight) {
    if ((Test-FateInvocation $Selected.lines) -or ($null -ne $Other -and (Test-FateInvocation $Other.lines))) { return $Selected }
    $Selected = Read-FateOfferButton $Selected $Other $Png $Engine $ImageWidth $ImageHeight
    $buttons = @($Selected.lines | Where-Object { $_.text -match '^\s*confirm\s*$' })
    if ($buttons.Count -ne 1) { return $Selected }
    $button = $buttons[0]
    $axis = $button.x + $button.width / 2
    $level = $button.y + $button.height / 2
    $counters = @($Selected.lines | Where-Object {
        $_.text -match '^\s*(\d{1,2})\s*/\s*(\d{1,2})\s*$' -and [int]$Matches[1] -lt [int]$Matches[2] -and
        [Math]::Abs($_.y + $_.height / 2 - $level) -lt 1.6 * $button.height -and
        ($axis - $_.x - $_.width / 2) -gt 1.2 * $button.width -and ($axis - $_.x - $_.width / 2) -lt 1.85 * $button.width
    })
    if ($counters.Count -ne 1) { return $Selected }
    $pitch = 1.85 * ($axis - $counters[0].x - $counters[0].width / 2)
    $bandTop = $level - 1.70 * $pitch
    $bandEnd = $level - 1.20 * $pitch
    $titles = @($Selected.lines | Where-Object {
        $_.y -ge $level - 2.13 * $pitch -and $_.y -lt $bandTop -and (
            ($_.text -match '^\s*fates\s*$' -and [Math]::Abs($_.x + $_.width / 2 - $axis) -lt .15 * $pitch) -or
            ($_.width -gt $pitch -and $_.x -lt $axis -and $_.x + $_.width -gt $axis))
    })
    if (!$titles.Count) { return $Selected }
    $dictionary = Get-FateCardDescriptions
    $band = @($Selected.lines | Where-Object { $_.y -ge $bandTop -and $_.y -lt $bandEnd -and $_.width -lt .85 * $pitch })
    $lines = @($Selected.lines)
    $grids = @(Get-FateHeaderGrid $band $axis $pitch $dictionary)
    if (!$grids.Count) {
        # The full pass has no usable row. Retry the title strip once, preserving
        # surrounding evidence and any already readable names in their own slots.
        $left = [int][Math]::Max(0, [Math]::Floor($axis - 3 * $pitch))
        $right = [int][Math]::Min($ImageWidth, [Math]::Ceiling($axis + 3 * $pitch))
        $top = [int][Math]::Max(0, [Math]::Floor($bandTop))
        $bottom = [int][Math]::Min($ImageHeight, [Math]::Ceiling($bandEnd + .08 * $pitch))
        if ($right -le $left -or $bottom -le $top) { return $Selected }
        $region = [Drawing.Rectangle]::FromLTRB($left, $top, $right, $bottom)
        $prepared = [FateOcrImage]::Prepare($Png, [Windows.Media.Ocr.OcrEngine]::MaxImageDimension, $region, 3)
        $read = Invoke-FateOcrPass $prepared.Png $Engine $ImageWidth $ImageHeight $prepared.ScaleX $prepared.ScaleY $prepared.Padding $left $top
        $found = @(Get-FateHeaderGrid @($read.lines | Where-Object { $_.y -lt $bandEnd }) $axis $pitch $dictionary)
        if ($found.Count -ne 1) { return $Selected }
        foreach ($cell in $found[0].cells) {
            $new = $cell.header
            $key = $new.text -replace '[^a-z]', ''
            if (!$dictionary.ContainsKey($key)) { continue }
            $old = @($band | Where-Object { [Math]::Abs($_.x + $_.width / 2 - $cell.center) -lt .16 * $pitch })
            if ($old.Count -gt 1) { continue }
            if ($old.Count -and $dictionary.ContainsKey(($old[0].text -replace '[^a-z]', ''))) { continue }
            $lines = @($lines | Where-Object { $old -notcontains $_ }) + $new
        }
        $band = @($lines | Where-Object { $_.y -ge $bandTop -and $_.y -lt $bandEnd })
        $grids = @(Get-FateHeaderGrid $band $axis $pitch $dictionary)
    }
    if ($grids.Count -ne 1) { return $Selected }
    foreach ($cell in $grids[0].cells) {
        $header = $cell.header
        $center = $header.x + $header.width / 2
        $bodyTop = $header.y + .62 * $pitch
        $bodyEnd = [Math]::Min($button.y, $header.y + 1.24 * $pitch)
        $body = @(Get-FateCardLines $Selected.lines $center $pitch $bodyTop $bodyEnd)
        $key = $header.text -replace '[^a-z]', ''
        $originalKnown = $dictionary.ContainsKey($key)
        $words = ConvertTo-FateDescriptionKey (($body | ForEach-Object { $_.text }) -join ' ')
        if ($originalKnown -and $dictionary[$key] -contains $words) { continue }
        $left = [int][Math]::Max(0, [Math]::Floor($center - .45 * $pitch))
        $right = [int][Math]::Min($ImageWidth, [Math]::Ceiling($center + .45 * $pitch))
        $start = if ($originalKnown) { $bodyTop } else { $header.y - .08 * $pitch }
        $top = [int][Math]::Max(0, [Math]::Floor($start))
        $bottom = [int][Math]::Min($ImageHeight, [Math]::Ceiling($bodyEnd + .06 * $pitch))
        if ($right -le $left -or $bottom -le $top) { continue }
        $region = [Drawing.Rectangle]::FromLTRB($left, $top, $right, $bottom)
        $scale = [Math]::Min(4.0, [Math]::Max(2.0, 36.0 / [Math]::Max(1, $header.height)))
        $prepared = [FateOcrImage]::Prepare($Png, [Windows.Media.Ocr.OcrEngine]::MaxImageDimension, $region, $scale)
        $read = Invoke-FateOcrPass $prepared.Png $Engine $ImageWidth $ImageHeight $prepared.ScaleX $prepared.ScaleY $prepared.Padding $left $top
        $newHeaders = @($read.lines | Where-Object { [Math]::Abs($_.y - $header.y) -lt .08 * $pitch -and
            [Math]::Abs($_.x + $_.width / 2 - $center) -lt .16 * $pitch -and $dictionary.ContainsKey(($_.text -replace '[^a-z]', '')) })
        if ($newHeaders.Count -gt 1) { continue }
        if ($newHeaders.Count) {
            $readKey = $newHeaders[0].text -replace '[^a-z]', ''
            if ($originalKnown -and $readKey -ne $key) { continue }
            $key = $readKey
        }
        $newBody = @(Get-FateCardLines $read.lines $center $pitch $bodyTop $bodyEnd)
        $newWords = ConvertTo-FateDescriptionKey (($newBody | ForEach-Object { $_.text }) -join ' ')
        if (!$originalKnown -and !$newHeaders.Count) {
            # An exact independent caption can support an unclear original
            # heading. Leave that heading raw for the importer's spelling check.
            $keys = @($dictionary.Keys | Where-Object { $dictionary[$_] -contains $newWords })
            if ($keys.Count -ne 1) { continue }
            $key = $keys[0]
        }
        $best = Get-FateCaptionScore $words $dictionary[$key]
        $candidate = Get-FateCaptionScore $newWords $dictionary[$key]
        if ($null -ne $Other -and $candidate -lt 1) {
            $otherBody = @(Get-FateCardLines $Other.lines $center $pitch $bodyTop $bodyEnd)
            $otherWords = ConvertTo-FateDescriptionKey (($otherBody | ForEach-Object { $_.text }) -join ' ')
            $otherScore = Get-FateCaptionScore $otherWords $dictionary[$key]
            if ($otherScore -gt $candidate) {
                $newBody = $otherBody; $newWords = $otherWords; $candidate = $otherScore
            }
        }
        # On small cards the parchment texture and the letter strokes can have
        # similar brightness. Compare a background-corrected read of this column.
        if ($pitch -le 220 -and $best -lt 1 -and $candidate -lt 1 -and $originalKnown) {
            $captionTop = [int][Math]::Max(0, [Math]::Floor($bodyTop))
            $captionBox = [Drawing.Rectangle]::FromLTRB($left, $captionTop, $right, $bottom)
            $prepared = [FateOcrImage]::PrepareCaption($Png, [Windows.Media.Ocr.OcrEngine]::MaxImageDimension, $captionBox)
            $read = Invoke-FateOcrPass $prepared.Png $Engine $ImageWidth $ImageHeight $prepared.ScaleX $prepared.ScaleY $prepared.Padding $left $captionTop
            $caption = @(Get-FateCardLines $read.lines $center $pitch $bodyTop $bodyEnd)
            $printed = ConvertTo-FateDescriptionKey (($caption | ForEach-Object { $_.text }) -join ' ')
            $score = Get-FateCaptionScore $printed $dictionary[$key]
            if ($score -ge .75 -and $score -gt $candidate) {
                $newBody = $caption; $newWords = $printed; $candidate = $score
            } elseif (!$dictionary[$key].Count -and (Test-FateCaptionAgreement $words $newWords $printed)) {
                $candidate = 1
            }
        }
        $remove = @()
        $add = @()
        # Do not shorten a longer original description or change visible numbers
        # just to recover a documented wording.
        $originalWords = @($words -split ' ' | Where-Object { $_ -ne [string][char]0x2022 })
        $keepsWords = !$words -or $originalWords.Count -le ($newWords -split ' ').Count
        $oldNumbers = [regex]::Matches($words, '\d+') | ForEach-Object { $_.Value }
        $newNumbers = [regex]::Matches($newWords, '\d+') | ForEach-Object { $_.Value }
        if ($candidate -gt $best -and $newBody.Count -and $keepsWords -and
            (!$oldNumbers -or ($oldNumbers -join ' ') -ceq ($newNumbers -join ' '))) {
            $remove = $body
            $add = $newBody
        } elseif ($dictionary[$key] -notcontains $words) { continue }
        if (!$originalKnown -and $newHeaders.Count -and ($candidate -eq 1 -or $best -eq 1)) {
            $remove += $header; $add += $newHeaders[0]
        }
        if ($add.Count) { $lines = @($lines | Where-Object { $remove -notcontains $_ }) + $add }
    }
    $text = ($lines | ForEach-Object { $_.text }) -join "`n"
    if ($lines.Count -gt 500 -or $text.Length -gt 20000) { return $Selected }
    return @{ lines = $lines; text = $text }
}
