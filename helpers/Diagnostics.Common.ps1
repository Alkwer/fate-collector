# Loaded by CloudUpload.Common.ps1. Diagnostics never reads capture bundles or gameplay credentials.
$script:FateDiagnosticPolicyDirectory = $PSScriptRoot
$script:FateDiagnosticOutcomes = @('ok', 'error', 'pending', 'blocked')
$script:FateDiagnosticJsonDateKind = (Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')

function Get-FateDiagnosticField($Value, [string]$Name) {
    if ($Value -is [Collections.IDictionary]) { return ,$Value[$Name] }
    if ($Value -is [PSCustomObject]) {
        $property = $Value.PSObject.Properties[$Name]
        if ($property) { return ,$property.Value }
    }
}

function Read-FateDiagnosticJson([string]$Path, [int]$MaxBytes = 4096) {
    if (![IO.File]::Exists($Path)) { return }
    try {
        $file = [IO.FileInfo]::new($Path)
        if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -gt $MaxBytes) { return }
        $stream = [IO.File]::Open($Path, 'Open', 'Read', ([IO.FileShare]::Read -bor [IO.FileShare]::Delete))
        try {
            if ($stream.Length -gt $MaxBytes) { return }
            $reader = [IO.StreamReader]::new($stream, $script:FateUploadUtf8)
            try { ConvertFrom-FateDiagnosticJson $reader.ReadToEnd() } finally { $reader.Dispose() }
        } finally { $stream.Dispose() }
    } catch { return }
}

function ConvertFrom-FateDiagnosticJson([string]$Json) {
    if ($script:FateDiagnosticJsonDateKind) {
        ConvertFrom-Json -InputObject $Json -DateKind String -ErrorAction Stop
    } else {
        ConvertFrom-Json -InputObject $Json -ErrorAction Stop
    }
}

function Get-FateDiagnosticPolicy([string]$Origin = '') {
    $path = Join-Path $script:FateDiagnosticPolicyDirectory 'diagnostics-policy.json'
    if (![IO.File]::Exists($path)) { $path = Join-Path $script:FateDiagnosticPolicyDirectory '../shared/diagnostics-policy.json' }
    $policy = Read-FateDiagnosticJson $path
    if (!$policy -or !$policy.version -or !$policy.appVersion -or !$policy.text -or !$policy.eventCodes) {
        throw 'The diagnostic consent policy is missing or invalid.'
    }
    [PSCustomObject]@{
        Version = $policy.version
        AppVersion = $policy.appVersion
        Text = if ($Origin) { "$($policy.text)`n`nDestination: $Origin" } else { $policy.text }
        EventCodes = $policy.eventCodes
    }
}

