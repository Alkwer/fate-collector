#Requires AutoHotkey v2.0
#SingleInstance Force
#Include Calibration.ahk

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
RecordDiagnosticEvent("app-start", "ok")
SetTimer () => RunCloudUploader(), 30000
SetTimer RunCloudUploader, -200

; Leave these keys available in other applications.
#HotIf WinActive("ahk_class POEWindowClass")
F6::CalibrateTopLeft()
F7::CalibrateBottomRight()
F8::PreviewCalibration()
F9::CapturePanel()
F10::CancelCapture()
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
    if !savedCalibrationAllowed
        throw Error("Select the panel again with F6 and F7.")
    saved := ReadFateCalibration(calibrationFile)
    if !saved
        throw Error("Press F6 at the upper-left corner of the panel first.")
    rect := FateCalibrationRect(saved, poe.width, poe.height, preview)
    calibration := {window: poe, first: rect.first, last: rect.last}
    if captureSession
        captureSession.lastFile := ""
    return poe
}

PreviewCalibration() {
    global calibration, capturing, previewWindows
    if capturing
        return
    previousCalibration := calibration
    try {
        poe := VerifyCalibration(true)
        if !calibration.last
            throw Error("Press F7 at the lower-right corner of the panel.")
        ClearCalibrationPreview()
        left := poe.left + calibration.first.x, top := poe.top + calibration.first.y
        width := calibration.last.x - calibration.first.x + 1, height := calibration.last.y - calibration.first.y + 1
        for edge in [[left, top, width, 2], [left, top + height - 2, width, 2], [left, top, 2, height], [left + width - 2, top, 2, height]] {
            outline := Gui("+AlwaysOnTop -Caption +ToolWindow +E0x20 -DPIScale")
            outline.BackColor := "EBCB73"
            outline.Show("NA x" edge[1] " y" edge[2] " w" edge[3] " h" edge[4])
            previewWindows.Push(outline)
        }
        SetTimer ClearCalibrationPreview, -2500
        Notice("Check the panel outline. Press F9 to capture, or F6/F7 to adjust it.")
    } catch as err {
        calibration := previousCalibration
        ClearCalibrationPreview()
        Notice(err.Message)
    }
}

ClearCalibrationPreview() {
    global previewWindows
    SetTimer ClearCalibrationPreview, 0
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
        ClearCalibrationPreview()
        calibration := 0
        savedCalibrationAllowed := false
        ClearFateCalibration(calibrationFile)
        calibration := {window: poe, first: GetClientPointer(poe), last: 0}
        if captureSession
            captureSession.lastFile := ""
        Notice("Upper-left corner saved. Move to the lower-right corner and press F7.")
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
        calibration.last := last
        SaveFateCalibration(calibrationFile, calibration)
        savedCalibrationAllowed := true
        Notice("Panel saved for next time. F8 previews it; F9 saves a capture.")
    } catch as err {
        Notice(err.Message)
    }
}

CapturePanel() {
    global calibration, calibrationFile, capturing, cancelled, captureSession
    global feedbackCaptureId, feedbackRepeat, feedbackOcr, feedbackSeen
    if capturing
        return
    capturing := true
    cancelled := false
    try {
        ClearCalibrationPreview()
        poe := VerifyCalibration()
        if !calibration.last
            throw Error("Press F7 at the lower-right corner of the panel.")
        left := calibration.first.x
        top := calibration.first.y
        width := calibration.last.x - left + 1
        height := calibration.last.y - top + 1

        captureId := NewCaptureId()
        if !captureSession || captureSession.pid != poe.pid || captureSession.sequence >= 1000000000
            captureSession := {id: NewCaptureId(), startedAt: A_NowUTC, pid: poe.pid, sequence: 0, lastFile: ""}
        captureDir := A_ScriptDir "\captures"
        ; Publish to the watched folder only after cancellation has been checked.
        outputDir := captureDir "\.pending"
        outputFile := outputDir "\fate-" captureId ".json"
        powershell := WindowsPowerShellPath()
        backend := IniRead(calibrationFile, "capture", "Backend", "auto")
        if !(backend = "auto" || backend = "gdi" || backend = "wgc")
            throw Error("Capture Backend must be auto, gdi or wgc in fate-collector.ini.")
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
        code := RunWait(command, A_ScriptDir, "Hide")
        Critical "On"

        if cancelled {
            if FileExist(outputFile)
                FileDelete outputFile
            Notice("Capture canceled. Repeat F6 and F7.")
        } else if FileExist(outputFile) && (code = 0 || code = 10 || code = 11 || code = 12) {
            suffix := code = 10 ? " (OCR unavailable)" : code = 11 ? " (OCR failed)" : ""
            if FileGetSize(outputFile) > 12 * 1024 * 1024
                throw Error("Capture exceeds the supported size limit.")
            readyFile := captureDir "\fate-" captureId ".json"
            FileMove outputFile, readyFile
            RecordDiagnosticEvent("capture", "ok")
            captureSession.sequence += 1
            captureSession.lastFile := readyFile
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
        capturing := false
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
    static lastConsentCheck := 0
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
                if folder = "consents" && (!lastConsentCheck || A_TickCount < lastConsentCheck || A_TickCount - lastConsentCheck >= 600000) {
                    lastConsentCheck := A_TickCount
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
