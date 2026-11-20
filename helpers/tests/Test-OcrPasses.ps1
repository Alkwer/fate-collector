Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$helperDirectory = Split-Path $PSScriptRoot -Parent
. (Join-Path $helperDirectory 'Ocr.Common.ps1')

function New-Line([string]$Text, [double]$X, [double]$Y = 20) {
    return @{ text = $Text; x = $X; y = $Y; width = 60; height = 12 }
}

function New-Pass([hashtable[]]$Lines) {
    return @{ text = ($Lines.text -join "`n"); lines = $Lines }
}

function Assert-Pass($Original, $Normalized, $Expected, [string]$Message) {
    $chosen = Select-FateOcrPass $Original $Normalized @('Alchemist', 'Sanguine', 'Butcher', 'Tempest')
    if (![object]::ReferenceEquals($chosen, $Expected)) { throw $Message }
}

$original = New-Pass @((New-Line 'ALCHEMIST' 20), (New-Line 'Unkn0wn Card' 250))
$improved = New-Pass @((New-Line 'Alche-mist' 24 21), (New-Line 'Butcher' 140), (New-Line 'Unkn0wn Card' 250))
$blank = New-Pass @((New-Line '   ' 20))
Assert-Pass $original $null $original 'Missing normalized pass should keep the original.'
Assert-Pass $original $blank $original 'Blank normalized pass should keep the original.'
Assert-Pass $null $improved $improved 'With no original pass, retain available normalized output.'
Assert-Pass $blank $improved $improved 'With a blank original pass, retain available normalized output.'
Assert-Pass $null $null $null 'Two missing passes should remain missing.'
Assert-Pass $original $improved $improved 'A new known header without losing the original should improve the pass.'

$tie = New-Pass @((New-Line 'Alchemist' 20), (New-Line 'Unkn0wn Card' 250))
Assert-Pass $original $tie $original 'An equal known-header count should keep the original.'
$conflict = New-Pass @((New-Line 'Sanguine' 20), (New-Line 'Unkn0wn Card' 250))
Assert-Pass $original $conflict $original 'A conflicting replacement header should keep the original.'
$overlappingConflict = New-Pass @((New-Line 'Alchemist' 20), (New-Line 'Sanguine' 25 21), (New-Line 'Butcher' 140))
Assert-Pass $original $overlappingConflict $original 'An added known name overlapping an original header should keep the original.'
$lost = New-Pass @((New-Line 'Sanguine' 140), (New-Line 'Butcher' 250))
Assert-Pass $original $lost $original 'More known headers should not outweigh the loss of an original header.'
$movedX = New-Pass @((New-Line 'Alchemist' 300), (New-Line 'Butcher' 140))
Assert-Pass $original $movedX $original 'A known header moved to another column should keep the original.'
$movedY = New-Pass @((New-Line 'Alchemist' 20 90), (New-Line 'Butcher' 140))
Assert-Pass $original $movedY $original 'A known header moved to another row should keep the original.'

$repeated = New-Pass @((New-Line 'Alchemist' 20), (New-Line 'Alchemist' 145))
$moreRepeated = New-Pass @((New-Line 'Alchemist' 20), (New-Line 'Alchemist' 145), (New-Line 'Tempest' 250))
Assert-Pass $repeated $moreRepeated $moreRepeated 'Known names can repeat at separate positions.'
$overlappingOriginal = New-Pass @((New-Line 'Alchemist' 20), (New-Line 'Alchemist' 22))
$oneMatch = New-Pass @((New-Line 'Alchemist' 21), (New-Line 'Butcher' 145), (New-Line 'Tempest' 250))
Assert-Pass $overlappingOriginal $oneMatch $overlappingOriginal 'One normalized header must not satisfy two original matches.'

$unknown = New-Pass @((New-Line 'Unkn0wn Card' 250))
$nearMatch = New-Pass @((New-Line 'Alchem1st' 250), (New-Line 'Sangu1ne' 140))
Assert-Pass $unknown $nearMatch $unknown 'A near match should not count as a known header.'
Assert-Pass $null $nearMatch $nearMatch 'The only OCR pass should preserve its exact unknown text.'

