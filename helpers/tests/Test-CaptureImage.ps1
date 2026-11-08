Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$helperDirectory = Split-Path $PSScriptRoot -Parent
Add-Type -AssemblyName System.Drawing
Add-Type -Path (Join-Path $helperDirectory 'CaptureImage.cs') -ReferencedAssemblies System.Drawing
Add-Type -Path (Join-Path $helperDirectory 'OcrImage.cs') -ReferencedAssemblies System.Drawing

function Assert-Image($Condition, [string]$Message) {
    if (!$Condition) { throw $Message }
}

$flags = [Reflection.BindingFlags]'NonPublic, Static'
$halfToFloat = [FateScreenCapture].GetMethod('HalfToFloat', $flags)
$linearToSrgb = [FateScreenCapture].GetMethod('LinearToSrgbByte', $flags)
Assert-Image ($null -ne $halfToFloat -and $null -ne $linearToSrgb) 'Expected HDR conversion methods.'

foreach ($test in @(
    @{ Bits = 0x0000; Expected = 0.0 },
    @{ Bits = 0x0001; Expected = [Math]::Pow(2, -24) },
    @{ Bits = 0x3C00; Expected = 1.0 },
    @{ Bits = 0xC000; Expected = -2.0 },
    @{ Bits = 0x7BFF; Expected = 65504.0 },
    @{ Bits = 0x7C00; Expected = [double]::PositiveInfinity },
    @{ Bits = 0xFC00; Expected = [double]::NegativeInfinity }
)) {
    $actual = $halfToFloat.Invoke($null, @([uint16]$test.Bits))
    Assert-Image ($actual -eq $test.Expected) ("Half float 0x{0:X4} decoded to {1}." -f $test.Bits, $actual)
}
Assert-Image ([single]::IsNaN($halfToFloat.Invoke($null, @([uint16]0x7E01)))) 'Half NaN was not preserved.'

foreach ($test in @(
    @{ Linear = [double]::NaN; Expected = 0 },
    @{ Linear = -0.1; Expected = 0 },
    @{ Linear = 0.002; Expected = 7 },
    @{ Linear = 0.18; Expected = 118 },
    @{ Linear = 0.5; Expected = 188 },
    @{ Linear = 1.0; Expected = 255 },
    @{ Linear = 2.0; Expected = 255 }
)) {
    $actual = $linearToSrgb.Invoke($null, @([double]$test.Linear))
    Assert-Image ($actual -eq $test.Expected) ("Linear {0} encoded to sRGB byte {1}." -f $test.Linear, $actual)
}
Write-Output 'PASS: WGC source compiled and its HDR conversion handled normal, subnormal, nonfinite and clipped values.'

function New-FixturePng([int]$Width, [int]$Height, [int]$Gray, [int]$RightGray = $Gray) {
    $bitmap = [Drawing.Bitmap]::new($Width, $Height)
    $output = [IO.MemoryStream]::new()
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $brush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb($RightGray, $RightGray, $RightGray))
    try {
        $graphics.Clear([Drawing.Color]::FromArgb($Gray, $Gray, $Gray))
        $halfWidth = [int][Math]::Floor($Width / 2)
        $graphics.FillRectangle($brush, $halfWidth, 0, $Width - $halfWidth, $Height)
        $bitmap.Save($output, [Drawing.Imaging.ImageFormat]::Png)
        return ,$output.ToArray()
    } finally {
        $brush.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
        $output.Dispose()
    }
}

function Test-PreparedPng($Prepared, [scriptblock]$Check) {
    $stream = [IO.MemoryStream]::new($Prepared.Png, $false)
    try {
        $bitmap = [Drawing.Bitmap]::new($stream)
        try { & $Check $bitmap }
        finally { $bitmap.Dispose() }
    } finally { $stream.Dispose() }
}

$uniform = New-FixturePng 24 14 97
$original = [Convert]::ToBase64String($uniform)
$prepared = [FateOcrImage]::Prepare($uniform, 256)
Assert-Image ($prepared.Padding -eq 16 -and $prepared.ScaleX -eq 2 -and $prepared.ScaleY -eq 2) 'Unexpected scale for a small uniform input.'
Test-PreparedPng $prepared {
    param($bitmap)
    Assert-Image ($bitmap.Width -eq 80 -and $bitmap.Height -eq 60) 'Unexpected uniform output size.'
    $expected = [Drawing.Color]::FromArgb(97, 97, 97).ToArgb()
    for ($y = 0; $y -lt $bitmap.Height; $y++) {
        for ($x = 0; $x -lt $bitmap.Width; $x++) {
            Assert-Image ($bitmap.GetPixel($x, $y).ToArgb() -eq $expected) "Uniform image changed at ($x, $y)."
        }
    }
}
Assert-Image ([Convert]::ToBase64String($uniform) -ceq $original) 'Preparing OCR changed the original PNG.'

$prepared = [FateOcrImage]::Prepare((New-FixturePng 24 14 100 104), 256)
Test-PreparedPng $prepared {
    param($bitmap)
    $dark = $bitmap.GetPixel(28, 30)
    $light = $bitmap.GetPixel(52, 30)
    Assert-Image ($dark.R -le 3 -and $dark.R -eq $dark.G -and $dark.G -eq $dark.B) 'The darker band was not stretched to grayscale black.'
    Assert-Image ($light.R -ge 252 -and $light.R -eq $light.G -and $light.G -eq $light.B) 'The lighter band was not stretched to grayscale white.'
}

$prepared = [FateOcrImage]::Prepare((New-FixturePng 101 67 97), 64)
Test-PreparedPng $prepared {
    param($bitmap)
    Assert-Image ($bitmap.Width -eq 64 -and $bitmap.Height -eq 53) 'The OCR limit must include padding on both sides.'
}
Assert-Image ([Math]::Abs($prepared.ScaleX - 32.0 / 101) -lt 1e-12) 'ScaleX must describe the rounded output width.'
Assert-Image ([Math]::Abs($prepared.ScaleY - 21.0 / 67) -lt 1e-12) 'ScaleY must describe the rounded output height.'

$prepared = [FateOcrImage]::Prepare((New-FixturePng 2200 2 97), 10000)
Test-PreparedPng $prepared {
    param($bitmap)
    Assert-Image ($bitmap.Width -eq 4096 -and $bitmap.Height -eq 36) 'The processing cap must remain at 4096 pixels.'
}
$rejected = $false
try { [void][FateOcrImage]::Prepare($uniform, 47) }
catch {
    $rejected = $_.Exception.InnerException -is [ArgumentOutOfRangeException] -and
        $_.Exception.InnerException.ParamName -eq 'maxDimension'
}
Assert-Image $rejected 'An OCR dimension limit too small for the minimum padded image should be rejected.'
Write-Output 'PASS: OCR image contrast, original PNG preservation, padding, scale, and dimension limits.'
