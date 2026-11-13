Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'AreaContext.Common.ps1')

function Assert-Area($Condition, [string]$Message) {
    if (!$Condition) { throw $Message }
}

function New-TestAreaRecord([string]$Severity, [string]$Message, [int]$ClientPid = 4000,
        [string]$Time = '2025/01/15 12:00:01', [long]$Tick = 10001) {
    return "$Time $Tick ab123456 [$Severity Client $ClientPid] $Message"
}

function New-TestAreaGeneration([string]$AreaId, [int]$Level, [int]$ClientPid = 4000,
        [string]$Time = '2025/01/15 12:00:01') {
    New-TestAreaRecord 'DEBUG' ('Generating level {0} area "{1}" with seed 123' -f $Level, $AreaId) $ClientPid $Time
}

function Read-TestAreaLog([string[]]$Lines, [switch]$Partial, [int]$MaxBytes = 256KB) {
    $ending = if ($Partial) { '' } else { "`r`n" }
    [IO.File]::WriteAllText($logPath, ($Lines -join "`r`n") + $ending, [Text.UTF8Encoding]::new($false))
    Read-FateClientLogArea -Path $logPath -ClientPid 4000 -ProcessStartedUtc $startedUtc -MaxBytes $MaxBytes
}

$folder = Join-Path ([IO.Path]::GetTempPath()) ("fate-area-test-" + [guid]::NewGuid())
[void][IO.Directory]::CreateDirectory((Join-Path $folder 'logs'))
$logPath = Join-Path $folder 'logs\Client.txt'
$startedUtc = [DateTime]::new(2025, 1, 15, 12, 0, 0, 500, [DateTimeKind]::Local).ToUniversalTime()
$scene = New-TestAreaRecord 'INFO' '[SCENE] Set Source [Test Area]' -Tick 10003
$newScene = New-TestAreaRecord 'INFO' '[SCENE] Set Source [Test Area]' -Tick 10013
$nullScene = New-TestAreaRecord 'INFO' '[SCENE] Set Source [(null)]' -Tick 10002
$unknownScene = New-TestAreaRecord 'INFO' '[SCENE] Set Source [(unknown)]' -Tick 10002
$transition = New-TestAreaRecord 'INFO' 'Connecting to instance server'
$generation = New-TestAreaGeneration 'MapWorldsDunes' 83

