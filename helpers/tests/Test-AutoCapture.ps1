Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$helper = Split-Path $PSScriptRoot -Parent
. (Join-Path $helper 'AutoCapture.Common.ps1')

function Assert-True($Condition, [string]$Message) {
    if (!$Condition) { throw $Message }
}

function New-Line([string]$Text, [double]$Center, [double]$Y, [double]$Width = 70, [double]$Height = 14) {
    return @{ text = $Text; x = $Center - $Width / 2; y = $Y; width = $Width; height = $Height }
}

function New-Ocr([array]$Lines, [string]$Status = 'ok') {
    return @{ status = $Status; text = ($Lines.text -join "`n"); lines = $Lines; language = 'en-US' }
}

function Test-Probe([array]$Lines, [string]$Expected) {
    $probe = Get-FateOfferProbe (New-Ocr $Lines) 950 520
    Assert-True ($probe.Status -ceq $Expected) "Expected '$Expected', got '$($probe.Status)'."
    if ($Expected -eq 'offer') {
        Assert-True ($probe.Signature -cmatch '\A[0-9a-f]{64}\z') 'Offer lacked a stable signature.'
    } else {
        Assert-True (!$probe.Signature) 'An unrecognized scan advertised a signature.'
    }
    return $probe.Signature
}

$heading = New-Line 'Fates' 475 26 50
$confirm = New-Line 'Confirm' 475 430 80
$boundaries = @($heading, $confirm)
$headers = @(
    (New-Line 'Alchemist' 145 114), (New-Line 'Sanguine' 365 114)
    (New-Line 'Butcher' 585 114), (New-Line 'Gravewalker' 805 114)
)
$copy = @(
    (New-Line 'Creates boiling' 145 299 120), (New-Line 'Creates a deadly ring' 365 299 140)
    (New-Line 'Flings projectiles' 585 299 130), (New-Line 'Creates fissures' 805 299 120)
)
$sample = $boundaries + $headers + $copy
$signature = Test-Probe $sample 'offer'
$raised = @(
    (New-Line 'alchemist' 148 115), (New-Line 'Sanguine' 367 113)
    (New-Line 'Butcher' 583 114), (New-Line 'Gravewalker' 805 91)
)
$jitter = Test-Probe ($boundaries + $raised + (New-Line 'Selection details' 805 300) +
    (New-Line 'Alchemist' 475 480) + (New-Line 'Select a Fate' 110 15 90)) 'offer'
