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
    [string]$SessionId,
    [string]$SessionStartedAt,
    [int]$CaptureSequence,
    [string]$PreviousCapturePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'CaptureContext.Common.ps1')

# CopyFromScreen, WinRT OCR, and line geometry adapted from One More Map.
# See README.md and LICENSE.one-more-map.txt.

function Wait-WinRtResult($Operation, [type]$ResultType) {
    $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    return $task.GetAwaiter().GetResult()
}

function Get-OcrResult([byte[]]$Png, [int]$ImageWidth, [int]$ImageHeight) {
    $ocr = [ordered]@{ status = 'unavailable'; text = ''; lines = @(); language = $null }
    try {
        Add-Type -AssemblyName System.Runtime.WindowsRuntime
        [void][Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
        [void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
        [void][Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
        [void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
        [void][Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]

        $languages = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages)
        if ($OcrLanguage) {
            $language = $languages | Where-Object LanguageTag -EQ $OcrLanguage | Select-Object -First 1
            if ($null -eq $language) { return $ocr }
            $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
        } else {
            $english = $languages | Where-Object LanguageTag -Match '^en(-|$)' |
                Sort-Object { if ($_.LanguageTag -eq 'en-US') { 0 } else { 1 } } | Select-Object -First 1
            $engine = if ($null -ne $english) { [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($english) }
            if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
            if ($null -eq $engine -and $languages.Count -gt 0) {
                $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($languages[0])
            }
        }
        if ($null -eq $engine) { return $ocr }
    } catch {
        Write-Verbose ("Windows OCR is unavailable. " + $_.Exception.Message)
        return $ocr
    }

    $ocr.status = 'error'
    try {
        $ocr.language = [string]$engine.RecognizerLanguage.LanguageTag
        $maxDimension = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
        if ($ImageWidth -gt $maxDimension -or $ImageHeight -gt $maxDimension) {
            throw "The capture exceeds the Windows OCR dimension limit ($maxDimension px)."
        }

        $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
            $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
            $_.GetParameters().Count -eq 1
        } | Select-Object -First 1
        $memory = [System.IO.MemoryStream]::new($Png, $false)
        try {
            $stream = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($memory)
            try {
                $decoder = Wait-WinRtResult ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
                $bitmap = Wait-WinRtResult ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
                try {
                    $recognized = Wait-WinRtResult ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
                } finally {
                    $bitmap.Dispose()
                }
            } finally {
                $stream.Dispose()
            }
        } finally {
            $memory.Dispose()
        }

        $lines = @(
            foreach ($line in $recognized.Lines) {
                $left = [double]$ImageWidth
                $top = [double]$ImageHeight
                $right = $bottom = 0.0
                foreach ($word in $line.Words) {
                    $rect = $word.BoundingRect
                    $left = [Math]::Min($left, [Math]::Max(0.0, $rect.X))
                    $top = [Math]::Min($top, [Math]::Max(0.0, $rect.Y))
                    $right = [Math]::Max($right, [Math]::Min($ImageWidth, $rect.X + $rect.Width))
                    $bottom = [Math]::Max($bottom, [Math]::Min($ImageHeight, $rect.Y + $rect.Height))
                }
                if ($right -gt $left -and $bottom -gt $top) {
                    [ordered]@{ text = [string]$line.Text; x = $left; y = $top; width = $right - $left; height = $bottom - $top }
                }
            }
        )
        $text = [string](($lines | ForEach-Object { $_.text }) -join "`n")
        if ($lines.Count -gt 500 -or $text.Length -gt 20000 -or @($lines | Where-Object { $_.text.Length -gt 2000 }).Count -gt 0) {
            throw 'Windows OCR returned too much text. Choose a tighter crop.'
        }
        $ocr.status = 'ok'
        $ocr.text = $text
        $ocr.lines = $lines
    } catch {
        Write-Verbose ("Windows OCR failed. " + $_.Exception.Message)
    }
    return $ocr
}

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
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
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

        int right = origin.X + width - 1, bottom = origin.Y + height - 1;
        var samples = new[] {
            origin, new Point(right, origin.Y), new Point(origin.X, bottom), new Point(right, bottom),
            new Point(origin.X + width / 2, origin.Y + height / 2)
        };
        foreach (var point in samples) {
            if (GetAncestor(WindowFromPoint(point), 2) != hwnd) {
                throw new InvalidOperationException("The selected panel is covered or outside the display.");
            }
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
        } finally {
            $env:TEMP = $tempBefore
            $env:TMP = $tmpBefore
        }
        $failureCode = 3
        $origin = [FateCaptureWindow]::GetCrop([IntPtr]$WindowHandle, $WindowPid, $ClientWidth, $ClientHeight, $X, $Y, $Width, $Height)
        $bitmap = [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.CopyFromScreen($origin.X, $origin.Y, 0, 0, $bitmap.Size)
            } finally {
                $graphics.Dispose()
            }
            $afterCopy = [FateCaptureWindow]::GetCrop([IntPtr]$WindowHandle, $WindowPid, $ClientWidth, $ClientHeight, $X, $Y, $Width, $Height)
            if ($origin.X -ne $afterCopy.X -or $origin.Y -ne $afterCopy.Y) {
                throw 'The game window moved during the capture.'
            }
            $failureCode = 1
            $memory = [System.IO.MemoryStream]::new()
            try {
                $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
                $png = $memory.ToArray()
            } finally {
                $memory.Dispose()
            }
        } finally {
            $bitmap.Dispose()
        }
    }

    if ($png.Length -ge 9MB) {
        $failureCode = 2
        throw 'The PNG is too large for a 12 MiB bundle. Choose a tighter crop.'
    }
    $ocr = Get-OcrResult -Png $png -ImageWidth $Width -ImageHeight $Height
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
        helperVersion = '0.2.0'
        image = [ordered]@{ mimeType = 'image/png'; width = $Width; height = $Height; dataBase64 = [Convert]::ToBase64String($png) }
        ocr = $ocr
        context = $context
    }
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
