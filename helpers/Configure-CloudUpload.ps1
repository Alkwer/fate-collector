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
$form.ClientSize = [Drawing.Size]::new(510, 258)

function Add-DialogLabel([string]$Text, [int]$Top, [int]$Height = 20) {
    $label = [Windows.Forms.Label]::new()
    $label.Text = $Text
    $label.SetBounds(16, $Top, 478, $Height)
    $form.Controls.Add($label)
    return $label
}

function Add-DialogTextBox([int]$Top) {
    $field = [Windows.Forms.TextBox]::new()
    $field.SetBounds(16, $Top, 478, 24)
    $form.Controls.Add($field)
    return $field
}

function Add-DialogButton([string]$Text, [int]$Left, [int]$Width) {
    $button = [Windows.Forms.Button]::new()
    $button.Text = $Text
    $button.SetBounds($Left, 212, $Width, 29)
    $form.Controls.Add($button)
    return $button
}

[void](Add-DialogLabel 'New F9 captures send OCR text and capture metadata to this site. Images stay local.' 16 30)
$status = Add-DialogLabel 'Cloud upload is off.' 48 33
[void](Add-DialogLabel 'HTTPS site origin (for example, https://collector.example)' 82)
$origin = Add-DialogTextBox 103
$origin.AccessibleName = 'HTTPS site origin'
[void](Add-DialogLabel 'Upload key' 141)
$key = Add-DialogTextBox 162
$key.AccessibleName = 'Upload key'
$key.UseSystemPasswordChar = $true
$key.MaxLength = 512

$disable = Add-DialogButton 'Disable upload' 16 110
$enable = Add-DialogButton 'Enable upload' 280 110
$close = Add-DialogButton 'Close' 399 95
$close.DialogResult = 'Cancel'
$form.AcceptButton = $enable
$form.CancelButton = $close

$disable.Enabled = [IO.File]::Exists((Join-Path $StateDirectory 'upload.clixml'))
try {
    $saved = Get-FateUploadConfiguration $StateDirectory
    if ($saved) {
        $origin.Text = $saved.Origin
        $scope = Join-Path $StateDirectory $saved.Scope
        $states = Join-Path $scope 'states'
        $queue = Join-Path $scope 'queue'
        $sent = $rejected = $queued = $retrying = 0
        if ([IO.Directory]::Exists($states)) {
            foreach ($path in [IO.Directory]::EnumerateFiles($states, '*.json')) {
                switch ((Read-FateUploadState $path).status) {
                    'accepted' { $sent++ }
                    'duplicate' { $sent++ }
                    'rejected' { $rejected++ }
                    'retry' { $retrying++ }
                }
            }
        }
        if ([IO.Directory]::Exists($queue)) {
            $queued = @([IO.Directory]::EnumerateFiles($queue, '*.json')).Count
        }
        $status.Text = "Cloud upload is enabled. Sent: $sent. Queued: $queued. Rejected: $rejected."
        $gate = Read-FateUploadState (Join-Path $scope 'gate.json')
        if ($gate -and $gate.revision -ceq $saved.Revision -and $gate.status -eq 'authorization') {
            $status.Text += [Environment]::NewLine + 'Upload paused: the site rejected the key. Enter a valid key.'
        } elseif ($retrying) {
            $status.Text += [Environment]::NewLine + 'Waiting to retry queued uploads.'
        }
    }
} catch {
    $status.Text = 'The saved settings could not be read. Enter the site and key again.'
}

$enable.Add_Click({
    $secret = $null
    try {
        $site = Resolve-FateUploadOrigin $origin.Text
        if (!$key.Text) { throw 'Enter the upload key.' }
        $secret = ConvertTo-SecureString -String $key.Text -AsPlainText -Force
        Assert-FateUploadKey $secret
    } catch {
        $status.Text = $_.Exception.Message
        return
    }
    try {
        Set-FateUploadConfiguration -StateDirectory $StateDirectory -Origin $site -Key $secret
        $key.Clear()
        $form.Close()
    } catch {
        $status.Text = 'Could not save settings. If the uploader is busy, try again shortly.'
    } finally { $secret.Dispose() }
})

$disable.Add_Click({
    $answer = [Windows.Forms.MessageBox]::Show($form,
        'Disable cloud upload? Unsent captures will stay local, even if you enable upload again later.',
        'Disable cloud upload', 'YesNo', 'Question', 'Button2')
    if ($answer -ne 'Yes') { return }
    try {
        Disable-FateUpload $StateDirectory
        $key.Clear()
        $form.Close()
    } catch {
        $status.Text = 'Could not disable upload. If the uploader is busy, try again shortly.'
    }
})

try { [void]$form.ShowDialog() }
finally {
    $key.Clear()
    $form.Dispose()
}
