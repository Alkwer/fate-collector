param(
    [string]$CapturesDirectory = (Join-Path $PSScriptRoot 'captures'),
    [string]$StateDirectory = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'FateCollector'),
    [switch]$AllowLocalTestEndpoint,
    [switch]$ForceRetry,
    [string]$FeedbackCaptureId,
    [string]$FeedbackPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'CloudUpload.Common.ps1')

$failed = $false
try {
    Invoke-FateCaptureUploads -CapturesDirectory $CapturesDirectory -StateDirectory $StateDirectory `
        -AllowLocalTestEndpoint:$AllowLocalTestEndpoint -ForceRetry:$ForceRetry
} catch {
    # Never print exception details: they can include HTTP headers or capture data.
    [Console]::Error.WriteLine('Cloud upload could not run. Check the upload settings and local folder permissions.')
    $failed = $true
} finally {
    if ($FeedbackCaptureId -and $FeedbackPath) {
        try {
            Write-FateCaptureUploadFeedback -StateDirectory $StateDirectory -CaptureId $FeedbackCaptureId -Path $FeedbackPath `
                -AllowLocalTestEndpoint:$AllowLocalTestEndpoint -Failed:$failed
        } catch {
            [Console]::Error.WriteLine('Could not update upload feedback. The local capture is preserved.')
            $failed = $true
        }
    }
}
if ($failed) { exit 1 }