Assert-True ($jitter -ceq $signature) 'Selection motion, copy changes, a world label or collected names changed the signature.'
$changed = Test-Probe ($boundaries + $headers[0..2] + (New-Line 'Dryad' 805 114) + $copy) 'offer'
Assert-True ($changed -cne $signature) 'A changed offered Fate did not change the signature.'
$swapped = Test-Probe ($boundaries + @((New-Line 'Sanguine' 145 114), (New-Line 'Alchemist' 365 114)) + $headers[2..3] + $copy) 'offer'
Assert-True ($swapped -cne $signature) 'Swapping card positions did not change the signature.'
[void](Test-Probe (@((New-Line 'Select a Fate' 475 26 90), $confirm, (New-Line 'Black Frost' 475 114))) 'offer')
[void](Test-Probe ($boundaries + @((New-Line 'Butcher' 365 114), (New-Line 'Butcher' 585 114))) 'offer')
[void](Test-Probe @((New-Line 'Abandoned Canal' 610 48 120), (New-Line 'Portal' 890 390)) 'empty')
[void](Test-Probe @((New-Line 'Confirm' 475 430)) 'uncertain')
[void](Test-Probe @((New-Line 'Confir' 475 430)) 'uncertain')
[void](Test-Probe @((New-Line 'Alchemist' 475 480)) 'uncertain')
[void](Test-Probe ($boundaries + (New-Line 'Alchemist' 475 480)) 'uncertain')
[void](Test-Probe ($headers + $copy) 'uncertain')
[void](Test-Probe ($sample + (New-Line 'Confirm' 475 416)) 'uncertain')
[void](Test-Probe ($sample + (New-Line 'Select a Fate' 475 9)) 'uncertain')
[void](Test-Probe ($sample + (New-Line 'Invoke Fates' 475 9 100)) 'uncertain')
[void](Test-Probe ($sample + (New-Line 'Invoke' 475 8 45)) 'uncertain')
[void](Test-Probe ($sample + (New-Line 'Invoke' 420 26 45)) 'uncertain')
[void](Test-Probe ($sample + (New-Line 'Junk' 150 520)) 'uncertain')
[void](Test-Probe ($boundaries + $headers[0..2] + (New-Line 'Gravewaker' 805 114) + $copy) 'uncertain')
[void](Test-Probe ($boundaries + $headers[0..2] + (New-Line 'Gravewa1ker' 805 114) + $copy) 'uncertain')
[void](Test-Probe ($boundaries + $headers[0..2] + $copy) 'uncertain')
[void](Test-Probe ($boundaries + $headers[0..2]) 'uncertain')
[void](Test-Probe ($boundaries + $headers[0] + $headers[2..3] + $copy) 'uncertain')
[void](Test-Probe ($boundaries + $headers + (New-Line 'Golemancer' 590 115) + $copy) 'uncertain')
$ten = @(0..9 | ForEach-Object { New-Line 'Butcher' (70 + 90 * $_) 114 50 })
[void](Test-Probe ($boundaries + $ten) 'uncertain')
Assert-True ((Get-FateOfferProbe @{ status = 'ok'; text = ''; lines = @() } 950 520).Status -eq 'uncertain') 'Blank OCR was mistaken for a closed panel.'
foreach ($status in 'error', 'unavailable') {
    Assert-True ((Get-FateOfferProbe (New-Ocr $sample $status) 950 520).Status -eq 'uncertain') 'An OCR failure was mistaken for a closed panel.'
}
Write-Output 'PASS: offer identity, jitter, explicit empty, invocation, ambiguous bounds and incomplete headers.'

$fixtureDirectory = Join-Path (Join-Path $helper 'captures') ("fixture & auto " + [guid]::NewGuid())
$captureDirectory = Join-Path $fixtureDirectory 'captures'
$directory = Join-Path $captureDirectory 'stage'
$sessionId = [guid]::NewGuid().ToString()
$started = [DateTime]::UtcNow.AddSeconds(-1).ToString('yyyyMMddHHmmss')
$id = [guid]::NewGuid().ToString()
$requestText = @"
[scan]
Version=1
Id=$id
WindowHandle=42
WindowPid=40
ClientWidth=1920
ClientHeight=1080
X=300
Y=100
Width=950
Height=520
CaptureBackend=auto
CandidateSignature=
PublishedSignature=
SessionId=$sessionId
SessionStartedAt=$started
CaptureSequence=1
PreviousCapturePath=
"@

function Test-BadRequest([string]$Text) {
    $failed = $false
    try { [void](ConvertFrom-FateAutoRequest $Text $captureDirectory) }
    catch { $failed = $true }
    Assert-True $failed 'An invalid request passed validation.'
}

$request = ConvertFrom-FateAutoRequest $requestText $captureDirectory
Assert-True ($request.WindowHandle -is [long] -and $request.ClientHeight -is [int] -and $request.Id -ceq $id -and
    (Get-FateAutoRequestId $requestText) -ceq $id) 'Could not read version 1 scan request.'
