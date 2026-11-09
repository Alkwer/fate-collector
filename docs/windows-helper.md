# Capture a Fate offer on Windows

Use Windows 10 or 11, AutoHotkey v2, and the built-in Windows PowerShell 5.1. Open Path of Exile in windowed or borderless windowed mode, then run `helpers/FateCollector.ahk`. Keep the panel fully visible. Version 0.3.1 strengthens overlay checks, recovers damaged upload metadata and scans large archives faster. Saved calibration, the second OCR pass and automatic HDR detection remain available. Exclusive fullscreen remains unvalidated.

## Direct cloud upload: no browser required

1. Right-click the helper's tray icon and choose **Cloud upload settings**. Enter the collector's HTTPS site origin and the **capture upload key** provided by the collection owner. Read the consent text and destination, tick **I agree to share new F9 captures with the destination above**, then click **Enable upload**. The checkbox starts unchecked. Do not enter a Cloudflare API token or the website's reviewed-offer key.
2. Open a Fate offer in Path of Exile. Move the pointer to the panel's upper-left corner and press **F6**, then to its lower-right corner and press **F7**. Include every offered card and its text.
3. With the game in front, press **F9**. The helper saves the screenshot/OCR bundle locally and queues the OCR text, line positions, image dimensions and capture metadata for upload. Screenshot pixels never leave the computer through this uploader.

Keep the helper running; the website can be closed. The helper tries after each capture, at startup, and about every 30 seconds. An unavailable connection keeps the immutable upload on disk; retries back off automatically. Reopening the helper resumes pending work. Matching server receipts acknowledge uploads, including a duplicate receipt after a lost response. Capture files are never deleted by the uploader. Press F9 only once per offer: a second press creates another capture ID.

Uploads start with new game captures created after accepting consent and only after the server confirms the exact consent record. Older captures and offline fixtures are excluded. Older helper settings without consent cannot upload. Changing the key for the same site preserves valid consent and pending work. Changing the site or consent policy requires a new choice and starts a separate queue.

To stop sharing, open **Cloud upload settings**, select the relevant entry in **Consent history**, and click **Withdraw consent**. New sends stop immediately. The helper retries server withdrawal while running, including after restart, without requiring the collection key. Until the server confirms, an already in-flight request may finish. On confirmation, captures submitted under that consent are deleted from the collection; local captures and receipts stay intact. Re-enabling requires new consent and does not send captures from the disabled period or an older queue. Withdrawing helper consent does not withdraw a separate website consent.

The helper saves the exact accepted text, policy version, device acceptance time, server confirmation time and withdrawal times under `%LOCALAPPDATA%\FateCollector\consents`. Its consent credential is protected with Windows DPAPI. Keep this folder until pending withdrawals are confirmed. Deleting local files or uninstalling the helper is not a server withdrawal. Older consent entries remain available in the dialog when switching destinations.

After F9, **Capture saved** confirms the local file. **Uploaded** appears only after a matching server receipt. **Queued** means the file is waiting for a connection or retry; leave the helper running. An authorization pause asks you to check the upload key; a consent pause asks you to review consent in settings. A rejected capture remains available locally. Feedback follows the latest capture and changes when its upload status changes. The settings dialog shows consent and withdrawal status.

The helper automatically records a random session ID, session start time and capture sequence. Restarting the helper or capturing from a different game process starts a new session. Only published captures advance the sequence; this is not an in-game encounter number. No character/account name is collected, and league, patch and area are not guessed.

**Possible repeat** means the previous capture in the same session had matching nonempty, successful OCR, the same image dimensions and was captured no more than 15 seconds earlier. Whitespace and letter case are ignored; numbers and punctuation are preserved. Recalibrating clears this comparison. Both captures remain saved and uploaded with different IDs. This is a review hint, not proof of a duplicate or a reason to automatically exclude an observation. The website shows the hint and session capture number without extra input fields.

Settings and queue receipts live under `%LOCALAPPDATA%\FateCollector`. The key is encrypted for the current Windows account on this computer using [Windows DPAPI through Export-Clixml](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/export-clixml?view=powershell-5.1). It is not included in captures, command-line arguments or the helper ZIP. This prevents copying the saved credential to another user or computer; it does not isolate it from programs running as the same Windows user.

