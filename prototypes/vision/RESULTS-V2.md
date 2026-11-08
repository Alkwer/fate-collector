# Visual prototype V2 — 8 November 2026

**All 18 omissions from V1 were recovered. On six new screenshots, known-icon
recall improved from 12/16 to 16/16, with one unsafe acceptance in both versions.**
The prototype remains local and unreviewed; it is not connected to F9 or uploads.

## Diagnosis and changes

The original 18 omissions were all **localized successfully** by V1. Classification
rejected them; none was caused by an absent search proposal.

| Cause | Omissions | Evidence and fix |
| --- | ---: | --- |
| Unequal effective resolution | 15 | V1 enlarged a 16px video patch and compared it with a sharper 24px reference. Reducing the reference to the available resolution passes the existing gates. This includes 13 blue-diamond and two gold-grid instances. |
| Invoked symbol variant and alignment | 3 | The active gold-grid differs from the offered-card reference. A crop from the existing reference merge image supplies that appearance. The best placement shifts by one pixel relative to the old grayscale proposal. |

`diagnosis-v1-18.json` records each expected class, original box, V1 rejection,
equal-resolution ablation and V2 match. Reproduce it with `diagnose_v1.py`.

V2 also searches a one-pixel neighbourhood for near-threshold reward proposals,
requires accepted local alignments to agree on the class, and suppresses overlaps
after classification so an unknown grayscale peak cannot discard a valid RGB
match. A saturation check prevents a desaturated glyph from borrowing the meaning
of a coloured reference. This fixed a regression on development images after
adding the invoked variant.

The score gate **0.86**, class-gap gate **0.07** and search gate **0.72** are unchanged.
There are eleven reference crops for eight icon motifs and two tiers. No new
test-image pixels entered the template bank. No dependencies were added.

## Measured results

Full-image scanning receives no label coordinates. Both versions use the same
annotations and one-to-one matching metric.

| Dataset and measure | V1 | V2 |
| --- | ---: | ---: |
| Former V1 holdout, now development: known icons | 4/22 | **22/22** |
| Former V1 holdout: incorrect accepted labels | 0 | 0 |
| New six-image test: known icons | 12/16 (75%) | **16/16 (100%)** |
| New test: accepted uncertain symbols | 1 | **1** |
| New test: precision among accepted icons | 12/13 (92.3%) | **16/17 (94.1%)** |
| New test: tiers | 12/12 | **12/12** |
| Three new frames without a Fate panel: accepted labels | 0 | **0** |

On the two new **720p positive frames alone**, V1 recognised 8/12 known icons,
V2 12/12, with no false acceptances. The remaining four known icons and the unsafe
acceptance are in the new 1080p press-kit frame. Labelled-patch classification
results are also retained in JSON; the table reports full-frame detection.

Other existing development images retain 22/22 reference icons and 4/5 related
validation icons, without incorrect accepted labels. The remaining related
validation miss is retained in the metrics. No evaluated scan was truncated.

## Remaining unsafe acceptance

In `v2-invoke-fates`, both versions identify `gold-axe` behind a translucent
tooltip. The dataset requires unknown for obscured symbols, so this counts as
**one false acceptance**, not an extra correct known icon. V2 reports similarity
0.8838 at `[535, 477, 24, 24]`. The colour guard handles loss of saturation, not
every form of occlusion/dimming. The other two uncertain symbols were rejected.

This remains a known limitation of frozen V2. The algorithm was not retuned after
observing the new test. Occlusion handling needs a subsequent revision and another
untouched test set before automatic use can be justified.

## Independence and audit trail

A separate annotation task selected and labelled the new images without running
either recognizer. Implementation was frozen before the main agent inspected
that set or its model outputs. The main agent then checked all six images and
added one omitted desaturated symbol **before the first model run**. Initial and
audited annotation hashes are in `v2-freeze.json`; recognizer, catalog, evaluator,
requirements and test-file hashes still match the frozen versions.

The new set contains one positive press-kit frame (`InvokeFates_1.png`), two
positive 720p panels at approximately 07:23:20 and 07:23:55, and three negatives:
a campaign boss, Atlas/inventory and combat. Sources and original/fixture hashes
are in `fixtures/holdout-v2.json`. Time links follow cached frame names and are
approximate. The positive video panels differ from the old 07:24:51–07:25:00
merge frames.

These are **new to this benchmark**, not new live captures. They come from the
same prerelease press kit/broadcast; scenes and repeated glyphs are correlated.
The new set covers five of eight icon motifs and only T2, with no new T3/T1
evidence. The old seven-instance T2/T3 set remains correct but is development
data. These small counts are not game-wide accuracy estimates.

## Reproduction and validation

From the repository root with the documented Python environment:

```powershell
python -m unittest discover -s prototypes/vision -p "test_*.py" -v
python prototypes/vision/diagnose_v1.py
python prototypes/vision/evaluate.py --output-dir prototypes/vision/output/development-v2
python prototypes/vision/evaluate.py --dataset prototypes/vision/fixtures/holdout-v2.json --output-dir prototypes/vision/output/new-v2
python prototypes/vision/evaluate.py --dataset prototypes/vision/fixtures/holdout-v2.json --baseline-v1 --output-dir prototypes/vision/output/new-v1
```

All **12 Python tests passed**, including regressions for unequal resolution,
desaturated glyph rejection, local alignment and obscured/unseen symbols. The
preserved V1 code/bank are `baseline_v1.py` and `fixtures/catalog-v1.json`.
`baseline-2026-11-08.json` remains unchanged. Machine-readable results:

- `development-v2-2026-11-08.json`
- `new-test-v1-2026-11-08.json`
- `new-test-v2-2026-11-08.json`

Numbered overlays were rendered and inspected, including a new 720p offer and
the remaining tooltip case. Application/helper code and production were not
changed. App/browser/native-helper tests were not rerun for this Python prototype;
the earlier app check belongs to the V1 record.
