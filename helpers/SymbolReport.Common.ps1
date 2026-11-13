function Save-FateSymbolDraft {
    param(
        [Parameter(Mandatory)]$Icon,
        [Parameter(Mandatory)]$Tooltip,
        [Parameter(Mandatory)][DateTime]$CreatedAt,
        [Parameter(Mandatory)][ValidateSet('live', 'test')][string]$Origin,
        [guid]$CaptureId = [guid]::Empty,
        [Parameter(Mandatory)][string]$OutputDirectory
    )

    $helperVersion = '0.5.0'
    $draftId = [guid]::NewGuid()
    $draft = [ordered]@{
        kind = 'fate-collector.symbol-draft'
        schemaVersion = 1
        id = $draftId.ToString()
        createdAt = $CreatedAt.ToUniversalTime().ToString('o', [Globalization.CultureInfo]::InvariantCulture)
        helperVersion = $helperVersion
        origin = $Origin
        captureId = if ($Origin -eq 'live' -and $CaptureId -ne [guid]::Empty) { $CaptureId.ToString() } else { $null }
        icon = @{
            mimeType = 'image/png'
            width = $Icon.Bounds.Width
            height = $Icon.Bounds.Height
            dataBase64 = [Convert]::ToBase64String($Icon.Png)
        }
        tooltip = @{
            mimeType = 'image/png'
            width = $Tooltip.Bounds.Width
            height = $Tooltip.Bounds.Height
            dataBase64 = [Convert]::ToBase64String($Tooltip.Png)
        }
    }
    $json = $draft | ConvertTo-Json -Depth 4 -Compress
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($json)
    if ($bytes.Length -gt 640KB) { throw 'The draft is too large. Select tighter crops.' }

    $directory = [IO.Directory]::CreateDirectory($OutputDirectory)
    $path = Join-Path $directory.FullName ("symbol-$draftId.json")
    $pending = $path + '.part'
    $file = [IO.File]::Open($pending, [IO.FileMode]::CreateNew)
    try {
        try { $file.Write($bytes, 0, $bytes.Length) }
        finally { $file.Dispose() }
        [IO.File]::Move($pending, $path)
    } finally {
        [IO.File]::Delete($pending)
    }
    return @{ Path = $path; Json = $json }
}
