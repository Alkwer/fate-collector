[CmdletBinding()]
param(
    [string]$Directory = (Join-Path $PSScriptRoot 'captures\.overlay'),
    [int]$ParentPid = 0,
    [switch]$Preview
)

$ErrorActionPreference = 'Stop'
if (!$Preview -and $ParentPid -le 0) { throw 'The overlay requires its helper process.' }

Add-Type -AssemblyName System.Drawing, System.Windows.Forms, System.Web.Extensions
Add-Type -Path (Join-Path $PSScriptRoot 'FateOverlay.cs') -ReferencedAssemblies System.Drawing, System.Windows.Forms, System.Web.Extensions, System.Core
[FateCollector.OverlayWindow]::UsePhysicalCoordinates()
[System.Windows.Forms.Application]::EnableVisualStyles()
[FateCollector.OverlayWindow]::Run($Directory, $ParentPid, $Preview.IsPresent, (Join-Path $PSScriptRoot 'overlay-icons.json'))
