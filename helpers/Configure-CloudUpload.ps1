param([string]$StateDirectory = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'FateCollector'))

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'CloudUpload.Common.ps1')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[Windows.Forms.Application]::EnableVisualStyles()
$form = [Windows.Forms.Form]::new()
$form.Text = 'Fate Collector cloud upload'
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.AutoScaleMode = 'Dpi'
$form.Font = [Drawing.SystemFonts]::MessageBoxFont
$form.ClientSize = [Drawing.Size]::new(650, 551)

function Add-DialogLabel([string]$Text, [int]$Top, [int]$Height = 20) {
    $label = [Windows.Forms.Label]::new()
    $label.Text = $Text
    $label.SetBounds(16, $Top, 618, $Height)
    $form.Controls.Add($label)
    return $label
}

function Add-DialogTextBox([int]$Top) {
    $field = [Windows.Forms.TextBox]::new()
    $field.SetBounds(16, $Top, 618, 24)
    $form.Controls.Add($field)
    return $field
}

function Add-DialogButton([string]$Text, [int]$Left, [int]$Top, [int]$Width) {
    $button = [Windows.Forms.Button]::new()
    $button.Text = $Text
    $button.SetBounds($Left, $Top, $Width, 29)
    $form.Controls.Add($button)
    return $button
}

[void](Add-DialogLabel 'Consent history' 16)
$history = [Windows.Forms.ComboBox]::new()
$history.AccessibleName = 'Consent history'
$history.DropDownStyle = 'DropDownList'
$history.SetBounds(16, 38, 459, 24)
$form.Controls.Add($history)
$withdraw = Add-DialogButton 'Withdraw consent' 488 35 146
$status = Add-DialogLabel 'Cloud upload is off.' 72 44

[void](Add-DialogLabel 'HTTPS site origin (for example, https://collector.example)' 127)
$origin = Add-DialogTextBox 148
$origin.AccessibleName = 'HTTPS site origin'
[void](Add-DialogLabel 'Upload key' 185)
$key = Add-DialogTextBox 206
$key.AccessibleName = 'Upload key'
$key.UseSystemPasswordChar = $true
$key.MaxLength = 512

[void](Add-DialogLabel 'Consent for new F9 captures' 243)
$policyBox = [Windows.Forms.TextBox]::new()
$policyBox.AccessibleName = 'Consent for new F9 captures'
$policyBox.Multiline = $true
$policyBox.ReadOnly = $true
$policyBox.BackColor = [Drawing.SystemColors]::Window
$policyBox.ScrollBars = 'Vertical'
$policyBox.SetBounds(16, 265, 618, 178)
$form.Controls.Add($policyBox)
$accept = [Windows.Forms.CheckBox]::new()
$accept.Text = 'I agree to share new F9 captures with the destination above.'
$accept.SetBounds(16, 451, 618, 27)
$form.Controls.Add($accept)
$errorLabel = Add-DialogLabel '' 480 28
$enable = Add-DialogButton 'Enable upload' 388 510 125
$close = Add-DialogButton 'Close' 527 510 107
$close.DialogResult = 'Cancel'
$form.CancelButton = $close

$script:saved = $null
$script:consents = @()
$script:shownPolicy = $null

function Update-ConsentStatus {
    $withdraw.Enabled = $false
    try {
        if ($history.SelectedIndex -lt 0 -or $history.SelectedIndex -ge $script:consents.Count) {
            $status.Text = if ([IO.File]::Exists((Join-Path $StateDirectory 'upload.clixml'))) {
                'Cloud upload is off. Enable upload to record consent for this version.'
            } else { 'Cloud upload is off.' }
            return
        }
        $consent = $script:consents[$history.SelectedIndex]
        $accepted = (ConvertTo-FateUploadTime $consent.AcceptedAt).ToLocalTime().ToString('g')
        $detail = "Accepted $accepted  |  Policy version $($consent.PolicyVersion)"
        if (Test-FateConsentWithdrawnLocally $StateDirectory $consent.Id) {
            $receipt = Read-FateUploadState (Get-FateConsentPath $StateDirectory $consent.Id 'withdrawn.json')
            $summary = if (Test-FateWithdrawalReceipt $receipt $consent.Id) {
                'Withdrawal confirmed by the collection. Local copies are kept.'
            } else { 'Withdrawn on this device. Waiting for confirmation from the collection.' }
        } else {
            $withdraw.Enabled = $true
            $summary = if (!$script:saved -or $script:saved.Scope -cne $consent.Id) {
                'Earlier consent. Automatic upload under this consent is off.'
            } elseif (!(Test-FateUploadConsentActive $script:saved $StateDirectory)) {
                'Cloud upload is off. The current policy requires new consent.'
            } else {
                switch ([string](Get-FateCurrentUploadGate $script:saved $StateDirectory)) {
                    'authorization' { 'Upload paused. Enter a valid upload key to resume.' }
                    'consent-required' { 'Upload paused. The collection did not accept this consent.' }
                    default {
                        $receipt = Read-FateUploadState (Get-FateConsentPath $StateDirectory $consent.Id 'recorded.json')
                        if (Test-FateConsentReceipt $receipt $consent) { 'Cloud upload is enabled.' }
                        else { 'Consent saved on this device. Waiting for confirmation before uploading.' }
                    }
                }
            }
        }
        $status.Text = "$summary`r`n$detail"
    } catch {
        $status.Text = 'Could not read the consent status. Check the local settings folder.'
    }
}

