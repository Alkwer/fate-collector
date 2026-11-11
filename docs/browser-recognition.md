# Browser visual suggestions — 10 November 2026

The local capture importer now proposes supported tier feathers and icon motifs
before saving a fresh offer. It runs for connected F9 folders, pasted helper JSON
and manually imported helper captures. Plain PNG imports still have no positioned
OCR, so their images are preserved without invented card associations.

## Implementation and trust boundary

`shared/visual-recognition.ts` is a separate `browser-v1` implementation derived
from the prototype's reference crops, geometry and score gates. It is **not** a
binary port of the frozen Python scanner and its benchmark scores are separate.
It uses bounded OCR-guided regions, sampled grayscale proposals and bilinear RGB
comparison, not the prototype's full-frame FFT/Lanczos scan or header rereads.
The frozen Python code, bank and historical reports remain unchanged.

The production dictionary now also includes Dryad and Avalanche, read directly
from the preserved GGG showcase headers. [Versioned catalog provenance](../shared/catalog-metadata.json)
records the source/date and explicitly unresolved semantics. This expands name
recognition only; it does not associate rewards with those names or establish
native accuracy. [Production promotion](recognition-validation.md#required-promotion-artifact)
requires an exact-release native holdout report with minimum scene and label
coverage. The server verifies a local measurement; it does not replay private
captures or attest the physical HDR state.

The generated `shared/visual-templates.json` contains 11 small crops for eight
motifs and T2/T3, with source paths, original boxes and SHA-256 hashes. Regenerate
it with Python/Pillow using `scripts/generate-visual-templates.py`; `--check`
verifies reproducibility. No full screenshot is bundled in the app, no new runtime
package is required, and no pixels are sent to the backend.

The browser decodes PNG pixels in a dedicated Worker. The search requires the
same exact Fates/Confirm controls as text parser `prerelease-names-3`. A unique
vertically ordered pair must share a horizontal axis; a separate world-space
"Select a Fate" label no longer invalidates that pair. Missing controls or several
aligned pairs still cause abstention. Invoke Fates, including a title split across
adjacent OCR lines, is excluded. Cards below Confirm cannot supply offered cards.
Each suggestion is mapped by header coordinates,
including duplicate names. The image limits remain 8192 px / 16,777,216 pixels;
the matcher accepts at most eight recognized offered headers and a reference
height of 540–2160. Helper 0.3.2 supplies the full client height for cropped panels.
Legacy 16:9 frames can use their own height; other legacy crops abstain.

The gates remain proposal 0.72, RGB similarity 0.86 and class margin 0.07, with
colour, overlap, clipping and tooltip guards. A worker error, unsupported browser,
unknown scale or a 15-second timeout preserves the original capture and OCR.
No partial worker output is applied after a timeout.

## What the suggestions establish

A motif match does not by itself establish a reward's kind or threshold. The
[tooltip-backed catalog](../research/REWARD_CATALOG_2026-11-10.md) supplies a
provisional Dreadmaidens' Sacrament combo (2) for orange feathers. Gold ring and
gold grid receive the names Item Rarity and Additional Currency Items, but keep
unknown kind, no threshold and `identified: false`. Other motifs remain unknown.
The editor offers three verified combo presets with reference icons and GGG
sources. Exceptional Gem is manual only; the three-gems motif is not that combo.
Fresh card review versions include `rewards-v1`; saved records are not backfilled.

Tiers appear as **suggested** until checked. The reward list is partial until the
user checks the whole row, including unrecognized icons, kinds, counts and
thresholds. A catalog meaning does not approve its occurrence in this image.
The advisor excludes
unconfirmed visual tiers from duplicate merges and treats incomplete visual reward
coverage as uncertainty. Saving/reviewing an offer does not implicitly confirm
either visual field. Reimport preserves existing corrections.

## Executed evidence

- Fresh Windows en-US OCR from helper 0.3.3 on 10 November, without editing its text
  or rectangles: both 1920×1080 press offers and their panel crops now give four
  offered T2 cards each. Offer A matches seven motifs; B matches six and excludes
  its collected Torchbearer. The old full-frame A failure came from a separate
  world-space title; B's `CONFIR` and cropped `NHR` are now read as `CONFIRM`.
  [Recorded OCR, source hashes and crop bounds](../tests/fixtures/presentation-ocr.json)
  feed the parser and pixel tests; browser tests use B's fresh full/crop OCR.
- The same fresh-OCR browser replay selects Tempest provisionally for Dreadmaidens'
  Sacrament and reports 1/2 after collecting it. Exceptional Gem remains unsupported.
  A's Gravewalker preference requires manual Item Rarity catalog identification.
  Both invocation screenshots (`exceptional-combo-03h14m42.png` and
  `showcase-before-07h24m51.png`) still produce no offered cards. Manual, partial
  invocation reconstructions retain their prior 1/3 Exceptional and six regular
  icon-unit duplicate results; they do not prove hidden rewards. Desktop and 390px
  replay passed without page errors or POST requests. Crop replay supplies the known
  1080px source height to simulate calibrated F9 metadata; it is not a native F9 test.
- Real, checked-in 1920×1080 press image `press-offer-b.png`, paired with the existing
  Windows OCR from the same native 4K scene after halving coordinates: four offered
  T2 cards and all six expected motifs. The collected Torchbearer stays excluded.
- The same pixels cropped to the offered panel with translated OCR and explicit
  frame height: the same four tiers and six motifs. The crop is derived evidence,
  not an independent encounter.
- Controlled 0.5× and 2× resampling, repeated motif/name cases, missing scale,
  ambiguous anchors, clipping, tooltip exclusion and unknown-colour rejection.
- Real-browser import → unreviewed suggestions → advisor abstention → manual tier
  check → save/reload → reimport preserving corrections, on desktop and phone.
- Connected-folder intake exercises the same real image without a manual save.
- The helper exporter passes its OCR-required Windows test. A full live game F9
  interaction and the native external folder picker are not automated by these tests.

The image comes from GGG prerelease materials and contributed reference crops.
These are integration/regression results, not an independent accuracy estimate.
The existing [native validation matrix](recognition-validation.md) remains open:
fresh positive encounters, HDR, alternate UI scales and an untouched positive
holdout are unavailable. The small semantic catalog covers only the cases above;
synthetic advisor cases establish the rule engine, not additional icon meanings.
No profitability or drop-rate claim follows.
