function Get-FateCaptureConsentPolicy([string]$Origin) {
    $path = Join-Path $PSScriptRoot 'consent-policy.json'
    if (![IO.File]::Exists($path)) { $path = Join-Path $PSScriptRoot '../shared/consent-policy.json' }
    $policy = Read-FateUploadState $path
    if (!$policy -or !$policy.version -or !$policy.common -or !$policy.scopes.captures) {
        throw 'The cloud upload consent policy is missing or invalid.'
    }
    [PSCustomObject]@{
        Version = $policy.version
        Text = "$($policy.common)`n`n$($policy.scopes.captures)`n`nDestination: $Origin"
    }
}

function Get-FateConsentPath([string]$StateDirectory, [string]$Id, [string]$Suffix) {
    if ($Id -cnotmatch "\A${script:FateUploadGuid}\z") { throw 'Invalid consent ID.' }
    Join-Path $StateDirectory "consents/$Id.$Suffix"
}

function New-FateCaptureConsent([string]$StateDirectory, [string]$Origin, $Policy) {
    $bytes = [byte[]]::new(32)
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    $token = [Security.SecureString]::new()
    try {
        foreach ($byte in $bytes) {
            foreach ($digit in $byte.ToString('x2').ToCharArray()) { $token.AppendChar($digit) }
        }
        $token.MakeReadOnly()
        $consent = [PSCustomObject]@{
            Id = [guid]::NewGuid().ToString()
            Scope = 'captures'
            Origin = $Origin
            PolicyVersion = $Policy.Version
            AcceptedAt = [DateTime]::UtcNow.ToString('o')
            Text = $Policy.Text
            Token = $token
        }
        $path = Get-FateConsentPath $StateDirectory $consent.Id 'clixml'
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path))
        Write-FateUploadProtectedState $path $consent
        return $consent.Id
    } finally {
        [Array]::Clear($bytes, 0, $bytes.Length)
        $token.Dispose()
    }
}

function Get-FateCaptureConsent([string]$StateDirectory, [string]$Id, [switch]$AllowLocalTestEndpoint) {
    $path = Get-FateConsentPath $StateDirectory $Id 'clixml'
    if (![IO.File]::Exists($path)) { return }
    $consent = Import-Clixml -LiteralPath $path -ErrorAction Stop
    if ($consent.Id -cne $Id -or $consent.Scope -cne 'captures' -or
        $consent.Token -isnot [Security.SecureString] -or $consent.Token.Length -ne 64 -or
        $consent.Text -isnot [string] -or !$consent.Text -or
        $consent.PolicyVersion -isnot [string] -or !$consent.PolicyVersion) {
        throw 'Cloud upload consent is invalid.'
    }
    $consent.Origin = Resolve-FateUploadOrigin $consent.Origin -AllowLocalTestEndpoint:$AllowLocalTestEndpoint
    [void](ConvertTo-FateUploadTime $consent.AcceptedAt)
    return $consent
}

function Test-FateConsentWithdrawnLocally([string]$StateDirectory, [string]$Id) {
    [IO.File]::Exists((Get-FateConsentPath $StateDirectory $Id 'withdrawal.json'))
}

function Test-FateCaptureConsentCurrent($Consent, $Policy) {
    $Consent.PolicyVersion -ceq $Policy.Version -and $Consent.Text -ceq $Policy.Text
}

function Save-FateCaptureConsentWithdrawal([string]$StateDirectory, [string]$Id, [switch]$AllowLocalTestEndpoint) {
    $path = Get-FateConsentPath $StateDirectory $Id 'withdrawal.json'
    if ([IO.File]::Exists($path)) { return }
    if (!(Get-FateCaptureConsent $StateDirectory $Id -AllowLocalTestEndpoint:$AllowLocalTestEndpoint)) {
        throw 'The consent could not be found.'
    }
    # The marker is the durable withdrawal request and blocks uploads even when the uploader holds its lock.
    # Create it once so a second dialog cannot change the original withdrawal time.
    $temporary = "$path.$([guid]::NewGuid().ToString('N')).part"
    try {
        Write-FateUploadState $temporary @{ withdrawnAt = [DateTime]::UtcNow.ToString('o') }
        try { [IO.File]::Move($temporary, $path) } catch [IO.IOException] {
            if (![IO.File]::Exists($path)) { throw }
        }
    } finally { [IO.File]::Delete($temporary) }
}

function Test-FateConsentReceipt($Receipt, $Consent) {
    if ($Receipt -isnot [PSCustomObject]) { return $false }
    foreach ($name in 'id', 'scope', 'policyVersion', 'text', 'acceptedAt', 'recordedAt') {
        if (!$Receipt.PSObject.Properties[$name] -or $Receipt.$name -isnot [string]) { return $false }
    }
    if (!$Receipt.PSObject.Properties['withdrawnAt'] -or $Receipt.id -cne $Consent.Id -or $Receipt.scope -cne $Consent.Scope -or
        $Receipt.policyVersion -cne $Consent.PolicyVersion -or $Receipt.text -cne $Consent.Text -or
        $Receipt.acceptedAt -cne $Consent.AcceptedAt -or $null -ne $Receipt.withdrawnAt) { return $false }
    try { [void](ConvertTo-FateUploadTime $Receipt.recordedAt) } catch { return $false }
    return $true
}

