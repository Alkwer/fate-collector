#Requires AutoHotkey v2.0
#SingleInstance Force
#Include Calibration.ahk
#Include CaptureProcess.ahk
#Include Overlay.ahk
#Include AutoCapture.ahk
#Include Desktop.ahk

; Game-window checks and panel calibration. Component attribution: THIRD_PARTY_NOTICES.md.
DllCall("SetThreadDpiAwarenessContext", "Ptr", -4, "Ptr")
CoordMode "Mouse", "Screen"
CoordMode "ToolTip", "Screen"

calibration := 0
calibrationFile := A_ScriptDir "\fate-collector.ini"
savedCalibrationAllowed := true
previewWindows := []
capturing := false
cancelled := false
uploaderPid := 0
settingsPid := 0
diagnosticsPid := 0
symbolReportPid := 0
symbolReportStarting := false
lastSymbolOffer := 0
captureSession := 0
feedbackCaptureId := ""
feedbackRepeat := false
feedbackOcr := ""
feedbackSeen := ""
uploadRequested := false
feedbackFile := A_ScriptDir "\captures\.feedback\" NewCaptureId() ".txt"
DirCreate A_ScriptDir "\captures"
A_TrayMenu.Add "Open capture folder", (*) => Run('explorer.exe "' A_ScriptDir '\captures"')
A_TrayMenu.Add "Cloud upload settings", ConfigureCloudUpload
A_TrayMenu.Add "Report a problem", ReportProblem
OverlayInit()
AutoCaptureInit()
DesktopInit()
RecordDiagnosticEvent("app-start", "ok")
SetTimer () => RunCloudUploader(), 30000
SetTimer RunCloudUploader, -200

; Leave these keys available in other applications.
#HotIf WinActive("ahk_class POEWindowClass")
F6::CalibrateTopLeft()
F7::CalibrateBottomRight()
F8::PreviewCalibration()
F9::CapturePanel()
^+F9::CaptureSymbolReport()
F10::CancelCapture()
#HotIf

#HotIf OverlayHotkeysActive()
^!1::OverlayShortcut(1, "1")
^!2::OverlayShortcut(2, "2")
^!3::OverlayShortcut(3, "3")
^!4::OverlayShortcut(4, "4")
^!5::OverlayShortcut(5, "5")
^!6::OverlayShortcut(6, "6")
^!7::OverlayShortcut(7, "7")
^!8::OverlayShortcut(8, "8")
^!9::OverlayShortcut(9, "9")
^!Enter::OverlayShortcut(10, "Enter")
^!n::OverlayShortcut(11, "n")
^!z::OverlayShortcut(12, "z")
#HotIf OverlayPoeActive()
^!o:: {
    OverlayToggle()
    KeyWait "o"
}
#HotIf

GetForegroundPoe() {
    hwnd := WinExist("A")
    window := "ahk_id " hwnd
    if !hwnd || WinGetClass(window) != "POEWindowClass"
        throw Error("Bring the Path of Exile window to the foreground.")

    imagePath := WinGetProcessPath(window)
    SplitPath imagePath, &fileName, &installDir
    archive := FileExist(installDir "\Content.ggpk")
    bundles := FileExist(installDir "\Bundles2\_.index.bin")
    if !RegExMatch(fileName, "i)^PathOfExile[_A-Za-z0-9-]*\.exe$")
        || !(archive && !InStr(archive, "D") || bundles && !InStr(bundles, "D"))
        throw Error("Could not verify the Path of Exile installation.")

    pid := WinGetPID(window)
    WinGetClientPos &left, &top, &width, &height, window
    if WinExist("A") != hwnd || width <= 0 || height <= 0
        throw Error("The game window changed during calibration.")
    return {hwnd: hwnd, pid: pid, path: imagePath, left: left, top: top, width: width, height: height}
}

GetClientPointer(poe) {
    MouseGetPos &screenX, &screenY
    x := screenX - poe.left
    y := screenY - poe.top
    if x < 0 || y < 0 || x >= poe.width || y >= poe.height
        throw Error("Move the pointer inside the game window.")
    return {x: x, y: y}
}

