#Requires AutoHotkey v2.0

; Hold the process handle returned by CreateProcessW throughout the deadline.
; A recycled PID can never cause another application's process to be terminated.
CreateFateCaptureProcess(command, workingDirectory := "") {
    startup := Buffer(A_PtrSize = 8 ? 104 : 68, 0)
    NumPut("UInt", startup.Size, startup)
    information := Buffer(A_PtrSize = 8 ? 24 : 16, 0)
    commandLine := Buffer(StrPut(command, "UTF-16") * 2, 0)
    StrPut(command, commandLine, "UTF-16")
    if !DllCall("CreateProcessW", "Ptr", 0, "Ptr", commandLine, "Ptr", 0, "Ptr", 0,
        "Int", false, "UInt", 0x08000000, "Ptr", 0,
        "Ptr", workingDirectory ? StrPtr(workingDirectory) : 0,
        "Ptr", startup, "Ptr", information, "Int")
        throw OSError()
    process := NumGet(information, 0, "Ptr")
    DllCall("CloseHandle", "Ptr", NumGet(information, A_PtrSize, "Ptr"))
    return process
}

WaitFateCaptureProcess(process, timeoutMs) {
    if timeoutMs < 1 || timeoutMs > 300000
        throw ValueError("Invalid capture deadline.")
    started := DllCall("GetTickCount64", "UInt64")
    loop {
        result := DllCall("WaitForSingleObject", "Ptr", process, "UInt", 0, "UInt")
        if result = 0 {
            code := 0
            if !DllCall("GetExitCodeProcess", "Ptr", process, "UInt*", &code)
                throw OSError()
            return code
        }
        if result != 258
            throw OSError()
        if DllCall("GetTickCount64", "UInt64") - started >= timeoutMs {
            if !DllCall("TerminateProcess", "Ptr", process, "UInt", 124)
                throw OSError()
            if DllCall("WaitForSingleObject", "Ptr", process, "UInt", 5000, "UInt") != 0
                throw Error("Capture timed out and could not be stopped. Local recovery files are preserved.")
            return 124
        }
        Sleep 25
    }
}

RunFateCaptureProcess(command, workingDirectory := "", timeoutMs := 90000) {
    if timeoutMs < 1 || timeoutMs > 300000
        throw ValueError("Invalid capture deadline.")
    process := CreateFateCaptureProcess(command, workingDirectory)
    try {
        return WaitFateCaptureProcess(process, timeoutMs)
    } finally {
        DllCall("CloseHandle", "Ptr", process)
    }
}
