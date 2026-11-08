param(
    [string]$StateDirectory = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'FateCollector'),
    [string]$CapturesDirectory = (Join-Path $PSScriptRoot 'captures'),
    [switch]$AllowLocalTestEndpoint
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'CloudUpload.Common.ps1')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[Windows.Forms.Application]::EnableVisualStyles()
$form = [Windows.Forms.Form]::new()
$form.Text = 'Fate Collector - Report a problem'
$form.StartPosition = 'CenterScreen'
$form.AutoScaleMode = 'Dpi'
$form.Font = [Drawing.SystemFonts]::MessageBoxFont
$form.ClientSize = [Drawing.Size]::new(850, 590)
$form.MinimumSize = [Drawing.Size]::new(790, 570)

$tabs = [Windows.Forms.TabControl]::new()
$tabs.Dock = 'Fill'
$form.Controls.Add($tabs)
$reportTab = [Windows.Forms.TabPage]::new('Diagnostic report')
$historyTab = [Windows.Forms.TabPage]::new('Report history')
$tabs.TabPages.AddRange(@($reportTab, $historyTab))
# Initialize both pages before setting child anchors, including the page that starts hidden.
$reportTab.Size = $tabs.DisplayRectangle.Size
$historyTab.Size = $tabs.DisplayRectangle.Size

function Add-ReportLabel($Parent, [string]$Text, [int]$Left, [int]$Top, [int]$Width, [int]$Height = 20) {
    $label = [Windows.Forms.Label]::new()
    $label.Text = $Text
    $label.SetBounds($Left, $Top, $Width, $Height)
    $Parent.Controls.Add($label)
    return $label
}

function Add-ReportButton($Parent, [string]$Text, [int]$Left, [int]$Top, [int]$Width) {
    $button = [Windows.Forms.Button]::new()
    $button.Text = $Text
    $button.SetBounds($Left, $Top, $Width, 32)
    $Parent.Controls.Add($button)
    return $button
}

function Add-ReportField([string]$Name, [int]$Left, [int]$Top, [int]$Width) {
    $field = [Windows.Forms.TextBox]::new()
    $field.AccessibleName = $Name
    $field.SetBounds($Left, $Top, $Width, 24)
    $reportTab.Controls.Add($field)
    return $field
}

[void](Add-ReportLabel $reportTab 'Generate a technical report, review the JSON and save a ZIP or send it to a collection.' 16 14 740)
$generate = Add-ReportButton $reportTab 'Generate report' 16 39 146
$saveZip = Add-ReportButton $reportTab 'Save ZIP' 173 39 112
$saveZip.Enabled = $false
[void](Add-ReportLabel $reportTab 'Saves a local copy on this computer.' 298 47 475)

[void](Add-ReportLabel $reportTab 'Collection site origin' 16 86 370)
$site = Add-ReportField 'Collection site origin' 16 109 371
$site.MaxLength = 300
[void](Add-ReportLabel $reportTab 'Collection key' 403 86 345)
$keyField = Add-ReportField 'Collection key' 403 109 410
$keyField.Anchor = 'Top, Left, Right'
$keyField.MaxLength = 512
$keyField.UseSystemPasswordChar = $true
$keyHint = Add-ReportLabel $reportTab '' 403 135 410 32
$keyHint.Anchor = 'Top, Left, Right'

$details = [Windows.Forms.TableLayoutPanel]::new()
$details.SetBounds(16, 169, 797, 271)
$details.Anchor = 'Top, Bottom, Left, Right'
$details.ColumnCount = 2
$details.RowCount = 2
[void]$details.ColumnStyles.Add([Windows.Forms.ColumnStyle]::new('Percent', 50))
[void]$details.ColumnStyles.Add([Windows.Forms.ColumnStyle]::new('Percent', 50))
[void]$details.RowStyles.Add([Windows.Forms.RowStyle]::new('Absolute', 24))
[void]$details.RowStyles.Add([Windows.Forms.RowStyle]::new('Percent', 100))
$reportTab.Controls.Add($details)

