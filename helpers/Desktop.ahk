#Requires AutoHotkey v2.0

DesktopInit() {
    global calibrationFile
    global desktop := {enabled: IniRead(calibrationFile, "advisor", "Mode", "desktop") != "website",
        process: 0, pid: 0, started: 0, showRequested: false, failed: false}
    A_TrayMenu.Add "Open local advisor", DesktopOpen
    A_TrayMenu.Add "Use website advisor", DesktopWebsite
    if !desktop.enabled
        A_TrayMenu.Check "Use website advisor"
    OnExit DesktopExit
    SetTimer DesktopTick, 500
    if desktop.enabled
        DesktopStart()
}

DesktopSaveMode() {
    global desktop, calibrationFile
    try IniWrite(desktop.enabled ? "desktop" : "website", calibrationFile, "advisor", "Mode")
    catch {
        Notice("The advisor mode could not be saved. It applies for this session.")
    }
}

DesktopStart() {
    global desktop
    if desktop.process
        return
    desktop.failed := false
    desktop.started := A_TickCount
    try {
        if !FileExist(A_ScriptDir "\desktop\index.html") || !FileExist(A_ScriptDir "\webview2\Microsoft.Web.WebView2.Core.dll")
            throw Error("The local advisor files are missing. Extract the complete updated helper ZIP.")
        command := '"' WindowsPowerShellPath() '" -NoLogo -NoProfile -NonInteractive -STA -ExecutionPolicy RemoteSigned -File "'
            . A_ScriptDir '\Start-FateDesktop.ps1" -ParentPid ' DllCall("GetCurrentProcessId", "UInt")
        desktop.process := CreateFateCaptureProcess(command, A_ScriptDir)
        desktop.pid := DllCall("GetProcessId", "Ptr", desktop.process, "UInt")
    } catch as err {
        desktop.failed := true
        Notice(err.Message)
    }
}

DesktopWindow() {
    global desktop
    if !desktop.process || DllCall("WaitForSingleObject", "Ptr", desktop.process, "UInt", 0, "UInt") != 258
        return 0
    previous := DetectHiddenWindows(true)
    try return WinExist("Fate Collector — Local ahk_pid " desktop.pid)
    finally DetectHiddenWindows previous
}

DesktopStop() {
    global desktop
    if desktop.process {
        if window := DesktopWindow()
            DllCall("PostMessageW", "Ptr", window, "UInt", 0x8461, "Ptr", 0, "Ptr", 0)
        if DllCall("WaitForSingleObject", "Ptr", desktop.process, "UInt", 1500, "UInt") = 258
            DllCall("TerminateProcess", "Ptr", desktop.process, "UInt", 0)
        DllCall("CloseHandle", "Ptr", desktop.process)
    }
    desktop.process := 0
    desktop.pid := 0
    desktop.showRequested := false
}

DesktopExit(*) {
    DesktopStop()
}

DesktopOpen(*) {
    global desktop
    desktop.enabled := true
    A_TrayMenu.Uncheck "Use website advisor"
    DesktopSaveMode()
    desktop.showRequested := true
    DesktopStart()
    DesktopTick()
}

DesktopWebsite(*) {
    global desktop
    desktop.enabled := false
    A_TrayMenu.Check "Use website advisor"
    DesktopSaveMode()
    DesktopStop()
    AutoCaptureReset("watching")
    Notice("Website mode enabled. Open the website and connect this helper's captures folder. Local collections stay saved.")
}

DesktopTick() {
    global desktop
    if !desktop.enabled || desktop.failed || !desktop.process
        return
    if DllCall("WaitForSingleObject", "Ptr", desktop.process, "UInt", 0, "UInt") != 258 {
        DesktopStop()
        desktop.failed := true
        Notice("The local advisor stopped. Check that Microsoft Edge WebView2 Runtime is installed, then choose Open local advisor to retry. Use website advisor is also available.")
        return
    }
    if desktop.showRequested && (window := DesktopWindow()) {
        previous := DetectHiddenWindows(true)
        try {
            WinShow window
            WinRestore window
            WinActivate window
            desktop.showRequested := false
        } finally DetectHiddenWindows previous
    }
}
