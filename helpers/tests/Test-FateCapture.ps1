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
    Assert-True ($Result.Code -in 0, 10, 11, 12) "Export failed ($($Result.Code)). $($Result.Output -join ' ')"
    $path = Join-Path $folder ("fate-" + $Id + '.json')
    Assert-True ((Get-Item -LiteralPath $path).Length -lt 12MB) 'Bundle exceeds the size limit.'
    $bundle = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($bundle.kind -eq 'fate-collector.capture' -and $bundle.schemaVersion -eq 1) 'Incorrect bundle header.'
    Assert-True ($bundle.source -eq 'windows-helper' -and $bundle.helperVersion -eq '0.3.3') 'Incorrect producer metadata.'
    Assert-True ($bundle.context.captureMode -eq 'fixture') 'The offline PNG was not marked as a fixture.'
    Assert-True ($bundle.captureId -eq $Id.ToString()) 'Incorrect capture ID.'
    Assert-True ([string]$bundle.capturedAt -match 'Z$' -or $bundle.capturedAt -is [DateTime]) 'Timestamp is not UTC ISO 8601.'
    [void][DateTimeOffset]::Parse($bundle.capturedAt)
    Assert-True ($bundle.image.mimeType -eq 'image/png' -and $bundle.image.width -eq 660 -and $bundle.image.height -eq 180) 'Incorrect image metadata.'
    Assert-True ($null -eq $bundle.image.PSObject.Properties['frameHeight']) 'Offline image must not invent a game-client height.'
    $decoded = [Convert]::FromBase64String($bundle.image.dataBase64)
    Assert-True ([Convert]::ToBase64String([IO.File]::ReadAllBytes($fixture)) -ceq [Convert]::ToBase64String($decoded)) 'The PNG bytes changed.'
    Assert-True ($bundle.ocr.text.Length -le 20000 -and $bundle.ocr.lines.Count -le 500) 'OCR exceeds the bundle limits.'
    return $bundle
}

try {
    & (Join-Path $PSScriptRoot 'Test-CaptureContext.ps1')
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
    $sessionId = [guid]::NewGuid().ToString()
    $sessionStartedAt = [DateTime]::UtcNow.AddSeconds(-1).ToString('yyyyMMddHHmmss')
    $result = Invoke-Export -Arguments @('-InputImage', $fixture, '-CaptureId', $id.ToString(), '-Verbose',
        '-SessionId', $sessionId, '-SessionStartedAt', $sessionStartedAt, '-CaptureSequence', '1')
    $bundle = Read-FixtureBundle $result $id
    Assert-True ($bundle.context.session.id -ceq $sessionId -and $bundle.context.session.sequence -eq 1 -and
        [DateTimeOffset]::Parse($bundle.context.session.startedAt) -le [DateTimeOffset]::Parse($bundle.capturedAt)) 'Exporter lost automatic session context.'
    if ($bundle.ocr.status -eq 'ok') {
        Assert-True ($result.Code -eq 0) 'Successful OCR should exit with code 0.'
        Assert-True ($bundle.ocr.text -match 'FATE COLLECTOR' -and $bundle.ocr.text -match 'ITEM RARITY') "Fixture text was not recognized. $($bundle.ocr.text)"
        Assert-True ($bundle.ocr.lines.Count -eq 2 -and $bundle.ocr.language) 'Expected two lines and a recognizer language.'
        foreach ($line in $bundle.ocr.lines) {
            Assert-True ($line.text -and $line.x -ge 0 -and $line.y -ge 0 -and $line.width -gt 0 -and $line.height -gt 0 -and
                ($line.x + $line.width) -le $bundle.image.width -and ($line.y + $line.height) -le $bundle.image.height) 'Invalid OCR line geometry.'
        }
        Write-Output 'PASS: OCR recognized both fixture lines with in-bounds coordinates.'
        $normalizedId = [guid]::NewGuid()
        $normalizedResult = Invoke-Export -Arguments @('-InputImage', $fixture, '-CaptureId', $normalizedId.ToString(), '-OcrMode', 'normalized')
        $normalizedBundle = Read-FixtureBundle $normalizedResult $normalizedId
        Assert-True ($normalizedResult.Code -eq 0 -and $normalizedBundle.ocr.lines.Count -eq 2 -and
            $normalizedBundle.ocr.text -match 'FATE COLLECTOR' -and $normalizedBundle.ocr.text -match 'ITEM RARITY') 'Normalized Windows OCR did not retain both fixture lines.'
        for ($lineIndex = 0; $lineIndex -lt 2; $lineIndex++) {
            $rawLine = $bundle.ocr.lines[$lineIndex]; $normalizedLine = $normalizedBundle.ocr.lines[$lineIndex]
            Assert-True ([Math]::Abs($rawLine.x - $normalizedLine.x) -lt 5 -and [Math]::Abs($rawLine.y - $normalizedLine.y) -lt 5 -and
                $normalizedLine.x -ge 0 -and $normalizedLine.y -ge 0 -and
                $normalizedLine.x + $normalizedLine.width -le 660 -and $normalizedLine.y + $normalizedLine.height -le 180) 'Normalized OCR geometry did not map back to the original screenshot.'
        }
        Write-Output 'PASS: real normalized OCR preserved PNG bytes, text and original-coordinate geometry.'
        # Refresh fixture time to keep this test deterministic on slower Windows runners.
        $previousPath = Join-Path $folder ("fate-" + $id + '.json')
        $bundle.capturedAt = [DateTime]::UtcNow.ToString('o')
        $bundle | ConvertTo-Json -Depth 6 -Compress | Set-Content -LiteralPath $previousPath -Encoding UTF8
        $repeatId = [guid]::NewGuid()
        $repeatResult = Invoke-Export -Arguments @('-InputImage', $fixture, '-CaptureId', $repeatId.ToString(),
            '-SessionId', $sessionId, '-SessionStartedAt', $sessionStartedAt, '-CaptureSequence', '2', '-PreviousCapturePath', $previousPath)
        $repeatBundle = Read-FixtureBundle $repeatResult $repeatId
        Assert-True ($repeatResult.Code -eq 12 -and $repeatBundle.context.session.sequence -eq 2 -and
            $repeatBundle.context.possibleDuplicate.ofCaptureId -ceq $id.ToString() -and (Test-Path -LiteralPath $previousPath)) 'Exporter lost repeat flag or original evidence.'
        Write-Output 'PASS: repeated OCR produces a second bundle, session sequence and repeat exit code for the helper.'
    } else {
        Assert-True (!$RequireOcr) "Fixture OCR was $($bundle.ocr.status). $($result.Output -join ' ')"
        Write-Output "SKIP: fixture OCR was $($bundle.ocr.status). Use -RequireOcr to require live OCR."
    }

    $id = [guid]::NewGuid()
    $result = Invoke-Export -Arguments @('-InputImage', $fixture, '-CaptureId', $id.ToString(), '-OcrLanguage', 'qaa')
    $bundle = Read-FixtureBundle $result $id
    Assert-True ($result.Code -eq 10 -and $bundle.ocr.status -eq 'unavailable' -and !$bundle.ocr.text -and
        $bundle.ocr.lines.Count -eq 0 -and $null -eq $bundle.ocr.language) 'Unavailable OCR did not preserve an image-only bundle.'
    Assert-True (!$bundle.context.PSObject.Properties['session']) 'Standalone legacy export invented a helper session.'
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

# Expected exporter failures leave a nonzero LASTEXITCODE. Report suite success
# only after every assertion and cleanup has completed; thrown failures still fail.
exit 0
