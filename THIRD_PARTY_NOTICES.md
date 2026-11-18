# Third-party notices

The root [MIT license](LICENSE) covers original Fate Collector code and
documentation. It does not grant rights to third-party artwork, screenshots,
game text, data, names or trademarks. Those materials retain their owners' rights.

## One More Map

The Windows helper adapts capture, game-window checks and Windows OCR techniques
from [One More Map](https://github.com/Alkwer/one-more-map.github.io),
`public/voyage-import.ahk` at commit `9f704ce8c2b9cb2187c16586f0169227aad72266`.
The adapted components cover PowerShell/WOW64 handling, foreground game validation,
client-relative calibration, GDI/Windows Graphics Capture including float16 HDR,
Windows Runtime OCR and multi-pass contrast processing.
Its MIT copyright and license notice is retained verbatim in
[helpers/LICENSE.third-party.txt](helpers/LICENSE.third-party.txt) and included
in the downloadable helper alongside this notice and the Fate Collector license.

## Path of Exile and presentation material

Path of Exile names, artwork and game content belong to Grinding Gear Games and
their respective rights holders. Fate Collector is an independent community
project and is not affiliated with or endorsed by Grinding Gear Games.

Research evidence, visual-recognition fixtures, extracted icon templates and OCR
text include material from the
[Covens of Umbra press kit](https://web.poecdn.com/public/news/2026-11-07/Kits_for_press_exc26/PoE1_CovensofUmbra_PressKit.zip)
and [recorded presentation](https://www.youtube.com/watch?v=8FKW2rKJyxA).
Source URLs, timestamps and hashes are documented in `research/`,
[the fixture manifest](prototypes/vision/fixtures/dataset.json),
[the visual prototype guide](prototypes/vision/README.md) and
[the OCR fixture provenance](tests/fixtures/README.md).
The project's MIT license does not relicense these materials or the presenters'
likenesses. Consult the original rights holders' terms before reusing them.

## PoEDB reference data and artwork

The offline Fate and reward references were transcribed from
[PoEDB Fates](https://poedb.tw/us/Fates), checked on 16 November 2026. Game text and
artwork remain the property of Grinding Gear Games. The eight original WebP
portraits mirrored by PoEDB have individual source URLs and SHA-256 hashes in
[PoEDB artwork credits](public/game-art/poedb/credits.json). Data provenance and
official patch corrections are recorded in [the catalog report](research/POEDB_CATALOG_2026-11-16.md).
The project license does not relicense this material.

The offline icon picker uses the 38 original GGG reward images from the same
PoEDB table. Their filenames and original CDN URLs are recorded in
[`shared/poedb-catalog.json`](shared/poedb-catalog.json).
The native overlay displays 32-pixel PNG renditions of the same sourced
reward artwork used in the web advisor.

## Dependencies

The Windows helper packages the Microsoft Edge WebView2 SDK version 1.0.3537.50
from [Microsoft.Web.WebView2 on NuGet](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3537.50).
Microsoft's SDK license and third-party notices are included as
`webview2/LICENSE.txt` and `webview2/NOTICE.txt`. The helper uses the WebView2
Runtime installed on Windows.

JavaScript and Python dependencies retain their own licenses. Their versions are
recorded in `package-lock.json` and `prototypes/vision/requirements.txt`.