function Get-FateDiagnosticTime {
    [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
}

function Test-FateDiagnosticTime($Value) {
    if ($Value -isnot [string]) { return $false }
    try { [void](ConvertTo-FateUploadTime $Value); return $true } catch { return $false }
}

function ConvertTo-FateDiagnosticEvent($Value, $Policy) {
    $at = Get-FateDiagnosticField $Value 'at'
    $code = Get-FateDiagnosticField $Value 'code'
    $outcome = Get-FateDiagnosticField $Value 'outcome'
    $status = Get-FateDiagnosticField $Value 'httpStatus'
    if (!(Test-FateDiagnosticTime $at) -or $code -isnot [string] -or $code -cnotin $Policy.EventCodes -or
        $outcome -isnot [string] -or $outcome -cnotin $script:FateDiagnosticOutcomes -or
        ($null -ne $status -and (($status -isnot [int] -and $status -isnot [long]) -or $status -lt 100 -or $status -gt 599))) { return }
    [ordered]@{ at = $at; code = $code; outcome = $outcome; httpStatus = $status }
}

function Write-FateDiagnosticEvent([string]$StateDirectory, [string]$Code, [string]$Outcome, $HttpStatus = $null) {
    try {
        # One slot per code and outcome, so a long-running helper cannot grow this log.
        $event = ConvertTo-FateDiagnosticEvent @{ at = Get-FateDiagnosticTime; code = $Code; outcome = $Outcome; httpStatus = $HttpStatus } (Get-FateDiagnosticPolicy)
        if (!$event) { return }
        $directory = Join-Path $StateDirectory 'diagnostic-events'
        [void][IO.Directory]::CreateDirectory($directory)
        Write-FateUploadState (Join-Path $directory "$Code.$Outcome.json") $event
    } catch {
        # A diagnostic write must never interrupt capture or upload.
    }
}

function Get-FateDiagnosticEnvironment([string]$Origin) {
    switch -CaseSensitive ($Origin) {
        'https://app.fate-collector.workers.dev' { 'production' }
        'https://app-staging.fate-collector.workers.dev' { 'staging' }
        default {
            if ($Origin -cmatch '\Ahttps?://(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?\z') { 'local' }
            else { 'unknown' }
        }
    }
}

function Set-FateDiagnosticSharingState([string]$StateDirectory, [string]$Sharing) {
    try {
        Write-FateUploadState (Join-Path $StateDirectory 'diagnostic-sharing.json') @{ sharing = $Sharing }
    } catch {
        # Gameplay uploads still work if diagnostic state cannot be written.
    }
}

function Get-FateDiagnosticSharingState([string]$StateDirectory) {
    $configuration = [IO.FileInfo]::new((Join-Path $StateDirectory 'upload.clixml'))
    if (!$configuration.Exists) { return 'off' }
    $file = [IO.FileInfo]::new((Join-Path $StateDirectory 'diagnostic-sharing.json'))
    if (!$file.Exists -or $file.LastWriteTimeUtc -lt $configuration.LastWriteTimeUtc) { return 'unknown' }
    $sharing = Get-FateDiagnosticField (Read-FateDiagnosticJson $file.FullName) 'sharing'
    if ($sharing -is [string] -and $sharing -cin 'off', 'active', 'pending', 'withdrawal-pending', 'error') { return $sharing }
    return 'unknown'
}

function Get-FateDiagnosticQueueCounts([string]$StateDirectory) {
    $counts = [ordered]@{ pending = 0; accepted = 0; rejected = 0; ignored = 0 }
    if (![IO.Directory]::Exists($StateDirectory)) { return $counts }
    $examined = 0
    foreach ($scope in [IO.Directory]::EnumerateDirectories($StateDirectory)) {
        if (++$examined -gt 10000) { break }
        if ([IO.Path]::GetFileName($scope) -cnotmatch "\A$script:FateUploadGuid\z" -or
            ([IO.File]::GetAttributes($scope) -band [IO.FileAttributes]::ReparsePoint)) { continue }
        foreach ($folder in 'queue', 'states') {
            $directory = Join-Path $scope $folder
            if (![IO.Directory]::Exists($directory) -or
                ([IO.File]::GetAttributes($directory) -band [IO.FileAttributes]::ReparsePoint)) { continue }
            foreach ($path in [IO.Directory]::EnumerateFiles($directory, '*.json')) {
                if (++$examined -gt 10000) { return $counts }
                if ([IO.Path]::GetFileNameWithoutExtension($path) -cnotmatch "\A$script:FateUploadGuid\z") { continue }
                if ($folder -eq 'queue') {
                    # A durable terminal state takes precedence if a crash left a queue file behind.
                    $stateDirectoryForScope = [IO.DirectoryInfo]::new((Join-Path $scope 'states'))
                    $state = if ($stateDirectoryForScope.Exists -and !($stateDirectoryForScope.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                        Read-FateDiagnosticJson (Join-Path $stateDirectoryForScope.FullName ([IO.Path]::GetFileName($path)))
                    }
                    $status = Get-FateDiagnosticField $state 'status'
                    if ($status -isnot [string] -or $status -cnotin 'accepted', 'duplicate', 'rejected', 'ignored') { $counts.pending++ }
                } else {
                    $status = Get-FateDiagnosticField (Read-FateDiagnosticJson $path) 'status'
                    if ($status -isnot [string]) { continue }
                    switch -CaseSensitive ($status) {
                        { $_ -cin 'accepted', 'duplicate' } { $counts.accepted++ }
                        'rejected' { $counts.rejected++ }
                        'ignored' { $counts.ignored++ }
                    }
                }
            }
        }
    }
    return $counts
}

function New-FateDiagnosticReport([string]$StateDirectory, [string]$CapturesDirectory, [string]$Origin = '') {
    $policy = Get-FateDiagnosticPolicy
    $now = Get-FateDiagnosticTime
    $storage = if ([IO.Directory]::Exists($CapturesDirectory)) { 'available' } else { 'unavailable' }
    $sharing = 'unknown'
    $counts = [ordered]@{ pending = 0; accepted = 0; rejected = 0; ignored = 0 }
    try {
        $sharing = Get-FateDiagnosticSharingState $StateDirectory
        $counts = Get-FateDiagnosticQueueCounts $StateDirectory
    } catch {
        $storage = 'unknown'
    }
    $directory = Join-Path $StateDirectory 'diagnostic-events'
    $events = @(
        foreach ($code in $policy.EventCodes) {
            foreach ($outcome in $script:FateDiagnosticOutcomes) {
                $event = ConvertTo-FateDiagnosticEvent (Read-FateDiagnosticJson (Join-Path $directory "$code.$outcome.json")) $policy
                if ($event -and $event.code -ceq $code -and $event.outcome -ceq $outcome) { $event }
            }
        }
        [ordered]@{ at = $now; code = 'diagnostics-generate'; outcome = 'ok'; httpStatus = $null }
    )
    [ordered]@{
        kind = 'fate-collector.diagnostics'; schemaVersion = 1; id = [Guid]::NewGuid().ToString()
        generatedAt = $now; source = 'windows-helper'; appVersion = $policy.AppVersion
        environment = Get-FateDiagnosticEnvironment $Origin
        runtime = [ordered]@{ family = 'windows-powershell'; version = $PSVersionTable.PSVersion.ToString(); platform = 'windows'; online = $null }
        state = [ordered]@{ storage = $storage; folderConnection = 'not-applicable'; sharing = $sharing; queue = $counts }
        events = @($events | Sort-Object { $_.at } | Select-Object -Last 100)
    }
}

function ConvertTo-FateDiagnosticReport($Value, $Policy) {
    $id = Get-FateDiagnosticField $Value 'id'
    $generatedAt = Get-FateDiagnosticField $Value 'generatedAt'
    $environment = Get-FateDiagnosticField $Value 'environment'
    $runtime = Get-FateDiagnosticField $Value 'runtime'
    $state = Get-FateDiagnosticField $Value 'state'
    $version = Get-FateDiagnosticField $runtime 'version'
    $storage = Get-FateDiagnosticField $state 'storage'
    $sharing = Get-FateDiagnosticField $state 'sharing'
    $rawEvents = Get-FateDiagnosticField $Value 'events'
    $schemaVersion = Get-FateDiagnosticField $Value 'schemaVersion'
    $appVersion = Get-FateDiagnosticField $Value 'appVersion'
    if ($id -isnot [string] -or $id -cnotmatch "\A$script:FateUploadGuid\z" -or !(Test-FateDiagnosticTime $generatedAt) -or
        'fate-collector.diagnostics' -cne (Get-FateDiagnosticField $Value 'kind') -or
        ($schemaVersion -isnot [int] -and $schemaVersion -isnot [long]) -or $schemaVersion -ne 1 -or
        'windows-helper' -cne (Get-FateDiagnosticField $Value 'source') -or
        $appVersion -isnot [string] -or $appVersion -cnotmatch '\A[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\z' -or
        $environment -isnot [string] -or $environment -cnotin 'local', 'staging', 'production', 'unknown' -or
        ($null -ne $version -and ($version -isnot [string] -or $version -cnotmatch '\A[0-9]{1,5}(?:\.[0-9]{1,5}){0,3}\z')) -or
        $storage -isnot [string] -or $storage -cnotin 'available', 'unavailable', 'unknown' -or
        $sharing -isnot [string] -or $sharing -cnotin 'off', 'active', 'pending', 'withdrawal-pending', 'error', 'unknown' -or
        $rawEvents -isnot [array] -or $rawEvents.Count -gt 100) { throw 'Invalid diagnostic report.' }
    $queue = Get-FateDiagnosticField $state 'queue'
    $counts = [ordered]@{}
    foreach ($name in 'pending', 'accepted', 'rejected', 'ignored') {
        $count = Get-FateDiagnosticField $queue $name
        if (($count -isnot [int] -and $count -isnot [long]) -or $count -lt 0 -or $count -gt 10000) { throw 'Invalid diagnostic queue count.' }
        $counts[$name] = $count
    }
    $events = @(
        foreach ($rawEvent in $rawEvents) {
            $event = ConvertTo-FateDiagnosticEvent $rawEvent $Policy
            if (!$event) { throw 'Invalid diagnostic event.' }
            $event
        }
    )
    [ordered]@{
        kind = 'fate-collector.diagnostics'; schemaVersion = 1; id = $id
        generatedAt = $generatedAt; source = 'windows-helper'; appVersion = $appVersion
        environment = $environment
        runtime = [ordered]@{ family = 'windows-powershell'; version = $version; platform = 'windows'; online = $null }
        state = [ordered]@{ storage = $storage; folderConnection = 'not-applicable'; sharing = $sharing; queue = $counts }
        events = $events
    }
}

function Export-FateDiagnosticZip([string]$Path, $Report) {
    $safeReport = ConvertTo-FateDiagnosticReport $Report (Get-FateDiagnosticPolicy)
    $json = ConvertTo-Json -InputObject $safeReport -Depth 8
    Add-Type -AssemblyName System.IO.Compression
    $temporary = "$Path.$([Guid]::NewGuid().ToString('N')).part"
    try {
        $stream = [IO.File]::Open($temporary, 'CreateNew', 'Write', 'None')
        try {
            $archive = [IO.Compression.ZipArchive]::new($stream, 'Create', $true)
            try {
                $entry = $archive.CreateEntry('diagnostics.json')
                $entryStream = $entry.Open()
                try {
                    $bytes = $script:FateUploadUtf8.GetBytes($json)
                    $entryStream.Write($bytes, 0, $bytes.Length)
                } finally { $entryStream.Dispose() }
            } finally { $archive.Dispose() }
            $stream.Flush($true)
        } finally { $stream.Dispose() }
        Move-FateUploadAtomicFile $temporary $Path
    } finally { [IO.File]::Delete($temporary) }
}

function Get-FateDiagnosticPath([string]$StateDirectory, [string]$Id, [string]$Suffix) {
    if ($Id -cnotmatch "\A$script:FateUploadGuid\z") { throw 'Invalid diagnostic report ID.' }
    Join-Path $StateDirectory "diagnostics/$Id.$Suffix"
}

function Read-FateDiagnosticRecord([string]$StateDirectory, [string]$Id, [switch]$AllowLocalTestEndpoint) {
    $path = Get-FateDiagnosticPath $StateDirectory $Id 'clixml'
    if (![IO.File]::Exists($path)) { return }
    $file = [IO.FileInfo]::new($path)
    if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -gt 128KB) { throw 'Invalid diagnostic record.' }
    $record = Import-Clixml -LiteralPath $path -ErrorAction Stop
    if ((Get-FateDiagnosticField $record 'Version') -ne 1 -or (Get-FateDiagnosticField $record 'Id') -cne $Id -or
        (Get-FateDiagnosticField $record 'Origin') -isnot [string] -or
        (Get-FateDiagnosticField $record 'ReportJson') -isnot [string] -or $record.ReportJson.Length -gt 64KB -or
        (Get-FateDiagnosticField $record 'ConsentVersion') -isnot [string] -or $record.ConsentVersion.Length -notin 1..40 -or
        (Get-FateDiagnosticField $record 'ConsentText') -isnot [string] -or $record.ConsentText.Length -notin 1..8000 -or
        !(Test-FateDiagnosticTime (Get-FateDiagnosticField $record 'AcceptedAt')) -or
        (Get-FateDiagnosticField $record 'Token') -isnot [Security.SecureString] -or $record.Token.Length -ne 64) {
        throw 'Invalid diagnostic record.'
    }
    if ((Resolve-FateUploadOrigin $record.Origin -AllowLocalTestEndpoint:$AllowLocalTestEndpoint) -cne $record.Origin -or
        (Get-FateUploadSecretText $record.Token) -cnotmatch '\A[0-9a-f]{64}\z') {
        $record.Token.Dispose()
        throw 'Invalid diagnostic record.'
    }
    $record
}

function New-FateDiagnosticRecord([string]$StateDirectory, [string]$Id, [string]$Origin, [string]$ReportJson, $Policy) {
    $bytes = [byte[]]::new(32)
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    $token = [Security.SecureString]::new()
    try {
        foreach ($byte in $bytes) {
            foreach ($digit in $byte.ToString('x2').ToCharArray()) { $token.AppendChar($digit) }
        }
        $token.MakeReadOnly()
        $record = [PSCustomObject]@{
            Version = 1; Id = $Id; Origin = $Origin; ReportJson = $ReportJson
            ConsentVersion = $Policy.Version; ConsentText = $Policy.Text
            AcceptedAt = Get-FateDiagnosticTime; Token = $token
        }
        $path = Get-FateDiagnosticPath $StateDirectory $Id 'clixml'
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path))
        Write-FateUploadProtectedState $path $record
        return $record
    } catch {
        $token.Dispose()
        throw
    } finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Test-FateDiagnosticReceipt($Receipt, $Record) {
    $consent = Get-FateDiagnosticField $Receipt 'consent'
    if ($Receipt -isnot [PSCustomObject] -or $consent -isnot [PSCustomObject] -or
        @($Receipt.PSObject.Properties).Count -ne 5 -or @($consent.PSObject.Properties).Count -ne 4) { return $false }
    foreach ($name in 'id', 'status', 'receivedAt', 'expiresAt') {
        if ((Get-FateDiagnosticField $Receipt $name) -isnot [string]) { return $false }
    }
    foreach ($name in 'version', 'text', 'acceptedAt', 'recordedAt') {
        if ((Get-FateDiagnosticField $consent $name) -isnot [string]) { return $false }
    }
    if ($Receipt.id -cne $Record.Id -or $Receipt.status -cne 'received' -or
        $consent.version -cne $Record.ConsentVersion -or $consent.text -cne $Record.ConsentText -or
        $consent.acceptedAt -cne $Record.AcceptedAt -or $consent.recordedAt -cne $Receipt.receivedAt -or
        !(Test-FateDiagnosticTime $Receipt.receivedAt) -or !(Test-FateDiagnosticTime $Receipt.expiresAt)) { return $false }
    $received = ConvertTo-FateUploadTime $Receipt.receivedAt
    $expires = ConvertTo-FateUploadTime $Receipt.expiresAt
    $accepted = ConvertTo-FateUploadTime $consent.acceptedAt
    return (($expires - $received).TotalDays -eq 30 -and $received -ge $accepted.AddMinutes(-5))
}

