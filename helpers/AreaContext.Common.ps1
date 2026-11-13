function Get-FateAreaCategory([string]$AreaId) {
    switch -CaseSensitive -Regex ($AreaId) {
        '\A(?:1_[1-5]|2_(?:[6-9]|10))_(?:town|[0-9][A-Za-z0-9_]*)\z' { return 'campaign' }
        '\AMapWorlds[A-Za-z0-9_]+\z' { return 'map' }
        '\A(?:Hideout[A-Za-z0-9_]+|2_11_endgame_town)\z' { return 'other' }
        default { return 'unknown' }
    }
}

function Read-FateClientLogArea {
    param(
        [string]$Path, [int]$ClientPid, [DateTime]$ProcessStartedUtc,
        [ValidateRange(1, 262144)][int]$MaxBytes = 256KB
    )

    # Read at most one bounded snapshot, sharing the live log with the game.
    $share = [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, $share)
    try {
        $length = $stream.Length
        $count = [int][Math]::Min($length, $MaxBytes)
        $offset = $length - $count
        $stream.Position = $offset
        $bytes = [byte[]]::new($count)
        for ($read = 0; $read -lt $count; $read += $chunk) {
            $chunk = $stream.Read($bytes, $read, $count - $read)
            if (!$chunk) { return }
        }
        # A partially written final record might be a transition.
        if (!$count -or $stream.Length -lt $length -or $bytes[$count - 1] -ne 10) { return }
    } finally {
        $stream.Dispose()
    }

    $lines = [Text.Encoding]::UTF8.GetString($bytes) -split '\r?\n'
    $firstLine = if ($offset -gt 0) { 1 } else { 0 }
    $header = [regex]::new("\A\uFEFF?(?<time>[0-9]{4}/[0-9]{2}/[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}) (?<tick>[0-9]+) [a-fA-F0-9]+ \[(?<severity>DEBUG|INFO) Client $ClientPid\] (?<message>.*)\z")
    $localZone = [TimeZoneInfo]::Local
    $culture = [Globalization.CultureInfo]::InvariantCulture
    $observedUtc = [DateTime]::UtcNow
    $pending = $null
    $current = $null
    for ($index = $firstLine; $index -lt $lines.Length; $index++) {
        $entry = $header.Match($lines[$index])
        if (!$entry.Success) { continue }
        $message = $entry.Groups['message'].Value
        $severity = $entry.Groups['severity'].Value
        $generation = $severity -ceq 'DEBUG' -and $message.StartsWith('Generating level', [StringComparison]::Ordinal)
        $scene = $severity -ceq 'INFO' -and $message.StartsWith('[SCENE] Set Source', [StringComparison]::Ordinal)
        $transition = ($severity -ceq 'INFO' -and $message -cmatch '\A(?:Connecting to instance server|Async connecting to|Abnormal disconnect|Closing game gracefully)\b') -or
            ($severity -ceq 'DEBUG' -and $message -cmatch '\AGot Instance Details from login server\b')
        if (!$generation -and !$scene -and !$transition) { continue }

        # A reused PID cannot carry over context from an earlier process.
        $localTime = [DateTime]::MinValue
        $validTime = [DateTime]::TryParseExact($entry.Groups['time'].Value, 'yyyy/MM/dd HH:mm:ss', $culture,
            [Globalization.DateTimeStyles]::None, [ref]$localTime)
        $current = $null
        if (!$validTime -or $localZone.IsInvalidTime($localTime) -or $localZone.IsAmbiguousTime($localTime)) {
            $pending = $null
            continue
        }
        $eventUtc = [TimeZoneInfo]::ConvertTimeToUtc($localTime, $localZone)
        if ($eventUtc -lt $ProcessStartedUtc -or $eventUtc -gt $observedUtc -or $transition) {
            $pending = $null
            continue
        }

        if ($generation) {
            $pending = $null
            if ($message -cmatch '\AGenerating level (?<level>[0-9]{1,3}) area "(?<area>[A-Za-z0-9_]{1,160})" with seed -?[0-9]+\z') {
                $level = [int]$Matches['level']
                if ($level -ge 1 -and $level -le 100) {
                    $pending = [ordered]@{
                        source = 'client-log'
                        category = Get-FateAreaCategory $Matches['area']
                        areaId = $Matches['area']
                        areaLevel = $level
                    }
                }
            }
            continue
        }

        # A normal scene swap can clear the previous scene after generating the next area.
        if ($message -ceq '[SCENE] Set Source [(null)]') { continue }
        if ($pending -and $message -cmatch '\A\[SCENE\] Set Source \[[^\[\]\r\n]+\]\z' -and $message -cne '[SCENE] Set Source [(unknown)]') {
            $current = @{
                Area = $pending
                SceneEvent = $entry.Groups['time'].Value + ' ' + $entry.Groups['tick'].Value
                LogLength = $length
            }
        }
        $pending = $null
    }
    return $current
}

function Get-FateAreaSnapshot([int]$WindowPid) {
    $process = $null
    try {
        $process = Get-Process -Id $WindowPid -ErrorAction Stop
        $imagePath = $process.Path
        if (!$imagePath -or [IO.Path]::GetFileName($imagePath) -notmatch '\APathOfExile[_A-Za-z0-9-]*\.exe\z') { return }
        $install = [IO.Path]::GetDirectoryName($imagePath)
        if (![IO.File]::Exists((Join-Path $install 'Content.ggpk')) -and ![IO.File]::Exists((Join-Path $install 'Bundles2\_.index.bin'))) { return }
        $startedUtc = $process.StartTime.ToUniversalTime()
        $logPath = Join-Path $install 'logs\Client.txt'
        $createdUtc = [IO.File]::GetCreationTimeUtc($logPath)
        $snapshot = Read-FateClientLogArea -Path $logPath -ClientPid $WindowPid -ProcessStartedUtc $startedUtc
        if (!$snapshot -or $process.HasExited -or [IO.File]::GetCreationTimeUtc($logPath) -ne $createdUtc) { return }
        $snapshot.ProcessStartedUtc = $startedUtc
        $snapshot.LogCreatedUtc = $createdUtc
        $snapshot.LogPath = $logPath
        return $snapshot
    } catch {
        # Area metadata is optional, including when the client log cannot be opened.
        return
    } finally {
        if ($process) { $process.Dispose() }
    }
}

function Resolve-FateCapturedArea($Before, $After) {
    if ($Before -and $After -and $Before.ProcessStartedUtc -eq $After.ProcessStartedUtc -and
        $Before.LogPath -eq $After.LogPath -and $Before.LogCreatedUtc -eq $After.LogCreatedUtc -and
        $Before.LogLength -le $After.LogLength -and $Before.SceneEvent -ceq $After.SceneEvent -and
        $Before.Area.areaId -ceq $After.Area.areaId -and $Before.Area.areaLevel -eq $After.Area.areaLevel) {
        return $After.Area
    }
    return [ordered]@{ source = 'client-log'; category = 'unknown'; areaId = $null; areaLevel = $null }
}
