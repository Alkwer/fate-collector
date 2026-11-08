# Fate Collector Windows helper

Start with the [Windows capture guide](../docs/windows-helper.md). Keep all bundled `.ahk` and `.ps1` files in the same folder. Direct cloud upload is optional and configured from the helper's tray menu; it works with the website closed.

## Source attribution

The helper adapts parts of `public/voyage-import.ahk` from One More Map at commit `9f704ce8c2b9cb2187c16586f0169227aad72266`. Copyright (c) 2026 one-more-map and contributors. See the [included license](LICENSE.one-more-map.txt).

- Windows PowerShell system path and WOW64 handling. [Lines 263–277](https://github.com/Alkwer/one-more-map.github.io/blob/9f704ce8c2b9cb2187c16586f0169227aad72266/public/voyage-import.ahk#L263-L277)
- Foreground game validation and installation markers. [Lines 315–331](https://github.com/Alkwer/one-more-map.github.io/blob/9f704ce8c2b9cb2187c16586f0169227aad72266/public/voyage-import.ahk#L315-L331) and [lines 346–390](https://github.com/Alkwer/one-more-map.github.io/blob/9f704ce8c2b9cb2187c16586f0169227aad72266/public/voyage-import.ahk#L346-L390)
- Calibration relative to the game client area. [Lines 448–469](https://github.com/Alkwer/one-more-map.github.io/blob/9f704ce8c2b9cb2187c16586f0169227aad72266/public/voyage-import.ahk#L448-L469)
- Windows Runtime OCR, language selection, and OCR line bounds. [Lines 1607–1723](https://github.com/Alkwer/one-more-map.github.io/blob/9f704ce8c2b9cb2187c16586f0169227aad72266/public/voyage-import.ahk#L1607-L1723) and [lines 1876–1914](https://github.com/Alkwer/one-more-map.github.io/blob/9f704ce8c2b9cb2187c16586f0169227aad72266/public/voyage-import.ahk#L1876-L1914)
- GDI screen-region capture. [Lines 1829–1856](https://github.com/Alkwer/one-more-map.github.io/blob/9f704ce8c2b9cb2187c16586f0169227aad72266/public/voyage-import.ahk#L1829-L1856)

The upstream repository includes a scope notice for third-party material. [Upstream license](https://github.com/Alkwer/one-more-map.github.io/blob/9f704ce8c2b9cb2187c16586f0169227aad72266/LICENSE)

## Additional adaptations in helper 0.3.0

- `Calibration.ahk`: saved client-relative coordinates, inspired by upstream lines 433–469. Fate stores only the panel rectangle, requires a preview after a same-aspect resolution change, and rejects a changed aspect ratio.
- `CaptureImage.cs`: the Windows Graphics Capture / float16 HDR implementation from upstream lines 1008–1600. Fate returns PNG bytes in memory, rejects truncated/multi-monitor regions and reports WGC failure instead of silently falling back to GDI on HDR.
- `Ocr.Common.ps1` and `OcrImage.cs`: the multiple-pass and percentile-contrast ideas from upstream lines 909–1006 and 1754–1788, adapted to Fate text. The Voyage-specific purple mask and numeric scoring are not copied. Original pixels remain intact; one OCR pass supplies all returned text/geometry.
- `fate-names.json` is packaged from the same small prerelease catalog as the web parser. The catalog is not exhaustive. No approximate match or recognition result implies manual review.

All `.ahk`, `.ps1`, `.cs` and JSON files in the release ZIP are required. Do not replace only the main script when updating. The native backend test covers a generated SDR fixture (including the float16 path), not a live HDR game session.
