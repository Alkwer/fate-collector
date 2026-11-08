# Fate visual recognition prototype V2

Offline recognition of **eight visual reward motifs and Fate tiers 2/3** from
screenshots. It scans pixels without receiving the annotated target coordinates.
It writes candidate regions, similarity scores, explicit unknowns and an optional
numbered image. No game capture, uploads or changes to browser records occur.

This is a research command, **not part of the F9 helper or production parser**.
V2 recovers all 18 omissions from the original 720p development set. On six new
screenshots it identifies 16/16 known icons (V1: 12/16), with one unsafe acceptance
under a tooltip in both versions. See [the V2 report](RESULTS-V2.md) and the
unchanged [V1 baseline](RESULTS.md). This is not yet reliable automatic ingestion.

The [whole-offer reader V2](OFFERS-V2.md) combines this frozen scanner with Windows
OCR, card/row association, tooltip masking and evidence-based refinements. It
recognizes 25/25 names, 33/33 card symbols and 3/3 shared symbols in six development
scenes. Six newly tested native game images were negatives; a fresh positive
native holdout is still missing. Use `offers.py` for that layer; `recognize.py`
below remains the unchanged V2 visual baseline. [Whole-offer V1](OFFERS.md) remains
available as a historical report.

## Run

Use Python 3.12+ in an optional virtual environment; the app itself still needs
only its existing Node/Windows dependencies. Run from the repository root:

```powershell
python -m venv prototypes/vision/.venv
prototypes/vision/.venv/Scripts/python.exe -m pip install -r prototypes/vision/requirements.txt
prototypes/vision/.venv/Scripts/python.exe -m unittest discover -s prototypes/vision -p "test_*.py" -v
prototypes/vision/.venv/Scripts/python.exe prototypes/vision/evaluate.py
prototypes/vision/.venv/Scripts/python.exe prototypes/vision/evaluate.py --dataset prototypes/vision/fixtures/holdout-v2.json --output-dir prototypes/vision/output/new-v2
prototypes/vision/.venv/Scripts/python.exe prototypes/vision/recognize.py screenshot.png --output result.json --overlay result.png
```

On macOS/Linux the virtual-environment interpreter is `.venv/bin/python`.
`evaluate.py` creates the ignored `prototypes/vision/output/` directory with
`metrics.json`, per-image JSON and numbered overlays. No network is used after
dependency installation. Pillow decodes images; NumPy performs local matching.

The default scale assumes an **uncropped, full game frame** with the preview UI's
proportions. Resolution is normalized to at most 1080p; smaller images are not
upscaled before scanning. `--ui-scale 1.25` permits an explicit size adjustment.
For a cropped 1080p panel 600 pixels high, for example, the corresponding factor
is `1080 / 600 = 1.8`. This is a manual prototype parameter, not automatic layout
or crop calibration. HDR, arbitrary aspect ratios, partial panels and other game
UI scales are unvalidated. Inputs are capped at 8192 px / 16,777,216 pixels.

## What a result means

- `status: candidate` identifies a visual motif; it never implies human review.
- `visualId` identifies the symbol, independently of the card name. Eight IDs:
  `blue-diamond`, `gold-stack`, `gold-grid`, `gold-ring`, `silver-cluster`,
  `orange-feathers`, `three-gems`, `gold-axe`.
- `tier` is populated only for a matching `tier-2` or `tier-3` feather patch.
  Tier 1 and any other tiers have no templates and have not been validated.
- `reward` remains null except for the gold-grid motif, supported by the
  Currency Items tooltip in the press-kit invocation image. Its `kind` and
  `threshold` remain unknown. A visual match does not establish combo activation,
  a reward quantity or the actual item outcome.
- `status: unknown` means a search proposal did not pass the score and ambiguity
  checks. These include background false proposals; **their count is not a count
  of unidentified reward icons**. A wholly new symbol may generate no proposal.
- `score` and `margin` are similarities, **not calibrated probabilities**.
  Uncertain predictions expose neither a guessed label nor a guessed tier.
- `complete` and `reviewed` are always false. In `recognize.py` there is no card association, OCR,
  offered/collected/invoked row separation or automatic offer construction.
- `truncated` reports reaching the bounded proposal budget. Such an image must
  not be interpreted as complete. Every result already remains incomplete.

Only accepted candidates are drawn in the overlay to keep the source readable;
rejected proposals remain in JSON. No confidence field is added to the existing
offer schema, and no candidates enter the shared research database.

## Method and fixture provenance

The scanner proposes local peaks using normalized grayscale cross-correlation.
It then compares each patch against all classes in its family using RGB shape
and colour similarity, with a minimum similarity of **0.86** and a minimum
best-versus-next-class gap of **0.07**. Both patches are first reduced to the
available native resolution. A one-pixel local alignment search can rescue
near-threshold reward proposals; conflicting accepted classes remain unknown.
Colour loss is checked against the winning reference, and overlap suppression
prioritizes accepted results. The original thresholds have not been relaxed.

`fixtures/catalog.json` contains eleven crops from three **reference** frames only.
`fixtures/dataset.json` records source URLs, original/derived SHA-256 hashes,
image dimensions, splits and manual boxes. The annotations are read only by the
evaluator, never by `scan`. Preparing fixtures does not learn from the holdout.

- Reference: `Fates_UI.png`, `Fates_UI_2.png` from the
  [GGG press kit](https://web.poecdn.com/public/news/2026-11-07/Kits_for_press_exc26/PoE1_CovensofUmbra_PressKit.zip),
  plus the [presentation's merged Conjurer](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=11703s).
- Validation: `InvokeFates_2.png` and the
  [Exceptional Gem tooltip](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=11677s).
  These are related presentation assets, not independent gameplay samples.
- Former V1 holdout, now V2 development: three frames of the
  [DatModz/Octavian merge sequence](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=26691s)
  and one gameplay frame without a Fate panel. None contributes template pixels.
  The three adjacent frames are correlated; repeated icons are not independent
  reward rolls or evidence of probabilities.

`fixtures/holdout-v2.json` adds six new benchmark frames. They were independently
annotated and checked after the V2 code freeze but before running the models.
None contributes template pixels. The original V1 code and catalog remain
available through `evaluate.py --baseline-v1`; use `--dataset` to select the new
manifest. The freeze hashes and both model reports are linked from RESULTS-V2.md.

The 4K press-kit frames are resized to 1920×1080 with Lanczos. Video frames retain
their existing 1920×1080 or 1280×720 size. Game artwork belongs to GGG. Existing
research evidence was copied, not modified. The dataset is prerelease evidence,
not live observations. The stored fixtures make the benchmark self-contained;
rebuilding them additionally requires the original press images and the existing
`research/evidence/` directory:

```powershell
python prototypes/vision/prepare_fixtures.py PATH_TO_EXTRACTED_PRESS_IMAGES
```

To compare a new algorithm, preserve both baselines, use the current holdout as a
development set once inspected, and acquire a new untouched scene for final
evaluation. Broader deployment needs more icon variants, negative examples,
scale/occlusion coverage, semantic tooltip evidence and card/row association.
