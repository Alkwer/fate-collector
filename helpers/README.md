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