Test-BadRequest ($requestText.Replace('Version=1', 'Version=2'))
Test-BadRequest ($requestText.Replace('CaptureBackend=auto', 'CaptureBackend=other'))
Test-BadRequest ($requestText.Replace('CandidateSignature=', 'CandidateSignature=not-a-signature'))
Test-BadRequest ($requestText.Replace('Y=100', 'Y=-1'))
Test-BadRequest ($requestText.Replace('X=300', 'X=2147483648'))
Test-BadRequest ($requestText.Replace('X=300', 'X=1200'))
Test-BadRequest ($requestText.Replace('Width=950', 'Width=8193'))
Test-BadRequest ($requestText.Replace('CaptureSequence=1', 'CaptureSequence=0'))
Test-BadRequest ($requestText.Replace("SessionStartedAt=$started", 'SessionStartedAt=20004399112233'))
foreach ($prefix in 'fate-', 'auto-fate-') {
    $filename = $prefix + $id + '.json'
    Test-BadRequest ($requestText.Replace('PreviousCapturePath=', "PreviousCapturePath=$captureDirectory\..\$filename"))
    Test-BadRequest ($requestText.Replace('PreviousCapturePath=', "PreviousCapturePath=$captureDirectory\stage\$filename"))
    Test-BadRequest ($requestText.Replace('PreviousCapturePath=', "PreviousCapturePath=$captureDirectory\${filename}:stream"))
}
Test-BadRequest ($requestText + "`nWidth=300")
Test-BadRequest ($requestText + "`n" + ' ' * 4096)
Write-Output 'PASS: bounded request protocol, geometry, timestamps and previous-file paths.'

# Inject only the OS operations. Use the real probe, candidate writer and capture
# context with fixture OCR and a PNG generated locally for this test.
function Get-FateAreaSnapshot([int]$WindowPid) { return }
function Get-FateWindowPng {
    param($WindowHandle, $WindowPid, $ClientWidth, $ClientHeight, $X, $Y, $Width, $Height, $CaptureBackend, $CompilerDirectory, $FailureCode)
    return ,$fixturePng
}
function Get-FateAutoOrigin($Request) {
    $script:originChecks++
    if ($script:originChecks -ge $script:loseFocusOnCheck) { throw 'Fixture foreground changed.' }
    return @{ X = 300; Y = 100 }
}
function Get-OcrResult($Png, $ImageWidth, $ImageHeight) { return $script:fixtureOcr }

