# Local OCR-only adapter. No capture bundle, upload or game input.
# OCR functions copied from helpers/Export-FateCapture.ps1 (helper 0.2.0).
# See ../../helpers/LICENSE.one-more-map.txt for upstream attribution.
param([Parameter(Mandatory)][string]$InputImage,
      [Parameter(Mandatory)][string]$OutputJson,
      [string]$OcrLanguage)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Wait-WinRtResult($Operation, [type]$ResultType) {
    $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    return $task.GetAwaiter().GetResult()
}

function Get-OcrResult([byte[]]$Png, [int]$ImageWidth, [int]$ImageHeight) {
    $ocr = [ordered]@{ status = 'unavailable'; text = ''; lines = @(); language = $null }
    try {
        Add-Type -AssemblyName System.Runtime.WindowsRuntime
        [void][Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
        [void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
        [void][Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
        [void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
        [void][Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]

        $languages = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages)
        if ($OcrLanguage) {
            $language = $languages | Where-Object LanguageTag -EQ $OcrLanguage | Select-Object -First 1
            if ($null -eq $language) { return $ocr }
            $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
        } else {
            $english = $languages | Where-Object LanguageTag -Match '^en(-|$)' |
                Sort-Object { if ($_.LanguageTag -eq 'en-US') { 0 } else { 1 } } | Select-Object -First 1
            $engine = if ($null -ne $english) { [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($english) }
            if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
            if ($null -eq $engine -and $languages.Count -gt 0) {
                $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($languages[0])
            }
        }
        if ($null -eq $engine) { return $ocr }
    } catch {
        Write-Verbose ("Windows OCR is unavailable. " + $_.Exception.Message)
        return $ocr
    }

    $ocr.status = 'error'
    try {
        $ocr.language = [string]$engine.RecognizerLanguage.LanguageTag
        $maxDimension = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
        if ($ImageWidth -gt $maxDimension -or $ImageHeight -gt $maxDimension) {
            throw "The capture exceeds the Windows OCR dimension limit ($maxDimension px)."
        }

        $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
            $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
            $_.GetParameters().Count -eq 1
        } | Select-Object -First 1
        $memory = [System.IO.MemoryStream]::new($Png, $false)
        try {
            $stream = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($memory)
            try {
                $decoder = Wait-WinRtResult ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
                $bitmap = Wait-WinRtResult ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
                try {
                    $recognized = Wait-WinRtResult ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
                } finally {
                    $bitmap.Dispose()
                }
            } finally {
                $stream.Dispose()
            }
        } finally {
            $memory.Dispose()
        }

        $lines = @(
            foreach ($line in $recognized.Lines) {
                $left = [double]$ImageWidth
                $top = [double]$ImageHeight
                $right = $bottom = 0.0
                foreach ($word in $line.Words) {
                    $rect = $word.BoundingRect
                    $left = [Math]::Min($left, [Math]::Max(0.0, $rect.X))
                    $top = [Math]::Min($top, [Math]::Max(0.0, $rect.Y))
                    $right = [Math]::Max($right, [Math]::Min($ImageWidth, $rect.X + $rect.Width))
                    $bottom = [Math]::Max($bottom, [Math]::Min($ImageHeight, $rect.Y + $rect.Height))
                }
                if ($right -gt $left -and $bottom -gt $top) {
                    [ordered]@{ text = [string]$line.Text; x = $left; y = $top; width = $right - $left; height = $bottom - $top }
                }
            }
        )
        $text = [string](($lines | ForEach-Object { $_.text }) -join "`n")
        if ($lines.Count -gt 500 -or $text.Length -gt 20000 -or @($lines | Where-Object { $_.text.Length -gt 2000 }).Count -gt 0) {
            throw 'Windows OCR returned too much text. Choose a tighter crop.'
        }
        $ocr.status = 'ok'
        $ocr.text = $text
        $ocr.lines = $lines
    } catch {
        Write-Verbose ("Windows OCR failed. " + $_.Exception.Message)
    }
    return $ocr
}

if ([IO.Path]::GetFullPath($InputImage) -eq [IO.Path]::GetFullPath($OutputJson)) {
    throw 'Input and output must differ.'
}
$sourceFile = Get-Item -LiteralPath $InputImage
if ($sourceFile.Length -gt 64MB) { throw 'Image exceeds 64 MiB.' }
Add-Type -AssemblyName System.Drawing
$png = [IO.File]::ReadAllBytes($sourceFile.FullName)
$memory = [IO.MemoryStream]::new($png, $false)
try {
    $source = [Drawing.Image]::FromStream($memory)
    try {
        $width = $source.Width
        $height = $source.Height
        if ($width -gt 8192 -or $height -gt 8192 -or ([long]$width * $height) -gt 16777216) {
            throw 'Image dimensions exceed the prototype limit.'
        }
    } finally { $source.Dispose() }
} finally { $memory.Dispose() }
$ocr = Get-OcrResult -Png $png -ImageWidth $width -ImageHeight $height
$record = [ordered]@{ ocr = $ocr; ocrEngine = 'Windows.Media.Ocr'; ocrAdapterVersion = 1 }
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputJson), ($record | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
