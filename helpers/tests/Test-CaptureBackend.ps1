# Native integration test: capture only a temporary, generated fixture window.
# No game input, game capture, upload, clipboard access or user's desktop output.
param([switch]$RequireCleanGdi)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type -Path (Join-Path (Split-Path $PSScriptRoot -Parent) 'CaptureImage.cs') -ReferencedAssemblies System.Drawing
Add-Type -ReferencedAssemblies System.Drawing, System.Windows.Forms -TypeDefinition @'
using System;
using System.Drawing;
using System.Windows.Forms;
using System.Runtime.InteropServices;
public class FateCaptureFixture : Form {
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(Point point);
    public bool IsOverlay { get; set; }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams { get { var p = base.CreateParams; p.ExStyle |= 0x08000000; return p; } }
    public bool OwnsSamplePoints(int left, int top, int width, int height) {
        int right = left + width - 1, bottom = top + height - 1;
        foreach (Point point in new[] { new Point(left, top), new Point(right, top), new Point(left, bottom),
                     new Point(right, bottom), new Point(left + width / 2, top + height / 2) }) {
            if (WindowFromPoint(point) != Handle) return false;
        }
        return true;
    }
    public bool IsTopAtCenter() {
        return WindowFromPoint(new Point(Left + Width / 2, Top + Height / 2)) == Handle;
    }
    protected override void OnPaint(PaintEventArgs e) {
        if (IsOverlay) { e.Graphics.Clear(Color.Magenta); return; }
        e.Graphics.Clear(Color.FromArgb(24, 24, 24));
        using (var grey = new SolidBrush(Color.FromArgb(128, 128, 128))) e.Graphics.FillRectangle(grey, 0, 0, Width / 2, Height);
        e.Graphics.FillRectangle(Brushes.White, Width / 2, 0, Width / 2, Height);
        using (var font = new Font("Arial", 22)) e.Graphics.DrawString("Fate capture test", font, Brushes.Black, 20, 20);
    }
}
'@
[void][FateCaptureFixture]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
$fixture = [FateCaptureFixture]::new()
$overlay = [FateCaptureFixture]::new()
function Assert-FixturePng([byte[]]$Png, [string]$Backend) {
    $stream = [IO.MemoryStream]::new($Png, $false)
    try {
        $image = [Drawing.Bitmap]::new($stream)
        try {
            if ($image.Width -ne $width -or $image.Height -ne $height) { throw "$Backend returned the wrong crop dimensions." }
            $grey = $image.GetPixel(100, 100); $white = $image.GetPixel(350, 100)
            if ([Math]::Abs($grey.R - 128) -gt 18 -or [Math]::Abs($grey.G - 128) -gt 18 -or
                [Math]::Abs($grey.B - 128) -gt 18 -or $white.R -lt 235 -or $white.G -lt 235 -or $white.B -lt 235) {
                throw "Unexpected fixture colors ($Backend): grey=$grey white=$white"
            }
        } finally { $image.Dispose() }
    } finally { $stream.Dispose() }
}
function Get-FixtureOccluders {
    $method = [FateScreenCapture].GetMethod('OccludingWindows', [Reflection.BindingFlags]'Static,NonPublic')
    $method.Invoke($null, [object[]]@($fixture.Handle, $left, $top, $width, $height))
}
try {
    $fixture.FormBorderStyle = 'None'; $fixture.ShowInTaskbar = $false; $fixture.TopMost = $true
    $fixture.StartPosition = 'Manual'; $fixture.Size = [Drawing.Size]::new(480, 200)
    $area = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $fixture.Location = [Drawing.Point]::new($area.X + 40, $area.Y + 40)
    $fixture.Show(); $fixture.Refresh(); [Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 250
    $left = $fixture.Left + 16; $top = $fixture.Top + 16; $width = 432; $height = 160
    if (!$fixture.OwnsSamplePoints($left, $top, $width, $height)) { throw 'The generated fixture is covered. Native capture test cannot proceed.' }
    $monitor = [FateScreenCapture]::MonitorForRegion($left, $top, $width, $height)
    $hdr = [FateScreenCapture]::IsHdrEnabled($monitor)
    if (@(Get-FixtureOccluders).Count -eq 0) {
        $cleanGdi = [FateScreenCapture]::CaptureDesktopRegion($fixture.Handle, $left, $top, $width, $height)
        if (!$hdr) { Assert-FixturePng $cleanGdi 'SDR GDI' }
        Write-Output "PASS: clean GDI crop (Windows HDR=$hdr)."
    } else {
        if ($RequireCleanGdi) { throw 'The generated fixture is covered. The clean GDI release check cannot proceed.' }
        Write-Output 'SKIP: clean GDI crop requires an interactive desktop with no intersecting windows.'
    }
    Assert-FixturePng ([FateScreenCapture]::CaptureWindowRegion($fixture.Handle, $left, $top, $width, $height, $false)) 'clean WGC'
    $overlay.IsOverlay = $true
    $overlay.FormBorderStyle = 'None'; $overlay.ShowInTaskbar = $false; $overlay.TopMost = $true
    $overlay.StartPosition = 'Manual'; $overlay.Size = [Drawing.Size]::new(36, 28)
    $overlay.Location = [Drawing.Point]::new($left + 82, $top + 86)
    $overlay.Show(); $overlay.Refresh(); [Windows.Forms.Application]::DoEvents()
    if (!$overlay.IsTopAtCenter() -or !$fixture.OwnsSamplePoints($left, $top, $width, $height)) {
        throw 'The generated overlay must cover the pixel test without covering any of the old validation points.'
    }
    foreach ($opacity in 1.0, 0.8) {
        $overlay.Opacity = $opacity
        $overlay.Refresh(); [Windows.Forms.Application]::DoEvents()
        if (!$overlay.IsTopAtCenter() -or $overlay.Handle -notin @(Get-FixtureOccluders)) {
            throw "GDI did not detect the intersecting overlay (opacity=$opacity)."
        }
        $blocked = $false
        try { [void][FateScreenCapture]::CaptureDesktopRegion($fixture.Handle, $left, $top, $width, $height) }
        catch [FateCaptureOccludedException] { $blocked = $true }
        if (!$blocked) { throw 'GDI accepted an intersecting overlay outside the old sample points.' }
        Write-Output "PASS: GDI rejects a small intersecting overlay (opacity=$opacity)."
    }
    foreach ($forceFloat in @($false, $true)) {
        $png = [FateScreenCapture]::CaptureWindowRegion($fixture.Handle, $left, $top, $width, $height, $forceFloat)
        if (!$overlay.IsTopAtCenter()) { throw 'The generated overlay moved during capture.' }
        Assert-FixturePng $png "WGC HDR=$hdr float16=$forceFloat"
        Write-Output "PASS: WGC window crop excludes the overlay (Windows HDR=$hdr, forceFloat16=$forceFloat)."
    }
} finally { $overlay.Dispose(); $fixture.Dispose() }
exit 0
