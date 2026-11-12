param([string]$FixturePng, [string]$FixtureDraft, [string]$FixtureReview)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$helper = Split-Path $PSScriptRoot -Parent
. (Join-Path $helper 'SymbolReport.Common.ps1')
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type -Path (Join-Path $helper 'SymbolReport.cs') -ReferencedAssemblies System.Drawing, System.Windows.Forms

function Assert-True([bool]$Condition, [string]$Message) {
    if (!$Condition) { throw $Message }
}

function Assert-CropFails([Drawing.Bitmap]$Frame, [Drawing.Rectangle]$Bounds, [bool]$IsIcon, [string]$Message) {
    try { [void][FateSymbolCrop]::Create($Frame, $Bounds, $IsIcon) }
    catch {
        if ($_.Exception.InnerException -is [ArgumentException] -and $_.Exception.InnerException.Message.Contains($Message)) { return }
        throw
    }
    throw "Unexpectedly accepted crop $Bounds."
}

function Assert-Png([byte[]]$Png, [Drawing.Rectangle]$Bounds, [Drawing.Color]$Color, [int]$MaxBytes) {
    Assert-True ($Png.Length -le $MaxBytes) 'PNG exceeded its byte budget.'
    Assert-True ($Png[24] -eq 8 -and $Png[25] -eq 2 -and $Png[28] -eq 0) 'Expected a noninterlaced 8-bit RGB PNG.'
    $offset = 8
    $chunks = @()
    while ($offset -lt $Png.Length) {
        $length = [Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($Png, $offset))
        $kind = [Text.Encoding]::ASCII.GetString($Png, $offset + 4, 4)
        Assert-True ($length -ge 0 -and $kind -cin @('IHDR', 'IDAT', 'IEND', 'sRGB', 'pHYs')) "Unexpected PNG chunk $kind."
        $chunks += $kind
        $offset += 12 + $length
    }
    Assert-True ($offset -eq $Png.Length -and $chunks[0] -eq 'IHDR' -and $chunks[-1] -eq 'IEND' -and 'IDAT' -in $chunks) 'Malformed PNG chunks.'
    $stream = [IO.MemoryStream]::new($Png, $false)
    try {
        $image = [Drawing.Bitmap]::new($stream)
        try {
            Assert-True ($image.Width -eq $Bounds.Width -and $image.Height -eq $Bounds.Height) 'Wrong crop dimensions.'
            foreach ($point in @([Drawing.Point]::new(0, 0), [Drawing.Point]::new($image.Width - 1, $image.Height - 1))) {
                Assert-True ($image.GetPixel($point.X, $point.Y).ToArgb() -eq $Color.ToArgb()) 'Crop pixels did not match the frozen frame.'
            }
        } finally { $image.Dispose() }
    } finally { $stream.Dispose() }
}

function Test-Selector([Drawing.Bitmap]$Frame, [Drawing.Rectangle]$IconBounds, [Drawing.Rectangle]$TooltipBounds) {
    $form = [FateSymbolReportForm]::new($Frame, $true)
    try {
        $instance = [Reflection.BindingFlags]'Instance,NonPublic'
        $canvas = $form.GetType().GetField('canvas', $instance).GetValue($form)
        $advance = $form.GetType().GetMethod('Advance', $instance)
        $select = $form.GetType().GetMethod('SelectCrop', $instance)
        $advanceArgs = [object[]]@($form, [EventArgs]::Empty)
        [void]$advance.Invoke($form, $advanceArgs)
        Assert-True ($null -eq $form.IconCrop -and $null -eq $form.TooltipCrop) 'An empty selection should keep the icon step open.'
        $canvas.Reset($IconBounds)
        [void]$advance.Invoke($form, $advanceArgs)
        Assert-True ($form.IconCrop.Bounds -eq $IconBounds -and $null -eq $form.TooltipCrop) 'The icon step did not advance to tooltip.'
        $canvas.Reset($TooltipBounds)
        [void]$advance.Invoke($form, $advanceArgs)
        Assert-True ($form.TooltipCrop.Bounds -eq $TooltipBounds) 'The tooltip step did not accept a valid crop.'

        [void]$select.Invoke($form, [object[]]@($true))
        $newIcon = [Drawing.Rectangle]::Inflate($IconBounds, -5, -5)
        $canvas.Reset($newIcon)
        [void]$advance.Invoke($form, $advanceArgs)
        Assert-True ($form.IconCrop.Bounds -eq $newIcon -and $form.TooltipCrop.Bounds -eq $TooltipBounds) 'Reselecting an icon should keep the tooltip.'
        [void]$select.Invoke($form, [object[]]@($false))
        $newTooltip = [Drawing.Rectangle]::Inflate($TooltipBounds, -5, -5)
        $canvas.Reset($newTooltip)
        [void]$advance.Invoke($form, $advanceArgs)
        Assert-True ($form.TooltipCrop.Bounds -eq $newTooltip -and $form.IconCrop.Bounds -eq $newIcon) 'Reselecting a tooltip should keep the icon.'
        Assert-True ($form.DialogResult -eq [Windows.Forms.DialogResult]::None) 'A valid crop must still await confirmation.'
        if ($FixtureReview) {
            # Render the actual WinForms controls in a test window. This does
            # not drive the production process or capture the desktop.
            $form.add_Shown({
                $preview = [Drawing.Bitmap]::new($form.Width, $form.Height)
                try {
                    $form.DrawToBitmap($preview, [Drawing.Rectangle]::new(0, 0, $form.Width, $form.Height))
                    $preview.Save($FixtureReview, [Drawing.Imaging.ImageFormat]::Png)
                } finally {
                    $preview.Dispose()
                    $form.CancelButton.PerformClick()
                }
            })
            Assert-True ($form.ShowDialog() -eq [Windows.Forms.DialogResult]::Cancel) 'Cancel must close the modal without approval.'
        }
        [void]$advance.Invoke($form, $advanceArgs)
        Assert-True ($form.DialogResult -eq [Windows.Forms.DialogResult]::OK) 'Continue must explicitly approve the two crops for local transfer.'
        Assert-True ($form.CancelButton.DialogResult -eq [Windows.Forms.DialogResult]::Cancel) 'Cancel must return no approved draft.'
    } finally { $form.Dispose() }
}

