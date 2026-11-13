[CmdletBinding(DefaultParameterSetName = 'Window')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Image')][string]$InputImage,
    [Parameter(Mandatory, ParameterSetName = 'Window')][long]$WindowHandle,
    [Parameter(Mandatory, ParameterSetName = 'Window')][int]$WindowPid,
    [Parameter(Mandatory, ParameterSetName = 'Window')][int]$ClientWidth,
    [Parameter(Mandatory, ParameterSetName = 'Window')][int]$ClientHeight,
    [Parameter(Mandatory, ParameterSetName = 'Window')][int]$X,
    [Parameter(Mandatory, ParameterSetName = 'Window')][int]$Y,
    [Parameter(Mandatory, ParameterSetName = 'Window')][int]$Width,
    [Parameter(Mandatory, ParameterSetName = 'Window')][int]$Height,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'captures'),
    [guid]$CaptureId = [guid]::NewGuid(),
    [string]$OcrLanguage,
    [ValidateSet('auto', 'original', 'normalized')][string]$OcrMode = 'auto',
    [ValidateSet('auto', 'gdi', 'wgc')][string]$CaptureBackend = 'auto',
    [string]$SessionId,
    [string]$SessionStartedAt,
    [int]$CaptureSequence,
    [string]$PreviousCapturePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'CaptureContext.Common.ps1')
. (Join-Path $PSScriptRoot 'AreaContext.Common.ps1')

# Screen capture, Windows OCR and positioned text export.
# Component attribution: THIRD_PARTY_NOTICES.md and LICENSE.third-party.txt.

. (Join-Path $PSScriptRoot 'Ocr.Common.ps1')

. (Join-Path $PSScriptRoot 'WindowCapture.Common.ps1')

$failureCode = 1
$temporaryPath = $null
$recoveryPath = $null
try {
    Add-Type -AssemblyName System.Drawing
    if ($PSCmdlet.ParameterSetName -eq 'Image') {
        $imageFile = Get-Item -LiteralPath $InputImage
        if ($imageFile.Length -ge 9MB) {
            $failureCode = 2
            throw 'The PNG is too large for a 12 MiB bundle. Choose a tighter crop.'
        }
        $png = [System.IO.File]::ReadAllBytes($imageFile.FullName)
        $memory = [System.IO.MemoryStream]::new($png, $false)
        try {
            $image = [System.Drawing.Image]::FromStream($memory)
            try {
                if ($image.RawFormat.Guid -ne [System.Drawing.Imaging.ImageFormat]::Png.Guid) {
                    throw 'InputImage must be a PNG file.'
                }
                $Width = $image.Width
                $Height = $image.Height
            } finally {
                $image.Dispose()
            }
        } finally {
            $memory.Dispose()
        }
    }

    if ($Width -le 0 -or $Height -le 0) { throw 'The selected crop has no area.' }
    if ($Width -gt 8192 -or $Height -gt 8192 -or ([long]$Width * $Height) -gt 16777216) {
        $failureCode = 2
        throw 'The crop is too large. Choose a tighter crop.'
    }

    $capturedAt = [DateTime]::UtcNow.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    $directory = [System.IO.Directory]::CreateDirectory($OutputDirectory)
    $area = $null
    if ($PSCmdlet.ParameterSetName -eq 'Window') {
        $areaBefore = Get-FateAreaSnapshot $WindowPid
        $png = Get-FateWindowPng -WindowHandle $WindowHandle -WindowPid $WindowPid -ClientWidth $ClientWidth -ClientHeight $ClientHeight `
            -X $X -Y $Y -Width $Width -Height $Height -CaptureBackend $CaptureBackend -CompilerDirectory $directory.FullName -FailureCode ([ref]$failureCode)
        $area = Resolve-FateCapturedArea $areaBefore (Get-FateAreaSnapshot $WindowPid)
    }

    if ($png.Length -ge 9MB) {
        $failureCode = 2
        throw 'The PNG is too large for a 12 MiB bundle. Choose a tighter crop.'
    }
    # Keep the captured pixels recoverable if WinRT OCR or its host process stalls.
    # This is local evidence only; upload and folder intake ignore PNG files.
    $recoveryPath = Join-Path $directory.FullName ("fate-" + $CaptureId + '.recovery.png')
    [IO.File]::WriteAllBytes($recoveryPath, $png)
    $ocr = Get-OcrResult -Png $png -ImageWidth $Width -ImageHeight $Height -OcrLanguage $OcrLanguage -OcrMode $OcrMode
    $captureMode = if ($PSCmdlet.ParameterSetName -eq 'Window') { 'game' } else { 'fixture' }
    $previous = $null
    if ($PreviousCapturePath -and [IO.File]::Exists($PreviousCapturePath)) {
        try {
            $previousFile = [IO.FileInfo]::new($PreviousCapturePath)
            if ($previousFile.Length -le 12MB -and !($previousFile.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                $previous = [IO.File]::ReadAllText($PreviousCapturePath) | ConvertFrom-Json
            }
        } catch { $previous = $null } # Optional evidence must not prevent a new capture.
    }
    $context = New-FateCaptureContext -Mode $captureMode -CaptureId $CaptureId.ToString() -CapturedAt ([DateTimeOffset]::Parse($capturedAt)) `
        -SessionId $SessionId -SessionStartedAt $SessionStartedAt -Sequence $CaptureSequence -Ocr $ocr -Width $Width -Height $Height -Previous $previous -Area $area
    $bundle = [ordered]@{
        kind = 'fate-collector.capture'
        schemaVersion = 1
        captureId = $CaptureId.ToString()
        capturedAt = $capturedAt
        source = 'windows-helper'
        helperVersion = '0.5.0'
        image = [ordered]@{ mimeType = 'image/png'; width = $Width; height = $Height; dataBase64 = [Convert]::ToBase64String($png) }
        ocr = $ocr
        context = $context
    }
    # Preserve the full client height so local visual matching does not mistake
    # a calibrated crop for a full frame. Image fixtures retain explicit unknown scale.
    if ($PSCmdlet.ParameterSetName -eq 'Window') { $bundle.image.frameHeight = $ClientHeight }
    $json = $bundle | ConvertTo-Json -Depth 6 -Compress
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($json)
    if ($bytes.Length -gt 12MB) {
        $failureCode = 2
        throw 'The bundle exceeds 12 MiB. Choose a tighter crop.'
    }
    $outputPath = Join-Path $directory.FullName ("fate-" + $CaptureId + '.json')
    $pendingPath = $outputPath + '.part'
    $file = [System.IO.File]::Open($pendingPath, [System.IO.FileMode]::CreateNew)
    $temporaryPath = $pendingPath
    try {
        $file.Write($bytes, 0, $bytes.Length)
    } finally {
        $file.Dispose()
    }
    [System.IO.File]::Move($temporaryPath, $outputPath)
    $temporaryPath = $null
    [IO.File]::Delete($recoveryPath)
    Write-Output $outputPath
    if ($ocr.status -eq 'unavailable') { exit 10 }
    if ($ocr.status -eq 'error') { exit 11 }
    if ($context.Contains('possibleDuplicate')) { exit 12 }
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit $failureCode
} finally {
    if ($null -ne $temporaryPath) {
        Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    }
}
