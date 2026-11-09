; Client-relative panel calibration. Component attribution: THIRD_PARTY_NOTICES.md.
; Pure file/geometry functions are kept separate from hotkeys for native tests.
ReadFateCalibration(path) {
    if !FileExist(path)
        return 0
    try {
        if FileGetSize(path) > 16384 || IniRead(path, "panel", "Version", "") != "1"
            return 0
        values := Map()
        for key in ["Left", "Top", "Right", "Bottom", "ClientWidth", "ClientHeight"] {
            raw := IniRead(path, "panel", key, "")
            if !RegExMatch(raw, "^\d+(?:\.\d+)?$")
                return 0
            values[key] := Number(raw)
        }
        saved := {left: values["Left"], top: values["Top"], right: values["Right"], bottom: values["Bottom"],
            width: values["ClientWidth"], height: values["ClientHeight"]}
        FateCalibrationRect(saved, saved.width, saved.height)
        return saved
    } catch {
        return 0 ; Invalid/old calibration requires new F6/F7 points, never guessed bounds.
    }
}

FateCalibrationRect(saved, width, height, allowResize := false) {
    if saved.width < 1 || saved.height < 1 || saved.width > 16384 || saved.height > 16384
        || width < 1 || height < 1 || width > 16384 || height > 16384
        || Mod(saved.width, 1) || Mod(saved.height, 1) || Mod(width, 1) || Mod(height, 1)
        || saved.left < 0 || saved.top < 0 || saved.right > 1 || saved.bottom > 1
        || saved.left >= saved.right || saved.top >= saved.bottom
        throw Error("Saved panel bounds are invalid. Repeat F6 and F7.")
    if width != saved.width || height != saved.height {
        if !allowResize
            throw Error("The game size changed. Press F8 to preview the saved panel, or select it again with F6/F7.")
        if Abs((width / height) / (saved.width / saved.height) - 1) > 0.01
            throw Error("The game aspect ratio changed. Repeat F6 and F7.")
    }
    left := Round(saved.left * width), top := Round(saved.top * height)
    right := Round(saved.right * width), bottom := Round(saved.bottom * height)
    if right - left < 2 || bottom - top < 2 || right - left > 8192 || bottom - top > 8192
        || (right - left) * (bottom - top) > 16777216
        throw Error("The saved panel is too small or too large. Repeat F6 and F7.")
    return {first: {x: left, y: top}, last: {x: right - 1, y: bottom - 1}}
}

SaveFateCalibration(path, selection) {
    width := selection.window.width, height := selection.window.height
    saved := {left: selection.first.x / width, top: selection.first.y / height,
        right: (selection.last.x + 1) / width, bottom: (selection.last.y + 1) / height, width: width, height: height}
    FateCalibrationRect(saved, width, height)
    temporary := path "." DllCall("GetCurrentProcessId") ".part"
    try {
        if FileExist(path)
            FileCopy path, temporary, 1
        IniWrite "1", temporary, "panel", "Version"
        for pair in [["Left", saved.left], ["Top", saved.top], ["Right", saved.right], ["Bottom", saved.bottom]]
            IniWrite Format("{:.10f}", pair[2]), temporary, "panel", pair[1]
        IniWrite width, temporary, "panel", "ClientWidth"
        IniWrite height, temporary, "panel", "ClientHeight"
        FileMove temporary, path, 1
    } finally {
        if FileExist(temporary)
            FileDelete temporary
    }
}

ClearFateCalibration(path) {
    if FileExist(path)
        IniDelete path, "panel"
}
