param([switch]$CheckWindow)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing, System.Windows.Forms, System.Web.Extensions
Add-Type -Path (Join-Path $PSScriptRoot '..\FateOverlay.cs') -ReferencedAssemblies System.Drawing, System.Windows.Forms, System.Web.Extensions, System.Core
[FateCollector.OverlayWindow]::UsePhysicalCoordinates()
[Windows.Forms.Application]::EnableVisualStyles()

function Assert-That([bool]$Condition, [string]$Message) {
    if (!$Condition) { throw $Message }
}

$results = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\.qa\overlay-native'))
[void][IO.Directory]::CreateDirectory($results)
$directory = Join-Path $results ('overlay-fixture-' + [Guid]::NewGuid().ToString('D'))
[void][IO.Directory]::CreateDirectory($directory)
$session = [FateCollector.OverlaySession]::new($directory)
$now = [FateCollector.OverlaySession]::Now()
$captureId = [Guid]::NewGuid().ToString('D')
$marker = @{ protocol = 1; captureId = $captureId; phase = 'saved'; updatedAt = $now }
$state = @{
    protocol = 1
    clientId = [Guid]::NewGuid().ToString('D')
    revision = [Guid]::NewGuid().ToString('D')
    writtenAt = $now
    captureId = $captureId
    status = 'provisional'
    title = 'Provisional: 2. Fate of Fortune'
    detail = 'A missing modifier may change the ranking. Record the Fate you choose in game.'
    rows = @(
        @{ label = '1. Fate of Resurgence'; detail = '+2 priority points'; recommended = $false },
        @{ label = '2. Fate of Fortune'; detail = '+7 priority points'; recommended = $true },
        @{ label = '3. Fate of Dread'; detail = 'Check the unidentified reward'; recommended = $false }
    )
    actions = @(
        @{ id = 'collect:a'; label = 'Record Fate of Resurgence'; slot = 1 },
        @{ id = 'collect:b'; label = 'Record Fate of Fortune'; slot = 2 },
        @{ id = 'collect:c'; label = 'Record Fate of Dread'; slot = 3 },
        @{ id = 'new-area'; label = 'New area'; slot = 11 },
        @{ id = 'undo'; label = 'Undo collection change'; slot = 12 }
    )
    acknowledgedCommandId = $null
    notice = $null
}
$regularRows = $state.rows
$regularActions = $state.actions
$utf8 = [Text.UTF8Encoding]::new($false)
function Write-Record([string]$Name, $Record) {
    [IO.File]::WriteAllText((Join-Path $directory $Name), ($Record | ConvertTo-Json -Depth 8 -Compress), $utf8)
}

