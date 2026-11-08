# Whole-offer prototype — 8 November 2026

Historical V1 results. See [whole-offer V2](OFFERS-V2.md) for the three resolved
omissions, current OCR adapter, native-image validation and current run commands.

`offers.py` joins positioned Windows OCR with the frozen V2 icon/feather scanner.
It returns individual cards in `offered`, `collected` and `invoked`, plus a separate
shared reward bar. This is a local research command; it does not change the
collector, F9 capture, browser data or uploads.

## Measured results

Six manually annotated prerelease scenes contain 15 offered, five collected and
five invoked cards. The annotations were prepared separately from implementation
and checked against rendered output. These are **development scenes from existing
press/showcase material**, not an untouched test set or live gameplay captures.

| Measure | Result |
| --- | ---: |
| Correct screen mode | 6/6 |
| Cards located in the correct group and horizontal order | 25/25 |
| Correct names | 23/25 |
| Unknown names / incorrect accepted names | 2 / 0 |
| Correct tiers (all T2 in these scenes) | 25/25 |
| Visible known symbols attributed to the correct card | 33/33 |
| Visible known symbols on the shared invocation bar | 2/3 |
| Incorrect accepted or unattributable symbols | 0 |
| False cards on two negative Atlas/combat scenes | 0 |

The two unresolved names are OCR `Dwad` for Dryad and `Stormcalter` for Stormcaller.
Their original text is retained and `name` stays null. No fuzzy correction or
inference from the card illustration is used. Spacing/case normalization accepts
`Torch bearer` as Torchbearer.

The unresolved shared symbol is gold-grid in `press-invoke`, with similarity
0.8299 below the unchanged 0.86 acceptance gate. It remains unknown. Hover/cursor
appearance differs from the reference; this layer does not change V2 templates
or lower thresholds to accept it.

The known unsafe V2 gold-axe acceptance behind the translucent Torchbearer tooltip
is suppressed by the new occlusion layer. The title of that tooltip does not
create another card. The parser also keeps repeated symbols, such as Avalanche's
two rings, and separates two Torchbearer cards in different rows.

## Resolution and regression checks

Two existing scenes (offer with a raised card; invocation with an obscuring
tooltip) were each resized with Lanczos to 1280×720, 2560×1440 and 3840×2160.
**Every image went through a fresh Windows OCR call**. Across those six controlled
variants, grouping, names and tiers were correct for 27/27 card occurrences;
36/36 visible card symbols were correct, with no accepted obscured shared symbol.
These are synthetic resolution checks, not six independent scenes.

All **28 Python tests passed**: 12 preserved V2 tests and 16 input/whole-offer tests.
They cover row separation, a raised card, repeated names and symbols, unknown OCR,
missing tier detections, the shared bar, tooltip masking, negative screens,
uncertain row boundaries, unavailable OCR, truncated searches and input geometry.
An additional CLI smoke check reads an actual JSON produced by the existing helper.
Rendered overlays were inspected at 720p and 1080p.

The V2 recognizer, reference catalog, evaluator, requirements and original tests
remain unchanged relative to `v2-freeze.json`. Application/browser/live-game test
suites were not rerun because their code was not modified.

Recorded results:

- [Whole offers](offers-2026-11-08.json)
- [Controlled resolution checks](offer-scales-2026-11-08.json)
- [Manual expected cards](fixtures/offers-expected.json)
- [Real, unedited Windows OCR records](fixtures/ocr/)

## Run

Use the Python environment described in [README.md](README.md), from the repository
root. Outputs and overlays are a separate prototype schema, **not collector import
files**.

```powershell
# Saved screenshot: Windows OCR runs locally using the existing helper.
python prototypes/vision/offers.py screenshot.png --output offer.json --overlay offer.png

# Existing helper capture: reuse its embedded pixels and positioned OCR.
python prototypes/vision/offers.py fate-capture.json --output offer.json --overlay offer.png

# Reproducible, platform-independent example with recorded OCR bound to pixels.
python prototypes/vision/offers.py prototypes/vision/fixtures/images/press-offer-b.png --ocr prototypes/vision/fixtures/ocr/press-offer-b.json --output offer.json --overlay offer.png

python -m unittest discover -s prototypes/vision -p "test_*.py" -v
python prototypes/vision/evaluate_offers.py

# Windows only: actual OCR on six resized variants (results in output/offer-scales).
python prototypes/vision/evaluate_offer_scales.py

# Windows only: rebuild source OCR records if intentionally refreshing the baseline.
python prototypes/vision/prepare_offer_ocr.py
```

The screenshot path uses `Export-FateCapture.ps1 -InputImage` in a temporary
directory below `prototypes/vision/output/ocr-work`, cleaned after the OCR call.
This helper mode does not capture a window, send input to the game or upload data.
Screenshots below 1080p are enlarged 2× for OCR, then coordinates are mapped back.
Icon scanning continues to use original pixels. Existing capture JSON retains its
original OCR; it is not silently rerun or enlarged.

## Interpretation and limits

- Each card includes `name`, `rawNameText`, `tier`, their candidate/unknown statuses,
  image regions and `rewardSymbols`. An exact known OCR header on parchment can
  preserve a card whose feathers were not recognized; its tier remains unknown.
- Screen labels establish offer versus invocation. Confirm separates the rows;
  when its text is obscured, a sufficiently large gap between two card rows can
  establish the boundary. Ambiguous cards go to `unassignedCards`.
- Tooltip detection groups specific English OCR phrases and checks for a dark
  panel in the pixels. Overlapping detections become unknown and lose semantic
  fields. Manual occlusion boxes are used only for documentation, never inference.
  Other tooltip styles, missing OCR or arbitrary overlays are not covered.
- Presenter overlays are not detected as masks. In the tested example they cover
  rewards; no symbol is accepted there, and the card's rewards remain unknown.
- `sharedRewardSymbols` describes the invocation bar without assigning its symbols
  to individual invoked cards. A recognized shape does not establish activation,
  quantities, combinations or reward probabilities.
- `rewardSymbols` also retains rejected search proposals. Their count is **not**
  the number of unknown rewards; background or overlays can produce proposals.
  No accepted symbols means unknown coverage, never proof of zero rewards.
- `complete` and `reviewed` are always false. This is not a human approval action.
  Supported motif/tier templates remain limited to V2's eight motifs and T2/T3;
  the whole-offer benchmark covers only T2.
- Geometry assumes full frames with the observed layout and proportional UI size.
  `--ui-scale` is manual (0.5–2). HDR, cropped panels, arbitrary aspect ratios,
  translated game text, other UI layouts and native live captures are unvalidated.
- A recorded OCR fixture must match the exact image SHA-256 and dimensions. OCR
  coordinates and input sizes are bounded; helper JSON input is limited to 12 MiB.

Before integrating this into the collector, use a new independent set of native
captures and add a review path for unknown names, symbols and incomplete coverage.