Automatic uploads remain **unverified**, including successful OCR. They populate the shared research database, not the browser's local history. There is no cloud history download or cloud correction screen yet. To inspect screenshots and correct a capture, use the optional local folder connection below. Reviewed sharing uses a separate key and the same capture ID, so a reviewed correction replaces the automatic candidate in the combined research view.

## Optional local review on the website

Open Fate Collector in desktop Chrome or Edge. Click **Connect folder**, choose the `captures` folder beside `FateCollector.ahk`, and allow read access. The helper creates it on startup; **Open capture folder** in its tray menu locates it. F9 captures then appear and save locally without pasting or clicking Save. Use **Edit details** for a misread; while connected, corrections save after a short typing pause.

Keep the website open for local intake. It checks the folder about every two seconds, but browser throttling or tab suspension can delay this. Files remain on disk and are caught up when the page resumes. After reopening, the browser may require **Resume local review** and renewed folder permission. **Disconnect** forgets this local link; it does not change the helper's cloud settings. Existing files in a newly connected folder are imported as well; already received or deliberately deleted captures are skipped.

Without a folder connection, paste with **Ctrl+V** or import the JSON backup and save manually. The clipboard fallback is still populated after F9. Other browsers can use this manual route. Local intake and edits do not automatically upload reviewed corrections.

The helper checks the foreground window class, executable name, and the installation's `Content.ggpk` or `Bundles2/_.index.bin` marker. Calibration is saved in `fate-collector.ini` beside the helper as ratios of the game client area. It follows a moved window and survives a restart at the same resolution. **F8** briefly outlines the saved panel without taking a screenshot or moving the pointer. After a resolution change at the same aspect ratio, F9 is blocked until you use F8 to preview the scaled panel; if the outline is wrong, repeat **F6/F7**. A changed aspect ratio requires F6/F7. Also recalibrate after changing the game's UI scale or moving the panel within the game; these changes cannot be detected automatically. **F10** clears both saved and current calibration. During an export it also discards that export when the worker finishes.

The helper captures only on **F9**. It reads the selected screen region, replaces the clipboard contents and saves a local backup. Captures are staged in `captures/.pending` until cancellation is checked, then published into `captures`; the website and uploader read only completed top-level files. The helper does not automate game actions.

## If capture or OCR fails

- For an oversized selection, use **F6** and **F7** to select a smaller area. The bundle limit is 12 MiB including the embedded PNG.
- For a window error, return focus to the game, uncover the whole panel, and press **F9** again. After a resolution change, use F8 to inspect the saved frame or repeat F6/F7.
- For an HDR capture failure, keep the entire selected panel on one monitor and retry. If capture remains unavailable, turn Windows HDR off and retry. A failed HDR capture is not silently replaced with washed-out GDI pixels.
- If Windows OCR is unavailable or fails, import the saved bundle and read the image manually. Install the relevant OCR language feature in Windows if you want OCR for that language. The helper tries installed English first, then the Windows profile languages and any remaining installed recognizer.
- If PowerShell blocks the export, check that the helper files are in a writable folder and that your Windows policy permits local scripts. The helper requests `RemoteSigned` for its child process. If Windows marked the downloaded script as remote, unblock the reviewed copy in the file's **Properties** if your policy allows it.
- If auto-save is paused at 250 offers, export and remove older observations, then select **Resume local review**. New files stay on disk. Malformed files are reported without blocking valid files; repaired files are retried.
- If the selected folder was moved or is no longer accessible, choose **Disconnect**, then **Connect folder** to select the correct folder. Existing saved offers stay in the browser.
- If a restored metadata backup has no screenshot, import the original helper file again. Missing screenshot/OCR evidence is restored while existing card corrections and review status are preserved.
- If cloud upload is waiting for a connection, leave the helper running or restart it later. If the key was rejected, re-enter a valid capture key in **Cloud upload settings**. A rejected invalid/conflicting capture stays in the local capture folder; it is not marked as uploaded. Local browser capacity does not limit the cloud queue.

