; The overlay sidecar reads advice and receives only viewport and hotkey messages.
; No input is sent to Path of Exile.
OverlayInit() {
    global overlay := {enabled: true, pid: 0, process: 0, window: 0, viewport: "", startedAt: 0, unavailable: false,
        directory: A_ScriptDir "\captures\.overlay", markerFailed: false, markerWarningShown: false, game: 0}
    A_TrayMenu.Add "Show/hide Fate overlay", OverlayToggle
    OnExit OverlayExit
    OverlayWriteCapture("cancelled")
    OverlayStart()
    SetTimer OverlayTick, 200
}

OverlayStart() {
    global overlay
    if overlay.process && DllCall("WaitForSingleObject", "Ptr", overlay.process, "UInt", 0, "UInt") = 0x102
        return
    OverlayExit()
    overlay.startedAt := A_TickCount
    overlay.unavailable := false
    script := A_ScriptDir "\Show-FateOverlay.ps1"
    if !FileExist(script)
        return
    try {
        command := '"' WindowsPowerShellPath() '" -NoLogo -NoProfile -NonInteractive -STA -ExecutionPolicy RemoteSigned -File "' script '"'
            . ' -Directory "' overlay.directory '" -ParentPid ' DllCall("GetCurrentProcessId", "UInt")
        Run(command, A_ScriptDir, "Hide", &child)
        ; Keep the actual child handle for lifetime checks and for a safe hide
        ; fallback if the sidecar ever stops processing window messages.
        overlay.process := DllCall("OpenProcess", "UInt", 0x100001, "Int", false, "UInt", child, "Ptr")
        if overlay.process
            overlay.pid := child
    }
}

OverlayExit(*) {
    global overlay
    if overlay.process {
        DllCall("TerminateProcess", "Ptr", overlay.process, "UInt", 0)
        DllCall("CloseHandle", "Ptr", overlay.process)
    }
    overlay.process := 0
    overlay.pid := 0
    overlay.window := 0
    overlay.viewport := ""
}

OverlayToggle(*) {
    global overlay
    if overlay.markerFailed && overlay.enabled {
        OverlayWriteCapture("cancelled")
        if !overlay.markerFailed
            OverlayTick()
        return
    }
    if overlay.unavailable {
        OverlayExit()
        overlay.enabled := true
        OverlayStart()
        return
    }
    overlay.enabled := !overlay.enabled
    if overlay.enabled
        OverlayStart()
    else
        OverlaySuspend()
    OverlayTick()
}

OverlayPoeActive() {
    if !WinActive("ahk_class POEWindowClass")
        return false
    try return !!GetForegroundPoe()
    return false
}

OverlayHotkeysActive() {
    global overlay, capturing, symbolReportPid, symbolReportStarting
    return overlay.enabled && !overlay.unavailable && !overlay.markerFailed && !capturing
        && !symbolReportStarting && !(symbolReportPid && ProcessExist(symbolReportPid)) && OverlayPoeActive()
}

OverlayFindWindow() {
    global overlay
    if !overlay.process || DllCall("WaitForSingleObject", "Ptr", overlay.process, "UInt", 0, "UInt") != 0x102
        return 0
    if !overlay.window {
        previous := DetectHiddenWindows(true)
        try overlay.window := WinExist("Fate Collector Overlay ahk_pid " overlay.pid)
        finally DetectHiddenWindows previous
    }
    return overlay.window
}

OverlaySend(values) {
    if !(window := OverlayFindWindow())
        return false
    payload := Buffer(values.Length * 8)
    for index, value in values
        NumPut("Int64", value, payload, (index - 1) * 8)
    packet := Buffer(A_PtrSize * 3, 0)
    NumPut("Ptr", 0x46415445, "UInt", payload.Size, packet)
    NumPut("Ptr", payload.Ptr, packet, A_PtrSize * 2)
    ; SMTO_BLOCK | SMTO_ABORTIFHUNG: keep the viewport revocation ordered
    ; with respect to capture and bound delays if the window is unresponsive.
    reply := 0
    delivered := DllCall("SendMessageTimeoutW", "Ptr", window, "UInt", 0x4a, "Ptr", A_ScriptHwnd,
        "Ptr", packet.Ptr, "UInt", 0x3, "UInt", 120, "Ptr*", &reply, "Ptr")
    return delivered && reply = 42
}

OverlaySuspend() {
    global overlay
    overlay.viewport := ""
    if OverlayFindWindow() {
        if !OverlaySend([1, 0, 0, 0, 0, 0, 0]) {
            ; Terminate only the exact process created by OverlayStart.
            DllCall("TerminateProcess", "Ptr", overlay.process, "UInt", 1)
            DllCall("WaitForSingleObject", "Ptr", overlay.process, "UInt", 250, "UInt")
            OverlayExit()
        }
        ; Drain desktop composition before a GDI read of the game pixels.
        DllCall("dwmapi\DwmFlush", "Int")
    }
}

