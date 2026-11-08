# Native integration test: capture only a temporary, generated fixture window.
# No game input, game capture, upload, clipboard access or user's desktop output.
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
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams { get { var p = base.CreateParams; p.ExStyle |= 0x08000000; return p; } }
    public bool OwnsRegion() {
        return WindowFromPoint(new Point(Left + 1, Top + 1)) == Handle &&
               WindowFromPoint(new Point(Right - 2, Bottom - 2)) == Handle &&
               WindowFromPoint(new Point(Left + Width / 2, Top + Height / 2)) == Handle;
    }
    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.Clear(Color.FromArgb(24, 24, 24));
        using (var grey = new SolidBrush(Color.FromArgb(128, 128, 128))) e.Graphics.FillRectangle(grey, 0, 0, Width / 2, Height);
        e.Graphics.FillRectangle(Brushes.White, Width / 2, 0, Width / 2, Height);
        using (var font = new Font("Arial", 22)) e.Graphics.DrawString("Fate capture test", font, Brushes.Black, 20, 20);
    }
}
'@
[void][FateCaptureFixture]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
$fixture = [FateCaptureFixture]::new()
try {
    $fixture.FormBorderStyle = 'None'; $fixture.ShowInTaskbar = $false; $fixture.TopMost = $true
    $fixture.StartPosition = 'Manual'; $fixture.Size = [Drawing.Size]::new(480, 200)
    $area = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $fixture.Location = [Drawing.Point]::new($area.X + 40, $area.Y + 40)
    $fixture.Show(); $fixture.Refresh(); [Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 250
    if (!$fixture.OwnsRegion()) { throw 'The generated fixture is covered. Native capture test cannot proceed.' }
    $monitor = [FateScreenCapture]::MonitorForRegion($fixture.Left, $fixture.Top, $fixture.Width, $fixture.Height)
    $hdr = [FateScreenCapture]::IsHdrEnabled($monitor)
    foreach ($forceFloat in @($false, $true)) {
        $png = [FateScreenCapture]::CaptureRegion($fixture.Left, $fixture.Top, $fixture.Width, $fixture.Height, $forceFloat)
        if (!$fixture.OwnsRegion()) { throw 'The generated fixture was covered during capture.' }
        $stream = [IO.MemoryStream]::new($png, $false)
        try {
            $image = [Drawing.Bitmap]::new($stream)
            try {
                if ($image.Width -ne 480 -or $image.Height -ne 200) { throw 'WGC returned a cropped or resized fixture.' }
                $grey = $image.GetPixel(100, 150); $white = $image.GetPixel(400, 150)
                if ([Math]::Abs($grey.R - 128) -gt 18 -or [Math]::Abs($grey.G - 128) -gt 18 -or
                    [Math]::Abs($grey.B - 128) -gt 18 -or $white.R -lt 235 -or $white.G -lt 235 -or $white.B -lt 235) {
                    throw "Unexpected fixture colors (HDR=$hdr, float16=$forceFloat): grey=$grey white=$white"
                }
                Write-Output "PASS: native WGC fixture dimensions and colors (Windows HDR=$hdr, forceFloat16=$forceFloat)."
            } finally { $image.Dispose() }
        } finally { $stream.Dispose() }
    }
} finally { $fixture.Close(); $fixture.Dispose() }
exit 0
