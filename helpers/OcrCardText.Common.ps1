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
        $script:FateCardDescriptions = $descriptions
    }
    return $script:FateCardDescriptions
}

function ConvertTo-FateDescriptionKey([string]$Text) {
    return (($Text.ToLowerInvariant() -replace '(?<!\d)[.,](?!\d)', '') -replace '\s+', ' ').Trim()
}

function Get-FateCardLines($Lines, $Center, $Pitch, $Top, $Bottom) {
    return $Lines | Where-Object {
        $_.y -ge $Top -and $_.y -lt $Bottom -and $_.width -lt $Pitch -and
        [Math]::Abs($_.x + $_.width / 2 - $Center) -lt .43 * $Pitch -and $_.text -match '[a-z]'
    } | Sort-Object { $_.y }, { $_.x }
}

function Read-FateOfferButton($Selected, $Other, [byte[]]$Png, $Engine, [int]$ImageWidth, [int]$ImageHeight) {
    if (@($Selected.lines | Where-Object { $_.text -match '^\s*confirm\s*$' }).Count) { return $Selected }
    $fractions = @($Selected.lines | Where-Object {
        $_.text -match '^\s*(\d{1,2})\s*/\s*(\d{1,2})\s*$' -and [int]$Matches[1] -lt [int]$Matches[2]
    })
    if ($fractions.Count -ne 1) { return $Selected }
    $fraction = $fractions[0]
    $unit = $fraction.height
    $x = $fraction.x + $fraction.width / 2
    $y = $fraction.y + $unit / 2
    $dictionary = Get-FateCardDescriptions
    $namesAbove = @($Selected.lines | Where-Object {
        $_.y -gt $y - 24 * $unit -and $_.y -lt $y - 12 * $unit -and
        [Math]::Abs($_.x + $_.width / 2 - $x) -lt 40 * $unit -and $dictionary.ContainsKey(($_.text -replace '[^a-z]', ''))
    })
    $titles = @($Selected.lines | Where-Object { $_.text -match '^\s*fates\s*$' -and
        $_.y -gt $y - 30 * $unit -and $_.y -lt $y - 15 * $unit -and
        [Math]::Abs($_.x + $_.width / 2 - $x - 6.5 * $unit) -lt 1.6 * $unit })
    if ($namesAbove.Count -lt 2 -and $titles.Count -ne 1) { return $Selected }
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
        if (!$originalKnown -and !$newHeaders.Count) { continue }
        if ($newHeaders.Count) {
            $readKey = $newHeaders[0].text -replace '[^a-z]', ''
            if ($originalKnown -and $readKey -ne $key) { continue }
            $key = $readKey
        }
        $newBody = @(Get-FateCardLines $read.lines $center $pitch $bodyTop $bodyEnd)
        $newWords = ConvertTo-FateDescriptionKey (($newBody | ForEach-Object { $_.text }) -join ' ')
        $remove = @()
        $add = @()
        # Do not shorten a longer original description or change visible numbers
        # just to recover a documented wording.
        $keepsWords = !$words -or ($words -split ' ').Count -le ($newWords -split ' ').Count
        $oldNumbers = [regex]::Matches($words, '\d+') | ForEach-Object { $_.Value }
        $newNumbers = [regex]::Matches($newWords, '\d+') | ForEach-Object { $_.Value }
        if ($dictionary[$key] -contains $newWords -and $newBody.Count -and $keepsWords -and
            (!$oldNumbers -or ($oldNumbers -join ' ') -ceq ($newNumbers -join ' '))) {
            $remove = $body
            $add = $newBody
        } elseif ($dictionary[$key] -notcontains $words) { continue }
        if (!$originalKnown) { $remove += $header; $add += $newHeaders[0] }
        if ($add.Count) { $lines = @($lines | Where-Object { $remove -notcontains $_ }) + $add }
    }
    $text = ($lines | ForEach-Object { $_.text }) -join "`n"
    if ($lines.Count -gt 500 -or $text.Length -gt 20000) { return $Selected }
    return @{ lines = $lines; text = $text }
}
