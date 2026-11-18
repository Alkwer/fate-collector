#Requires AutoHotkey v2.0

; Detection never selects a card or sends input to the game. The first matching
; observation only arms a candidate; the next must supply the same offer.
class FateAutoState {
    candidate := ""
    published := ""
    captureId := ""
    misses := 0
    manual := false

    Observe(status, signature := "", saved := false, id := "") {
        if status != "offer" {
            this.candidate := ""
            this.misses := status = "empty" ? this.misses + 1 : 0
            if this.misses >= 2 {
                this.published := ""
                this.captureId := ""
                this.manual := false
            }
            return this.manual ? "retain" : "watch"
        }
        this.misses := 0
        if this.manual && !this.published
            this.published := signature
        if signature = this.published && this.captureId {
            this.candidate := signature
            return "retain"
        }
        this.manual := false
        if saved && signature = this.candidate && id {
            return "publish"
        }
        this.candidate := signature
        return "watch"
    }

    CommitOffer(signature, id) {
        this.published := signature
        this.captureId := id
        this.manual := false
    }

    ManualCapture(id) {
        this.candidate := ""
        this.published := ""
        this.captureId := id
        this.misses := 0
        this.manual := true
    }
}

AutoCaptureInit() {
    global calibrationFile
    global autoCapture := {enabled: IniRead(calibrationFile, "capture", "AutoDetect", "1") != "0",
        process: 0, directory: "", request: 0, viewport: "", next: 0, state: FateAutoState(),
        marker: "", ownsMarker: false, errors: 0, fault: false, acknowledgedReset: "", browserState: ""}
    A_TrayMenu.Add "Auto-detect Fate cards", AutoCaptureToggle
    if autoCapture.enabled
        A_TrayMenu.Check "Auto-detect Fate cards"
    OnExit AutoCaptureExit
    SetTimer AutoCaptureTick, 250
}

AutoCaptureToggle(*) {
    global autoCapture, calibrationFile
    if autoCapture.fault {
        autoCapture.fault := false
        autoCapture.enabled := true
    } else {
        autoCapture.enabled := !autoCapture.enabled
    }
    autoCapture.errors := 0
    autoCapture.next := 0
    AutoCaptureStop()
    if autoCapture.enabled
        A_TrayMenu.Check "Auto-detect Fate cards"
    else {
        A_TrayMenu.Uncheck "Auto-detect Fate cards"
        AutoCaptureMarker("paused")
    }
    try IniWrite(autoCapture.enabled ? "1" : "0", calibrationFile, "capture", "AutoDetect")
    catch {
        Notice("Could not save the auto-detect setting. It applies for this session.")
    }
}

AutoCaptureExit(*) {
    AutoCaptureStop()
}

AutoCaptureStop() {
    global autoCapture
    if autoCapture.process {
        DllCall("TerminateProcess", "Ptr", autoCapture.process, "UInt", 0)
        DllCall("WaitForSingleObject", "Ptr", autoCapture.process, "UInt", 500, "UInt")
        DllCall("CloseHandle", "Ptr", autoCapture.process)
    }
    autoCapture.process := 0
    autoCapture.request := 0
    autoCapture.state.candidate := ""
    autoCapture.state.misses := 0
    ; Only this helper's newly allocated UUID directory is eligible for cleanup.
    root := A_ScriptDir "\captures\.auto\"
    directory := autoCapture.directory
    if SubStr(directory, 1, StrLen(root)) = root
        && RegExMatch(SubStr(directory, StrLen(root) + 1), "^[a-f0-9-]{36}$") {
        Loop Files directory "\*", "F" {
            try FileDelete A_LoopFileFullPath
        }
        try DirDelete directory
    }
    autoCapture.directory := ""
}

AutoCaptureManual(id := "", poe := 0, started := 0) {
    global autoCapture
    AutoCaptureStop()
    autoCapture.state := FateAutoState()
    autoCapture.marker := ""
    if id {
        autoCapture.state.ManualCapture(id)
        autoCapture.ownsMarker := true
        if poe
            autoCapture.viewport := AutoCaptureViewport(poe, started)
    }
}

AutoCaptureReset(phase := "paused") {
    global autoCapture
    AutoCaptureStop()
    autoCapture.state := FateAutoState()
    autoCapture.viewport := ""
    autoCapture.fault := false
    autoCapture.errors := 0
    autoCapture.next := 0
    autoCapture.marker := ""
    AutoCaptureMarker(phase)
}

AutoCaptureViewport(poe, started) {
    global calibration
    return Format("{},{},{},{},{},{},{},{},{},{}", poe.hwnd, poe.pid, started, poe.width, poe.height,
        calibration.first.x, calibration.first.y, calibration.last.x, calibration.last.y, FateCaptureBackend())
}

