[CmdletBinding(DefaultParameterSetName = 'Game')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Game')][long]$WindowHandle,
    [Parameter(Mandatory, ParameterSetName = 'Game')][int]$WindowPid,
    [Parameter(Mandatory, ParameterSetName = 'Game')][int]$ClientWidth,
    [Parameter(Mandatory, ParameterSetName = 'Game')][int]$ClientHeight,
    [Parameter(ParameterSetName = 'Game')][ValidateSet('auto', 'gdi', 'wgc')][string]$CaptureBackend = 'auto',
    [Parameter(ParameterSetName = 'Game')][guid]$CaptureId = [guid]::Empty,
    [Parameter(Mandatory, ParameterSetName = 'Fixture')][string]$FixtureImage
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'WindowCapture.Common.ps1')
. (Join-Path $PSScriptRoot 'SymbolReport.Common.ps1')

Add-Type -AssemblyName System.Drawing, System.Windows.Forms
$fixture = $PSCmdlet.ParameterSetName -eq 'Fixture'
$failureCode = 1
try {
    if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') { throw 'Start Windows PowerShell with -STA.' }
    $createdAt = [DateTime]::UtcNow
    if ($fixture) {
        $file = Get-Item -LiteralPath $FixtureImage
        if ($file.Length -gt 64MB) { throw 'Choose a fixture PNG under 64 MiB.' }
        $png = [IO.File]::ReadAllBytes($file.FullName)
    } else {
        $imagePath = (Get-Process -Id $WindowPid).Path
        if (!$imagePath -or [IO.Path]::GetFileName($imagePath) -notmatch '^PathOfExile[_A-Za-z0-9-]*\.exe$') {
            throw 'Bring the verified Path of Exile window to the foreground.'
        }
        $install = [IO.Path]::GetDirectoryName($imagePath)
        if (![IO.File]::Exists((Join-Path $install 'Content.ggpk')) -and ![IO.File]::Exists((Join-Path $install 'Bundles2\_.index.bin'))) {
            throw 'Could not verify the Path of Exile installation.'
        }
        if ($ClientWidth -le 0 -or $ClientHeight -le 0 -or $ClientWidth -gt 8192 -or $ClientHeight -gt 8192 -or
            ([long]$ClientWidth * $ClientHeight) -gt 16777216) {
            throw 'The game window is too large. Reduce the game window size and retry.'
        }
        $png = Get-FateWindowPng -WindowHandle $WindowHandle -WindowPid $WindowPid -ClientWidth $ClientWidth -ClientHeight $ClientHeight `
            -X 0 -Y 0 -Width $ClientWidth -Height $ClientHeight -CaptureBackend $CaptureBackend `
            -CompilerDirectory $env:TEMP -FailureCode ([ref]$failureCode)
    }

    # The editor sees only the frozen pixels. Compile and show it after capture,
    # so activation cannot hide the original in-game tooltip.
    Add-Type -Path (Join-Path $PSScriptRoot 'SymbolReport.cs') -ReferencedAssemblies System.Drawing, System.Windows.Forms
    [Windows.Forms.Application]::EnableVisualStyles()
    $stream = [IO.MemoryStream]::new($png, $false)
    try {
        $frame = [Drawing.Bitmap]::new($stream)
        try {
            if ($frame.RawFormat.Guid -ne [Drawing.Imaging.ImageFormat]::Png.Guid -or
                $frame.Width -gt 8192 -or $frame.Height -gt 8192 -or ([long]$frame.Width * $frame.Height) -gt 16777216) {
                throw 'The frozen image must be a PNG within the supported game-window size.'
            }
            $form = [FateSymbolReportForm]::new($frame, $fixture)
            try {
                if ($form.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { return }
                $origin = if ($fixture) { 'test' } else { 'live' }
                $draft = Save-FateSymbolDraft -Icon $form.IconCrop -Tooltip $form.TooltipCrop -CreatedAt $createdAt -Origin $origin `
                    -CaptureId $CaptureId -OutputDirectory (Join-Path $PSScriptRoot 'symbol-reports')
            } finally { $form.Dispose() }
        } finally { $frame.Dispose() }
    } finally { $stream.Dispose() }

    if ($fixture) {
        Write-Output $draft.Path
        return
    }
    $site = 'https://app.fate-collector.workers.dev/#report-symbol'
    $clipboardReady = $false
    try {
        [Windows.Forms.Clipboard]::SetDataObject($draft.Json, $true, 8, 100)
        $clipboardReady = $true
    } catch {
        [void][Windows.Forms.MessageBox]::Show("The clipboard is unavailable. Choose the saved draft on the website.`n`n$($draft.Path)", 'Fate Collector')
    }
    try { Start-Process $site }
    catch {
        $transfer = if ($clipboardReady) { 'Paste the copied draft or choose the saved file.' } else { 'Choose the saved draft file.' }
        [void][Windows.Forms.MessageBox]::Show("Open $site in your browser. $transfer`n`n$($draft.Path)", 'Fate Collector')
    }
} catch {
    $message = switch ($failureCode) {
        3 { 'Keep the game in front and the tooltip visible, then press Ctrl+Shift+F9 again.' }
        4 { 'Window capture failed. Keep the game on one monitor and retry.' }
        default { $_.Exception.Message }
    }
    if ($fixture) { throw }
    [void][Windows.Forms.MessageBox]::Show($message, 'Fate Collector', 'OK', 'Warning')
    exit $failureCode
}