VerifyCalibration(preview := false) {
    global calibration, calibrationFile, captureSession, savedCalibrationAllowed
    poe := GetForegroundPoe()
    if calibration {
        previous := calibration.window
        if poe.hwnd = previous.hwnd && poe.pid = previous.pid && poe.path = previous.path
            && poe.width = previous.width && poe.height = previous.height
            return poe
    }
    saved := savedCalibrationAllowed ? ReadFateCalibration(calibrationFile) : 0
    if !saved
        throw Error("Press F6 above the Fates title and to the left of the first card.")
    rect := FateCalibrationRect(saved, poe.width, poe.height, preview)
    calibration := {window: poe, first: rect.first, last: rect.last}
    if captureSession
        captureSession.lastFile := ""
    return poe
}

PreviewCalibration() {
    global calibration, capturing
    if capturing
        return
    previousCalibration := calibration
    try {
        VerifyCalibration(true)
        ShowCalibrationFrame()
    } catch as err {
        calibration := previousCalibration
        ClearCalibrationPreview()
        Notice(err.Message)
    }
}

ShowCalibrationFrame() {
    global calibration, previewWindows, previewBounds
    ClearCalibrationPreview()
    previewBounds := ""
    ClearNotice()
    try {
        Loop 4 {
            edge := Gui("+AlwaysOnTop -Caption +ToolWindow +E0x08000020 -DPIScale")
            edge.BackColor := "EBCB73"
            previewWindows.Push(edge)
        }
        caption := Gui("+AlwaysOnTop -Caption +ToolWindow +E0x08000020 -DPIScale")
        previewWindows.Push(caption)
        caption.BackColor := "192E37"
        caption.MarginX := 10
        caption.MarginY := 6
        caption.SetFont("s10 cFFFFFF", "Segoe UI")
        caption.AddText(, "Include the Fates title, all cards, reward icons and Confirm.")
        caption.AddText("y+2 cEBCB73", calibration.last
            ? "Saved frame   |   F6 / F7  Adjust     F9  Capture"
            : "F7   Below Confirm and to the right of the last card")
        caption.Show("Hide AutoSize")
        SetTimer PositionCalibrationFrame, 50
        if calibration.last
            SetTimer ClearCalibrationPreview, -5000
        PositionCalibrationFrame()
    } catch {
        ClearCalibrationPreview()
        throw
    }
}

PositionCalibrationFrame() {
    global calibration, previewWindows, previewBounds
    if !previewWindows.Length
        return
    poe := calibration.window
    if !WinActive("ahk_id " poe.hwnd) {
        ClearCalibrationPreview()
        return
    }
    try WinGetClientPos &x, &y, &w, &h, "ahk_id " poe.hwnd
    catch TargetError {
        ClearCalibrationPreview()
        return
    }
    if w != poe.width || h != poe.height {
        ClearCalibrationPreview()
        return
    }
    left := x + calibration.first.x, top := y + calibration.first.y
    if calibration.last {
        right := x + calibration.last.x, bottom := y + calibration.last.y
    } else {
        MouseGetPos &mouseX, &mouseY
        right := Max(left, Min(mouseX, x + w - 1))
        bottom := Max(top, Min(mouseY, y + h - 1))
    }
    bounds := Format("{},{},{},{}", left, top, right, bottom)
    if bounds = previewBounds
        return
    previewBounds := bounds
    width := right - left + 1, height := bottom - top + 1
    stroke := Max(2, Round(h / 540))
    dx := Min(stroke, width), dy := Min(stroke, height)
    edges := [[left, top, width, dy], [left, bottom - dy + 1, width, dy],
        [left, top, dx, height], [right - dx + 1, top, dx, height]]
    for index, edge in edges
        previewWindows[index].Show(Format("NA x{} y{} w{} h{}", edge*))
    caption := previewWindows[5]
    caption.GetPos(, , &cw, &ch)
    cx := Max(x, Min(left, x + w - cw))
    cy := top - ch - 3 >= y ? top - ch - 3 : Min(top + dy + 3, y + h - ch)
    caption.Show(Format("NA x{} y{}", cx, cy))
}

ClearCalibrationPreview() {
    global previewWindows
    SetTimer ClearCalibrationPreview, 0
    SetTimer PositionCalibrationFrame, 0
    for outline in previewWindows
        outline.Destroy()
    previewWindows := []
}