Add-Type -AssemblyName System.Drawing
$bitmap = [Drawing.Bitmap]::new(950, 520)
$memory = [IO.MemoryStream]::new()
try {
    $bitmap.Save($memory, [Drawing.Imaging.ImageFormat]::Png)
    $fixturePng = $memory.ToArray()
} finally {
    $memory.Dispose()
    $bitmap.Dispose()
}
[void][IO.Directory]::CreateDirectory($directory)
try {
    $parent = @{ HasExited = $false }
    $script:fixtureOcr = New-Ocr $sample
    $script:originChecks = 0
    $script:loseFocusOnCheck = [int]::MaxValue
    $first = Invoke-FateAutoScan $request $directory '1.2.3' $parent
    Assert-True ($first.Saved -eq 0 -and $first.Status -eq 'offer' -and $first.Signature -ceq $signature -and $first.ObservedAt -gt 0) 'First observation did not wait for confirmation.'
    Assert-True (!(Get-ChildItem -LiteralPath $directory -File)) 'The first observation wrote evidence.'
    Write-FateAutoResult $directory $id $first

    $request.Id = [guid]::NewGuid().ToString()
    $request.CandidateSignature = $first.Signature
    $second = Invoke-FateAutoScan $request $directory '1.2.3' $parent
    Assert-True ($second.Saved -eq 1 -and $second.Status -eq 'offer' -and $second.Signature -ceq $signature) 'Matching scans did not publish a candidate.'
    Write-FateAutoResult $directory $request.Id $second
    $result = Read-FateAutoText (Join-Path $directory 'result.ini') 1024
    Assert-True ($result -match "(?m)^Id=$($request.Id)`r?$" -and $result -match '(?m)^Saved=1\r?$' -and
        $result -match '(?m)^ObservedAt=[0-9]{13}\r?$') 'The result was not replaced with the new scan status.'
    $path = Join-Path $directory ("fate-" + $request.Id + '.json')
    $bundle = Read-FateAutoText $path 12MB | ConvertFrom-Json
    Assert-True ($bundle.kind -eq 'fate-collector.capture' -and $bundle.schemaVersion -eq 1 -and $bundle.captureId -ceq $request.Id -and
        $bundle.source -eq 'windows-helper' -and $bundle.helperVersion -eq '1.2.3' -and $bundle.image.frameHeight -eq 1080 -and
        $bundle.image.width -eq 950 -and $bundle.image.height -eq 520 -and $bundle.context.captureMode -eq 'game' -and
        $bundle.context.area.category -eq 'unknown' -and $bundle.context.session.id -eq $sessionId -and $bundle.context.session.sequence -eq 1 -and
        $bundle.image.dataBase64 -ceq [Convert]::ToBase64String($fixturePng) -and $bundle.ocr.lines.Count -eq $sample.Count) 'The candidate lost capture or session evidence.'

    $request.Id = [guid]::NewGuid().ToString()
    $request.PublishedSignature = $signature
    $repeat = Invoke-FateAutoScan $request $directory '1.2.3' $parent
    Assert-True ($repeat.Saved -eq 0 -and $repeat.Signature -ceq $signature) 'A published offer saved another candidate.'
    foreach ($prefix in 'fate-', 'auto-fate-') {
        $priorPath = Join-Path $captureDirectory ($prefix + $bundle.captureId + '.json')
        [IO.File]::Copy($path, $priorPath)
        $duplicateId = [guid]::NewGuid().ToString()
        $duplicateText = $requestText.Replace("Id=$id", "Id=$duplicateId").Replace('CaptureSequence=1', 'CaptureSequence=2').
            Replace('CandidateSignature=', "CandidateSignature=$signature").Replace('PreviousCapturePath=', "PreviousCapturePath=$priorPath")
        $duplicateRequest = ConvertFrom-FateAutoRequest $duplicateText $captureDirectory
        Assert-True ($duplicateRequest.PreviousCapturePath -ceq $priorPath) "Previous capture path was not preserved for $prefix."
        $duplicate = Invoke-FateAutoScan $duplicateRequest $directory '1.2.3' $parent
        $repeatBundle = Read-FateAutoText (Join-Path $directory ("fate-" + $duplicateId + '.json')) 12MB | ConvertFrom-Json
        Assert-True ($duplicate.Saved -eq 1 -and $repeatBundle.context.possibleDuplicate.ofCaptureId -ceq $bundle.captureId) "Repeat metadata was lost for $prefix."
    }

    $request.Id = [guid]::NewGuid().ToString()
    $request.PublishedSignature = ''
    $script:originChecks = 0
    $script:loseFocusOnCheck = 3
    $focusLost = Invoke-FateAutoScan $request $directory '1.2.3' $parent
    Assert-True ($focusLost.Saved -eq 0 -and $focusLost.Status -eq 'error' -and $script:originChecks -eq 3) 'Focus loss before response did not invalidate evidence.'

    $script:loseFocusOnCheck = [int]::MaxValue
    $oldAge = $script:FateAutoMaxAgeMs
    try {
        $script:FateAutoMaxAgeMs = -1
        $expired = Invoke-FateAutoScan $request $directory '1.2.3' $parent
        Assert-True ($expired.Saved -eq 0 -and $expired.Status -eq 'error') 'A stale frame was accepted.'
    } finally { $script:FateAutoMaxAgeMs = $oldAge }

    $script:fixtureOcr = New-Ocr @((New-Line 'Blood Aqueduct' 475 26)) 'ok'
    $closed = Invoke-FateAutoScan $request $directory '1.2.3' $parent
    Assert-True ($closed.Saved -eq 0 -and $closed.Status -eq 'empty') 'A negative scan saved evidence.'
    Assert-True (@(Get-ChildItem -LiteralPath $directory -File).Count -eq 4) 'A failed or negative scan left a candidate, image or temporary file.'
    Write-Output 'PASS: atomic responses, stable confirmed evidence, duplicate metadata, stale frame and foreground rejection.'
} finally {
    Get-ChildItem -LiteralPath $directory -File | ForEach-Object { Remove-Item -LiteralPath $_.FullName }
    Remove-Item -LiteralPath $directory
    Get-ChildItem -LiteralPath $captureDirectory -File | ForEach-Object { Remove-Item -LiteralPath $_.FullName }
    Remove-Item -LiteralPath $captureDirectory
    Remove-Item -LiteralPath $fixtureDirectory
}