$temp = Join-Path ([IO.Path]::GetTempPath()) ("fate-symbol-test-" + [guid]::NewGuid())
$frame = [Drawing.Bitmap]::new(1100, 640, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
$iconBounds = [Drawing.Rectangle]::new(160, 130, 80, 80)
$tooltipBounds = [Drawing.Rectangle]::new(450, 212, 350, 200)
try {
    $graphics = [Drawing.Graphics]::FromImage($frame)
    try {
        $graphics.Clear([Drawing.Color]::FromArgb(32, 53, 63))
        $graphics.FillRectangle([Drawing.Brushes]::MediumAquamarine, $iconBounds)
        $graphics.FillRectangle([Drawing.Brushes]::SaddleBrown, $tooltipBounds)
        $graphics.DrawString('Synthetic tooltip sample', [Drawing.SystemFonts]::CaptionFont, [Drawing.Brushes]::White, 474, 240)
    } finally { $graphics.Dispose() }
    $icon = [FateSymbolCrop]::Create($frame, $iconBounds, $true)
    $tooltip = [FateSymbolCrop]::Create($frame, $tooltipBounds, $false)
    Test-Selector $frame $iconBounds $tooltipBounds
    Assert-Png $icon.Png $iconBounds ([Drawing.Color]::MediumAquamarine) 64KB
    Assert-Png $tooltip.Png $tooltipBounds ([Drawing.Color]::SaddleBrown) 384KB
    Assert-CropFails $frame ([Drawing.Rectangle]::new(0, 0, 7, 80)) $true 'between 8 and 256'
    Assert-CropFails $frame ([Drawing.Rectangle]::new(0, 0, 257, 80)) $true 'between 8 and 256'
    Assert-CropFails $frame ([Drawing.Rectangle]::new(0, 0, 1601, 80)) $false 'between 8 and 1600'
    Assert-CropFails $frame ([Drawing.Rectangle]::new(-1, 1, 80, 80)) $true 'inside'
    Assert-CropFails $frame ([Drawing.Rectangle]::new(1020, 561, 80, 80)) $true 'inside'

    $noise = [Random]::new(18)
    for ($y = 0; $y -lt 400; $y++) {
        for ($x = 0; $x -lt 400; $x++) {
            $frame.SetPixel($x, $y, [Drawing.Color]::FromArgb($noise.Next(256), $noise.Next(256), $noise.Next(256)))
        }
    }
    Assert-CropFails $frame ([Drawing.Rectangle]::new(0, 0, 256, 256)) $true 'exceeds 64 KiB'
    Assert-CropFails $frame ([Drawing.Rectangle]::new(0, 0, 400, 400)) $false 'exceeds 384 KiB'

    $createdAt = [DateTime]::UtcNow
    $captureId = [guid]::NewGuid()
    $captureFolder = [IO.Directory]::CreateDirectory((Join-Path $temp 'captures'))
    $output = Join-Path $temp 'symbol-reports'
    $release = Get-Content -Raw (Join-Path $helper '..\shared\helper-release.json') | ConvertFrom-Json
    foreach ($origin in 'live', 'test') {
        $saved = Save-FateSymbolDraft -Icon $icon -Tooltip $tooltip -CreatedAt $createdAt -Origin $origin -CaptureId $captureId -OutputDirectory $output
        $json = [IO.File]::ReadAllText($saved.Path)
        $draft = $json | ConvertFrom-Json
        $names = @($draft.PSObject.Properties.Name | Sort-Object)
        $keys = @('captureId', 'createdAt', 'helperVersion', 'icon', 'id', 'kind', 'origin', 'schemaVersion', 'tooltip')
        Assert-True (($names -join ',') -ceq ($keys -join ',')) 'Unexpected draft fields.'
        Assert-True ($draft.kind -ceq 'fate-collector.symbol-draft' -and $draft.schemaVersion -eq 1 -and $draft.origin -ceq $origin) 'Wrong draft identity.'
        Assert-True ($draft.createdAt.EndsWith('Z') -and [DateTimeOffset]::Parse($draft.createdAt).UtcDateTime -eq $createdAt) 'Creation timestamp was not UTC.'
        Assert-True ($draft.helperVersion -ceq $release.version -and (Split-Path $saved.Path -Leaf) -ceq "symbol-$($draft.id).json") 'Wrong producer or file name.'
        $expectedCapture = if ($origin -eq 'live') { $captureId.ToString() } else { $null }
        Assert-True ($draft.captureId -ceq $expectedCapture) 'Wrong linked capture ID.'
        Assert-True ($draft.icon.mimeType -eq 'image/png' -and $draft.tooltip.mimeType -eq 'image/png') 'Wrong image MIME type.'
        Assert-True ($draft.icon.width -eq $iconBounds.Width -and $draft.tooltip.height -eq $tooltipBounds.Height) 'Wrong draft image dimensions.'
        Assert-True ($draft.icon.dataBase64 -ceq [Convert]::ToBase64String($icon.Png)) 'Draft did not preserve the accepted crop.'
        Assert-True ($json -ceq $saved.Json -and (Get-Item -LiteralPath $saved.Path).Length -le 640KB) 'File and clipboard JSON should match and fit the draft budget.'
        if ($origin -eq 'test' -and $FixtureDraft) {
            $fixturePath = [IO.Path]::GetFullPath($FixtureDraft)
            [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($fixturePath))
            [IO.File]::Copy($saved.Path, $fixturePath, $true)
        }
    }
    $unlinked = (Save-FateSymbolDraft -Icon $icon -Tooltip $tooltip -CreatedAt $createdAt -Origin live -OutputDirectory $output).Json | ConvertFrom-Json
    Assert-True ($null -eq $unlinked.captureId) 'An absent capture reference must remain null.'
    Assert-True (@($captureFolder.EnumerateFiles('fate-*.json')).Count -eq 0) 'A draft was visible to the capture queue.'
    Assert-True (@([IO.Directory]::EnumerateFiles($output, '*.part')).Count -eq 0) 'A partial draft was left behind.'
    $oversized = @{ Bounds = $tooltipBounds; Png = [byte[]]::new(500KB) }
    try {
        [void](Save-FateSymbolDraft -Icon $icon -Tooltip $oversized -CreatedAt $createdAt -Origin live -OutputDirectory $output)
        throw 'Oversized draft was saved.'
    } catch {
        if (!$_.Exception.Message.Contains('draft is too large')) { throw }
    }
    Assert-True (@([IO.Directory]::EnumerateFiles($output)).Count -eq 3) 'Rejected draft left a file.'
    if ($FixturePng) {
        # Recreate the generated preview areas after the noise test.
        $graphics = [Drawing.Graphics]::FromImage($frame)
        try {
            $graphics.Clear([Drawing.Color]::FromArgb(32, 53, 63))
            $graphics.FillRectangle([Drawing.Brushes]::MediumAquamarine, $iconBounds)
            $graphics.FillRectangle([Drawing.Brushes]::SaddleBrown, $tooltipBounds)
            $graphics.DrawString('Synthetic tooltip sample', [Drawing.SystemFonts]::CaptionFont, [Drawing.Brushes]::White, 474, 240)
            $frame.Save($FixturePng, [Drawing.Imaging.ImageFormat]::Png)
        } finally { $graphics.Dispose() }
    }
    Write-Output 'PASS: frozen-frame selection and reselection, crop bounds and pixels, PNG byte limits, draft shape and atomic local output.'
} finally {
    $frame.Dispose()
    if ([IO.Directory]::Exists($temp)) { Remove-Item -LiteralPath $temp -Recurse -Force }
}