$preview = [Windows.Forms.TextBox]::new()
$policyBox = [Windows.Forms.TextBox]::new()
foreach ($box in @($preview, $policyBox)) {
    $box.Multiline = $true
    $box.ReadOnly = $true
    $box.BackColor = [Drawing.SystemColors]::Window
    $box.ScrollBars = 'Vertical'
    $box.Dock = 'Fill'
    $box.Margin = [Windows.Forms.Padding]::new(0, 0, 8, 0)
}
$preview.AccessibleName = 'Diagnostic JSON preview'
$preview.Font = [Drawing.Font]::new('Consolas', 9)
$preview.WordWrap = $false
$preview.ScrollBars = 'Both'
$preview.Text = 'Generate a report to see the JSON here.'
$policyBox.AccessibleName = 'Diagnostic consent and destination'
$policyBox.Margin = [Windows.Forms.Padding]::new(8, 0, 0, 0)
$previewLabel = [Windows.Forms.Label]::new()
$previewLabel.Text = 'Diagnostic JSON'
$previewLabel.Dock = 'Fill'
$policyLabel = [Windows.Forms.Label]::new()
$policyLabel.Text = 'Diagnostic consent'
$policyLabel.Margin = [Windows.Forms.Padding]::new(8, 3, 0, 0)
$policyLabel.Dock = 'Fill'
$details.Controls.Add($previewLabel, 0, 0)
$details.Controls.Add($policyLabel, 1, 0)
$details.Controls.Add($preview, 0, 1)
$details.Controls.Add($policyBox, 1, 1)

$accept = [Windows.Forms.CheckBox]::new()
$accept.Text = 'I agree to send this report to the collection above.'
$accept.SetBounds(16, 447, 590, 26)
$accept.Anchor = 'Bottom, Left'
$reportTab.Controls.Add($accept)
$status = Add-ReportLabel $reportTab 'Generate a report to get started.' 16 483 590 63
$status.Anchor = 'Bottom, Left, Right'
$send = Add-ReportButton $reportTab 'Send report' 668 483 145
$send.Anchor = 'Bottom, Right'

[void](Add-ReportLabel $historyTab 'Reports you tried to send from this device' 16 14 740)
$history = [Windows.Forms.ListBox]::new()
$history.AccessibleName = 'Reports and their destinations'
$history.SetBounds(16, 40, 797, 379)
$history.Anchor = 'Top, Bottom, Left, Right'
$historyTab.Controls.Add($history)
$historyStatus = Add-ReportLabel $historyTab '' 16 432 797 62
$historyStatus.Anchor = 'Bottom, Left, Right'
$openReport = Add-ReportButton $historyTab 'View report' 16 503 137
$openReport.Anchor = 'Bottom, Left'
$withdraw = Add-ReportButton $historyTab 'Withdraw consent' 165 503 155
$withdraw.Anchor = 'Bottom, Left'
$copyReportId = Add-ReportButton $historyTab 'Copy report number' 332 503 153
$copyReportId.Anchor = 'Bottom, Left'
$copyStatus = Add-ReportLabel $historyTab '' 498 512 315 36
$copyStatus.Anchor = 'Bottom, Left, Right'

$script:report = $null
$script:currentPolicy = $null
$script:loadedRecord = $null
$script:historyRecords = @()
$script:saved = $null
try { $script:saved = Get-FateUploadConfiguration $StateDirectory -AllowLocalTestEndpoint:$AllowLocalTestEndpoint } catch {}

function Update-ReportSend {
    $send.Enabled = $accept.Enabled -and $accept.Checked -and
        ($keyField.Text.Length -gt 0 -or ($script:saved -and $script:currentPolicy -and $script:saved.Origin -ceq $script:currentPolicy.Origin))
}

