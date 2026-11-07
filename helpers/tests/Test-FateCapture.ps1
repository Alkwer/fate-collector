param([switch]$RequireOcr)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$helper = Split-Path $PSScriptRoot -Parent
$export = Join-Path $helper 'Export-FateCapture.ps1'
$powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$folder = Join-Path (Join-Path $helper 'captures') ("fixture & space " + [guid]::NewGuid())
[void][System.IO.Directory]::CreateDirectory($folder)
$fixture = Join-Path $folder 'fixture.png'
$largeFixture = Join-Path $folder 'large.png'

function Invoke-Export {
    param([string[]]$Arguments)
    $ErrorActionPreference = 'Continue'
    $output = & $powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File $export -OutputDirectory $folder @Arguments 2>&1
    return @{ Code = $LASTEXITCODE; Output = @($output) }
}

function Assert-True($Condition, [string]$Message) {
    if (!$Condition) { throw $Message }
}

function Read-FixtureBundle($Result, [guid]$Id) {
    Assert-True ($Result.Code -in 0, 10, 11) "Export failed ($($Result.Code)). $($Result.Output -join ' ')"
    $path = Join-Path $folder ("fate-" + $Id + '.json')
    Assert-True ((Get-Item -LiteralPath $path).Length -lt 12MB) 'Bundle exceeds the size limit.'
    $bundle = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($bundle.kind -eq 'fate-collector.capture' -and $bundle.schemaVersion -eq 1) 'Incorrect bundle header.'
    Assert-True ($bundle.source -eq 'windows-helper' -and $bundle.helperVersion -eq '0.1.0') 'Incorrect producer metadata.'
    Assert-True ($bundle.context.captureMode -eq 'fixture') 'The offline PNG was not marked as a fixture.'
    Assert-True ($bundle.captureId -eq $Id.ToString()) 'Incorrect capture ID.'
    Assert-True ([string]$bundle.capturedAt -match 'Z$' -or $bundle.capturedAt -is [DateTime]) 'Timestamp is not UTC ISO 8601.'
    [void][DateTimeOffset]::Parse($bundle.capturedAt)
    Assert-True ($bundle.image.mimeType -eq 'image/png' -and $bundle.image.width -eq 660 -and $bundle.image.height -eq 180) 'Incorrect image metadata.'
    $decoded = [Convert]::FromBase64String($bundle.image.dataBase64)
    Assert-True ([Convert]::ToBase64String([IO.File]::ReadAllBytes($fixture)) -ceq [Convert]::ToBase64String($decoded)) 'The PNG bytes changed.'
    Assert-True ($bundle.ocr.text.Length -le 20000 -and $bundle.ocr.lines.Count -le 500) 'OCR exceeds the bundle limits.'
    return $bundle
}

try {
    $image = [System.Drawing.Bitmap]::new(660, 180)
    $graphics = [System.Drawing.Graphics]::FromImage($image)
    $font = [System.Drawing.Font]::new('Arial', 38, [System.Drawing.FontStyle]::Bold)
    try {
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.DrawString('FATE COLLECTOR', $font, [System.Drawing.Brushes]::Black, 15.0, 10.0)
        $graphics.DrawString('ITEM RARITY', $font, [System.Drawing.Brushes]::Black, 15.0, 85.0)
        $image.Save($fixture, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $font.Dispose()
        $graphics.Dispose()
        $image.Dispose()
    }

    $id = [guid]::NewGuid()
    $result = Invoke-Export -Arguments @('-InputImage', $fixture, '-CaptureId', $id.ToString(), '-Verbose')
    $bundle = Read-FixtureBundle $result $id
    if ($bundle.ocr.status -eq 'ok') {
        Assert-True ($result.Code -eq 0) 'Successful OCR should exit with code 0.'
        Assert-True ($bundle.ocr.text -match 'FATE COLLECTOR' -and $bundle.ocr.text -match 'ITEM RARITY') "Fixture text was not recognized. $($bundle.ocr.text)"
        Assert-True ($bundle.ocr.lines.Count -eq 2 -and $bundle.ocr.language) 'Expected two lines and a recognizer language.'
        foreach ($line in $bundle.ocr.lines) {
            Assert-True ($line.text -and $line.x -ge 0 -and $line.y -ge 0 -and $line.width -gt 0 -and $line.height -gt 0 -and
                ($line.x + $line.width) -le $bundle.image.width -and ($line.y + $line.height) -le $bundle.image.height) 'Invalid OCR line geometry.'
        }
        Write-Output 'PASS: OCR recognized both fixture lines with in-bounds coordinates.'
    } else {
        Assert-True (!$RequireOcr) "Fixture OCR was $($bundle.ocr.status). $($result.Output -join ' ')"
        Write-Output "SKIP: fixture OCR was $($bundle.ocr.status). Use -RequireOcr to require live OCR."
    }

    $id = [guid]::NewGuid()
    $result = Invoke-Export -Arguments @('-InputImage', $fixture, '-CaptureId', $id.ToString(), '-OcrLanguage', 'qaa')
    $bundle = Read-FixtureBundle $result $id
    Assert-True ($result.Code -eq 10 -and $bundle.ocr.status -eq 'unavailable' -and !$bundle.ocr.text -and
        $bundle.ocr.lines.Count -eq 0 -and $null -eq $bundle.ocr.language) 'Unavailable OCR did not preserve an image-only bundle.'
    Write-Output 'PASS: unavailable OCR preserved the original PNG and empty OCR.'

    $image = [System.Drawing.Bitmap]::new(8193, 1)
    try {
        $image.Save($largeFixture, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $image.Dispose()
    }
    $id = [guid]::NewGuid()
    $result = Invoke-Export -Arguments @('-InputImage', $largeFixture, '-CaptureId', $id.ToString())
    Assert-True ($result.Code -eq 2 -and ($result.Output -join ' ') -match 'tighter crop' -and
        !(Test-Path -LiteralPath (Join-Path $folder ("fate-" + $id + '.json')))) 'Oversized image was not rejected clearly.'
    Write-Output 'PASS: oversized image rejected with a crop hint and no bundle.'

    $id = [guid]::NewGuid()
    $result = Invoke-Export -Arguments @('-WindowHandle', '0', '-WindowPid', '1', '-ClientWidth', '100', '-ClientHeight', '100',
        '-X', '5', '-Y', '5', '-Width', '50', '-Height', '50', '-CaptureId', $id.ToString())
    Assert-True ($result.Code -eq 3 -and !(Test-Path -LiteralPath (Join-Path $folder ("fate-" + $id + '.json')))) "Invalid game window was not rejected. $($result.Output -join ' ')"
    Write-Output 'PASS: invalid game window rejected before capture.'
    Assert-True (@(Get-ChildItem -LiteralPath $folder -File -Filter '*.part').Count -eq 0) 'A partial bundle was left behind.'
} finally {
    Get-ChildItem -LiteralPath $folder -File | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
    Remove-Item -LiteralPath $folder
}
