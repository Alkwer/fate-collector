[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Directory,
    [Parameter(Mandatory)][ValidateRange(1, 2147483647)][int]$ParentPid,
    [Parameter(Mandatory)][ValidatePattern('\A[0-9]{1,5}(?:\.[0-9]{1,5}){2}\z')][string]$HelperVersion
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'AutoCapture.Common.ps1')

$parent = $null
$self = $null
try {
    # Holding the original process handle keeps HasExited tied to that process
    # even after its PID becomes eligible for reuse.
    $parent = [Diagnostics.Process]::GetProcessById($ParentPid)
    [void]$parent.SafeHandle
    $self = [Diagnostics.Process]::GetCurrentProcess()
    if ($parent.HasExited -or $parent.StartTime -ge $self.StartTime) { exit 0 }
    $self.Dispose()
    $self = $null

    if ($Directory -notmatch '\A[A-Za-z]:[\\/]') { throw 'Invalid scan directory.' }
    $directoryInfo = [IO.DirectoryInfo]::new($Directory)
    $captureDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'captures'))
    if (!$directoryInfo.Exists -or $directoryInfo.Attributes -band [IO.FileAttributes]::ReparsePoint -or
        !$directoryInfo.Parent -or $directoryInfo.Parent.Name -cne '.auto' -or
        $directoryInfo.Parent.Attributes -band [IO.FileAttributes]::ReparsePoint -or
        $directoryInfo.Parent.Parent.FullName -ine $captureDirectory -or
        $directoryInfo.Parent.Parent.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Invalid scan directory.'
    }
    $Directory = $directoryInfo.FullName
    $requestPath = Join-Path $Directory 'request.ini'
    $env:TEMP = $Directory
    $env:TMP = $Directory

    $seen = [Collections.Generic.HashSet[guid]]::new()
    $lastText = $null
    $lastUnreadable = $false
    $errorResult = @{ Status = 'error'; Signature = ''; Saved = 0; ObservedAt = 0 }
    while (!$parent.HasExited -and $seen.Count -lt 32768) {
        if ([IO.File]::Exists($requestPath)) {
            try {
                $requestText = Read-FateAutoText $requestPath 4096
                $lastUnreadable = $false
            } catch {
                # Never echo request text, image data, or client log content.
                if (!$lastUnreadable -and !$parent.HasExited) { Write-FateAutoResult $Directory '' $errorResult }
                $lastUnreadable = $true
                $requestText = $null
            }
            if ($null -ne $requestText -and $requestText -cne $lastText -and !$parent.HasExited) {
                $lastText = $requestText
                $id = Get-FateAutoRequestId $requestText
                if (!$id -or $seen.Add([guid]$id)) {
                    try {
                        $request = ConvertFrom-FateAutoRequest $requestText $captureDirectory
                        $result = Invoke-FateAutoScan $request $Directory $HelperVersion $parent
                    } catch {
                        # Invalid requests and capture errors are never reported as empty.
                        $result = $errorResult
                    }
                    if (!$parent.HasExited) { Write-FateAutoResult $Directory $id $result }
                    elseif ($result.Saved) { [IO.File]::Delete((Join-Path $Directory ("fate-" + $id + '.json'))) }
                }
            }
        }
        if (!$parent.HasExited) { [void]$parent.WaitForExit(100) }
    }
    exit 0
} catch {
    [Console]::Error.WriteLine('The automatic scan worker stopped.')
    exit 1
} finally {
    if ($parent) { $parent.Dispose() }
    if ($self) { $self.Dispose() }
}