function Update-ReportConsent {
    $script:currentPolicy = $null
    $accept.Checked = $false
    $accept.Enabled = $false
    $send.Enabled = $false
    $keyHint.Text = 'Enter the capture or reviewed collection key to send.'
    try {
        $origin = Resolve-FateUploadOrigin $site.Text -AllowLocalTestEndpoint:$AllowLocalTestEndpoint
        $policy = Get-FateDiagnosticPolicy $origin
        $consentText = $policy.Text
        $retryAllowed = $true
        if ($script:loadedRecord) {
            $consentText = $script:loadedRecord.ConsentText
            $retryAllowed = $script:loadedRecord.ConsentVersion -ceq $policy.Version -and $consentText -ceq $policy.Text -and
                (Get-FateDiagnosticStatus $StateDirectory $script:loadedRecord) -eq 'pending'
        }
        $policyBox.Text = $consentText.Replace("`n", "`r`n")
        $script:currentPolicy = [PSCustomObject]@{ Version = $policy.Version; Text = $policy.Text; Origin = $origin }
        if ($script:saved -and $script:saved.Origin -ceq $origin) {
            $keyHint.Text = 'A saved key is available. Leave blank to use it.'
        }
        $accept.Enabled = $null -ne $script:report -and $retryAllowed
    } catch {
        $policyBox.Text = 'Enter a valid HTTPS site origin to review the consent and destination.'
    }
}

function Set-ReportPreview($Report) {
    $script:report = $Report
    $preview.Text = ConvertTo-Json -InputObject $Report -Depth 8
    $preview.SelectionStart = 0
    $preview.ScrollToCaret()
    $saveZip.Enabled = $true
    $send.Text = if ($script:loadedRecord) { 'Retry sending' } else { 'Send report' }
    Update-ReportConsent
}

function Get-ReportStatusText([string]$Value) {
    switch ($Value) {
        'received' { 'Received by the collection. You can withdraw consent from Report history.' }
        'pending' { 'Receipt unconfirmed. You can retry or withdraw consent from Report history.' }
        'withdrawal-pending' { 'Withdrawal saved on this device. Deletion will retry while the helper is running.' }
        'withdrawn' { 'Withdrawal confirmed by the collection. Local copies are kept.' }
        'expired' { 'The collection retention period has ended. Local copies are kept.' }
        'authorization' { 'The collection declined the request. Check the key and retry.' }
        'different-report' { 'The collection or saved attempt requires a new report and consent.' }
        'closed' { 'The collection reports this report is closed. You can request deletion from Report history.' }
        'rate-limited' {
            $retry = Get-FateDiagnosticRetryTime (Get-FateDiagnosticPath $StateDirectory $script:report.id 'send-retry.json')
            if ($retry) { "The collection has reached its limit. Retry after $($retry.ToLocalTime().ToString('g'))." }
            else { 'The collection has reached its limit. Wait a moment and retry.' }
        }
        'busy' { 'The background uploader is busy. Try again in a few seconds.' }
        default { 'Report status unavailable.' }
    }
}

function Update-ReportHistoryStatus {
    $openReport.Enabled = $history.SelectedIndex -ge 0
    $copyReportId.Enabled = $openReport.Enabled
    $withdraw.Enabled = $false
    if (!$openReport.Enabled) {
        $historyStatus.Text = 'No diagnostic reports have been sent from this device yet.'
        return
    }
    $selected = $script:historyRecords[$history.SelectedIndex]
    try {
        $value = Get-FateDiagnosticStatus $StateDirectory $selected
        $withdraw.Enabled = $value -in 'received', 'pending', 'expired'
        $historyStatus.Text = Get-ReportStatusText $value
        if ($value -eq 'withdrawal-pending') {
            $retry = Get-FateDiagnosticRetryTime (Get-FateDiagnosticPath $StateDirectory $selected.Id 'withdrawal-retry.json')
            if ($retry) { $historyStatus.Text = "Withdrawal saved. The collection asked us to retry after $($retry.ToLocalTime().ToString('g'))." }
        }
        if ($value -eq 'received') {
            $receipt = Read-FateDiagnosticJson (Get-FateDiagnosticPath $StateDirectory $selected.Id 'received.json') 32KB
            if (Test-FateDiagnosticReceipt $receipt $selected) {
                $expiry = (ConvertTo-FateUploadTime $receipt.expiresAt).ToLocalTime().ToString('g')
                $historyStatus.Text += "`r`nExpires $expiry"
            }
        }
    } catch { $historyStatus.Text = 'Could not read the saved receipt.' }
}