AutoCaptureMarker(phase, id := "") {
    global autoCapture, overlay
    marker := phase ":" id
    if autoCapture.marker != marker || overlay.markerFailed {
        OverlayWriteCapture(phase, id)
        autoCapture.marker := overlay.markerFailed ? "" : marker
    }
    autoCapture.ownsMarker := true
}

AutoOverlayConnected() {
    global overlay, autoCapture
    path := overlay.directory "\state.json"
    try {
        if FileGetSize(path) > 32768
            return false
        state := FileRead(path, "UTF-8")
        autoCapture.browserState := state
        if !RegExMatch(state, '(?<!\\)"writtenAt"\s*:\s*(\d+)', &match)
            return false
        ticks := Buffer(8)
        DllCall("GetSystemTimeAsFileTime", "Ptr", ticks.Ptr)
        now := (NumGet(ticks, 0, "Int64") - 116444736000000000) // 10000
        return match[1] > 0 && now - match[1] <= 12000 && match[1] - now <= 5000
    }
    return false
}

AutoJsonString(text, field) {
    return RegExMatch(text, '(?<!\\)"' field '"\s*:\s*"([^"\\]*)"', &found) ? found[1] : ""
}

AutoCaptureAreaReset() {
    global autoCapture, overlay
    state := autoCapture.browserState
    ack := AutoJsonString(state, "acknowledgedCommandId")
    if !RegExMatch(ack, "^[a-f0-9-]{36}$") || ack = autoCapture.acknowledgedReset
        || AutoJsonString(state, "status") != "busy"
        return
    try {
        path := overlay.directory "\command.json"
        if FileGetSize(path) > 1024
            return
        command := FileRead(path, "UTF-8")
        if AutoJsonString(command, "id") = ack && AutoJsonString(command, "action") = "confirm-new-area"
            && AutoJsonString(command, "clientId") = AutoJsonString(state, "clientId") {
            ; Acknowledgement of the explicit area reset permits a fresh capture
            ; even when the new area's cards have the same names as the old row.
            AutoCaptureReset("watching")
            autoCapture.acknowledgedReset := ack
        }
    }
}

AutoCaptureFailure() {
    global autoCapture
    AutoCaptureStop()
    autoCapture.errors += 1
    autoCapture.next := A_TickCount + 5000
    if autoCapture.errors >= 3 {
        autoCapture.fault := true
        Notice("Auto-detect paused after repeated read errors. Use F9, or select Auto-detect Fate cards in the tray to retry.")
    }
    if autoCapture.state.manual && autoCapture.state.captureId
        AutoCaptureMarker("saved", autoCapture.state.captureId)
    else if autoCapture.fault
        AutoCaptureMarker("paused")
    else {
        AutoCaptureMarker("watching")
    }
}