function Test-FateWithdrawalReceipt($Receipt, [string]$Id) {
    if ($Receipt -isnot [PSCustomObject]) { return $false }
    foreach ($name in 'id', 'status', 'withdrawnAt') {
        if (!$Receipt.PSObject.Properties[$name] -or $Receipt.$name -isnot [string]) { return $false }
    }
    if ($Receipt.id -cne $Id -or $Receipt.status -cne 'withdrawn') { return $false }
    try { [void](ConvertTo-FateUploadTime $Receipt.withdrawnAt) } catch { return $false }
    return $true
}

function Invoke-FateConsentRequest($Consent, [Security.SecureString]$Key, $Withdrawal) {
    if ($Withdrawal) {
        return Invoke-FateCloudRequest -Origin $Consent.Origin -Path "/api/consents/$($Consent.Id)/withdraw" `
            -Payload (ConvertTo-Json -InputObject $Withdrawal -Compress) -ConsentToken $Consent.Token
    }
    $body = ConvertTo-Json -Compress -InputObject @{
        id = $Consent.Id
        scope = $Consent.Scope
        policyVersion = $Consent.PolicyVersion
        acceptedAt = $Consent.AcceptedAt
        text = $Consent.Text
        token = Get-FateUploadSecretText $Consent.Token
    }
    Invoke-FateCloudRequest -Origin $Consent.Origin -Path '/api/consents' -Payload $body -Key $Key
}

function Invoke-FatePendingWithdrawals([string]$StateDirectory, [scriptblock]$Transport, [switch]$AllowLocalTestEndpoint) {
    $directory = Join-Path $StateDirectory 'consents'
    if (![IO.Directory]::Exists($directory)) { return }
    $attempted = 0
    foreach ($path in [IO.Directory]::EnumerateFiles($directory, '*.withdrawal.json')) {
        if ($attempted -ge $script:FateWithdrawalBatchSize) { break }
        if ([IO.Path]::GetFileName($path) -cnotmatch "\A($script:FateUploadGuid)\.withdrawal\.json\z") { continue }
        $id = $Matches[1]
        $receiptPath = Get-FateConsentPath $StateDirectory $id 'withdrawn.json'
        $consent = $null
        try {
            if (Test-FateWithdrawalReceipt (Read-FateUploadState $receiptPath) $id) { continue }
            $retryPath = Get-FateConsentPath $StateDirectory $id 'withdrawal-retry.json'
            $retry = Read-FateUploadState $retryPath
            if ($retry -and (ConvertTo-FateUploadTime $retry.retryAt) -gt [DateTimeOffset]::UtcNow) { continue }
            $consent = Get-FateCaptureConsent $StateDirectory $id -AllowLocalTestEndpoint:$AllowLocalTestEndpoint
            if (!$consent) { continue }
            $withdrawal = Read-FateUploadState $path
            [void](ConvertTo-FateUploadTime $withdrawal.withdrawnAt)
            $attempted++
            $result = $null
            try { $result = & $Transport $consent $null $withdrawal } catch {}
            if ($result -and $result.Status -eq 200 -and (Test-FateWithdrawalReceipt $result.Receipt $id)) {
                Write-FateUploadState $receiptPath @{ id = $id; status = 'withdrawn'; withdrawnAt = $result.Receipt.withdrawnAt }
            } else {
                Write-FateWithdrawalRetry $retryPath $result
            }
        } catch {
            # A failed attempt stays pending. Other collections and local capture remain available.
        } finally {
            if ($consent) { $consent.Token.Dispose() }
        }
    }
}

function Confirm-FateUploadConsent($Configuration, [string]$StateDirectory, [scriptblock]$Transport, [switch]$ForceRetry) {
    $consent = $Configuration.Consent
    if (Test-FateConsentWithdrawnLocally $StateDirectory $consent.Id) { return $false }
    $receiptPath = Get-FateConsentPath $StateDirectory $consent.Id 'recorded.json'
    if (Test-FateConsentReceipt (Read-FateUploadState $receiptPath) $consent) { return $true }
    $gatePath = Get-FateConsentPath $StateDirectory $consent.Id 'gate.json'
    $gate = Read-FateUploadState $gatePath
    if ($gate -and $gate.revision -ceq $Configuration.Revision) {
        if ($gate.status -in 'authorization', 'consent-required') { return $false }
        if (!$ForceRetry -and (ConvertTo-FateUploadTime $gate.retryAt) -gt [DateTimeOffset]::UtcNow) { return $false }
    }
    $result = $null
    try { $result = & $Transport $consent $Configuration.Key $null } catch {}
    if ($result -and $result.Status -in 200, 201 -and (Test-FateConsentReceipt $result.Receipt $consent)) {
        Write-FateUploadState $receiptPath @{
            id = $consent.Id
            scope = $consent.Scope
            policyVersion = $consent.PolicyVersion
            acceptedAt = $consent.AcceptedAt
            text = $consent.Text
            recordedAt = $result.Receipt.recordedAt
            withdrawnAt = $null
        }
        return $true
    }
    $status = if (!$result) { 'offline' }
        elseif ($result.Status -eq 401) { 'authorization' }
        elseif ($result.Status -in 403, 409) { 'consent-required' }
        else { 'retry' }
    $delay = if ($result -and $result.RetrySeconds) { [Math]::Max(30, [Math]::Min(86400, [double]$result.RetrySeconds)) } else { 30 }
    Write-FateUploadState $gatePath @{
        status = $status
        revision = $Configuration.Revision
        retryAt = [DateTimeOffset]::UtcNow.AddSeconds($delay).ToString('o')
    }
    return $false
}
