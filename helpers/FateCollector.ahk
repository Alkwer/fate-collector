#Requires AutoHotkey v2.0
#SingleInstance Force

; Window checks and calibration adapted from One More Map. See README.md and LICENSE.one-more-map.txt.
DllCall("SetThreadDpiAwarenessContext", "Ptr", -4, "Ptr")
CoordMode "Mouse", "Screen"
CoordMode "ToolTip", "Screen"

calibration := 0
capturing := false
cancelled := false
uploaderPid := 0
settingsPid := 0
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
SetTimer () => RunCloudUploader(), 30000
SetTimer RunCloudUploader, -200

; Leave these keys available in other applications.
#HotIf WinActive("ahk_class POEWindowClass")
F6::CalibrateTopLeft()
F7::CalibrateBottomRight()
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

VerifyCalibration() {
    global calibration
    if !calibration
        throw Error("Press F6 at the upper-left corner of the panel first.")
    poe := GetForegroundPoe()
    previous := calibration.window
    if poe.hwnd != previous.hwnd || poe.pid != previous.pid || poe.path != previous.path
        || poe.width != previous.width || poe.height != previous.height {
        calibration := 0
        throw Error("The window or its size changed. Repeat F6 and F7.")
    }
    return poe
}

CalibrateTopLeft() {
    global calibration, capturing, captureSession
    if capturing
        return
    try {
        poe := GetForegroundPoe()
        calibration := {window: poe, first: GetClientPointer(poe), last: 0}
        if captureSession
            captureSession.lastFile := ""
        Notice("Upper-left corner saved. Move to the lower-right corner and press F7.")
    } catch as err {
        Notice(err.Message)
    }
}

CalibrateBottomRight() {
    global calibration, capturing
    if capturing
        return
    try {
        poe := VerifyCalibration()
        last := GetClientPointer(poe)
        if last.x <= calibration.first.x || last.y <= calibration.first.y
            throw Error("The F7 corner must be to the right of and below the F6 corner.")
        calibration.last := last
        Notice("Panel selected. Press F9 to save a capture.")
    } catch as err {
        Notice(err.Message)
    }
}

CapturePanel() {
    global calibration, capturing, cancelled, captureSession
    global feedbackCaptureId, feedbackRepeat, feedbackOcr, feedbackSeen
    if capturing
        return
    capturing := true
    cancelled := false
    try {
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
        script := A_ScriptDir "\Export-FateCapture.ps1"
        if !FileExist(powershell) || !FileExist(script)
            throw Error("Windows PowerShell or Export-FateCapture.ps1 is missing.")

        ; Quote absolute paths without trailing separators for Windows argument parsing.
        command := '"' powershell '" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "' script '"'
            . ' -OutputDirectory "' outputDir '" -CaptureId ' captureId
            . ' -WindowHandle ' poe.hwnd ' -WindowPid ' poe.pid
            . ' -ClientWidth ' poe.width ' -ClientHeight ' poe.height
            . ' -X ' left ' -Y ' top ' -Width ' width ' -Height ' height
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
            Notice("The selection is too large. Use F6 and F7 to select a smaller panel.")
        } else if code = 3 {
            Notice("Keep the game in front and the panel visible, then press F9 again.")
        } else {
            Notice("Capture failed. Check write permissions and the Windows PowerShell execution policy.")
        }
    } catch as err {
        Notice(err.Message)
    } finally {
        capturing := false
    }
}

WindowsPowerShellPath() {
    launcherDir := A_Is64bitOS && A_PtrSize = 4 ? "Sysnative" : "System32"
    return A_WinDir "\" launcherDir "\WindowsPowerShell\v1.0\powershell.exe"
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
    if FileExist(stateDir "\upload.clixml")
        return true
    ; Withdrawal can be pending even when there is no active upload configuration.
    Loop Files, stateDir "\consents\*.withdrawal.json", "F" {
        id := SubStr(A_LoopFileName, 1, 36)
        if !FileExist(stateDir "\consents\" id ".withdrawn.json")
            return true
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

CancelCapture() {
    global calibration, capturing, cancelled
    calibration := 0
    if capturing {
        cancelled := true
        return
    }
    Notice("Calibration cleared. Use F6 and F7.")
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