try {
    $cases = @(
        @{ id = '1_1_1'; level = 1; category = 'campaign' }
        @{ id = '1_5_town'; level = 45; category = 'campaign' }
        @{ id = '2_7_5_map'; level = 52; category = 'campaign' }
        @{ id = '2_10_9'; level = 67; category = 'campaign' }
        @{ id = 'MapWorldsPrimordialBoss2'; level = 83; category = 'map' }
        @{ id = 'HideoutCosmicAtlas'; level = 60; category = 'other' }
        @{ id = '2_11_endgame_town'; level = 69; category = 'other' }
        @{ id = 'DeepwaterEncounter'; level = 83; category = 'unknown' }
    )
    foreach ($case in $cases) {
        $snapshot = Read-TestAreaLog @($transition, (New-TestAreaGeneration $case.id $case.level), $nullScene, $scene)
        Assert-Area ($snapshot.Area.source -ceq 'client-log' -and $snapshot.Area.category -ceq $case.category -and
            $snapshot.Area.areaId -ceq $case.id -and $snapshot.Area.areaLevel -eq $case.level) "Wrong classification for $($case.id)."
    }
    Assert-Area (!(Read-TestAreaLog @($generation, $scene, $transition))) 'Pending transition reused previous area.'
    Assert-Area (!(Read-TestAreaLog @($generation, $scene, (New-TestAreaRecord 'DEBUG' 'Got Instance Details from login server')))) 'Pending instance reused previous area.'
    Assert-Area (!(Read-TestAreaLog @($generation, $scene, (New-TestAreaRecord 'INFO' 'Abnormal disconnect')))) 'Disconnect reused previous area.'
    Assert-Area (!(Read-TestAreaLog @($generation, $scene, $nullScene))) 'Scene unload reused previous area.'
    Assert-Area (!(Read-TestAreaLog @($generation, $unknownScene, $scene))) 'Unknown scene confirmed an area.'
    Assert-Area (!(Read-TestAreaLog @($generation, $scene, $newScene))) 'An unpaired scene reused previous area.'
    Assert-Area (!(Read-TestAreaLog @($generation, $nullScene))) 'Generation without a named scene was confirmed.'
    Assert-Area (!(Read-TestAreaLog @((New-TestAreaGeneration 'MapWorldsDunes' 83 5000), $scene))) 'Wrong PID supplied the area.'
    Assert-Area (!(Read-TestAreaLog @((New-TestAreaGeneration 'MapWorldsDunes' 83 4000 '2025/01/15 12:00:00'), $scene))) 'Old PID lifecycle supplied the area.'
    Assert-Area (!(Read-TestAreaLog @($generation, $scene, (New-TestAreaGeneration 'Bad/Id' 83), $newScene))) 'Malformed area reused previous area.'
    Assert-Area (!(Read-TestAreaLog @($generation, $scene, (New-TestAreaGeneration 'MapWorldsDunes' 101), $newScene))) 'Out-of-range area level reused previous area.'
    Assert-Area (!(Read-TestAreaLog @($generation, $scene, $transition) -Partial)) 'Incomplete tail reused previous area.'
    Assert-Area (!(Read-TestAreaLog @($generation, $scene) -MaxBytes ($scene.Length + 2))) 'Tail without complete generation guessed the area.'
    $padded = Read-TestAreaLog @(('x' * 1024), $generation, $scene) -MaxBytes 400
    Assert-Area ($padded.Area.category -ceq 'map') 'Bounded tail lost a complete area after a clipped first line.'
    $chat = New-TestAreaRecord 'INFO' ('@Player: ' + (New-TestAreaGeneration '1_1_1' 1))
    $spoofed = Read-TestAreaLog @($generation, $scene, $chat, (New-TestAreaRecord 'INFO' 'Generating level 1 area "1_1_1" with seed 123'))
    Assert-Area ($spoofed.Area.category -ceq 'map') 'Chat or unexpected severity overrode game area.'

    # Resolve the installed-client log through the same process lookup as the exporter.
    [IO.File]::WriteAllText((Join-Path $folder 'Content.ggpk'), '')
    $gameProcess = [pscustomobject]@{ Path = Join-Path $folder 'PathOfExile_x64Steam.exe'; StartTime = $startedUtc; HasExited = $false }
    Add-Member -InputObject $gameProcess -MemberType ScriptMethod -Name Dispose -Value {}
    function Get-Process([int]$Id) {
        Assert-Area ($Id -eq 4000) 'Area capture read an unrelated process.'
        return $gameProcess
    }

    $before = Get-FateAreaSnapshot 4000
    $sameArea = Resolve-FateCapturedArea $before (Get-FateAreaSnapshot 4000)
    Assert-Area ($sameArea.areaId -ceq 'MapWorldsDunes' -and $sameArea.Count -eq 4) 'Stable snapshots lost area or exposed log details.'
    [void](Read-TestAreaLog @($generation, $scene, $transition, $generation, $newScene))
    $reentry = Resolve-FateCapturedArea $before (Get-FateAreaSnapshot 4000)
    Assert-Area ($reentry.category -ceq 'unknown' -and $null -eq $reentry.areaId -and $null -eq $reentry.areaLevel) 'Re-entry into same area attached stale context.'
    $gameProcess.StartTime = $startedUtc.AddMinutes(1)
    Assert-Area (!(Get-FateAreaSnapshot 4000)) 'New process reused old area.'
    $gameProcess.StartTime = $startedUtc
    $gameProcess.Path = Join-Path $folder 'NotTheGame.exe'
    Assert-Area (!(Get-FateAreaSnapshot 4000)) 'Unverified executable yielded area context.'
    $gameProcess.Path = Join-Path $folder 'PathOfExile_x64Steam.exe'
    $gameProcess.HasExited = $true
    Assert-Area (!(Get-FateAreaSnapshot 4000)) 'Exited process yielded area context.'
    $gameProcess.HasExited = $false
    [IO.File]::Delete($logPath)
    $missing = Resolve-FateCapturedArea (Get-FateAreaSnapshot 4000) (Get-FateAreaSnapshot 4000)
    Assert-Area ($missing.category -ceq 'unknown' -and $null -eq $missing.areaId) 'Missing log failed to fall back to unknown.'
} finally {
    [IO.File]::Delete($logPath)
    [IO.File]::Delete((Join-Path $folder 'Content.ggpk'))
    [IO.Directory]::Delete((Join-Path $folder 'logs'))
    [IO.Directory]::Delete($folder)
}
Write-Output 'PASS: bounded Client.txt area recognition, process identity, transitions, disconnects, truncation, and privacy.'
