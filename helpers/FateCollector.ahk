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
    global calibration, capturing
    if capturing
        return
    try {
        poe := GetForegroundPoe()
        calibration := {window: poe, first: GetClientPointer(poe), last: 0}
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
    global calibration, capturing, cancelled
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
        SetTimer ClearNotice, 0
        ToolTip
        code := RunWait(command, A_ScriptDir, "Hide")
        Critical "On"

        if cancelled {
            if FileExist(outputFile)
                FileDelete outputFile
            Notice("Capture canceled. Repeat F6 and F7.")
        } else if FileExist(outputFile) && (code = 0 || code = 10 || code = 11) {
            suffix := code = 0 ? "" : code = 10 ? " (OCR unavailable)" : " (OCR failed)"
            if FileGetSize(outputFile) > 12 * 1024 * 1024
                throw Error("Capture exceeds the supported size limit.")
            readyFile := captureDir "\fate-" captureId ".json"
            FileMove outputFile, readyFile
            SetTimer RunCloudUploader, -100
            try {
                A_Clipboard := FileRead(readyFile, "UTF-8")
                Notice("Capture saved" suffix ". Cloud upload runs in the background when enabled."
                    . "`nManual fallback: paste with Ctrl+V.")
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
    global uploaderPid
    if uploaderPid && ProcessExist(uploaderPid)
        return
    ; No PowerShell process is needed until the user has opted in.
    localAppData := EnvGet("LOCALAPPDATA")
    if !localAppData || !FileExist(localAppData "\FateCollector\upload.clixml")
        return
    powershell := WindowsPowerShellPath()
    script := A_ScriptDir "\Upload-FateCaptures.ps1"
    if FileExist(powershell) && FileExist(script)
        try Run('"' powershell '" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "' script '"',
            A_ScriptDir, "Hide", &uploaderPid)
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
