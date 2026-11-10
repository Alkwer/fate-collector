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

# Screen capture, Windows OCR and positioned text export.
# Component attribution: THIRD_PARTY_NOTICES.md and LICENSE.third-party.txt.

. (Join-Path $PSScriptRoot 'Ocr.Common.ps1')

function Add-WindowCaptureType {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class FateCaptureWindow {
    [StructLayout(LayoutKind.Sequential)]
    public struct Point { public int X, Y; public Point(int x, int y) { X = x; Y = y; } }
    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int capacity);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

    public static Point GetCrop(IntPtr hwnd, uint expectedPid, int clientWidth, int clientHeight,
                                int x, int y, int width, int height) {
        SetThreadDpiAwarenessContext(new IntPtr(-4)); // Per-monitor DPI aware v2
        uint pid;
        Rect rect;
        var className = new StringBuilder(64);
        var origin = new Point(x, y);
        if (hwnd == IntPtr.Zero || GetForegroundWindow() != hwnd ||
            GetClassName(hwnd, className, className.Capacity) == 0 || className.ToString() != "POEWindowClass" ||
            GetWindowThreadProcessId(hwnd, out pid) == 0 || pid != expectedPid ||
            !GetClientRect(hwnd, out rect) || rect.Right != clientWidth || rect.Bottom != clientHeight ||
            !ClientToScreen(hwnd, ref origin)) {
            throw new InvalidOperationException("The foreground Path of Exile window or client size changed.");
        }

        return origin;
    }
}
'@
}

$failureCode = 1
$temporaryPath = $null
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
    if ($PSCmdlet.ParameterSetName -eq 'Window') {
        if ($X -lt 0 -or $Y -lt 0 -or ([long]$X + $Width) -gt $ClientWidth -or ([long]$Y + $Height) -gt $ClientHeight) {
            throw 'The selected crop must fit inside the game client.'
        }
        # Windows PowerShell's in-memory compiler can use temporary files.
        # Keep them in the same output directory and restore the child process settings.
        $tempBefore = $env:TEMP
        $tmpBefore = $env:TMP
        try {
            $env:TEMP = $directory.FullName
            $env:TMP = $directory.FullName
            Add-WindowCaptureType
            if (-not ('FateScreenCapture' -as [type])) {
                Add-Type -Path (Join-Path $PSScriptRoot 'CaptureImage.cs') -ReferencedAssemblies System.Drawing
            }
        } finally {
            $env:TEMP = $tempBefore
            $env:TMP = $tmpBefore
        }
        $failureCode = 3
        $origin = [FateCaptureWindow]::GetCrop([IntPtr]$WindowHandle, $WindowPid, $ClientWidth, $ClientHeight, $X, $Y, $Width, $Height)
        $monitor = [FateScreenCapture]::MonitorForRegion($origin.X, $origin.Y, $Width, $Height)
        $useWgc = $CaptureBackend -eq 'wgc' -or ($CaptureBackend -eq 'auto' -and [FateScreenCapture]::IsHdrEnabled($monitor))
        if ($useWgc) {
            $failureCode = 4
            # Do not silently downgrade an HDR capture to washed-out GDI pixels.
            $png = [FateScreenCapture]::CaptureWindowRegion([IntPtr]$WindowHandle, $origin.X, $origin.Y, $Width, $Height, $false)
        } else {
            $failureCode = 1
            try {
                $png = [FateScreenCapture]::CaptureDesktopRegion([IntPtr]$WindowHandle, $origin.X, $origin.Y, $Width, $Height)
            } catch [FateCaptureOccludedException] {
                if ($CaptureBackend -eq 'gdi') {
                    $failureCode = 3
                    throw
                }
                # The desktop crop is unsafe. Capture the verified window itself instead.
                $failureCode = 3
                $verified = [FateCaptureWindow]::GetCrop([IntPtr]$WindowHandle, $WindowPid, $ClientWidth, $ClientHeight, $X, $Y, $Width, $Height)
                if ($origin.X -ne $verified.X -or $origin.Y -ne $verified.Y) { throw 'The game window moved during the capture.' }
                $failureCode = 4
                $png = [FateScreenCapture]::CaptureWindowRegion([IntPtr]$WindowHandle, $origin.X, $origin.Y, $Width, $Height, $false)
            }
        }
        $failureCode = 3
        $afterCopy = [FateCaptureWindow]::GetCrop([IntPtr]$WindowHandle, $WindowPid, $ClientWidth, $ClientHeight, $X, $Y, $Width, $Height)
        if ($origin.X -ne $afterCopy.X -or $origin.Y -ne $afterCopy.Y) { throw 'The game window moved during the capture.' }
        $failureCode = 1
    }

    if ($png.Length -ge 9MB) {
        $failureCode = 2
        throw 'The PNG is too large for a 12 MiB bundle. Choose a tighter crop.'
    }
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
        -SessionId $SessionId -SessionStartedAt $SessionStartedAt -Sequence $CaptureSequence -Ocr $ocr -Width $Width -Height $Height -Previous $previous
    $bundle = [ordered]@{
        kind = 'fate-collector.capture'
        schemaVersion = 1
        captureId = $CaptureId.ToString()
        capturedAt = $capturedAt
        source = 'windows-helper'
        helperVersion = '0.3.3'
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
