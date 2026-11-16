[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$zip = Join-Path $repo 'public/downloads/fate-collector-helper.zip'
$work = Join-Path ([IO.Path]::GetTempPath()) ('fate-desktop-test-' + [guid]::NewGuid().ToString('N'))
$work = [IO.Path]::GetFullPath($work)
if ([IO.Path]::GetDirectoryName($work) -ine [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')) { throw 'Invalid desktop test directory.' }
New-Item -ItemType Directory $work | Out-Null
try {
    Expand-Archive -LiteralPath $zip -DestinationPath $work
    $source = Get-ChildItem -LiteralPath $work -Recurse -Filter FateDesktop.cs | Select-Object -First 1
    if (!$source) { throw 'The helper archive does not contain FateDesktop.cs.' }
    $helper = $source.Directory.FullName
    $sdk = Join-Path $helper 'webview2'
    $core = Join-Path $sdk 'Microsoft.Web.WebView2.Core.dll'
    $forms = Join-Path $sdk 'Microsoft.Web.WebView2.WinForms.dll'
    foreach ($file in @($core, $forms, (Join-Path $sdk 'x64/WebView2Loader.dll'), (Join-Path $sdk 'x86/WebView2Loader.dll'))) {
        if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing SDK file: $([IO.Path]::GetFileName($file))" }
    }
    Add-Type -AssemblyName System.Drawing, System.Windows.Forms, System.Web.Extensions
    [void][Reflection.Assembly]::Load([IO.File]::ReadAllBytes($core))
    [void][Reflection.Assembly]::Load([IO.File]::ReadAllBytes($forms))
    Add-Type -Path $source.FullName -ReferencedAssemblies @('System.Drawing','System.Windows.Forms','System.Web.Extensions','System.Core',$core,$forms)
    $type = [FateCollector.DesktopHost]
    $flags = [Reflection.BindingFlags]'Instance,Static,NonPublic'
    $hostInstance = [Runtime.Serialization.FormatterServices]::GetUninitializedObject($type)
    $captures = Join-Path $helper 'captures'
    $overlay = Join-Path $captures '.overlay'
    New-Item -ItemType Directory -Force $overlay | Out-Null
    $type.GetField('captures', $flags).SetValue($hostInstance, $captures)
    function Invoke-HostMethod([string]$Name, [object[]]$Arguments) {
        try { return $type.GetMethod($Name, $flags).Invoke($hostInstance, $Arguments) }
        catch [Reflection.TargetInvocationException] { throw $_.Exception.InnerException }
    }
    function Assert([bool]$Condition, [string]$Message) { if (!$Condition) { throw $Message } }
    function Assert-Throws([scriptblock]$Action, [type]$Expected, [string]$Message) {
        try { & $Action | Out-Null } catch {
            $exception = $_.Exception
            while ($null -ne $exception) { if ($Expected.IsInstanceOfType($exception)) { return }; $exception = $exception.InnerException }
            throw "$Message`: unexpected $($_.Exception.GetType().Name)"
        }
        throw "$Message`: no exception"
    }
    $id = '11111111-1111-4111-8111-111111111111'
    $captureName = "fate-$id.json"
    [IO.File]::WriteAllText((Join-Path $captures $captureName), 'capture')
    [IO.File]::WriteAllText((Join-Path $captures "auto-fate-$id.json"), 'auto')
    [IO.File]::WriteAllText((Join-Path $captures 'secret.json'), 'secret')
    $names = @(Invoke-HostMethod 'List' @('captures') | ForEach-Object { $_.name })
    Assert ($names.Count -eq 3 -and $names -contains '.overlay' -and $names -contains $captureName -and $names -contains "auto-fate-$id.json") 'Capture listing is not restricted.'
    $capture = Invoke-HostMethod 'Read' @("captures/$captureName")
    Assert ($capture.text -eq 'capture' -and $capture.lastModified -gt 0) 'Capture read failed.'
    Invoke-HostMethod 'Write' @('captures/.overlay/state.json', 'first') | Out-Null
    Invoke-HostMethod 'Write' @('captures/.overlay/state.json', 'second') | Out-Null
    $state = Invoke-HostMethod 'Read' @('captures/.overlay/state.json')
    Assert ($state.text -eq 'second') 'State replacement failed.'
    [IO.File]::WriteAllText((Join-Path $overlay 'secret.json'), 'secret')
    $names = @(Invoke-HostMethod 'List' @('captures/.overlay') | ForEach-Object { $_.name })
    Assert ($names.Count -eq 1 -and $names[0] -eq 'state.json') 'Overlay listing is not restricted.'
    foreach ($path in @('captures/../secret.json', 'captures/.overlay/../secret.json', 'captures/.overlay/state.json:stream', 'captures\secret.json', 'captures/secret.json')) {
        Assert-Throws { Invoke-HostMethod 'Read' @($path) } ([ArgumentException]) "Path accepted: $path"
    }
    Assert-Throws { Invoke-HostMethod 'Write' @('captures/.overlay/capture.json', 'x') } ([ArgumentException]) 'Write outside state accepted'
    Assert-Throws { Invoke-HostMethod 'Write' @('captures/.overlay/state.json', ('x' * 32769)) } ([IO.IOException]) 'Oversize state write accepted'
    Assert-Throws { Invoke-HostMethod 'Read' @('captures/.overlay/command.json') } ([IO.FileNotFoundException]) 'Missing overlay file'
    [IO.File]::WriteAllText((Join-Path $overlay 'command.json'), ('x' * 32769))
    Assert-Throws { Invoke-HostMethod 'Read' @('captures/.overlay/command.json') } ([IO.IOException]) 'Oversize overlay read accepted'
    [IO.File]::WriteAllText((Join-Path $captures $captureName), ('x' * (12 * 1024 * 1024 + 1)))
    Assert-Throws { Invoke-HostMethod 'Read' @("captures/$captureName") } ([IO.IOException]) 'Oversize capture read accepted'
    foreach ($origin in @('http://fate.local/index.html', 'https://fate.local.evil/', 'https://fate.local:444/', 'https://example.com/', 'file:///index.html', 'https://user@fate.local/')) {
        Assert (!(Invoke-HostMethod 'Local' @($origin))) "Untrusted origin accepted: $origin"
    }
    Assert (Invoke-HostMethod 'Local' @('https://fate.local/index.html')) 'Local origin rejected.'
    $junction = Join-Path $work 'overlay-target'
    New-Item -ItemType Directory $junction | Out-Null
    [IO.Directory]::Move($overlay, (Join-Path $captures '.overlay-saved'))
    $junctionCreated = $false
    try {
        try { New-Item -ItemType Junction -Path $overlay -Target $junction -ErrorAction Stop | Out-Null; $junctionCreated = $true }
        catch { Write-Output 'SKIP: junction creation unavailable.' }
        if ($junctionCreated) { Assert-Throws { Invoke-HostMethod 'List' @('captures/.overlay') } ([UnauthorizedAccessException]) 'Reparse directory accepted' }
    } finally {
        if ($junctionCreated) { [IO.Directory]::Delete($overlay) }
        [IO.Directory]::Move((Join-Path $captures '.overlay-saved'), $overlay)
    }
    Write-Output 'PASS: desktop bridge file boundaries, limits and origin guard.'
} finally {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
