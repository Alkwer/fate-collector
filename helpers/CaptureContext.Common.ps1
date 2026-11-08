# Session identity describes a helper/game session, not an in-game encounter.
$script:FateContextGuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

function ConvertTo-FateCaptureContext($Context, [string]$CaptureId) {
    $result = [ordered]@{ captureMode = $Context.captureMode }
    if ($Context.PSObject.Properties['session']) {
        $session = $Context.session
        if (!$session -or $session.id -isnot [string] -or $session.id -cnotmatch "\A$script:FateContextGuid\z" -or
            $session.startedAt -isnot [string] -or $session.startedAt -cnotmatch '\A\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|[+-]\d\d:\d\d)\z' -or
            $session.sequence -isnot [int] -or $session.sequence -lt 1 -or $session.sequence -gt 1000000000) {
            throw 'Invalid capture session.'
        }
        $time = [DateTimeOffset]::MinValue
        if (![DateTimeOffset]::TryParse($session.startedAt, [ref]$time)) { throw 'Invalid session time.' }
        $result.session = [ordered]@{ id = $session.id; startedAt = $session.startedAt; sequence = $session.sequence }
    }
    if ($Context.PSObject.Properties['possibleDuplicate']) {
        $repeat = $Context.possibleDuplicate
        if (!$repeat -or $repeat.ofCaptureId -isnot [string] -or $repeat.ofCaptureId -cnotmatch "\A$script:FateContextGuid\z" -or
            $repeat.ofCaptureId -ieq $CaptureId -or $repeat.reason -cne 'same-ocr-within-15s') { throw 'Invalid possible repeat.' }
        $result.possibleDuplicate = [ordered]@{ ofCaptureId = $repeat.ofCaptureId; reason = $repeat.reason }
    }
    return $result
}

function New-FateCaptureContext {
    param([string]$Mode, [string]$CaptureId, [DateTimeOffset]$CapturedAt, [string]$SessionId,
        [string]$SessionStartedAt, [int]$Sequence, $Ocr, [int]$Width, [int]$Height, $Previous)
    $context = [ordered]@{ captureMode = $Mode }
    if (!$SessionId -and !$SessionStartedAt -and !$Sequence) { return $context }
    if ($SessionId -cnotmatch "\A$script:FateContextGuid\z" -or $Sequence -lt 1 -or $Sequence -gt 1000000000) {
        throw 'Invalid capture session arguments.'
    }
    $started = [DateTimeOffset]::ParseExact($SessionStartedAt, 'yyyyMMddHHmmss',
        [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal)
    if ($started -gt $CapturedAt) { throw 'Session starts after capture.' }
    $context.session = [ordered]@{ id = $SessionId; startedAt = $started.ToString('o'); sequence = $Sequence }
    # A suspicion only: retain both captures. Blank/failed OCR is never evidence of a repeat.
    if ($Previous -and $Ocr.status -eq 'ok' -and ![string]::IsNullOrWhiteSpace($Ocr.text)) {
        try {
            $age = ($CapturedAt - [DateTimeOffset]::Parse($Previous.capturedAt)).TotalSeconds
            $text = [regex]::Replace($Ocr.text.Trim(), '\s+', ' ').ToUpperInvariant()
            $priorText = [regex]::Replace($Previous.ocr.text.Trim(), '\s+', ' ').ToUpperInvariant()
            if ($Previous.kind -eq 'fate-collector.capture' -and $Previous.captureId -cne $CaptureId -and
                $Previous.captureId -cmatch "\A$script:FateContextGuid\z" -and
                $Previous.context.captureMode -ceq $Mode -and $Previous.context.session.id -ceq $SessionId -and
                $Previous.context.session.sequence -eq ($Sequence - 1) -and $age -ge 0 -and $age -le 15 -and
                $Previous.image.width -eq $Width -and $Previous.image.height -eq $Height -and
                $Previous.ocr.status -eq 'ok' -and $text -ceq $priorText) {
                $context.possibleDuplicate = [ordered]@{ ofCaptureId = $Previous.captureId; reason = 'same-ocr-within-15s' }
            }
        } catch {
            # An old/missing/corrupt previous capture cannot establish a repeat. Preserve the new capture.
        }
    }
    return $context
}