function Read-ReportHistory {
    $selectedId = if ($history.SelectedIndex -ge 0) { $script:historyRecords[$history.SelectedIndex].Id }
    $history.Items.Clear()
    $directory = Join-Path $StateDirectory 'diagnostics'
    $script:historyRecords = @(
        if ([IO.Directory]::Exists($directory)) {
            foreach ($path in [IO.Directory]::EnumerateFiles($directory, '*.clixml')) {
                $id = [IO.Path]::GetFileNameWithoutExtension($path)
                try {
                    $record = Read-FateDiagnosticRecord $StateDirectory $id -AllowLocalTestEndpoint:$AllowLocalTestEndpoint
                    if (!$record) { continue }
                    $record.Token.Dispose()
                    $record
                } catch { continue }
            }
        }
    ) | Sort-Object AcceptedAt -Descending
    $script:historyRecords = @($script:historyRecords | Where-Object { $null -ne $_ })
    $index = 0
    foreach ($record in $script:historyRecords) {
        $date = (ConvertTo-FateUploadTime $record.AcceptedAt).ToLocalTime().ToString('g')
        $item = $history.Items.Add("$date  |  $($record.Origin)  |  $($record.Id.Substring(0, 8))")
        if ($record.Id -ceq $selectedId) { $index = $item }
    }
    if ($history.Items.Count) { $history.SelectedIndex = $index }
    Update-ReportHistoryStatus
}

$site.Add_TextChanged({
    $keyField.Clear()
    Update-ReportConsent
})
$keyField.Add_TextChanged({ Update-ReportSend })
$accept.Add_CheckedChanged({ Update-ReportSend })
$tabs.Add_SelectedIndexChanged({ if ($tabs.SelectedTab -eq $historyTab) { Read-ReportHistory } })
$history.Add_SelectedIndexChanged({
    $copyStatus.Text = ''
    Update-ReportHistoryStatus
})

$generate.Add_Click({
    try {
        $origin = if ($script:currentPolicy) { $script:currentPolicy.Origin } else { '' }
        $report = New-FateDiagnosticReport $StateDirectory $CapturesDirectory $origin
        $script:loadedRecord = $null
        $site.ReadOnly = $false
        Set-ReportPreview $report
        $status.Text = 'Review the JSON. Save a ZIP or give consent to send.'
    } catch { $status.Text = 'Could not generate a diagnostic report. Check the helper installation.' }
})

$saveZip.Add_Click({
    $dialog = [Windows.Forms.SaveFileDialog]::new()
    try {
        $dialog.Filter = 'Diagnostic ZIP (*.zip)|*.zip'
        $dialog.FileName = "fate-diagnostics-$($script:report.id).zip"
        $dialog.AddExtension = $true
        $dialog.DefaultExt = 'zip'
        if ($dialog.ShowDialog($form) -ne 'OK') { return }
        Export-FateDiagnosticZip $dialog.FileName $script:report
        $status.Text = 'ZIP saved to this computer.'
    } catch { $status.Text = 'Could not save the ZIP. Choose a writable folder.' }
    finally { $dialog.Dispose() }
})