CalibrateTopLeft() {
    global calibration, capturing, captureSession, calibrationFile, savedCalibrationAllowed
    if capturing
        return
    try {
        poe := GetForegroundPoe()
        AutoCaptureReset()
        ClearCalibrationPreview()
        calibration := 0
        savedCalibrationAllowed := false
        ClearFateCalibration(calibrationFile)
        calibration := {window: poe, first: GetClientPointer(poe), last: 0}
        if captureSession
            captureSession.lastFile := ""
        ShowCalibrationFrame()
    } catch as err {
        Notice(err.Message)
    }
}

CalibrateBottomRight() {
    global calibration, capturing, calibrationFile, savedCalibrationAllowed
    if capturing
        return
    try {
        poe := VerifyCalibration()
        last := GetClientPointer(poe)
        if last.x <= calibration.first.x || last.y <= calibration.first.y
            throw Error("The F7 corner must be to the right of and below the F6 corner.")
        selection := {window: poe, first: calibration.first, last: last}
        SaveFateCalibration(calibrationFile, selection)
        calibration := selection
        savedCalibrationAllowed := true
        AutoCaptureReset("watching")
        ShowCalibrationFrame()
    } catch as err {
        Notice(err.Message)
    }
}

CapturePanel() {
    global calibration, capturing, cancelled, captureSession
    global feedbackCaptureId, feedbackRepeat, feedbackOcr, feedbackSeen
    global lastSymbolOffer
    if capturing
        return
    AutoCaptureManual()
    capturing := true
    cancelled := false
    captureId := ""
    capturePhase := "error"
    try {
        OverlaySuspend()
        OverlayWriteCapture("capturing")
        ClearCalibrationPreview()
        poe := VerifyCalibration()
        gameStarted := PoeProcessStarted(poe.pid)
        if !calibration.last
            throw Error("Press F7 below Confirm and to the right of the last card.")
        left := calibration.first.x
        top := calibration.first.y
        width := calibration.last.x - left + 1
        height := calibration.last.y - top + 1

        captureId := NewCaptureId()
        OverlayWriteCapture("capturing", captureId)
        if !captureSession || captureSession.pid != poe.pid || captureSession.sequence >= 1000000000
            captureSession := {id: NewCaptureId(), startedAt: A_NowUTC, pid: poe.pid, sequence: 0, lastFile: ""}
        captureDir := A_ScriptDir "\captures"
        ; Publish to the watched folder only after cancellation has been checked.
        outputDir := captureDir "\.pending"
        outputFile := outputDir "\fate-" captureId ".json"
        powershell := WindowsPowerShellPath()
        backend := FateCaptureBackend()
        script := A_ScriptDir "\Export-FateCapture.ps1"
        if !FileExist(powershell) || !FileExist(script)
            throw Error("Windows PowerShell or Export-FateCapture.ps1 is missing.")

        ; Quote absolute paths without trailing separators for Windows argument parsing.
        command := '"' powershell '" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "' script '"'
            . ' -OutputDirectory "' outputDir '" -CaptureId ' captureId
            . ' -WindowHandle ' poe.hwnd ' -WindowPid ' poe.pid
            . ' -ClientWidth ' poe.width ' -ClientHeight ' poe.height
            . ' -X ' left ' -Y ' top ' -Width ' width ' -Height ' height
            . ' -CaptureBackend ' backend
            . ' -SessionId ' captureSession.id ' -SessionStartedAt ' captureSession.startedAt
            . ' -CaptureSequence ' (captureSession.sequence + 1)
        if captureSession.lastFile
            command .= ' -PreviousCapturePath "' captureSession.lastFile '"'
        SetTimer ClearNotice, 0
        ToolTip
        code := RunFateCaptureProcess(command, A_ScriptDir)
        Critical "On"

        if cancelled {
            if FileExist(outputFile)
                FileDelete outputFile
            recoveryFile := outputDir "\fate-" captureId ".recovery.png"
            if FileExist(recoveryFile)
                FileDelete recoveryFile
            Notice("Capture canceled. Repeat F6 and F7.")
        } else if FileExist(outputFile) && (code = 0 || code = 10 || code = 11 || code = 12 || code = 124) {
            suffix := code = 10 ? " (OCR unavailable)" : code = 11 ? " (OCR failed)" : ""
            if FileGetSize(outputFile) > 12 * 1024 * 1024
                throw Error("Capture exceeds the supported size limit.")
            readyFile := captureDir "\fate-" captureId ".json"
            FileMove outputFile, readyFile
            capturePhase := "saved"
            AutoCaptureManual(captureId, poe, gameStarted)
            OverlayRememberGame(poe, gameStarted)
            RecordDiagnosticEvent("capture", "ok")
            captureSession.sequence += 1
            captureSession.lastFile := readyFile
            lastSymbolOffer := {id: captureId, pid: poe.pid, hwnd: poe.hwnd, start: gameStarted}
            feedbackCaptureId := captureId
            feedbackRepeat := code = 12
            feedbackOcr := suffix
            feedbackSeen := ""
            SetTimer RunCloudUploader, -100
            try {
                A_Clipboard := FileRead(readyFile, "UTF-8")
                Notice("Capture saved" suffix ". Checking upload..." (feedbackRepeat ? "`nPossible repeat - both captures are kept." : ""))
            } catch {
                Notice("Clipboard unavailable. Import the file saved in helpers\captures" suffix ".")
            }
        } else if code = 124 {
            RecordDiagnosticEvent("capture", "error")
            Notice("Capture timed out. Any recovery PNG is kept in captures\.pending. Press F9 to retry.")
        } else if code = 2 {
            RecordDiagnosticEvent("capture", "blocked")
            Notice("The selection is too large. Use F6 and F7 to select a smaller panel.")
        } else if code = 3 {
            RecordDiagnosticEvent("capture", "blocked")
            Notice("Keep the game in front and the panel visible, then press F9 again.")
        } else if code = 4 {
            RecordDiagnosticEvent("capture", "error")
            Notice("HDR capture failed. Keep the panel on one monitor. Retry, or disable Windows HDR and retry.")
        } else {
            RecordDiagnosticEvent("capture", "error")
            Notice("Capture failed. Check write permissions and the Windows PowerShell execution policy.")
        }
    } catch as err {
        RecordDiagnosticEvent("capture", "error")
        Notice(err.Message)
    } finally {
        OverlayWriteCapture(cancelled ? "cancelled" : capturePhase, captureId)
        capturing := false
        OverlayTick()
    }
}

