Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$helperDirectory = Split-Path $PSScriptRoot -Parent
. (Join-Path $helperDirectory 'Ocr.Common.ps1')

function New-Line([string]$Text, [double]$X, [double]$Y = 20) {
    return @{ text = $Text; x = $X; y = $Y; width = 60; height = 12 }
}

function New-Pass([hashtable[]]$Lines) {
    return @{ text = ($Lines.text -join "`n"); lines = $Lines }
}

function Assert-Pass($Original, $Normalized, $Expected, [string]$Message) {
    $chosen = Select-FateOcrPass $Original $Normalized @('Alchemist', 'Sanguine', 'Butcher', 'Tempest')
    if (![object]::ReferenceEquals($chosen, $Expected)) { throw $Message }
}

$original = New-Pass @((New-Line 'ALCHEMIST' 20), (New-Line 'Unkn0wn Card' 250))
$improved = New-Pass @((New-Line 'Alche-mist' 24 21), (New-Line 'Butcher' 140), (New-Line 'Unkn0wn Card' 250))
$blank = New-Pass @((New-Line '   ' 20))
Assert-Pass $original $null $original 'Missing normalized pass should keep the original.'
Assert-Pass $original $blank $original 'Blank normalized pass should keep the original.'
Assert-Pass $null $improved $improved 'With no original pass, retain available normalized output.'
Assert-Pass $blank $improved $improved 'With a blank original pass, retain available normalized output.'
Assert-Pass $null $null $null 'Two missing passes should remain missing.'
Assert-Pass $original $improved $improved 'A new known header without losing the original should improve the pass.'

$tie = New-Pass @((New-Line 'Alchemist' 20), (New-Line 'Unkn0wn Card' 250))
Assert-Pass $original $tie $original 'An equal known-header count should keep the original.'
$conflict = New-Pass @((New-Line 'Sanguine' 20), (New-Line 'Unkn0wn Card' 250))
Assert-Pass $original $conflict $original 'A conflicting replacement header should keep the original.'
$overlappingConflict = New-Pass @((New-Line 'Alchemist' 20), (New-Line 'Sanguine' 25 21), (New-Line 'Butcher' 140))
Assert-Pass $original $overlappingConflict $original 'An added known name overlapping an original header should keep the original.'
$lost = New-Pass @((New-Line 'Sanguine' 140), (New-Line 'Butcher' 250))
Assert-Pass $original $lost $original 'More known headers should not outweigh the loss of an original header.'
$movedX = New-Pass @((New-Line 'Alchemist' 300), (New-Line 'Butcher' 140))
Assert-Pass $original $movedX $original 'A known header moved to another column should keep the original.'
$movedY = New-Pass @((New-Line 'Alchemist' 20 90), (New-Line 'Butcher' 140))
Assert-Pass $original $movedY $original 'A known header moved to another row should keep the original.'

$repeated = New-Pass @((New-Line 'Alchemist' 20), (New-Line 'Alchemist' 145))
$moreRepeated = New-Pass @((New-Line 'Alchemist' 20), (New-Line 'Alchemist' 145), (New-Line 'Tempest' 250))
Assert-Pass $repeated $moreRepeated $moreRepeated 'Known names can repeat at separate positions.'
$overlappingOriginal = New-Pass @((New-Line 'Alchemist' 20), (New-Line 'Alchemist' 22))
$oneMatch = New-Pass @((New-Line 'Alchemist' 21), (New-Line 'Butcher' 145), (New-Line 'Tempest' 250))
Assert-Pass $overlappingOriginal $oneMatch $overlappingOriginal 'One normalized header must not satisfy two original matches.'

$unknown = New-Pass @((New-Line 'Unkn0wn Card' 250))
$nearMatch = New-Pass @((New-Line 'Alchem1st' 250), (New-Line 'Sangu1ne' 140))
Assert-Pass $unknown $nearMatch $unknown 'A near match should not count as a known header.'
Assert-Pass $null $nearMatch $nearMatch 'The only OCR pass should preserve its exact unknown text.'
Write-Output 'PASS: OCR fallback, conservative header matching, repeated names, and unknown text preservation.'
