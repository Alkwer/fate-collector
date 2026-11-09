# Fate Collector Windows helper

Start with the [Windows capture guide](../docs/windows-helper.md). Keep all bundled `.ahk` and `.ps1` files in the same folder. Direct cloud upload is optional and configured from the helper's tray menu; it works with the website closed.

## Capture and OCR

- `Calibration.ahk` stores the panel rectangle as client-relative coordinates, requires a preview after a same-aspect resolution change, and rejects a changed aspect ratio.
- `CaptureImage.cs` captures with GDI for SDR or Windows Graphics Capture / float16 for HDR. It returns PNG bytes in memory, rejects truncated/multi-monitor regions and reports WGC failure instead of silently falling back to GDI on HDR.
- `Ocr.Common.ps1` and `OcrImage.cs` compare multiple OCR passes using percentile-contrast processing. Original pixels remain intact; one OCR pass supplies all returned text/geometry.
- `fate-names.json` is packaged from the same small prerelease catalog as the web parser. The catalog is not exhaustive. No approximate match or recognition result implies manual review.

All `.ahk`, `.ps1`, `.cs` and JSON files in the release ZIP are required. Do not replace only the main script when updating. The native backend test covers a generated SDR fixture (including the float16 path), not a live HDR game session.

## Licenses

Component attribution is recorded in [third-party notices](../THIRD_PARTY_NOTICES.md).
The [component license](LICENSE.third-party.txt) is included in every helper package.
