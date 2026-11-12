function Add-WindowCaptureType {
    if ('FateCaptureWindow' -as [type]) { return }
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

function Get-FateWindowPng {
    param(
        [long]$WindowHandle, [int]$WindowPid, [int]$ClientWidth, [int]$ClientHeight,
        [int]$X, [int]$Y, [int]$Width, [int]$Height, [string]$CaptureBackend,
        [string]$CompilerDirectory, [ref]$FailureCode
    )

    if ($X -lt 0 -or $Y -lt 0 -or ([long]$X + $Width) -gt $ClientWidth -or ([long]$Y + $Height) -gt $ClientHeight) {
        throw 'The selected crop must fit inside the game client.'
    }
    # Windows PowerShell's in-memory compiler can use temporary files.
    # Keep them in the same output directory and restore the child process settings.
    $tempBefore = $env:TEMP
    $tmpBefore = $env:TMP
    try {
        $env:TEMP = $CompilerDirectory
        $env:TMP = $CompilerDirectory
        Add-WindowCaptureType
        if (-not ('FateScreenCapture' -as [type])) {
            Add-Type -Path (Join-Path $PSScriptRoot 'CaptureImage.cs') -ReferencedAssemblies System.Drawing
        }
    } finally {
        $env:TEMP = $tempBefore
        $env:TMP = $tmpBefore
    }
    $FailureCode.Value = 3
    $origin = [FateCaptureWindow]::GetCrop([IntPtr]$WindowHandle, $WindowPid, $ClientWidth, $ClientHeight, $X, $Y, $Width, $Height)
    $monitor = [FateScreenCapture]::MonitorForRegion($origin.X, $origin.Y, $Width, $Height)
    $useWgc = $CaptureBackend -eq 'wgc' -or ($CaptureBackend -eq 'auto' -and [FateScreenCapture]::IsHdrEnabled($monitor))
    if ($useWgc) {
        $FailureCode.Value = 4
        # Do not silently downgrade an HDR capture to washed-out GDI pixels.
        $png = [FateScreenCapture]::CaptureWindowRegion([IntPtr]$WindowHandle, $origin.X, $origin.Y, $Width, $Height, $false)
    } else {
        $FailureCode.Value = 1
        try {
            $png = [FateScreenCapture]::CaptureDesktopRegion([IntPtr]$WindowHandle, $origin.X, $origin.Y, $Width, $Height)
        } catch [FateCaptureOccludedException] {
            if ($CaptureBackend -eq 'gdi') {
                $FailureCode.Value = 3
                throw
            }
            # The desktop crop is unsafe. Capture the verified window itself instead.
            $FailureCode.Value = 3
            $verified = [FateCaptureWindow]::GetCrop([IntPtr]$WindowHandle, $WindowPid, $ClientWidth, $ClientHeight, $X, $Y, $Width, $Height)
            if ($origin.X -ne $verified.X -or $origin.Y -ne $verified.Y) { throw 'The game window moved during the capture.' }
            $FailureCode.Value = 4
            $png = [FateScreenCapture]::CaptureWindowRegion([IntPtr]$WindowHandle, $origin.X, $origin.Y, $Width, $Height, $false)
        }
    }
    $FailureCode.Value = 3
    $afterCopy = [FateCaptureWindow]::GetCrop([IntPtr]$WindowHandle, $WindowPid, $ClientWidth, $ClientHeight, $X, $Y, $Width, $Height)
    if ($origin.X -ne $afterCopy.X -or $origin.Y -ne $afterCopy.Y) { throw 'The game window moved during the capture.' }
    $FailureCode.Value = 1
    return ,$png
}