$offer = New-Pass @((New-Line 'Fates' 140), (New-Line 'Alchemist' 20 60), (New-Line 'NHR' 145 100))
$confirmed = New-Pass @((New-Line 'Fates' 140), (New-Line 'Alchemist' 20 60), (New-Line 'CONFIRM' 140 100))
Assert-Pass $offer $confirmed $confirmed 'A centered Confirm can break a tie that preserves original headers.'
$confirmConflict = New-Pass @((New-Line 'Fates' 140), (New-Line 'Sanguine' 20 60), (New-Line 'CONFIRM' 140 100))
Assert-Pass $offer $confirmConflict $offer 'A readable button cannot displace an original known header.'
$confirmOffAxis = New-Pass @((New-Line 'Fates' 140), (New-Line 'Alchemist' 20 60), (New-Line 'CONFIRM' 250 100))
Assert-Pass $offer $confirmOffAxis $offer 'A button outside the panel axis cannot break the tie.'
$confirmNearMatch = New-Pass @((New-Line 'Fates' 140), (New-Line 'Alchemist' 20 60), (New-Line 'CONFIR' 140 100))
Assert-Pass $offer $confirmNearMatch $offer 'A partial button label cannot break the tie.'
$confirmAmbiguous = New-Pass @((New-Line 'Fates' 140), (New-Line 'Alchemist' 20 60), (New-Line 'CONFIRM' 140 100), (New-Line 'CONFIRM' 140 150))
Assert-Pass $offer $confirmAmbiguous $offer 'An ambiguous button cannot break the tie.'
Assert-Pass $confirmAmbiguous $confirmed $confirmAmbiguous 'A tie must keep existing ambiguous button evidence.'

$splitInvocation = New-Pass @((New-Line 'Invoke' 140 5), (New-Line 'Fates' 140), (New-Line 'Alchemist' 20 60))
$moreOfferHeaders = New-Pass @((New-Line 'Fates' 140), (New-Line 'Alchemist' 20 60), (New-Line 'Butcher' 260 60), (New-Line 'CONFIRM' 140 100))
Assert-Pass $splitInvocation $confirmed $splitInvocation 'An OCR tie must preserve a split invocation title.'
Assert-Pass $splitInvocation $moreOfferHeaders $splitInvocation 'Added headers cannot remove a split invocation title.'
$invokedConfirm = New-Pass @((New-Line 'Invoke Fates' 140 5), (New-Line 'Fates' 140), (New-Line 'Alchemist' 20 60), (New-Line 'CONFIRM' 140 100))
Assert-Pass $offer $invokedConfirm $offer 'An invocation pass cannot break a tie using its Confirm button.'

$fragment = $confirmNearMatch.lines[2]
$foundConfirm = New-Line 'CONFIRM' 142 99
$merged = Merge-FateConfirmLine $confirmNearMatch $fragment @($foundConfirm, (New-Line 'Butcher' 260 60))
if ($merged.lines.Count -ne 3 -or ![Object]::ReferenceEquals($merged.lines[0], $confirmNearMatch.lines[0]) -or
    ![Object]::ReferenceEquals($merged.lines[1], $confirmNearMatch.lines[1]) -or
    ![Object]::ReferenceEquals($merged.lines[2], $foundConfirm) -or $merged.text -cne "Fates`nAlchemist`nCONFIRM") {
    throw 'A positioned reread should replace only the fragment with the exact text and rectangle returned by OCR.'
}
foreach ($unusable in @((New-Line 'CONFIR' 142 99), (New-Line 'CONFIRM' 142 150), (New-Line 'CONFIRM' 250 100))) {
    if (![Object]::ReferenceEquals((Merge-FateConfirmLine $confirmNearMatch $fragment @($unusable)), $confirmNearMatch)) {
        throw 'An incomplete or displaced reread must keep the original text and positions.'
    }
}
Write-Output 'PASS: OCR fallback, conservative header matching, invocation titles, and exact button rereads.'