function Test-WindowBridge {
    Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
public static class FateTestBridge {
    [StructLayout(LayoutKind.Sequential)]
    struct Packet { public IntPtr Tag; public int Length; public IntPtr Pointer; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string name);
    public static IntPtr FindOverlay() { return FindWindow(null, "Fate Collector Overlay"); }
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr window, out int pid);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rectangle corners);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr window, int message, IntPtr sender,
        ref Packet packet, int flags, int timeout, out IntPtr output);
    public static Point Center(IntPtr window) {
        Rectangle raw;
        if (!GetWindowRect(window, out raw)) throw new InvalidOperationException();
        return new Point((raw.X + raw.Width) / 2, (raw.Y + raw.Height) / 2);
    }
    public static bool Send(IntPtr window, IntPtr sender, long[] values) {
        var packet = new Packet { Tag = new IntPtr(0x46415445), Length = values.Length * 8 };
        packet.Pointer = Marshal.AllocHGlobal(packet.Length);
        try {
            for (int i = 0; i < values.Length; i++) Marshal.WriteInt64(packet.Pointer, i * 8, values[i]);
            IntPtr output;
            return SendMessageTimeout(window, 0x4a, sender, ref packet, 3, 1000, out output) != IntPtr.Zero && output.ToInt64() == 42;
        } finally { Marshal.FreeHGlobal(packet.Pointer); }
    }
}
'@
    $state.rows = $regularRows
    $state.actions = $regularActions
    $state.writtenAt = [FateCollector.OverlaySession]::Now()
    Write-Record 'state.json' $state
    $fixture = [Windows.Forms.Form]::new()
    $other = [Windows.Forms.Form]::new()
    $sidecar = $null
    try {
        $fixture.Text = 'Fate Collector overlay test fixture'
        $fixture.StartPosition = 'Manual'
        $fixture.Bounds = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
        $fixture.TopMost = $true
        $fixture.Show()
        $fixture.Activate()
        [Windows.Forms.Application]::DoEvents()
        [void][FateTestBridge]::SetForegroundWindow($fixture.Handle)
        Assert-That ([FateTestBridge]::GetForegroundWindow() -eq $fixture.Handle) 'The fixture needs an interactive Windows desktop.'
        $script = Join-Path $PSScriptRoot '..\Show-FateOverlay.ps1'
        $errorFile = Join-Path $directory 'sidecar-error.log'
        $sidecar = Start-Process "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -WindowStyle Hidden -PassThru -RedirectStandardError $errorFile -ArgumentList @(
            '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $script + '"'),
            '-Directory', ('"' + $directory + '"'), '-ParentPid', $PID
        )
        $window = [IntPtr]::Zero
        $stop = [Diagnostics.Stopwatch]::StartNew()
        while ($window -eq [IntPtr]::Zero -and $stop.Elapsed.TotalSeconds -lt 6 -and !$sidecar.HasExited) {
            [Windows.Forms.Application]::DoEvents()
            $candidate = [FateTestBridge]::FindOverlay()
            if ($candidate -ne [IntPtr]::Zero) {
                $owner = 0
                [void][FateTestBridge]::GetWindowThreadProcessId($candidate, [ref]$owner)
                if ($owner -eq $sidecar.Id) { $window = $candidate }
            }
            Start-Sleep -Milliseconds 50
        }
        if ($window -eq [IntPtr]::Zero) {
            $reason = if ($sidecar.HasExited) { [IO.File]::ReadAllText($errorFile) } else { 'Timed out.' }
            throw "The Windows overlay sidecar did not initialize. $reason"
        }
        Assert-That (![FateTestBridge]::IsWindowVisible($window)) 'The sidecar showed before receiving a viewport.'
        $viewport = [long[]]@(1, $fixture.Handle.ToInt64(), $PID, 0, 0, 0, 0)
        Assert-That ([FateTestBridge]::Send($window, $fixture.Handle, $viewport)) 'The native viewport packet was not accepted.'
        Assert-That ([FateTestBridge]::IsWindowVisible($window)) 'The overlay did not appear for the active fixture.'
        Assert-That ([FateTestBridge]::GetForegroundWindow() -eq $fixture.Handle) 'The overlay activated over the fixture.'
        $center = [FateTestBridge]::Center($window)
        $hit = [FateTestBridge]::WindowFromPoint($center)
        Start-Sleep -Milliseconds 80 # allow the visible revision to receive WM_PAINT
        Assert-That ([FateTestBridge]::Send($window, $fixture.Handle, [long[]]@(2, 11))) 'The native shortcut packet was not accepted.'
        $command = Get-Content -Raw -LiteralPath (Join-Path $directory 'command.json') | ConvertFrom-Json
        Assert-That ($command.action -eq 'new-area') 'The native window did not forward the displayed shortcut.'
        $state.acknowledgedCommandId = $command.id
        $state.revision = [Guid]::NewGuid().ToString('D')
        $state.rows = @(1..9 | ForEach-Object {
            @{ label = "$_. Fate of Resurgence"; detail = ('An unknown reward requires inspection in game. ' * 10); recommended = ($_ -eq 2) }
        })
        Write-Record 'state.json' $state
        Start-Sleep -Milliseconds 450 # allow the acknowledged command and new layout to render
        Assert-That (![FateTestBridge]::Send($window, $fixture.Handle, [long[]]@(2, 11))) 'The native window advertised interaction while shortcuts were paused.'
        $latest = Get-Content -Raw -LiteralPath (Join-Path $directory 'command.json') | ConvertFrom-Json
        Assert-That ($latest.id -eq $command.id) 'The dense panel still accepted a shortcut.'
        $center = [FateTestBridge]::Center($window)
        $hit = [FateTestBridge]::WindowFromPoint($center)
        Assert-That ([FateTestBridge]::Send($window, $fixture.Handle, [long[]]@(1, 0, 0, 0, 0, 0, 0))) 'The capture suspension packet was not accepted.'
        Assert-That (![FateTestBridge]::IsWindowVisible($window)) 'The overlay remained visible after synchronous capture suspension.'
        Assert-That ($hit -ne $window -and $hit -eq [FateTestBridge]::WindowFromPoint($center)) 'The overlay changed mouse hit testing.'
        Assert-That ([FateTestBridge]::Send($window, $fixture.Handle, $viewport)) 'The window could not be resumed.'
        $other.Show()
        $other.Activate()
        [Windows.Forms.Application]::DoEvents()
        [void][FateTestBridge]::SetForegroundWindow($other.Handle)
        Start-Sleep -Milliseconds 250
        Assert-That ([FateTestBridge]::GetForegroundWindow() -eq $other.Handle -and ![FateTestBridge]::IsWindowVisible($window)) 'The overlay did not hide when the fixture lost focus.'
        Write-Output 'PASS: native window IPC, nonactivation, mouse pass-through, capture suspension and focus loss.'
    } finally {
        if ($sidecar) {
            if (!$sidecar.HasExited) { $sidecar.Kill(); [void]$sidecar.WaitForExit(3000) }
            $sidecar.Dispose()
        }
        $other.Dispose()
        $fixture.Dispose()
    }
}

