#Requires AutoHotkey v2.0
#Include ..\Calibration.ahk

path := A_Temp "\fate-calibration-test-" DllCall("GetCurrentProcessId") ".ini"
if FileExist(path) {
    FileAppend "Calibration test path already exists.`n", "**"
    ExitApp 1
}

exitCode := 0
try {
    RunCalibrationTests(path)
    FileAppend "PASS: calibration roundtrip, validation, resize and capture settings preservation.`n", "*"
} catch as exception {
    FileAppend "Calibration test failed: " exception.Message "`n" exception.Stack "`n", "**"
    exitCode := 1
} finally {
    if FileExist(path)
        FileDelete path
}
ExitApp exitCode

AssertCalibration(condition, message) {
    if !condition
        throw Error(message)
}

AssertRect(rect, left, top, right, bottom) {
    AssertCalibration(rect.first.x = left && rect.first.y = top && rect.last.x = right && rect.last.y = bottom,
        "The reconstructed rectangle differs from the expected inclusive bounds.")
}

AssertRejected(callback, expectedMessage) {
    try {
        callback.Call()
    } catch as exception {
        AssertCalibration(InStr(exception.Message, expectedMessage), "Unexpected rejection: " exception.Message)
        return
    }
    throw Error("Expected a rejection containing " expectedMessage)
}

RunCalibrationTests(path) {
    AssertCalibration(!ReadFateCalibration(path), "A missing INI must have no calibration.")
    ClearFateCalibration(path)
    AssertCalibration(!FileExist(path), "Clearing a missing INI must leave it absent.")
    IniWrite "wgc", path, "capture", "Backend"
    IniWrite "preserve", path, "capture", "CustomSetting"
    AssertCalibration(!ReadFateCalibration(path), "An INI with capture settings alone must have no calibration.")
    ClearFateCalibration(path)
    AssertCalibration(IniRead(path, "capture", "Backend") = "wgc", "Clearing an absent panel changed capture settings.")

    selection := {first: {x: 125, y: 85}, last: {x: 1054, y: 705}, window: {width: 1200, height: 800}}
    SaveFateCalibration(path, selection)
    saved := ReadFateCalibration(path)
    AssertCalibration(IsObject(saved), "The saved calibration could not be read.")
    AssertCalibration(saved.width = 1200 && saved.height = 800, "The saved client dimensions changed.")
    AssertRect(FateCalibrationRect(saved, 1200, 800), 125, 85, 1054, 705)
    AssertRejected(() => FateCalibrationRect(saved, 2400, 1600), "game size changed")
    AssertRect(FateCalibrationRect(saved, 2400, 1600, true), 250, 170, 2109, 1411)
    AssertRejected(() => FateCalibrationRect(saved, 1200, 1000, true), "aspect ratio changed")
    AssertRejected(() => FateCalibrationRect(saved, 0, 800), "bounds are invalid")
    AssertRejected(() => FateCalibrationRect(saved, 1200.5, 800), "bounds are invalid")
    AssertRejected(() => FateCalibrationRect(saved, 16385, 800), "bounds are invalid")

    AssertRect(FateCalibrationRect({left: 0, top: 0, right: 1, bottom: 1, width: 8192, height: 2048}, 8192, 2048),
        0, 0, 8191, 2047)
    AssertRejected(() => FateCalibrationRect({left: 0, top: 0, right: 1, bottom: 1, width: 8193, height: 2}, 8193, 2), "too small or too large")
    AssertRejected(() => FateCalibrationRect({left: 0, top: 0, right: 1, bottom: 1, width: 8192, height: 2049}, 8192, 2049), "too small or too large")
    AssertRejected(() => FateCalibrationRect({left: 0, top: 0, right: 0.001, bottom: 1, width: 1200, height: 800}, 1200, 800), "too small or too large")

    for pair in [["Version", "2"], ["Left", "broken"], ["Right", "1.1"], ["Bottom", "0.01"], ["ClientWidth", "1200.5"]] {
        IniWrite pair[2], path, "panel", pair[1]
        AssertCalibration(!ReadFateCalibration(path), "Accepted corrupted panel key " pair[1])
        SaveFateCalibration(path, selection)
    }
    IniDelete path, "panel", "ClientHeight"
    AssertCalibration(!ReadFateCalibration(path), "Accepted a panel with a missing client dimension.")
    SaveFateCalibration(path, selection)
    AssertCalibration(IniRead(path, "capture", "Backend") = "wgc"
        && IniRead(path, "capture", "CustomSetting") = "preserve", "Saving calibration changed capture settings.")

    ClearFateCalibration(path)
    AssertCalibration(!ReadFateCalibration(path), "Clearing calibration left a readable panel.")
    AssertCalibration(IniRead(path, "capture", "Backend") = "wgc"
        && IniRead(path, "capture", "CustomSetting") = "preserve", "Clearing calibration changed capture settings.")
}