$names = @{ Alchemist = @(); Butcher = @() }
$headers = @((New-Line 'Alchemist' 300 165), (New-Line 'Butcher' 500 165))
$counter = @{ x = 339; y = 360; width = 20; height = 12 }
$rage = @{ x = 740; y = 370; width = 34; height = 12 }
if (!(Test-FateOfferFraction $counter $headers $names) -or (Test-FateOfferFraction $rage $headers $names)) {
    throw 'A HUD fraction outside the card row cannot displace the offer counter.'
}
$fraction = @{ text='0/4'; x=537; y=460; width=20; height=15 }
$button = @{ text='CONFIRM'; x=610; y=465; width=60; height=10 }
$footer = @{ text='Confirm'; x=548; y=678; width=50; height=12 }
if (@(Get-FateButtonCounters $button @($fraction)).Count -ne 1 -or @(Get-FateButtonCounters $footer @($fraction)).Count) {
    throw 'Only the panel button should pair with the counter when the controller footer is visible.'
}
if (!(Test-FateCaptionAgreement 'causes continuai fire damage' 'causes continual fire damage' 'causes continual fire daxxge') -or
    (Test-FateCaptionAgreement 'causes continuai fire damage' 'causes continual fire damage' 'causes minor fire damage') -or
    (Test-FateCaptionAgreement 'release 2 fire projectiles' 'release 3 fire projectiles' 'release 3 fire projectiles') -or
    (Test-FateCaptionAgreement 'release fire projectiles' 'release more fire projectiles' 'release more fire projectiles')) {
    throw 'Changing undocumented text requires corroboration for each changed word with consistent numbers and word count.'
}

Add-Type -AssemblyName System.Drawing
if (-not ('FateOcrImage' -as [type])) {
    Add-Type -Path (Join-Path $helperDirectory 'OcrImage.cs') -ReferencedAssemblies System.Drawing
}

# The name is dark ink on a dim plate. Bright tooltip lettering must map to
# the same background as the plate while the ink stays legible.
$plate = [Drawing.Bitmap]::new(80, 32)
$plateStream = [IO.MemoryStream]::new()
$plateGraphics = [Drawing.Graphics]::FromImage($plate)
try {
    $plateGraphics.Clear([Drawing.Color]::FromArgb(42, 33, 25))
    $plateGraphics.FillRectangle([Drawing.Brushes]::Black, 22, 8, 8, 16)
    $plateGraphics.FillRectangle([Drawing.Brushes]::LightGray, 48, 8, 8, 16)
    $plate.Save($plateStream, [Drawing.Imaging.ImageFormat]::Png)
    $prepared = [FateOcrImage]::PrepareCoveredNameplate($plateStream.ToArray(), 4096, [Drawing.Rectangle]::new(0, 0, 80, 32))
    $resultStream = [IO.MemoryStream]::new($prepared.Png, $false)
    try {
        $result = [Drawing.Bitmap]::new($resultStream)
        try {
            $row = [int]($prepared.Padding + 16 * $prepared.ScaleY)
            $intensities = @(foreach ($x in 14, 26, 52) { $result.GetPixel([int]($prepared.Padding + $x * $prepared.ScaleX), $row).R })
            if ($intensities[0] -lt 245 -or $intensities[1] -gt 10 -or $intensities[2] -lt 245) {
                throw 'Covered title OCR must preserve the dark letters and suppress the brighter overlay.'
            }
        } finally { $result.Dispose() }
    } finally { $resultStream.Dispose() }
} finally { $plateGraphics.Dispose(); $plateStream.Dispose(); $plate.Dispose() }