function Read-ConsentHistory {
    $script:saved = $null
    try { $script:saved = Get-FateUploadConfiguration $StateDirectory } catch {}
    $directory = Join-Path $StateDirectory 'consents'
    $script:consents = @(
        if ([IO.Directory]::Exists($directory)) {
            foreach ($path in [IO.Directory]::EnumerateFiles($directory, '*.clixml')) {
                try { Get-FateCaptureConsent $StateDirectory ([IO.Path]::GetFileNameWithoutExtension($path)) }
                catch { continue }
            }
        }
    ) | Sort-Object AcceptedAt -Descending
    $script:consents = @($script:consents | Where-Object { $null -ne $_ })
    $history.Items.Clear()
    $currentIndex = -1
    foreach ($consent in $script:consents) {
        $accepted = (ConvertTo-FateUploadTime $consent.AcceptedAt).ToLocalTime().ToString('g')
        $index = $history.Items.Add("$($consent.Origin) - $accepted")
        if ($script:saved -and $script:saved.Scope -ceq $consent.Id) { $currentIndex = $index }
    }
    if ($history.Items.Count) { $history.SelectedIndex = [Math]::Max(0, $currentIndex) }
    Update-ConsentStatus
}

function Update-ConsentPolicy {
    $script:shownPolicy = $null
    $accept.Checked = $false
    try {
        $site = Resolve-FateUploadOrigin $origin.Text
        $script:shownPolicy = Get-FateCaptureConsentPolicy $site
        $policyBox.Text = $script:shownPolicy.Text.Replace("`n", "`r`n")
    } catch {
        $policyBox.Text = if ($origin.Text.Trim()) { $_.Exception.Message }
            else { 'Enter the HTTPS site origin to see the consent text and destination.' }
    }
    $accept.Enabled = $null -ne $script:shownPolicy
    $enable.Enabled = $false
}

$history.Add_SelectedIndexChanged({ Update-ConsentStatus })
$origin.Add_TextChanged({ Update-ConsentPolicy })
$accept.Add_CheckedChanged({ $enable.Enabled = $accept.Enabled -and $accept.Checked })
$timer = [Windows.Forms.Timer]::new()
$timer.Interval = 2000
$timer.Add_Tick({ Update-ConsentStatus })

$enable.Add_Click({
    $secret = $null
    $errorLabel.Text = ''
    try {
        if (!$accept.Checked -or !$script:shownPolicy) { return }
        $site = Resolve-FateUploadOrigin $origin.Text
        if (!$key.Text) { throw 'Enter the upload key.' }
        $secret = ConvertTo-SecureString -String $key.Text -AsPlainText -Force
        Set-FateUploadConfiguration -StateDirectory $StateDirectory -Origin $site -Key $secret `
            -ConsentAccepted -DisplayedPolicy $script:shownPolicy
        $key.Clear()
        $accept.Checked = $false
        Read-ConsentHistory
    } catch {
        Update-ConsentPolicy
        $errorLabel.Text = $_.Exception.Message
    } finally { if ($secret) { $secret.Dispose() } }
})

$withdraw.Add_Click({
    $errorLabel.Text = ''
    try {
        $consent = $script:consents[$history.SelectedIndex]
        Disable-FateUpload $StateDirectory -ConsentId $consent.Id
        $accept.Checked = $false
        Update-ConsentStatus
    } catch {
        $errorLabel.Text = 'Could not save the withdrawal. Check the local settings folder.'
    }
})

try {
    Read-ConsentHistory
    if ($script:saved) { $origin.Text = $script:saved.Origin }
    Update-ConsentPolicy
    $timer.Start()
    [void]$form.ShowDialog()
}
finally {
    $timer.Dispose()
    $key.Clear()
    $form.Dispose()
}