try {
    Write-Record 'state.json' $state
    $session.Poll($now)
    Assert-That ($session.View.Actions.Count -eq 0) 'A browser snapshot cannot supersede a missing capture marker.'
    Write-Record 'capture.json' $marker
    $session.Poll($now)
    Assert-That ($session.View.Actions.Count -eq 5 -and $session.View.Rows[1].Recommended) 'Live matching advice was not loaded.'
    $displayed = $session.View

    Assert-That (!$session.Send(10, $displayed, $now)) 'An action not advertised was sent.'
    Assert-That ($session.Send(2, $displayed, $now)) 'An advertised action was not sent.'
    $path = Join-Path $directory 'command.json'
    $command = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
    Assert-That ($command.protocol -eq 1 -and $command.captureId -eq $captureId -and
        $command.clientId -eq $state.clientId -and $command.revision -eq $state.revision -and
        $command.action -eq 'collect:b' -and $command.createdAt -eq $now -and $command.id -eq $session.PendingId) 'The command was not bound to the displayed snapshot.'
    Assert-That (!$session.Send(11, $displayed, ($now + 1))) 'A second command overwrote a pending command.'

    $originalClientId = $state.clientId
    $state.clientId = [Guid]::NewGuid().ToString('D')
    $state.acknowledgedCommandId = $command.id
    Write-Record 'state.json' $state
    $session.Poll($now + 10)
    Assert-That ($session.PendingId -eq $command.id) 'An acknowledgment from a different browser was accepted.'
    $state.clientId = $originalClientId
    $state.revision = [Guid]::NewGuid().ToString('D')
    Write-Record 'state.json' $state
    $session.Poll($now + 20)
    Assert-That (!$session.PendingId) 'A matching acknowledgment did not release the pending action.'
    Assert-That (!$session.Send(11, $displayed, ($now + 21))) 'A hotkey was applied after the displayed revision changed.'

    $state.acknowledgedCommandId = $null
    Write-Record 'state.json' $state
    $session.Poll($now + 25)
    Assert-That ($session.Send(11, $session.View, ($now + 25))) 'A new action could not be sent after acknowledgment.'
    $previousCommand = Get-Content -Raw -LiteralPath $path
    $state.writtenAt = $now + 12025
    Write-Record 'state.json' $state
    $session.Poll($now + 12025)
    Assert-That (!$session.PendingId -and $session.Feedback -like 'No confirmation*') 'The pending action did not time out.'
    Assert-That ((Get-Content -Raw -LiteralPath $path) -ceq $previousCommand) 'The timed-out action was replayed.'

    $state.writtenAt = $now
    Write-Record 'state.json' $state
    $session.Poll($now + 12001)
    Assert-That ($session.View.Rows.Count -eq 0 -and $session.View.Actions.Count -eq 0) 'A stale browser heartbeat left advice visible.'
    $session.Poll($now - 5001)
    Assert-That ($session.View.Actions.Count -eq 0) 'A browser heartbeat too far in the future was accepted.'
    $session.Poll($now)

    $marker.captureId = [Guid]::NewGuid().ToString('D')
    Write-Record 'capture.json' $marker
    Assert-That (!$session.Send(2, $session.View, $now) -and $session.View.Rows.Count -eq 0) 'An old capture could still receive commands.'
    $marker.captureId = $captureId
    foreach ($phase in @('capturing', 'error', 'cancelled')) {
        $marker.phase = $phase
        Write-Record 'capture.json' $marker
        $session.Poll($now)
        Assert-That ($session.View.Actions.Count -eq 0 -and $session.View.Rows.Count -eq 0) "$phase left previous advice available."
    }
    Write-Record 'capture.json' @{ protocol = 1; phase = 'saved'; updatedAt = $now; captureId = $null }
    $session.Poll($now)
    Assert-That ($session.View.Status -eq 'error') 'A saved marker without a capture ID was accepted.'
    $marker.phase = 'saved'
    Write-Record 'capture.json' $marker
    foreach ($bad in @('{', ('x' * 32769))) {
        [IO.File]::WriteAllText((Join-Path $directory 'state.json'), $bad, $utf8)
        $session.Poll($now)
        Assert-That ($session.View.Rows.Count -eq 0) 'Malformed or oversized advice was shown.'
    }
    $state.actions += @{ id = 'duplicate-slot'; label = 'Ambiguous shortcut'; slot = 2 }
    Write-Record 'state.json' $state
    $session.Poll($now)
    Assert-That ($session.View.Actions.Count -eq 0) 'A duplicate keyboard binding was accepted.'
    $state.actions = @($state.actions | Where-Object { $_.id -ne 'duplicate-slot' })
    Write-Record 'state.json' $state

    $work = [Drawing.Rectangle]::new(-1280, 0, 1280, 680)
    $crop = [Drawing.Rectangle]::new(-1100, 20, 480, 510)
    $placed = [FateCollector.OverlayWindow]::Place($work, $crop, [Drawing.Size]::new(392, 340), 12)
    Assert-That ($work.Contains($placed) -and !$crop.IntersectsWith($placed)) 'Placement covered the crop despite room on its monitor.'
    $placed = [FateCollector.OverlayWindow]::Place($work, $work, [Drawing.Size]::new(392, 670), 12)
    Assert-That ($work.Contains($placed)) 'Clamped placement escaped the monitor work area.'

    $renderSession = [FateCollector.OverlaySession]::new($directory)
    $renderSession.Poll($now + 10)
    $shortcutsFit = $false
    $image = [FateCollector.OverlayWindow]::Snapshot($renderSession, 96, 1280, 720, [ref]$shortcutsFit)
    try {
        Assert-That ($shortcutsFit -and $image.Width -eq 392 -and $image.Height -gt 250) 'The regular native panel failed to show the advertised controls.'
        $dark = $image.GetPixel(15, 50)
        Assert-That ($dark.R -eq 32 -and $dark.G -eq 53 -and $dark.B -eq 63) 'The native panel did not paint its surface.'
        $image.Save((Join-Path $results 'overlay-native.png'), [Drawing.Imaging.ImageFormat]::Png)
    } finally { $image.Dispose() }

    $state.rows = @(1..9 | ForEach-Object {
        if ($_ -eq 2) {
            @{ label = '2. Fate of Fortune'; detail = '+7 priority points'; recommended = $true }
        } else {
            @{ label = "$_. Fate of Resurgence with a long name"; detail = 'Several unknown modifiers still need review'; recommended = $false }
        }
    })
    $state.actions = @(1..12 | ForEach-Object { @{ id = "action-$_"; label = "Shortcut $_"; slot = $_ } })
    $state.revision = [Guid]::NewGuid().ToString('D')
    Write-Record 'state.json' $state
    $renderSession.Poll($now + 11)
    $compact = [FateCollector.OverlayWindow]::Snapshot($renderSession, 144, 1280, 768, [ref]$shortcutsFit)
    try {
        Assert-That (!$shortcutsFit -and $compact.Width -eq 588 -and $compact.Height -le 732) 'The 150% layout did not pause shortcuts when the detailed comparison could not fit.'
        $compact.Save((Join-Path $results 'overlay-native-compact.png'), [Drawing.Imaging.ImageFormat]::Png)
    } finally { $compact.Dispose() }
    $tight = [FateCollector.OverlayWindow]::Snapshot($renderSession, 192, 1280, 720, [ref]$shortcutsFit)
    try {
        Assert-That (!$shortcutsFit -and $tight.Width -eq 784 -and $tight.Height -le 672) 'The 200% layout did not pause shortcuts when the detailed comparison could not fit.'
        $tight.Save((Join-Path $results 'overlay-native-tight.png'), [Drawing.Imaging.ImageFormat]::Png)
    } finally { $tight.Dispose() }
    Write-Output 'PASS: overlay freshness, capture identity, bounded input, action acknowledgment, placement and native rendering.'
    if ($CheckWindow) { Test-WindowBridge }
} finally {
    foreach ($file in [IO.Directory]::GetFiles($directory)) { [IO.File]::Delete($file) }
    [IO.Directory]::Delete($directory)
}
