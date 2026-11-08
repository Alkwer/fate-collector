# Whole-offer V2 — corrected names, cursor-border icon and native-image checks

The three reported omissions are fixed in the local whole-offer reader. The six
development scenes now yield **25/25 names, 33/33 card symbols and 3/3 visible
shared-bar symbols**, with no incorrect accepted labels. Card grouping and tiers
remain 25/25. Results remain unreviewed and incomplete by design.

The requested test on **new native positive Fate scenes is still unavailable**.
The local game screenshot folder contains eight archived images with 2024 file
timestamps. Six were independently inspected before model execution: none contains
a Fate panel. The main agent checked two representative annotations as well.
Renaming the Codex project did not move its directory: `poe1-fate-collector` still
points at the existing `ChatGPT/poe1` workspace.

## Changes and evidence

### Names

Low-resolution header OCR confused Dryad with `Dwad` and Stormcaller with
`Stormcalter`. For an unknown name on a detected card, the Windows CLI now reads
the header twice at predetermined sizes after grayscale contrast normalization.
It requires both readings to select the same nearby catalog name, with a minimum
gap to the next dictionary entry and compatibility with the original OCR.

Recorded readings are `Dtyad` / `Dtyad` and `Stormca!tet:` / `St0rmcaltet:`. They
produce Dryad and Stormcaller using general edit-distance rules; no aliases for
these specific errors are hardcoded. This is **dictionary-assisted OCR**, not an
exact OCR reading or a calibrated confidence estimate. The repeated reads use
the same OCR engine and are correlated.

Conflicting, absent or ambiguous readings stay unknown. Repeatedly reading the
same noncatalog word is also insufficient to replace it with a catalog name;
the regression test covers `Dread`, a one-letter neighbour of Dryad. Original
`rawNameText`, the two additional readings, method and edit distances remain in
JSON. Corrected names carry an asterisk in the overlay. Similar unseen names can
still confuse this finite dictionary, so human review remains necessary.

### Icon

The missing gold-grid's lower-right border is overlapped by the cursor. Expanding
the alignment search did not help: the original placement still scored best at
0.8299. Two interior crops score **0.9166 and 0.9358**, identifying the glyph without
the damaged outer border.

The additional check applies only to ambiguous reward detections inside an
established card reward region or shared bar. It requires whole-patch similarity
at least 0.80, agreement with its best class, two interior scores at least 0.90,
and both class margins at least 0.10. Tooltip masks and missing-colour failures
remain unknown. No image or label from the new native negatives was added to the
template bank. Frozen `recognize.py` and its V2 templates/thresholds are unchanged.

### Native image input

The existing capture helper refuses PNGs of 9 MiB or larger to keep its embedded
image bundle below 12 MiB. Several original 4K game screenshots exceed that limit.
The prototype now uses `Read-ImageOcr.ps1`, an OCR-only adapter based on the existing
helper's OCR functions. It returns text/geometry without embedding an image in
JSON. Original native pixels are retained for image input and OCR; the visual
scanner still performs its documented internal normalization to at most 1080p.
Production helper/capture/upload code and their limits are unchanged.

## Validation

| Set | Result | What it establishes |
| --- | --- | --- |
| Six existing development scenes | 25/25 cards, names and tiers; 33/33 card symbols; 3/3 shared symbols; zero wrong acceptances | Repairs the three known omissions, preserving grouping and tooltip abstention |
| Six newly tested genuine local 3840×2160 screenshots | OCR succeeded without input resizing; zero detected cards or accepted symbols | Negative testing on real native images; these archived scenes contain no Fate panel |
| Four original 3840×2160 press PNGs | 17/17 cards, names and tiers; 21/21 card symbols; 3/3 shared symbols; zero wrong acceptances | Native positive-image input works on known scenes; these are not new scenes or an untouched holdout |
| Python regression suite | 32/32 passed | Existing 28 checks plus refinement, dictionary ambiguity and unseen/occluded-symbol checks |

CLI output and overlays were checked, including the corrected 720p header. The
actual OCR-only adapter ran on all six local native screenshots and all four
original press PNGs. Original images were not modified or copied into tracked
fixtures. No native game session, fresh positive capture, F9 integration or
production deployment was performed. The remaining validation gap is independent
native captures containing Fate panels, including new names/symbols and layouts.

Machine-readable records:

- [Development results](offers-v2-2026-11-08.json)
- [Native negative results](native-negatives-2026-11-08.json)
- [Original 4K press results](native-press-2026-11-08.json)
- [Additional header OCR](fixtures/ocr-headers/), bound to original image hashes
- [Local screenshot inventory](fixtures/native-candidates.json), including two uninspected images excluded from the test

## Reproduce

Use the Python environment from [README.md](README.md), in the repository root:

```powershell
python -m unittest discover -s prototypes/vision -p "test_*.py" -v
# Recorded OCR; portable, no Windows OCR call or network required.
python prototypes/vision/evaluate_offers_v2.py

# Windows: reread ambiguous headers and test local native negatives.
python prototypes/vision/evaluate_offers_v2.py --record-headers --native-directory PATH_TO_LOCAL_SCREENSHOTS

# Windows: verify original hashes and run native press PNGs from a local folder.
python prototypes/vision/evaluate_native_press.py PATH_TO_ORIGINAL_PRESS_IMAGES

# Windows: complete screenshot/capture pipeline, including extra header OCR.
python prototypes/vision/offers.py screenshot.png --output offer.json --overlay offer.png
```

The native screenshot files are not included in the repository. Their manifest
contains filenames and hashes; pass their local directory explicitly.

`recognize_offer(..., header_reader=...)` accepts either real or recorded header
readings. Without that optional reader it applies visual refinement but retains
unresolved names; the Windows CLI supplies the local reader automatically.
`assemble_offer` remains the deterministic association layer exercised by the
earlier regression tests. The historical [V1 report](OFFERS.md) and its JSON
results are preserved; `evaluate_offers_v2.py` is the current evaluator.
