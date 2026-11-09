# Fate Collector Windows helper

Start with the [Windows capture guide](../docs/windows-helper.md). Keep all bundled `.ahk` and `.ps1` files in the same folder. Direct cloud upload is optional and configured from the helper's tray menu; it works with the website closed.

## Capture and OCR

- `Calibration.ahk` stores the panel rectangle as client-relative coordinates, requires a preview after a same-aspect resolution change, and rejects a changed aspect ratio.
- `CaptureImage.cs` checks visible windows above the game immediately before and after copying a GDI crop. In auto mode, SDR uses GDI for a clear crop and switches to window-targeted Windows Graphics Capture (WGC) if another window intersects it. HDR uses window-targeted WGC with float16 and reports backend failures. Explicit GDI rejects intersecting windows. Both backends return PNG bytes in memory and require the complete crop on one monitor.
- `Ocr.Common.ps1` and `OcrImage.cs` compare multiple OCR passes using percentile-contrast processing. Original pixels remain intact; one OCR pass supplies all returned text/geometry.
- `fate-names.json` is packaged from the same small prerelease catalog as the web parser. The catalog is not exhaustive. No approximate match or recognition result implies manual review.

Keep all `.ahk`, `.ps1`, `.cs` and JSON files together when updating the release. CI runs the AutoHotkey syntax and calibration tests. Run `node scripts/test-helper.mjs backend -RequireCleanGdi` before release on an interactive desktop with no overlapping windows. The test uses a generated window and ordinary and translucent overlays. Check the supported game display modes on a real HDR monitor separately. GDI samples window order around the copy, so an overlay that appears and disappears within that interval can escape the check. Select WGC explicitly if window isolation is required for SDR.

## Upload recovery

The uploader pauses when a gate is corrupt. Review the policy and enable upload again to start with a new consent. The old gate and captures stay on disk. A corrupt consent confirmation is replaced only after the collection confirms the same consent again. Withdrawal uses the original marker and token to recover a damaged receipt or retry record. Replaced corrupt metadata is kept in sibling `.corrupt` files.

## Upload scan benchmark

Run `helpers/tests/Measure-UploadScan.ps1` in Windows PowerShell 5.1. It seeds previously processed files and times a full cycle that discovers and sends one new synthetic capture through a fake transport.

| Processed files | Median cycle before | Median cycle after | Other I/O operations before / after |
| ---: | ---: | ---: | ---: |
| 1,000 | 345 ms | 113 ms | 9,863 / 4,843 |
| 10,000 | 2,925 ms | 842 ms | 91,314 / 41,291 |

Five warm runs per size on local Windows. The new capture was sent in the first cycle in all runs. Both versions used 22 process read operations (13,607 bytes) and four writes per run. Median working set deltas were 0.0 / 6.9 MiB at 1,000 and 0.3 / 0.0 MiB at 10,000, with allocator and garbage collection noise. Timing covers one uploader invocation with no network and excludes the tray schedule. Enumeration still checks the archive on each invocation, so a restart can discover a file written before it reached the queue.

## Licenses

Component attribution is recorded in [third-party notices](../THIRD_PARTY_NOTICES.md).
The [component license](LICENSE.third-party.txt) is included in every helper package.
