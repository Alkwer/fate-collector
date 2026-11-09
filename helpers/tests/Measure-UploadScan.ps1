# Use Windows PowerShell 5.1. The fixture uses only generated capture IDs and a fake transport.
param([int[]]$Sizes = @(1000, 10000), [int]$Runs = 5)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'CloudUpload.Common.ps1')
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FateUploadBenchmark {
    [StructLayout(LayoutKind.Sequential)]
    public struct Io { public ulong Reads, Writes, Other, ReadBytes, WriteBytes, OtherBytes; }
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool GetProcessIoCounters(IntPtr process, out Io io);
}
'@

$root = Join-Path ([IO.Path]::GetTempPath()) "FateCollector scan $([guid]::NewGuid())"
$key = ConvertTo-SecureString 'synthetic-benchmark-key' -AsPlainText -Force
$process = [Diagnostics.Process]::GetCurrentProcess()
try {
    $state = Join-Path $root 'state'
    Set-FateUploadConfiguration -StateDirectory $state -Origin 'https://benchmark.invalid' -Key $key -ConsentAccepted
    $config = Get-FateUploadConfiguration $state
    $scope = Join-Path $state $config.Scope
    $states = Join-Path $scope 'states'
    [void][IO.Directory]::CreateDirectory($states)
    $consentTransport = {
        param($Consent, $Key, $Withdrawal)
        @{
            Status = 201
            Receipt = [PSCustomObject]@{
                id = $Consent.Id; scope = $Consent.Scope; policyVersion = $Consent.PolicyVersion
                text = $Consent.Text; acceptedAt = $Consent.AcceptedAt
                recordedAt = [DateTime]::UtcNow.ToString('o'); withdrawnAt = $null
            }
        }
    }
    $calls = [Collections.Generic.List[string]]::new()
    $transport = {
        param($Configuration, [string]$Payload)
        $id = (ConvertFrom-Json -InputObject $Payload).captureId
        $calls.Add($id)
        @{ Status = 201; Receipt = [PSCustomObject]@{ id = $id; status = 'accepted'; reviewed = $false } }
    }
    foreach ($size in $Sizes) {
        $captures = Join-Path $root "captures-$size"
        [void][IO.Directory]::CreateDirectory($captures)
        for ($i = 0; $i -lt $size; $i++) {
            $id = [guid]::NewGuid()
            [IO.File]::WriteAllText([IO.Path]::Combine($captures, "fate-$id.json"), '{}')
            [IO.File]::WriteAllText([IO.Path]::Combine($states, "$id.json"), '{"status":"accepted"}')
        }
        $parameters = @{
            CapturesDirectory = $captures; StateDirectory = $state
            ConsentTransport = $consentTransport; Transport = $transport
        }
        Invoke-FateCaptureUploads @parameters
        foreach ($run in 1..$Runs) {
            # Create an eligible capture without adding any index or queue entry, as after a restart.
            $newId = [guid]::NewGuid().ToString()
            $capture = @{
                kind = 'fate-collector.capture'; schemaVersion = 1; captureId = $newId
                capturedAt = [DateTime]::UtcNow.ToString('o'); source = 'windows-helper'; helperVersion = 'benchmark'
                context = @{ captureMode = 'game' }; image = @{ width = 128; height = 64 }
                ocr = @{ status = 'ok'; language = 'en-US'; text = 'Generated fixture'; lines = @() }
            }
            Write-FateUploadState ([IO.Path]::Combine($captures, "fate-$newId.json")) $capture
            $process.Refresh()
            $memoryBefore = $process.WorkingSet64
            $ioBefore = [FateUploadBenchmark+Io]::new()
            $ioAfter = [FateUploadBenchmark+Io]::new()
            if (![FateUploadBenchmark]::GetProcessIoCounters($process.Handle, [ref]$ioBefore)) { throw 'Could not read process I/O counters.' }
            $watch = [Diagnostics.Stopwatch]::StartNew()
            Invoke-FateCaptureUploads @parameters
            $watch.Stop()
            if (![FateUploadBenchmark]::GetProcessIoCounters($process.Handle, [ref]$ioAfter)) { throw 'Could not read process I/O counters.' }
            $process.Refresh()
            if (!$calls.Count -or $calls[$calls.Count - 1] -cne $newId) { throw 'The new capture was not sent in the first cycle.' }
            [PSCustomObject]@{
                Archive = $size; Run = $run; CycleMs = [Math]::Round($watch.Elapsed.TotalMilliseconds, 1)
                ReadOps = $ioAfter.Reads - $ioBefore.Reads; ReadBytes = $ioAfter.ReadBytes - $ioBefore.ReadBytes
                WriteOps = $ioAfter.Writes - $ioBefore.Writes; OtherOps = $ioAfter.Other - $ioBefore.Other
                WorkingSetDeltaMiB = [Math]::Round(($process.WorkingSet64 - $memoryBefore) / 1MB, 1)
            }
        }
    }
} finally {
    $process.Dispose()
    $key.Dispose()
    $resolved = [IO.Path]::GetFullPath($root)
    if ([IO.Path]::GetDirectoryName($resolved) -eq [IO.Path]::GetTempPath().TrimEnd('\') -and
        [IO.Path]::GetFileName($resolved) -match '\AFateCollector scan [0-9a-f-]{36}\z' -and
        [IO.Directory]::Exists($resolved)) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
