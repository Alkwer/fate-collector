# Game artwork in the decision UI

Path of Exile artwork is © Grinding Gear Games. These are reference crops from
the existing evidence corpus, not generated or reconstructed artwork. The UI
uses them to identify Fates and recorded reward motifs in both themes.

## Sources and coverage

- [GGG Covens of Umbra press kit](https://web.poecdn.com/public/news/2026-11-07/Kits_for_press_exc26/PoE1_CovensofUmbra_PressKit.zip):
  Alchemist, Sanguine, Butcher, Gravewalker, Torchbearer, Tempest, Stormcaller,
  Houndmaster; eight reward motifs. Local originals: `press-offer-a.png` and
  `press-offer-b.png` under `prototypes/vision/fixtures/images/`.
- [GGG Day 1, 03:14:42](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=11682s):
  Bloodthirsty, Deathbringer and Dryad.
- [GGG Day 1, 03:15:02](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=11702s): Conjurer.
- [GGG Day 1, 07:23:55](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=26635s): Avalanche.
- Three tooltip-verified reward references retain the exact existing pixels and
  provenance from `shared/reward-icons.json`.

Coverage is 13 of the 17 currently recognized Fate names. Wildfire, Doomsayer,
Incandescent and Crowkeeper have no verified portrait in the available local
corpus. Unknown names also show **Artwork unavailable**. Avalanche's source is
a smaller, compressed video frame; no artificial detail is added to it.

`public/game-art/credits.json` lists the source file, public URL, source SHA-256,
crop rectangle `[x, y, width, height]`, and output SHA-256 for every raster.
Portraits are lossless WebP crops. Reward PNGs retain the existing reference
bytes. No remote image service, runtime fetch to a third party, or new runtime
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