OverlayRememberGame(poe, started) {
    global overlay
    overlay.game := {hwnd: poe.hwnd, pid: poe.pid, started: started, width: poe.width, height: poe.height}
}

OverlayTick() {
    global overlay, capturing, symbolReportPid, symbolReportStarting, calibration, calibrationFile, savedCalibrationAllowed
    poe := 0
    if overlay.enabled && overlay.markerFailed && !overlay.markerWarningShown && !capturing && !symbolReportStarting {
        overlay.markerWarningShown := true
        Notice("Fate overlay cannot write to the captures folder. Check write access, then retry from the tray.")
    }
    if overlay.enabled && !overlay.unavailable && !capturing && !symbolReportStarting && !OverlayFindWindow()
        && (A_TickCount - overlay.startedAt > 8000
            || overlay.process && DllCall("WaitForSingleObject", "Ptr", overlay.process, "UInt", 0, "UInt") = 0) {
        overlay.unavailable := true
        Notice("Fate overlay is unavailable. Use Show/hide Fate overlay in the tray to retry.")
    }
    if (overlay.enabled || overlay.game) && !overlay.markerFailed && !capturing
        && !symbolReportStarting && !(symbolReportPid && ProcessExist(symbolReportPid))
        && WinActive("ahk_class POEWindowClass")
        try poe := GetForegroundPoe()
    if poe && overlay.game && (overlay.game.hwnd != poe.hwnd || overlay.game.pid != poe.pid
        || overlay.game.width != poe.width || overlay.game.height != poe.height
        || !overlay.game.started || overlay.game.started != PoeProcessStarted(poe.pid)) {
        OverlaySuspend()
        OverlayWriteCapture("cancelled")
        overlay.game := 0
        if overlay.markerFailed
            return
    }
    if !poe || !overlay.enabled {
        if overlay.viewport != "" && OverlaySend([1, 0, 0, 0, 0, 0, 0])
            overlay.viewport := ""
        return
    }
    if !OverlayFindWindow()
        return

    first := 0
    last := 0
    if calibration && calibration.window.hwnd = poe.hwnd && calibration.window.pid = poe.pid
        && calibration.window.width = poe.width && calibration.window.height = poe.height {
        first := calibration.first
        last := calibration.last
    } else if savedCalibrationAllowed {
        saved := ReadFateCalibration(calibrationFile)
        if saved {
            try {
                rect := FateCalibrationRect(saved, poe.width, poe.height)
                first := rect.first
                last := rect.last
            }
        }
    }
    x := last ? poe.left + first.x : 0
    y := last ? poe.top + first.y : 0
    width := last ? last.x - first.x + 1 : 0
    height := last ? last.y - first.y + 1 : 0
    viewport := Format("{},{},{},{},{},{}", poe.hwnd, poe.pid, x, y, width, height)
    if viewport != overlay.viewport && OverlaySend([1, poe.hwnd, poe.pid, x, y, width, height])
        overlay.viewport := viewport
}

OverlayShortcut(slot, key) {
    if OverlayHotkeysActive() {
        OverlayTick()
        OverlaySend([2, slot])
    }
    ; Holding a key must not reapply a command after the website acknowledges it.
    KeyWait key
}

OverlayWriteCapture(phase, captureId := "") {
    global overlay
    ; Filetime and Unix epoch are both UTC; retain the actual millisecond value.
    ticks := Buffer(8)
    DllCall("GetSystemTimeAsFileTime", "Ptr", ticks.Ptr)
    unixMillis := (NumGet(ticks, 0, "Int64") - 116444736000000000) // 10000
    id := captureId = "" ? "null" : '"' captureId '"'
    path := overlay.directory "\capture.json"
    temporary := path "." DllCall("GetCurrentProcessId", "UInt") ".part"
    try {
        DirCreate overlay.directory
        file := FileOpen(temporary, "w", "UTF-8-RAW")
        try file.Write('{"protocol":1,"captureId":' id ',"phase":"' phase '","updatedAt":' unixMillis '}')
        finally file.Close()
        ; Win32 replacement is atomic on the local volume. The browser can only
        ; see an entire prior marker or an entire new one.
        if !DllCall("MoveFileExW", "Str", temporary, "Str", path, "UInt", 0x9, "Int")
            throw OSError()
        overlay.markerFailed := false
        overlay.markerWarningShown := false
    } catch {
        overlay.markerFailed := true
        try FileDelete temporary
    }
}