$send.Add_Click({
    if (!$accept.Checked -or !$accept.Enabled -or !$script:currentPolicy) { return }
    $manualKey = $null
    $form.UseWaitCursor = $true
    $send.Enabled = $false
    $status.Text = 'Waiting for the collection to confirm receipt...'
    $status.Refresh()
    try {
        $secret = $null
        if ($keyField.Text) {
            $manualKey = ConvertTo-SecureString -String $keyField.Text -AsPlainText -Force
            $secret = $manualKey
        } elseif ($script:saved -and $script:saved.Origin -ceq $script:currentPolicy.Origin) {
            $secret = $script:saved.Key
        }
        $result = Send-FateDiagnosticReport -StateDirectory $StateDirectory -Report $script:report `
            -Origin $site.Text -Key $secret -DisplayedPolicy $script:currentPolicy -ConsentAccepted:$accept.Checked `
            -AllowLocalTestEndpoint:$AllowLocalTestEndpoint
        $record = Read-FateDiagnosticRecord $StateDirectory $script:report.id -AllowLocalTestEndpoint:$AllowLocalTestEndpoint
        if ($record) {
            $record.Token.Dispose()
            $script:loadedRecord = $record
            $site.ReadOnly = $true
            $send.Text = 'Retry sending'
        }
        Update-ReportConsent
        $status.Text = Get-ReportStatusText $result
    } catch {
        $status.Text = 'Could not send the report. Check the collection key and the local settings folder.'
    } finally {
        if ($manualKey) { $manualKey.Dispose() }
        $form.UseWaitCursor = $false
        Update-ReportSend
    }
})

$openReport.Add_Click({
    if ($history.SelectedIndex -lt 0) { return }
    $record = $script:historyRecords[$history.SelectedIndex]
    try {
        $report = ConvertTo-FateDiagnosticReport (ConvertFrom-FateDiagnosticJson $record.ReportJson) (Get-FateDiagnosticPolicy)
        if ($report.id -cne $record.Id) { throw 'Invalid diagnostic record.' }
        $script:loadedRecord = $record
        $keyField.Clear()
        $site.Text = $record.Origin
        $site.ReadOnly = $true
        Set-ReportPreview $report
        $status.Text = Get-ReportStatusText (Get-FateDiagnosticStatus $StateDirectory $record)
        $tabs.SelectedTab = $reportTab
    } catch { $historyStatus.Text = 'Could not open the saved report.' }
})

$copyReportId.Add_Click({
    if ($history.SelectedIndex -lt 0) { return }
    try {
        $id = $script:historyRecords[$history.SelectedIndex].Id
        [Windows.Forms.Clipboard]::SetText($id)
        $copyStatus.Text = 'Report number copied.'
    } catch { $copyStatus.Text = 'Could not copy the report number.' }
})

$withdraw.Add_Click({
    if ($history.SelectedIndex -lt 0) { return }
    $record = $script:historyRecords[$history.SelectedIndex]
    if ([Windows.Forms.MessageBox]::Show($form, 'Ask this collection to delete the report? Local copies will be kept.',
        'Withdraw diagnostic consent', 'YesNo', 'Question', 'Button2') -ne 'Yes') { return }
    $form.UseWaitCursor = $true
    try {
        Save-FateDiagnosticWithdrawal -StateDirectory $StateDirectory -Id $record.Id -AllowLocalTestEndpoint:$AllowLocalTestEndpoint
        Update-ReportHistoryStatus
        $historyStatus.Refresh()
        $lock = Enter-FateUploadLock $StateDirectory
        if ($lock) {
            try {
                Invoke-FateDiagnosticWithdrawals -StateDirectory $StateDirectory -Id $record.Id -AllowLocalTestEndpoint:$AllowLocalTestEndpoint
            } finally { $lock.Dispose() }
        }
        Update-ReportHistoryStatus
        if ($script:report -and $script:report.id -ceq $record.Id) {
            Update-ReportConsent
            $status.Text = Get-ReportStatusText (Get-FateDiagnosticStatus $StateDirectory $record)
        }
    } catch { $historyStatus.Text = 'Could not save or check the withdrawal request.' }
    finally { $form.UseWaitCursor = $false }
})

if ($script:saved) { $site.Text = $script:saved.Origin }
Update-ReportConsent
$timer = [Windows.Forms.Timer]::new()
$timer.Interval = 2000
$timer.Add_Tick({ if ($tabs.SelectedTab -eq $historyTab) { Update-ReportHistoryStatus } })
$timer.Start()
try { [void]$form.ShowDialog() } finally {
    $timer.Dispose()
    $form.Dispose()
    if ($script:saved) {
        $script:saved.Key.Dispose()
        $script:saved.Consent.Token.Dispose()
    }
}
