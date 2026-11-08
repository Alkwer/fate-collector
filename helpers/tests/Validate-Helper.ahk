#Requires AutoHotkey v2.0
; /Validate parses the real entry point; ExitApp also prevents side effects if
; this wrapper is accidentally run without that switch. It has its own identity.
ExitApp 0
#Include ..
#Include FateCollector.ahk
