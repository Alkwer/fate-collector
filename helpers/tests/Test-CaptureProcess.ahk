#Requires AutoHotkey v2.0
#SingleInstance Off
#Include ..\CaptureProcess.ahk

if A_Args.Length && A_Args[1] = "--success" {
    Sleep 100
    ExitApp 7
}
if A_Args.Length && A_Args[1] = "--wait" {
    if A_Args.Length > 1
        FileAppend "synthetic local recovery evidence", A_Args[2]
    Sleep 10000
    ExitApp 0
}

other := 0
capture := 0
evidence := A_Temp "\fate-capture-deadline-" DllCall("GetCurrentProcessId") ".txt"
try {
    if FileExist(evidence)
        throw Error("The test evidence path already exists.")
    command := '"' A_AhkPath '" "' A_ScriptFullPath '" '
    if RunFateCaptureProcess(command "--success", A_ScriptDir, 5000) != 7
        throw Error("Lost the completed process exit status.")
    other := CreateFateCaptureProcess(command "--wait", A_ScriptDir)
    if RunFateCaptureProcess(command "--wait", A_ScriptDir, 150) != 124
        throw Error("A stalled capture did not reach its deadline.")
    if DllCall("WaitForSingleObject", "Ptr", other, "UInt", 0, "UInt") != 258
        throw Error("The capture deadline stopped an unrelated process.")
    capture := CreateFateCaptureProcess(command '--wait "' evidence '"', A_ScriptDir)
    started := A_TickCount
    while !FileExist(evidence) {
        if A_TickCount - started > 5000
            throw Error("The synthetic capture did not save its evidence.")
        Sleep 25
    }
    if WaitFateCaptureProcess(capture, 100) != 124 || !FileExist(evidence)
        throw Error("A deadline removed existing local evidence.")
    FileAppend "PASS: process deadline, exit code and independent process isolation.`n", "*"
} catch as exception {
    FileAppend exception.Message "`n", "**"
    ExitApp 1
} finally {
    if capture {
        DllCall("TerminateProcess", "Ptr", capture, "UInt", 0)
        DllCall("CloseHandle", "Ptr", capture)
    }
    if other {
        DllCall("TerminateProcess", "Ptr", other, "UInt", 0)
        DllCall("CloseHandle", "Ptr", other)
    }
    if FileExist(evidence)
        FileDelete evidence
}