CaptureSymbolReport() {
    global capturing, lastSymbolOffer, symbolReportPid, symbolReportStarting
    if capturing || symbolReportStarting || symbolReportPid && ProcessExist(symbolReportPid)
        return
    symbolReportStarting := true
    AutoCaptureStop()
    try {
        poe := GetForegroundPoe()
        backend := FateCaptureBackend()
        powershell := WindowsPowerShellPath()
        script := A_ScriptDir "\Report-Symbol.ps1"
        if !FileExist(powershell) || !FileExist(script)
            throw Error("Windows PowerShell or Report-Symbol.ps1 is missing.")
        ; Hide the console from PowerShell itself so the selection dialog can show.
        command := '"' powershell '" -WindowStyle Hidden -NoLogo -NoProfile -NonInteractive -STA -ExecutionPolicy RemoteSigned -File "' script '"'
            . ' -WindowHandle ' poe.hwnd ' -WindowPid ' poe.pid
            . ' -ClientWidth ' poe.width ' -ClientHeight ' poe.height ' -CaptureBackend ' backend
        if lastSymbolOffer && lastSymbolOffer.pid = poe.pid && lastSymbolOffer.hwnd = poe.hwnd
            && lastSymbolOffer.start && lastSymbolOffer.start = PoeProcessStarted(poe.pid)
            command .= ' -CaptureId ' lastSymbolOffer.id
        ClearCalibrationPreview()
        SetTimer ClearNotice, 0
        ToolTip
        OverlaySuspend()
        Run(command, A_ScriptDir, , &symbolReportPid)
    } catch as err {
        Notice(err.Message)
    } finally {
        symbolReportStarting := false
    }
}

FateCaptureBackend() {
    global calibrationFile
    backend := IniRead(calibrationFile, "capture", "Backend", "auto")
    if !(backend = "auto" || backend = "gdi" || backend = "wgc")
        throw Error("Capture Backend must be auto, gdi or wgc in fate-collector.ini.")
    return backend
}

PoeProcessStarted(pid) {
    ; A recycled PID or window handle must not link a new game to an old F9.
    process := DllCall("OpenProcess", "UInt", 0x1000, "Int", false, "UInt", pid, "Ptr")
    if !process
        return 0
    try {
        times := Buffer(32)
        if DllCall("GetProcessTimes", "Ptr", process, "Ptr", times.Ptr, "Ptr", times.Ptr + 8,
            "Ptr", times.Ptr + 16, "Ptr", times.Ptr + 24, "Int")
            return NumGet(times, 0, "Int64")
        return 0
    } finally {
        DllCall("CloseHandle", "Ptr", process)
    }
}

