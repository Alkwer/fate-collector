# Game artwork in the decision UI

Path of Exile artwork is © Grinding Gear Games. These are reference crops from
official press images, the announcement gallery and video, not generated or
reconstructed artwork. The UI
uses them to identify Fates and recorded reward motifs in both themes.

## Sources and coverage

- [GGG Covens of Umbra press kit](https://web.poecdn.com/public/news/2026-11-07/Kits_for_press_exc26/PoE1_CovensofUmbra_PressKit.zip):
  Alchemist, Sanguine, Butcher, Gravewalker, Torchbearer, Tempest, Stormcaller,
  Houndmaster; eight reward motifs, Item Rarity and the orange-feather motif
  already verified for Dreadmaidens' Sacrament. Use the original **3840 × 2160**
  `Fates_UI.png`, `Fates_UI_2.png` and `InvokeFates_1.png` members, not the
  downsampled recognition fixtures. Portrait crops are now 220 × 220 and the
  reward motifs 48 × 48 (Item Rarity 68 × 72).
- [GGG announcement panel](https://web.poecdn.com/protected/image/promo/covensofumbra/Panel2.webp?key=YMNn1CjhLYc1njLU_aQHWA):
  Doomsayer and Wildfire, 160 × 160 crops from the original 1920 × 776 image.
- [GGG gallery screenshot](https://web.poecdn.com/protected/image/promo/covensofumbra/Screenshots/Panel2/Screenshot1.webp?key=aoza73oYjHDwS-f-KkKchg):
  Incandescent (208 × 208) and Crowkeeper (216 × 216), from the full 3840 × 2160
  screenshot. Both names are readable in the source. These files are linked by
  the public [Covens announcement](https://www.pathofexile.com/covens).
- [GGG trailer, 00:36](https://www.youtube.com/watch?v=XaySR0RjRPA&t=36s):
  Dryad, a 250 × 250 crop from the native 3840 × 2160 video frame.
- [GGG Day 1, 03:14:40](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=11680s):
  Bloodthirsty, Deathbringer and the Exceptional Gem reference.
- [GGG Day 1, 03:15:02](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=11702s): Conjurer.
- [GGG Day 1, 07:23:55](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=26635s): Avalanche.
- Day 1 uses native **2560 × 1440** frames: 138 × 138 portraits for Bloodthirsty,
  Deathbringer and Conjurer, 124 × 124 for Avalanche, and 45 × 40 for Exceptional
  Gem. These retain video compression; no upscaling, sharpening or generated
  detail is applied. The same motifs remain mapped to the existing verified
  meanings in `shared/reward-icons.json`; recognition reference bytes are unchanged.

Coverage is **all 17 currently recognized Fate names**. Unknown names and failed
loads still show **Artwork unavailable**. Smaller sources are centered within
the portrait area and never enlarged past their native dimensions. Both themes
use the same local images and rendering limits.

`public/game-art/credits.json` lists the source file, public URL, source SHA-256,
crop rectangle `[x, y, width, height]`, source/output dimensions, and output
SHA-256 for every raster. Press-kit records also identify the ZIP member;
video records give the timestamp and native-resolution frame method. Source
names refer to the downloadable original or captured frame, not a committed
full-size screenshot. All assets are direct crops with no resize or filters.
Portraits are lossless WebP crops; rewards are PNG. No remote image service,
runtime fetch to a third party, or new runtime
dependency is needed.

## Interpretation boundaries

Only artwork is cropped from Fate cards. Name headers, tier feathers, modifiers
and reward rows are excluded. Displayed values always come from the current
offer/collection, never the reference screenshot. Exact normalized names select
portraits; no fuzzy or thematic substitutions are allowed.

Recorded `visualId` selects its existing motif, even when its meaning is unknown.
The unknown/review label remains visible. Without a visual ID, a confirmed label
may select one of the three tooltip references or the additional-currency motif.
`Currency` and `Currency Items` are display aliases for that sourced motif. This
does not merge solver labels or infer regular/combo kind, threshold or quantity.
Other labels retain a neutral symbol. No recognition templates or mechanics are
changed by the UI images.

The invocation guide preserves source indices and input reward counts so two
copies with identical artwork remain distinguishable. Only merges already
returned by the solver get a pictured T2 + T2 → T3 result. **Confirm in game** is
an instruction; **Done in game** records local completion and retains Undo.