function New-CounterFixture([string]$LeftDigit, [string]$RightDigit, [switch]$VerticalMark, [switch]$Hud, [switch]$Isolated,
        [switch]$FaintDigitStroke, [switch]$TouchingDigit, [switch]$Dim,
        [ValidateSet('None', 'Overprint', 'Gap')][string]$SlashCover = 'None') {
    $scale = if ($Dim) { 2 } else { 1 }
    $image = [Drawing.Bitmap]::new(240 * $scale, 205 * $scale)
    $stream = [IO.MemoryStream]::new()
    $graphics = [Drawing.Graphics]::FromImage($image)
    $faint = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(115, 115, 115))
    try {
        $graphics.Clear([Drawing.Color]::Black)
        $graphics.ScaleTransform($scale, $scale)
        $ink = if ($Dim) { [Drawing.Brushes]::DarkSlateGray } else { [Drawing.Brushes]::White }
        $digitX = if ($TouchingDigit) { 69 } else { 66 }
        foreach ($digit in $LeftDigit, $RightDigit) {
            for ($row = 0; $row -lt 7; $row++) {
                for ($col = 0; $col -lt 5; $col++) {
                    if ($digit[$row * 5 + $col] -eq '1') {
                        $brush = if ($FaintDigitStroke -and $digitX -eq 66 -and $row -ge 4) { $faint } else { $ink }
                        $graphics.FillRectangle($brush, $digitX + 2 * $col, 109 + 2 * $row, 2, 2)
                    }
                }
            }
            $digitX = 86
        }
        for ($row = 0; $row -lt 18; $row++) {
            $offset = if ($VerticalMark) { 0 } else { [int][Math]::Floor((17 - $row) / 5) }
            $graphics.FillRectangle($ink, 79 + $offset, 107 + $row, 2, 1)
        }
        if ($SlashCover -ne 'None') {
            $cover = if ($SlashCover -eq 'Overprint') { [Drawing.Brushes]::LightGray } else { [Drawing.Brushes]::Black }
            $graphics.FillRectangle($cover, 78, 118, 7, 2)
        }
        if ($Hud) {
            $graphics.FillRectangle([Drawing.Brushes]::LightSteelBlue, 63, 143, 30, 12)
            $graphics.FillRectangle([Drawing.Brushes]::SteelBlue, 64, 155, 34, 23)
        }
        if ($Isolated) {
            foreach ($y in 102, 124) {
                foreach ($x in 50, 94) { $graphics.FillRectangle([Drawing.Brushes]::DimGray, $x, $y, 19, 1) }
            }
            $crop = $image.Clone([Drawing.Rectangle]::new(34, 95, 96, 42), [Drawing.Imaging.PixelFormat]::Format24bppRgb)
            try { $crop.Save($stream, [Drawing.Imaging.ImageFormat]::Png) } finally { $crop.Dispose() }
        } else {
            $image.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
        }
        return ,$stream.ToArray()
    } finally {
        $faint.Dispose()
        $graphics.Dispose()
        $stream.Dispose()
        $image.Dispose()
    }
}

$zero = '01110' + '11011' + '10001' + '10001' + '10001' + '11011' + '01110'
$two = '11110' + '10011' + '00011' + '00110' + '01100' + '11000' + '11111'
$four = '00110' + '01110' + '01110' + '11010' + '11111' + '00010' + '00010'
$image = New-CounterFixture $zero $two
$counters = [FateOcrImage]::ReadCounters($image)
if ($counters.Count -ne 1 -or $counters[0].Text -cne '0/2' -or
    $counters[0].Bounds -ne [Drawing.Rectangle]::new(66, 107, 30, 18)) {
    throw 'Decode both visible digits and the slash in the original image coordinates.'
}