WindowsPowerShellPath() {
    launcherDir := A_Is64bitOS && A_PtrSize = 4 ? "Sysnative" : "System32"
    return A_WinDir "\" launcherDir "\WindowsPowerShell\v1.0\powershell.exe"
}

RecordDiagnosticEvent(code, outcome) {
    ; Only fixed codes and the UTC timestamp are stored. Never save exception text or capture data.
    if !(code = "app-start" && outcome = "ok" || code = "capture" && (outcome = "ok" || outcome = "blocked" || outcome = "error"))
        return
    localAppData := EnvGet("LOCALAPPDATA")
    if !localAppData
        return
    directory := localAppData "\FateCollector\diagnostic-events"
    path := directory "\" code "." outcome ".json"
    temporary := path ".part"
    try {
        DirCreate directory
        now := FormatTime(A_NowUTC, "yyyy-MM-dd'T'HH:mm:ss'Z'")
        eventFile := FileOpen(temporary, "w", "UTF-8-RAW")
        try eventFile.Write('{"at":"' now '","code":"' code '","outcome":"' outcome '","httpStatus":null}')
        finally eventFile.Close()
        FileMove temporary, path, 1
    } catch {
        ; Capture and the tray remain available when local diagnostic storage fails.
    }
}

RunCloudUploader(*) {
    global uploaderPid, uploadRequested, feedbackCaptureId, feedbackFile, capturing
    if capturing
        return
    if uploaderPid && ProcessExist(uploaderPid) {
        uploadRequested := true
        return
    }
    uploadRequested := false
    localAppData := EnvGet("LOCALAPPDATA")
    if !localAppData || !HasCloudUploadWork(localAppData "\FateCollector") {
        ShowUploadFeedback("local")
        return
    }
    powershell := WindowsPowerShellPath()
    script := A_ScriptDir "\Upload-FateCaptures.ps1"
    if !FileExist(powershell) || !FileExist(script) {
        ShowUploadFeedback("error")
        return
    }
    try {
        if FileExist(feedbackFile)
            FileDelete feedbackFile
        command := '"' powershell '" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "' script '"'
        if feedbackCaptureId
            command .= ' -FeedbackCaptureId ' feedbackCaptureId ' -FeedbackPath "' feedbackFile '"'
        Run(command, A_ScriptDir, "Hide", &uploaderPid)
        SetTimer CheckUploadFeedback, 250
    } catch {
        ShowUploadFeedback("error")
    }
}

HasCloudUploadWork(stateDir) {
    static lastReceiptCheck := 0
    if FileExist(stateDir "\upload.clixml")
        return true
    ; Withdrawal can be pending even when there is no active upload configuration.
    for folder in ["consents", "diagnostics"] {
        Loop Files, stateDir "\" folder "\*.withdrawal.json", "F" {
            if RegExMatch(A_LoopFileName, "^[0-9a-f-]{36}\.withdrawal\.json$") {
                id := SubStr(A_LoopFileName, 1, 36)
                if !FileExist(stateDir "\" folder "\" id ".withdrawn.json")
                    return true
                ; Only PowerShell can validate the receipt. Recheck old ones periodically.
                if !lastReceiptCheck || A_TickCount < lastReceiptCheck || A_TickCount - lastReceiptCheck >= 600000 {
                    lastReceiptCheck := A_TickCount
                    return true
                }
            }
        }
    }
    return false
}

CheckUploadFeedback() {
    global uploaderPid, uploadRequested, feedbackCaptureId, feedbackFile, capturing
    if uploaderPid && ProcessExist(uploaderPid)
        return
    ; Avoid covering the selected panel while the exporter is capturing it.
    if capturing
        return
    SetTimer CheckUploadFeedback, 0
    uploaderPid := 0
    if uploadRequested {
        RunCloudUploader()
        return
    }
    if !feedbackCaptureId
        return
    try {
        if FileGetSize(feedbackFile) > 256
            throw Error("Invalid upload feedback.")
        fields := StrSplit(Trim(FileRead(feedbackFile, "UTF-8")), "`n", "`r")
        if fields.Length != 2 || fields[1] != feedbackCaptureId
            throw Error("Stale upload feedback.")
        ShowUploadFeedback(fields[2])
    } catch {
        ShowUploadFeedback("error")
    }
}

