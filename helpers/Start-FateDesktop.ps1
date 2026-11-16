[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateRange(1,2147483647)][int]$ParentPid,
    [string]$ProfileDirectory = (Join-Path $env:LOCALAPPDATA 'FateCollector\desktop')
)
$ErrorActionPreference = 'Stop'
$parent = $null
try {
    $parent = [Diagnostics.Process]::GetProcessById($ParentPid)
    [void]$parent.SafeHandle
    if ($parent.HasExited -or $parent.StartTime -ge [Diagnostics.Process]::GetCurrentProcess().StartTime) { throw 'The helper process is no longer available.' }
    $sdk = Join-Path $PSScriptRoot 'webview2'
    $core = Join-Path $sdk 'Microsoft.Web.WebView2.Core.dll'
    $forms = Join-Path $sdk 'Microsoft.Web.WebView2.WinForms.dll'
    $loader = Join-Path $sdk $(if ([IntPtr]::Size -eq 8) { 'x64\WebView2Loader.dll' } else { 'x86\WebView2Loader.dll' })
    if (!(Test-Path -LiteralPath $core -PathType Leaf) -or !(Test-Path -LiteralPath $forms -PathType Leaf) -or !(Test-Path -LiteralPath $loader -PathType Leaf)) {
        [Console]::Error.WriteLine('Fate Collector local desktop files are missing. Download the helper again.')
        exit 1
    }
    Add-Type -AssemblyName System.Drawing, System.Windows.Forms, System.Web.Extensions
    [void][Reflection.Assembly]::LoadFrom($core)
    [void][Reflection.Assembly]::LoadFrom($forms)
    Add-Type -Path (Join-Path $PSScriptRoot 'FateDesktop.cs') -ReferencedAssemblies @('System.Drawing','System.Windows.Forms','System.Web.Extensions','System.Core',$core,$forms)
    $result = [FateCollector.DesktopHost]::Run($PSScriptRoot, [IO.Path]::GetFullPath($ProfileDirectory), $parent)
    if ($result -ne 0) { exit $result }
} catch {
    [Console]::Error.WriteLine('Fate Collector could not start the local desktop. Check the helper installation and Microsoft Edge WebView2 Runtime.')
    exit 1
} finally { if ($parent) { $parent.Dispose() } }
