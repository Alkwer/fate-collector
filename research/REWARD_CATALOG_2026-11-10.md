# Reward catalog evidence — 10 November 2026

The catalog was checked against the existing original GGG press images and video
frames below. This is prerelease evidence, not a live-game verification. The web
reader returned no usable Covens page text and could not fetch the YouTube video;
the observations here come from the locally preserved source frames.

| Motif | Evidence and supported mapping | Import behavior |
| --- | --- | --- |
| `orange-feathers` | `evidence/flask-tooltip-03h14m57.png`: Dreadmaidens' Sacrament, unique Basalt Flask, two matching copies. Same colour motif and combo border in `prototypes/vision/fixtures/images/press-offer-b.png` and under Stormcaller in the Item Rarity frame. | Suggest combo (2), identified meaning, but leave the full reward review false. The small matcher crop does not independently verify the whole border. |
| `gold-ring` | `evidence/item-rarity-03h13m57.png`: Item Rarity, three copies in the shown combo variant. `prototypes/vision/fixtures/v2/images/invoke-fates.png` shows the coloured ring on Torchbearer before it enters the combined row. Other cards show the centre motif without that border. | Suggest the name only; kind unknown, threshold null, unidentified. Selecting the verified combo in the editor is explicit. |
| `gold-grid` | `prototypes/vision/fixtures/images/press-invoke.png`: additional Currency Items. `evidence/duplicates-after-03h15m03.png` also shows a combo-border variant. | Suggest Additional Currency Items; kind unknown, threshold null, unidentified. No currency quantity, pool or combo threshold is inferred. |
| `three-gems` | Present in the press images and Conjurer sequence, but no identifying tooltip. | Remains unknown. It is **not** the Exceptional Gem icon. |
| `blue-diamond` | `evidence/showcase-merged-07h24m55.png` identifies one instance as additional Rare Swords and a Speed modifier on swords dropped by the empowered monster. | Remains unknown: there is insufficient evidence that every copy denotes that exact item type/modifier. |
| `gold-stack`, `silver-cluster`, `gold-axe` | Motifs visible in the press images; no identifying tooltip in the inspected evidence. | Remain unknown. |

Exceptional Gem is a separate icon outside the eight-motif recognizer. Its tooltip
in `evidence/exceptional-tooltip-03h14m37.png` confirms combo (3), and
`evidence/exceptional-combo-03h14m42.png` shows activation. It is available for
manual catalog selection only. Fate names do not identify their rewards.

Primary source links and paraphrased effects live in `shared/reward-catalog.ts`.
The three small display references in `shared/reward-icons.json` record source
paths, original pixel boxes and SHA-256 hashes. They are regenerated alongside the
unchanged visual matcher bank by `scripts/generate-visual-templates.py --check`.
The display crops do not extend or retrain the matcher. The frozen prototype
catalog, annotations and benchmarks remain unchanged.

`rewards-v1` is appended to each fresh card's visual-review version. Previously
saved offers and manual corrections are never backfilled. The user must check
all visible icons, meanings, kinds, counts and thresholds; `identified` alone does
not approve the image match or completeness. Counts are icon occurrences, not
predicted item quantities. Selecting a catalog entry preserves the row ID, count
and original matched motif and resets the reward review.