## Report a problem without sharing captures

Choose **Report a problem** from the helper's tray menu. Generate the diagnostic
report and inspect its exact contents. You can save a ZIP locally, or accept the
separate diagnostic consent and send the report to the collection. This does not
enable gameplay upload. Keep the returned report number and use it when contacting
Fate Collector — Alkwer through the project repository.

Diagnostics contain predefined technical states/codes and bounded counts; they do
not include keys, raw errors, paths, usernames, screenshots or OCR. Use the report
history to withdraw consent and delete the remote report. Offline deletion is
retried while the helper runs and after restart. Keep helper settings until it is
confirmed. Reports expire after 30 days and are cleaned within the following
15 minutes. See [diagnostic contents and retention](diagnostics.md).

## Offline PNG and fixture test

### Capture and OCR methods

Automatic SDR uses guarded GDI and falls back to window-targeted Windows Graphics Capture (WGC) when another window intersects the crop. The fallback rechecks the game identity, foreground and geometry; unrelated backend errors stop capture. When Windows reports HDR on the target monitor, WGC uses float16 scRGB pixels converted against that monitor's SDR white level. The screenshot stays in memory until the normal capture bundle is saved. Foreground/window/coverage checks run before and after capture. A region spanning monitors is rejected. Native tests verify WGC's normal and float16 paths on an **SDR** display, including ordinary and translucent overlays. Real HDR monitors and live PoE still need validation. GDI cannot exclude a transient overlay appearing and disappearing entirely between its checks; select WGC explicitly when window isolation is required.

Advanced troubleshooting can set `Backend=auto`, `gdi` or `wgc` under `[capture]` in `fate-collector.ini`, or pass `-CaptureBackend` to the exporter. `auto` is the default. Forcing `gdi` with Windows HDR enabled can distort colors.

OCR reads the original pixels and a bounded, contrast-normalized/resized version. Coordinates from the second pass are mapped to the original screenshot. The second pass is selected only if the first has no text, or it adds exact catalog headers while preserving the original known headers in their positions. Conflicts and ties keep the original pass. Unknown names are not replaced by dictionary guesses. This selection is a heuristic, not calibrated confidence; a missed/incorrect unknown name is still possible. The returned text is one whole selected pass, never a mixture of captures. The original PNG is unchanged. The capture format stays compatible with existing v1 uploads; helper version 0.3.0 identifies this pipeline. `-OcrMode original` or `-OcrMode normalized` can isolate a pass for offline diagnosis.

The prototype under `prototypes/vision` remains separate: its icon recognition and dictionary-assisted header refinements have not been enabled in F9.

From the repository root, use the following commands in Windows PowerShell 5.1. The first creates the same bundle from an existing PNG. The optional `-OcrLanguage` argument accepts an installed Windows OCR language tag such as `en-US`. The second exercises the exporter against an image generated locally by the test.

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\helpers\Export-FateCapture.ps1 -InputImage 'C:\path\to\offer.png'
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\helpers\tests\Test-FateCapture.ps1 -RequireOcr
```

The exporter prints the saved path and marks offline PNG bundles as fixtures. Exit codes `0`, `10`, and `11` indicate a saved bundle with OCR successful, unavailable, or failed, respectively. Code `12` is successful OCR with a possible-repeat hint. `-RequireOcr` makes the fixture test require successful recognition. The fixture verifies the bundle shape and OCR paths without opening the game. Standalone PNG export without session arguments retains the legacy context format.

Capture failure code `4` means WGC failed and no capture bundle was published. The focused native checks are `npm run test:calibration`, `npm run test:capture-image`, `npm run test:ocr` and `npm run test:capture-backend`. The last command briefly opens its own generated fixture window and checks WGC dimensions/colors in memory; it does not capture the game, save desktop images or upload anything. AHK tests use the standard v2 installation, or the `AUTOHOTKEY_EXE` environment variable.

When updating, exit the running helper, replace all bundled program files, and restart it. Retain `captures` and `fate-collector.ini`. A website notice compares the version recorded in the opened capture with the bundled helper version; it does not inspect the currently running helper or update it automatically.