ShowUploadFeedback(status) {
    global feedbackCaptureId, feedbackRepeat, feedbackOcr, feedbackSeen
    if !feedbackCaptureId
        return
    switch status {
        case "uploaded": message := "Uploaded."
        case "offline": message := "Queued - connection unavailable. Will retry."
        case "queued", "retry": message := "Queued - waiting to upload. Will retry."
        case "queue-blocked": message := "Upload blocked - queued data could not be verified. Capture kept locally."
        case "authorization": message := "Upload paused - check the upload key in Cloud upload settings."
        case "consent-pending": message := "Queued - waiting for the collection to confirm consent."
        case "consent-required": message := "Upload paused - review consent in Cloud upload settings."
        case "settings-damaged": message := "Upload paused - review consent and enable upload again in Cloud upload settings."
        case "rejected": message := "Upload rejected. Capture kept locally."
        case "local": message := "Saved locally. Cloud upload is off or this capture is not eligible."
        default: message := "Upload status unavailable. Capture kept locally. Check Cloud upload settings."
    }
    signature := feedbackCaptureId ":" status
    if signature = feedbackSeen
        return
    feedbackSeen := signature
    Notice(message feedbackOcr (feedbackRepeat ? "`nPossible repeat - both captures are kept." : ""))
}

ConfigureCloudUpload(*) {
    global settingsPid
    if settingsPid && ProcessExist(settingsPid)
        return
    powershell := WindowsPowerShellPath()
    script := A_ScriptDir "\Configure-CloudUpload.ps1"
    if !FileExist(powershell) || !FileExist(script) {
        MsgBox "Windows PowerShell or the cloud upload settings script is missing.", "Fate Collector", "Icon!"
        return
    }
    try Run('"' powershell '" -NoLogo -NoProfile -NonInteractive -STA -ExecutionPolicy RemoteSigned -File "' script '"',
        A_ScriptDir, "Hide", &settingsPid)
    catch {
        MsgBox "Could not open the cloud upload settings.", "Fate Collector", "Icon!"
    }
}

ReportProblem(*) {
    global diagnosticsPid
    if diagnosticsPid && ProcessExist(diagnosticsPid)
        return
    powershell := WindowsPowerShellPath()
    script := A_ScriptDir "\Report-Problem.ps1"
    if !FileExist(powershell) || !FileExist(script) {
        MsgBox "Windows PowerShell or the diagnostic dialog is missing.", "Fate Collector", "Icon!"
        return
    }
    ; Let PowerShell hide its console so the dialog itself is visible.
    try Run('"' powershell '" -WindowStyle Hidden -NoLogo -NoProfile -NonInteractive -STA -ExecutionPolicy RemoteSigned -File "' script '"',
        A_ScriptDir, , &diagnosticsPid)
    catch {
        MsgBox "Could not open the diagnostic dialog.", "Fate Collector", "Icon!"
    }
}

CancelCapture() {
    global calibration, calibrationFile, capturing, cancelled, captureSession, savedCalibrationAllowed
    AutoCaptureReset()
    calibration := 0
    savedCalibrationAllowed := false
    ClearCalibrationPreview()
    clearFailed := false
    try ClearFateCalibration(calibrationFile)
    catch {
        clearFailed := true
    }
    if captureSession
        captureSession.lastFile := ""
    if capturing {
        cancelled := true
        if clearFailed
            Notice("Capture canceled. Could not clear the saved panel; check write access to fate-collector.ini.")
        return
    }
    Notice(clearFailed ? "Panel disabled for this session. Could not clear saved calibration; check fate-collector.ini write access." : "Calibration cleared. Use F6 and F7.")
}

NewCaptureId() {
    guid := Buffer(16)
    result := Buffer(39 * 2)
    if DllCall("ole32\CoCreateGuid", "Ptr", guid.Ptr, "Int") != 0
        || !DllCall("ole32\StringFromGUID2", "Ptr", guid.Ptr, "Ptr", result.Ptr, "Int", 39, "Int")
        throw Error("Could not create a capture ID.")
    return StrLower(SubStr(StrGet(result, "UTF-16"), 2, 36))
}

Notice(message) {
    ToolTip message
    SetTimer ClearNotice, -4000
}

ClearNotice() {
    ToolTip
}