AutoCaptureTick() {
    global autoCapture, overlay, capturing, symbolReportStarting, symbolReportPid
    global previewWindows, calibration, captureSession, lastSymbolOffer
    static running := false
    if running || capturing
        return
    running := true
    Critical "On"
    try {
        eligible := autoCapture.enabled && !autoCapture.fault && overlay.enabled && !overlay.markerFailed
            && !symbolReportStarting && !(symbolReportPid && ProcessExist(symbolReportPid))
            && !previewWindows.Length && AutoOverlayConnected() && OverlayPoeActive()
        poe := 0
        if eligible {
            try {
                poe := VerifyCalibration()
                if !calibration.last
                    poe := 0
            }
        }
        if !poe {
            if autoCapture.process {
                AutoCaptureStop()
                if autoCapture.ownsMarker && !autoCapture.state.manual
                    AutoCaptureMarker(autoCapture.enabled ? "watching" : "paused")
            }
            return
        }
        AutoCaptureAreaReset()
        started := PoeProcessStarted(poe.pid)
        viewport := AutoCaptureViewport(poe, started)
        if !started
            return
        if viewport != autoCapture.viewport {
            AutoCaptureStop()
            autoCapture.viewport := viewport
            autoCapture.state := FateAutoState()
            autoCapture.marker := ""
            AutoCaptureMarker("watching")
        }
        if autoCapture.request {
            request := autoCapture.request
            result := autoCapture.directory "\result.ini"
            if FileExist(result) && FileGetSize(result) <= 2048
                && IniRead(result, "scan", "Id", "") = request.id {
                status := IniRead(result, "scan", "Status", "error")
                signature := IniRead(result, "scan", "Signature", "")
                saved := IniRead(result, "scan", "Saved", "0")
                observed := IniRead(result, "scan", "ObservedAt", "0")
                ticks := Buffer(8)
                DllCall("GetSystemTimeAsFileTime", "Ptr", ticks.Ptr)
                now := (NumGet(ticks, 0, "Int64") - 116444736000000000) // 10000
                if IniRead(result, "scan", "Version", "") != "1" || !IsInteger(observed)
                    || now - observed > 5000 || observed > now + 1000
                    || !(status = "offer" || status = "empty" || status = "uncertain")
                    || !(saved = "0" || saved = "1")
                    || (status = "offer" && !RegExMatch(signature, "^[a-f0-9]{64}$")) {
                    AutoCaptureFailure()
                    return
                }
                autoCapture.request := 0
                autoCapture.next := A_TickCount + 1500
                autoCapture.errors := 0
                decision := autoCapture.state.Observe(status, signature, saved = "1", request.id)
                if decision = "publish" {
                    source := autoCapture.directory "\fate-" request.id ".json"
                    if !FileExist(source) || FileGetSize(source) > 12 * 1024 * 1024
                        throw Error("Invalid automatic capture.")
                    ; Revalidate immediately before publishing; timer interruptions
                    ; cannot race a manual capture or a foreground/calibration change.
                    Critical "On"
                    check := GetForegroundPoe()
                    if check.hwnd != poe.hwnd || check.pid != poe.pid || check.width != poe.width || check.height != poe.height
                        || PoeProcessStarted(poe.pid) != started
                        throw Error("The game changed during detection.")
                    ; Current and older uploaders enumerate only fate-*.json.
                    ; Existing consent covers manual F9 captures, not these scans.
                    ready := A_ScriptDir "\captures\auto-fate-" request.id ".json"
                    FileMove source, ready
                    autoCapture.state.CommitOffer(signature, request.id)
                    captureSession.sequence += 1
                    captureSession.lastFile := ready
                    lastSymbolOffer := {id: request.id, pid: poe.pid, hwnd: poe.hwnd, start: started}
                    OverlayRememberGame(poe, started)
                    AutoCaptureMarker("saved", request.id)
                    RecordDiagnosticEvent("capture", "ok")
                } else if decision = "retain" {
                    AutoCaptureMarker("saved", autoCapture.state.captureId)
                } else {
                    AutoCaptureMarker("watching")
                }
                return
            }
            if A_TickCount - request.started > 15000
                AutoCaptureFailure()
            return
        }
        if A_TickCount < autoCapture.next
            return
        if !autoCapture.process {
            autoCapture.directory := A_ScriptDir "\captures\.auto\" NewCaptureId()
            DirCreate autoCapture.directory
            command := '"' WindowsPowerShellPath() '" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "'
                . A_ScriptDir '\Watch-FatePanel.ps1" -Directory "' autoCapture.directory '" -ParentPid '
                . DllCall("GetCurrentProcessId", "UInt") ' -HelperVersion 0.10.4'
            autoCapture.process := CreateFateCaptureProcess(command, A_ScriptDir)
        } else if DllCall("WaitForSingleObject", "Ptr", autoCapture.process, "UInt", 0, "UInt") != 258 {
            AutoCaptureFailure()
            return
        }
        if !captureSession || captureSession.pid != poe.pid || captureSession.sequence >= 1000000000
            captureSession := {id: NewCaptureId(), startedAt: A_NowUTC, pid: poe.pid, sequence: 0, lastFile: ""}
        id := NewCaptureId()
        ; The worker is idle here. Avoid racing Win32 INI reads against atomic
        ; replacement of the previous reply on the next request.
        resultPath := autoCapture.directory "\result.ini"
        if FileExist(resultPath)
            FileDelete resultPath
        text := "[scan]`nVersion=1`nId=" id "`nWindowHandle=" poe.hwnd "`nWindowPid=" poe.pid
            . "`nClientWidth=" poe.width "`nClientHeight=" poe.height "`nX=" calibration.first.x "`nY=" calibration.first.y
            . "`nWidth=" (calibration.last.x - calibration.first.x + 1) "`nHeight=" (calibration.last.y - calibration.first.y + 1)
            . "`nCaptureBackend=" FateCaptureBackend() "`nCandidateSignature=" autoCapture.state.candidate
            . "`nPublishedSignature=" autoCapture.state.published "`nSessionId=" captureSession.id
            . "`nSessionStartedAt=" captureSession.startedAt "`nCaptureSequence=" (captureSession.sequence + 1)
            . "`nPreviousCapturePath=" captureSession.lastFile "`n"
        path := autoCapture.directory "\request.ini"
        file := FileOpen(path ".part", "w", "UTF-8-RAW")
        try file.Write(text)
        finally file.Close()
        if !DllCall("MoveFileExW", "Str", path ".part", "Str", path, "UInt", 0x9, "Int")
            throw OSError()
        autoCapture.request := {id: id, started: A_TickCount}
    } catch {
        AutoCaptureFailure()
    } finally {
        Critical "Off"
        running := false
    }
}