$fragment = @{ text = '012'; x = 65; y = 106; width = 42; height = 20 }
$neighbor = @{ text = 'text'; x = 123; y = 113; width = 35; height = 10 }
$confirm = New-Line 'CONFIRM' 165 113
$outsidePanel = @{ text = '012 text'; lines = @((New-PositionedOcrLine @($fragment, $neighbor) '012 text')) }
if (![object]::ReferenceEquals((Merge-FateCounterLines $outsidePanel $null $counters), $outsidePanel)) {
    throw 'A fraction on a dark background needs panel or HUD context.'
}
$panel = @{ text = "012 text`nCONFIRM"; lines = @($outsidePanel.lines[0], $confirm) }
$merged = Merge-FateCounterLines $panel $null $counters
if ($merged.text -cne "0/2`ntext`nCONFIRM" -or $merged.lines[1].x -ne 123 -or $merged.lines[1].width -ne 35) {
    throw 'Replace only words at the counter while preserving the adjacent text and its position.'
}
$withoutFragment = New-Pass @($confirm)
if ((Merge-FateCounterLines $withoutFragment $null $counters).text -cne "CONFIRM`n0/2") {
    throw 'Recover a missing reading using the PNG even without a near match in the OCR text.'
}
$hud = [FateOcrImage]::ReadCounters((New-CounterFixture $zero $two -Hud))
if ($hud.Count -ne 1 -or !$hud[0].HasHudCards -or (Merge-FateCounterLines $outsidePanel $null $hud).text -cne "0/2`ntext") {
    throw 'Recognize the card-icon context when panel text is absent.'
}
$isolated = [FateOcrImage]::ReadCounters((New-CounterFixture $zero $two -Isolated))
$blankPass = @{ text = ''; lines = @() }
if ($isolated.Count -ne 1 -or !$isolated[0].IsIsolatedPlaque -or
    (Merge-FateCounterLines $blankPass $null $isolated).text -cne '0/2') {
    throw 'An isolated counter needs a tightly framed plaque with visible trim.'
}
if (([FateOcrImage]::ReadCounters((New-CounterFixture $zero $two -VerticalMark))).Count -ne 0 -or
    ([FateOcrImage]::ReadCounters((New-CounterFixture $four $two))).Count -ne 0) {
    throw 'Reject a vertical stroke in place of the slash and reject current values above capacity.'
}
foreach ($png in @(
        (New-CounterFixture $two $two -FaintDigitStroke -Hud),
        (New-CounterFixture $two $two -TouchingDigit -Hud))) {
    $recovered = [FateOcrImage]::ReadCounters($png)
    if ($recovered.Count -ne 1 -or $recovered[0].Text -cne '2/2' -or !$recovered[0].HasHudCards) {
        throw 'Recover a faint digit or a digit touching the diagonal slash from the HUD pixels.'
    }
}
if (([FateOcrImage]::ReadCounters((New-CounterFixture $two $two -TouchingDigit -VerticalMark -Hud))).Count -ne 0 -or
    ([FateOcrImage]::ReadCounters((New-CounterFixture $two $two -FaintDigitStroke -VerticalMark -Hud))).Count -ne 0) {
    throw 'Reject a vertical mark even when a digit touches it or a digit has faint strokes.'
}
foreach ($cover in 'None', 'Overprint') {
    $dim = New-CounterFixture $zero $four -Dim -SlashCover $cover
    $region = [Drawing.Rectangle]::new(100, 170, 140, 100)
    $read = [FateOcrImage]::ReadCounters($dim, $region)
    if ($read.Count -ne 1 -or $read[0].Text -ne '0/4' -or
        [FateOcrImage]::ReadCounters($dim).Count -ne 0) {
        throw 'Read the dim fraction only in the panel search region, including a partly overprinted diagonal.'
    }
}
foreach ($invalid in @(
        (New-CounterFixture $zero $four -Dim -SlashCover Gap),
        (New-CounterFixture $zero $four -Dim -SlashCover Overprint -VerticalMark),
        (New-CounterFixture $four $two -Dim),
        (New-CounterFixture ('0' * 35) $four -Dim))) {
    if ([FateOcrImage]::ReadCounters($invalid, $region).Count) {
        throw 'A dark gap, a vertical mark, an impossible count or a missing digit cannot establish a dim fraction.'
    }
}
if (!(Get-FateDimCounterRegion @($confirm)).IsEmpty -or
    !(Get-FateDimCounterRegion @((New-Line 'Fates' 80), (New-Line 'Invoke Fates' 95))).IsEmpty) {
    throw 'A dim counter search requires a unique panel heading.'
}
$tooManyLines = New-Pass (@($confirm) + @(1..499 | ForEach-Object { New-Line 'other' 10 20 }))
if (![object]::ReferenceEquals((Merge-FateCounterLines $tooManyLines $null $counters), $tooManyLines)) {
    throw 'Appending a recovered counter must respect the line count limit.'
}
$tooMuchText = New-Pass (@($confirm) + @(1..10 | ForEach-Object { New-Line ('a' * 1998) 10 20 }))
if (![object]::ReferenceEquals((Merge-FateCounterLines $tooMuchText $null $counters), $tooMuchText)) {
    throw 'Appending a recovered counter must respect the text length limit.'
}
Write-Output 'PASS: visual counter geometry, digit evidence, panel and HUD context, and positioned OCR merge.'