function Get-FateDiagnosticStatus([string]$StateDirectory, $Record) {
    $id = $Record.Id
    if ([IO.File]::Exists((Get-FateDiagnosticPath $StateDirectory $id 'withdrawal.json'))) {
        $receipt = Read-FateDiagnosticJson (Get-FateDiagnosticPath $StateDirectory $id 'withdrawn.json')
        if (Test-FateWithdrawalReceipt $receipt $id) { return 'withdrawn' }
        return 'withdrawal-pending'
    }
    $receipt = Read-FateDiagnosticJson (Get-FateDiagnosticPath $StateDirectory $id 'received.json') 32KB
    if (Test-FateDiagnosticReceipt $receipt $Record) {
        if ((ConvertTo-FateUploadTime $receipt.expiresAt) -le [DateTimeOffset]::UtcNow) { return 'expired' }
        return 'received'
    }
    return 'pending'
}

function Invoke-FateDiagnosticRequest($Record, [Security.SecureString]$Key, [string]$Payload, [string]$WithdrawalPath) {
    if (!$Key) {
        return Invoke-FateCloudRequest -Origin $Record.Origin -Path "/api/diagnostics/$($Record.Id)/withdraw" `
            -Payload $Payload -DiagnosticToken $Record.Token
    }
    Invoke-FateCloudRequest -Origin $Record.Origin -Path '/api/diagnostics' -Payload $Payload `
        -Key $Key -CancelIfExists $WithdrawalPath
}

function Get-FateDiagnosticRetryTime([string]$Path) {
    $retryAt = Get-FateDiagnosticField (Read-FateDiagnosticJson $Path) 'retryAt'
    if (!(Test-FateDiagnosticTime $retryAt)) { return }
    $time = ConvertTo-FateUploadTime $retryAt
    $remaining = $time - [DateTimeOffset]::UtcNow
    if ($remaining.TotalSeconds -gt 0 -and $remaining.TotalDays -le 1) { return $time }
}

function Write-FateDiagnosticRetryTime([string]$Path, $Result) {
    $seconds = Get-FateDiagnosticField $Result 'RetrySeconds'
    if ($seconds -isnot [ValueType] -or [double]::IsNaN($seconds)) { $seconds = 30 }
    $delay = [Math]::Max(30, [Math]::Min(86400, [double]$seconds))
    Write-FateUploadState $Path @{ retryAt = [DateTime]::UtcNow.AddSeconds($delay).ToString('o') }
}

function Send-FateDiagnosticReport {
    param([string]$StateDirectory, $Report, [string]$Origin, [Security.SecureString]$Key,
        [switch]$ConsentAccepted, $DisplayedPolicy, [switch]$AllowLocalTestEndpoint,
        [scriptblock]$Transport = ${function:Invoke-FateDiagnosticRequest})
    if (!$ConsentAccepted -or !$DisplayedPolicy) { throw 'Explicit diagnostic consent is required.' }
    $site = Resolve-FateUploadOrigin $Origin -AllowLocalTestEndpoint:$AllowLocalTestEndpoint
    $policy = Get-FateDiagnosticPolicy $site
    if ($DisplayedPolicy.Version -cne $policy.Version -or $DisplayedPolicy.Text -cne $policy.Text) {
        throw 'Read and accept the current diagnostic consent.'
    }
    $safeReport = ConvertTo-FateDiagnosticReport $Report $policy
    $id = $safeReport.id
    $json = ConvertTo-Json -InputObject $safeReport -Compress -Depth 8
    if (!$Key) { throw 'A collection key is required.' }
    Assert-FateUploadKey $Key
    $lock = Enter-FateUploadLock $StateDirectory
    if (!$lock) { return 'busy' }
    $record = $null
    try {
        $record = Read-FateDiagnosticRecord $StateDirectory $id -AllowLocalTestEndpoint:$AllowLocalTestEndpoint
        $withdrawalPath = Get-FateDiagnosticPath $StateDirectory $id 'withdrawal.json'
        if ([IO.File]::Exists($withdrawalPath)) {
            if ($record) { return (Get-FateDiagnosticStatus $StateDirectory $record) }
            return 'withdrawal-pending'
        }
        if (!$record) {
            $record = New-FateDiagnosticRecord $StateDirectory $id $site $json $policy
        } elseif ($record.Origin -cne $site -or $record.ReportJson -cne $json -or
            $record.ConsentVersion -cne $policy.Version -or $record.ConsentText -cne $policy.Text) {
            return 'different-report'
        }
        $status = Get-FateDiagnosticStatus $StateDirectory $record
        if ($status -ne 'pending') { return $status }
        $retryPath = Get-FateDiagnosticPath $StateDirectory $id 'send-retry.json'
        if (Get-FateDiagnosticRetryTime $retryPath) { return 'rate-limited' }
        $body = ConvertTo-Json -Compress -Depth 8 -InputObject ([ordered]@{
            report = $safeReport
            consent = [ordered]@{ version = $record.ConsentVersion; text = $record.ConsentText; acceptedAt = $record.AcceptedAt }
            token = Get-FateUploadSecretText $record.Token
        })
        $result = $null
        try {
            if (![IO.File]::Exists($withdrawalPath)) { $result = & $Transport $record $Key $body $withdrawalPath }
        } catch {}
        $httpStatus = Get-FateDiagnosticField $result 'Status'
        $receipt = Get-FateDiagnosticField $result 'Receipt'
        if ([IO.File]::Exists($withdrawalPath)) { return (Get-FateDiagnosticStatus $StateDirectory $record) }
        if ($httpStatus -in 200, 201 -and (Test-FateDiagnosticReceipt $receipt $record)) {
            Write-FateUploadState (Get-FateDiagnosticPath $StateDirectory $id 'received.json') $receipt
            Write-FateDiagnosticEvent $StateDirectory 'diagnostics-upload' 'ok' $httpStatus
            return (Get-FateDiagnosticStatus $StateDirectory $record)
        }
        Write-FateDiagnosticEvent $StateDirectory 'diagnostics-upload' 'pending' $httpStatus
        switch ($httpStatus) {
            { $_ -in 401, 403 } { return 'authorization' }
            409 { return 'different-report' }
            410 { return 'closed' }
            429 {
                Write-FateDiagnosticRetryTime $retryPath $result
                return 'rate-limited'
            }
        }
        return 'pending'
    } finally {
        if ($record) { $record.Token.Dispose() }
        $lock.Dispose()
    }
}

function Save-FateDiagnosticWithdrawal([string]$StateDirectory, [string]$Id, [switch]$AllowLocalTestEndpoint) {
    $path = Get-FateDiagnosticPath $StateDirectory $Id 'withdrawal.json'
    if ([IO.File]::Exists($path)) { return }
    $record = Read-FateDiagnosticRecord $StateDirectory $Id -AllowLocalTestEndpoint:$AllowLocalTestEndpoint
    if (!$record) { throw 'The diagnostic consent could not be found.' }
    $record.Token.Dispose()
    # A durable local marker blocks explicit retries even if another process holds the uploader lock.
    $temporary = "$path.$([Guid]::NewGuid().ToString('N')).part"
    try {
        Write-FateUploadState $temporary @{ withdrawnAt = Get-FateDiagnosticTime }
        try { [IO.File]::Move($temporary, $path) } catch [IO.IOException] {
            if (![IO.File]::Exists($path)) { throw }
        }
    } finally { [IO.File]::Delete($temporary) }
}

function Invoke-FateDiagnosticWithdrawals {
    param([string]$StateDirectory, [string]$Id, [switch]$AllowLocalTestEndpoint,
        [scriptblock]$Transport = ${function:Invoke-FateDiagnosticRequest})
    $directory = Join-Path $StateDirectory 'diagnostics'
    if (![IO.Directory]::Exists($directory)) { return }
    $pattern = if ($Id) { [IO.Path]::GetFileName((Get-FateDiagnosticPath $StateDirectory $Id 'withdrawal.json')) } else { '*.withdrawal.json' }
    foreach ($path in [IO.Directory]::EnumerateFiles($directory, $pattern)) {
        if ([IO.Path]::GetFileName($path) -cnotmatch "\A($script:FateUploadGuid)\.withdrawal\.json\z") { continue }
        $reportId = $Matches[1]
        $receiptPath = Get-FateDiagnosticPath $StateDirectory $reportId 'withdrawn.json'
        if (Test-FateWithdrawalReceipt (Read-FateDiagnosticJson $receiptPath) $reportId) { continue }
        $retryPath = Get-FateDiagnosticPath $StateDirectory $reportId 'withdrawal-retry.json'
        if (Get-FateDiagnosticRetryTime $retryPath) { continue }
        $record = $null
        try {
            $withdrawnAt = Get-FateDiagnosticField (Read-FateDiagnosticJson $path) 'withdrawnAt'
            if (!(Test-FateDiagnosticTime $withdrawnAt)) { continue }
            $record = Read-FateDiagnosticRecord $StateDirectory $reportId -AllowLocalTestEndpoint:$AllowLocalTestEndpoint
            if (!$record) { continue }
            $body = ConvertTo-Json -Compress -InputObject @{ withdrawnAt = $withdrawnAt }
            $result = & $Transport $record $null $body $null
            $status = Get-FateDiagnosticField $result 'Status'
            $receipt = Get-FateDiagnosticField $result 'Receipt'
            if ($status -eq 200 -and (Test-FateWithdrawalReceipt $receipt $reportId)) {
                Write-FateUploadState $receiptPath @{ id = $reportId; status = 'withdrawn'; withdrawnAt = $receipt.withdrawnAt }
                Write-FateDiagnosticEvent $StateDirectory 'diagnostics-withdraw' 'ok' $status
            } else {
                Write-FateDiagnosticEvent $StateDirectory 'diagnostics-withdraw' 'pending' $status
                if ($status -eq 429) { Write-FateDiagnosticRetryTime $retryPath $result }
            }
        } catch {
            Write-FateDiagnosticEvent $StateDirectory 'diagnostics-withdraw' 'pending'
        } finally {
            if ($record) { $record.Token.Dispose() }
        }
    }
}
