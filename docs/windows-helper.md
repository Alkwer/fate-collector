# Capture a Fate offer on Windows

Use Windows 10 or 11, AutoHotkey v2, and the built-in Windows PowerShell 5.1. Open Path of Exile in windowed or borderless windowed mode, then run `helpers/FateCollector.ahk`. Keep the panel fully visible. For consistent colors, use SDR. Exclusive fullscreen and HDR capture are outside the supported setup.

## Direct cloud upload: no browser required

1. Right-click the helper's tray icon and choose **Cloud upload settings**. Enter the collector's HTTPS site origin and the **capture upload key** provided by the collection owner. Click **Enable upload**. Do not enter a Cloudflare API token or the website's reviewed-offer key.
2. Open a Fate offer in Path of Exile. Move the pointer to the panel's upper-left corner and press **F6**, then to its lower-right corner and press **F7**. Include every offered card and its text.
3. With the game in front, press **F9**. The helper saves the screenshot/OCR bundle locally and queues the OCR text, line positions, image dimensions and capture metadata for upload. Screenshot pixels never leave the computer through this uploader.

Keep the helper running; the website can be closed. The helper tries after each capture, at startup, and about every 30 seconds. An unavailable connection keeps the immutable upload on disk; retries back off automatically. Reopening the helper resumes pending work. Matching server receipts acknowledge uploads, including a duplicate receipt after a lost response. Capture files are never deleted by the uploader. Press F9 only once per offer: a second press creates another capture ID.

Uploads start with new game captures created after enabling the feature. Older captures and offline fixtures are excluded. Changing the key for the same site preserves pending work. Changing the site starts a separate queue and a new start time. **Disable upload** stops future sends; enabling again starts fresh, so captures from the disabled period and the old backlog are not silently sent. A send already acknowledged by the server cannot be recalled. Disabling or deleting local files does not remove cloud data.

Settings and queue receipts live under `%LOCALAPPDATA%\FateCollector`. The key is encrypted for the current Windows account on this computer using [Windows DPAPI through Export-Clixml](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/export-clixml?view=powershell-5.1). It is not included in captures, command-line arguments or the helper ZIP. This prevents copying the saved credential to another user or computer; it does not isolate it from programs running as the same Windows user.

Automatic uploads remain **unverified**, including successful OCR. They populate the shared research database, not the browser's local history. There is no cloud history download or cloud correction screen yet. To inspect screenshots and correct a capture, use the optional local folder connection below. Reviewed sharing uses a separate key and the same capture ID, so a reviewed correction replaces the automatic candidate in the combined research view.

## Optional local review on the website

Open Fate Collector in desktop Chrome or Edge. Click **Connect folder**, choose the `captures` folder beside `FateCollector.ahk`, and allow read access. The helper creates it on startup; **Open capture folder** in its tray menu locates it. F9 captures then appear and save locally without pasting or clicking Save. Use **Edit details** for a misread; while connected, corrections save after a short typing pause.

Keep the website open for local intake. It checks the folder about every two seconds, but browser throttling or tab suspension can delay this. Files remain on disk and are caught up when the page resumes. After reopening, the browser may require **Resume local review** and renewed folder permission. **Disconnect** forgets this local link; it does not change the helper's cloud settings. Existing files in a newly connected folder are imported as well; already received or deliberately deleted captures are skipped.

Without a folder connection, paste with **Ctrl+V** or import the JSON backup and save manually. The clipboard fallback is still populated after F9. Other browsers can use this manual route. Local intake and edits do not automatically upload reviewed corrections.

The helper checks the foreground window class, executable name, and the installation's `Content.ggpk` or `Bundles2/_.index.bin` marker. Calibration stays in memory and follows the client if you move the window. Repeat **F6** and **F7** if you resize the client, change its UI scale, or move the panel within it. Press **F10** in the game to clear calibration. During an export, **F10** discards that export when the worker finishes.

The helper captures only on **F9**. It reads the selected screen region, replaces the clipboard contents and saves a local backup. Captures are staged in `captures/.pending` until cancellation is checked, then published into `captures`; the website and uploader read only completed top-level files. The helper does not automate game actions.

## If capture or OCR fails

- For an oversized selection, use **F6** and **F7** to select a smaller area. The bundle limit is 12 MiB including the embedded PNG.
- For a window error, return focus to the game, uncover the whole panel, and press **F9** again. If the game changed size or restarted, repeat calibration.
- If Windows OCR is unavailable or fails, import the saved bundle and read the image manually. Install the relevant OCR language feature in Windows if you want OCR for that language. The helper tries installed English first, then the Windows profile languages and any remaining installed recognizer.
- If PowerShell blocks the export, check that the helper files are in a writable folder and that your Windows policy permits local scripts. The helper requests `RemoteSigned` for its child process. If Windows marked the downloaded script as remote, unblock the reviewed copy in the file's **Properties** if your policy allows it.
- If auto-save is paused at 250 offers, export and remove older observations, then select **Resume local review**. New files stay on disk. Malformed files are reported without blocking valid files; repaired files are retried.
- If the selected folder was moved or is no longer accessible, choose **Disconnect**, then **Connect folder** to select the correct folder. Existing saved offers stay in the browser.
- If a restored metadata backup has no screenshot, import the original helper file again. Missing screenshot/OCR evidence is restored while existing card corrections and review status are preserved.
- If cloud upload is waiting for a connection, leave the helper running or restart it later. If the key was rejected, re-enter a valid capture key in **Cloud upload settings**. A rejected invalid/conflicting capture stays in the local capture folder; it is not marked as uploaded. Local browser capacity does not limit the cloud queue.

## Offline PNG and fixture test

From the repository root, use the following commands in Windows PowerShell 5.1. The first creates the same bundle from an existing PNG. The optional `-OcrLanguage` argument accepts an installed Windows OCR language tag such as `en-US`. The second exercises the exporter against an image generated locally by the test.

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\helpers\Export-FateCapture.ps1 -InputImage 'C:\path\to\offer.png'
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\helpers\tests\Test-FateCapture.ps1 -RequireOcr
```

The exporter prints the saved path and marks offline PNG bundles as fixtures. Exit codes `0`, `10`, and `11` indicate a saved bundle with OCR successful, unavailable, or failed, respectively. `-RequireOcr` makes the fixture test require successful recognition. The fixture verifies the bundle shape and OCR paths without opening the game.
