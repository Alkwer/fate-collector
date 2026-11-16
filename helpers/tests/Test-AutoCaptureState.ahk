#Requires AutoHotkey v2.0
exitCode := 0
try {
    state := FateAutoState()
    AssertAuto(state.Observe("offer", "a") = "watch", "First sighting must not publish.")
    AssertAuto(state.Observe("offer", "a", true, "capture-a") = "publish", "Stable second sighting must publish.")
    AssertAuto(state.captureId = "", "A failed file promotion must not commit an identity.")
    state.CommitOffer("a", "capture-a")
    Loop 5
        AssertAuto(state.Observe("offer", "a") = "retain", "Continuous offer must not create repeated captures.")
    AssertAuto(state.Observe("uncertain") = "watch", "Uncertain automatic advice must clear.")
    AssertAuto(state.Observe("offer", "a") = "retain", "OCR loss must retain the existing identity.")
    AssertAuto(state.Observe("offer", "b", true, "stale") = "watch", "A changed offer requires its own two sightings.")
    AssertAuto(state.Observe("offer", "b", true, "capture-b") = "publish", "Changed stable offer must publish.")
    state.CommitOffer("b", "capture-b")
    state.Observe("empty")
    state.Observe("uncertain")
    state.Observe("empty")
    AssertAuto(state.published = "b", "Only consecutive empty frames rearm detection.")
    state.Observe("empty")
    AssertAuto(state.published = "" && state.captureId = "", "Closed panel must rearm identical future offers.")
    state.ManualCapture("manual")
    AssertAuto(state.Observe("uncertain") = "retain", "Manual F9 must work with unsupported automatic OCR.")
    AssertAuto(state.Observe("offer", "c") = "retain" && state.captureId = "manual", "Manual capture must not be duplicated by detection.")
    state.Observe("empty")
    AssertAuto(state.Observe("empty") = "watch" && !state.manual, "A confirmed close ends the manual override.")
    AssertAuto(AutoJsonString('{"detail":"escaped \"status\":\"busy\"","status":"idle"}', "status") = "idle", "Text content cannot spoof a state field.")
    FileAppend "PASS: automatic offer stability, duplicates, close/reopen, OCR loss and manual fallback.`n", "*"
} catch as exception {
    FileAppend "Auto capture state failed: " exception.Message "`n" exception.Stack "`n", "**"
    exitCode := 1
}
ExitApp exitCode

AssertAuto(condition, message) {
    if !condition
        throw Error(message)
}

; Parse the real helper but never execute its startup, capture or upload paths.
#Include ..\FateCollector.ahk
