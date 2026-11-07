param(
    [string]$CapturesDirectory = (Join-Path $PSScriptRoot 'captures'),
    [string]$StateDirectory = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'FateCollector'),
    [switch]$AllowLocalTestEndpoint,
    [switch]$ForceRetry
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'CloudUpload.Common.ps1')

try {
    Invoke-FateCaptureUploads -CapturesDirectory $CapturesDirectory -StateDirectory $StateDirectory `
        -AllowLocalTestEndpoint:$AllowLocalTestEndpoint -ForceRetry:$ForceRetry
} catch {
    # Never print exception details: they can include HTTP headers or capture data.
    [Console]::Error.WriteLine('Cloud upload could not run. Check the upload settings and local folder permissions.')
    exit 1
}
