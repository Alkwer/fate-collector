Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'CaptureContext.Common.ps1')
function Assert-Context($Condition, [string]$Message) { if (!$Condition) { throw $Message } }
$session = [guid]::NewGuid().ToString()
$id = [guid]::NewGuid().ToString()
$priorId = [guid]::NewGuid().ToString()
$now = [DateTimeOffset]::UtcNow
$ocr = [pscustomobject]@{ status = 'ok'; text = "TORCHBEARER`n100% increased rewards" }
$prior = [pscustomobject]@{
    kind = 'fate-collector.capture'; captureId = $priorId; capturedAt = $now.AddSeconds(-15).ToString('o')
    context = [pscustomobject]@{ captureMode = 'game'; session = [pscustomobject]@{ id = $session; sequence = 1 } }
    image = [pscustomobject]@{ width = 800; height = 400 }
    ocr = [pscustomobject]@{ status = 'ok'; text = 'Torchbearer  100% increased rewards' }
}
$argsForContext = @{ Mode='game'; CaptureId=$id; CapturedAt=$now; SessionId=$session
    SessionStartedAt=$now.AddMinutes(-1).ToString('yyyyMMddHHmmss'); Sequence=2; Ocr=$ocr; Width=800; Height=400; Previous=$prior }
$result = New-FateCaptureContext @argsForContext
Assert-Context ($result.session.sequence -eq 2 -and $result.session.id -ceq $session) 'Session identity/sequence lost.'
Assert-Context ($result.possibleDuplicate.ofCaptureId -ceq $priorId -and $result.possibleDuplicate.reason -eq 'same-ocr-within-15s') 'Near repeat was not flagged.'
$prior.capturedAt = $now.AddSeconds(-15.001).ToString('o')
Assert-Context (!(New-FateCaptureContext @argsForContext).Contains('possibleDuplicate')) 'Old identical offer was flagged.'
$prior.capturedAt = $now.AddSeconds(1).ToString('o')
Assert-Context (!(New-FateCaptureContext @argsForContext).Contains('possibleDuplicate')) 'Future capture was flagged.'
$prior.capturedAt = $now.AddSeconds(-1).ToString('o')
$prior.ocr.text = 'Torchbearer 101% increased rewards'
Assert-Context (!(New-FateCaptureContext @argsForContext).Contains('possibleDuplicate')) 'Different modifier was flagged.'
$prior.ocr.text = $ocr.text
$prior.context.session.id = [guid]::NewGuid().ToString()
Assert-Context (!(New-FateCaptureContext @argsForContext).Contains('possibleDuplicate')) 'Separate session was flagged.'
$prior.context.session.id = $session
$prior.image.width = 801
Assert-Context (!(New-FateCaptureContext @argsForContext).Contains('possibleDuplicate')) 'Different crop was flagged.'
$prior.image.width = 800
$prior.context.session.sequence = 0
Assert-Context (!(New-FateCaptureContext @argsForContext).Contains('possibleDuplicate')) 'Nonconsecutive capture was flagged.'
$prior.context.session.sequence = 1
$ocr.status = 'error'
Assert-Context (!(New-FateCaptureContext @argsForContext).Contains('possibleDuplicate')) 'Failed OCR was flagged.'
$ocr.status = 'ok'; $ocr.text = '   '
Assert-Context (!(New-FateCaptureContext @argsForContext).Contains('possibleDuplicate')) 'Blank OCR was flagged.'
$argsForContext.Previous = [pscustomobject]@{ kind = 'broken' }
Assert-Context (!(New-FateCaptureContext @argsForContext).Contains('possibleDuplicate')) 'Corrupt evidence broke capture.'
$contextObject = $result | ConvertTo-Json -Depth 5 | ConvertFrom-Json
$projected = ConvertTo-FateCaptureContext $contextObject $id
Assert-Context ($projected.session.id -ceq $session -and $projected.possibleDuplicate.ofCaptureId -ceq $priorId) 'Projection lost session/repeat.'
$contextObject.possibleDuplicate.ofCaptureId = $id
$rejected = $false
try { [void](ConvertTo-FateCaptureContext $contextObject $id) } catch { $rejected = $true }
Assert-Context $rejected 'Self-referencing repeat was accepted.'
Write-Output 'PASS: automatic session context; repeat window, content, crop, session, sequence and failed-OCR boundaries.'
