# Browser visual suggestions — updated 16 November 2026

The local capture importer now proposes supported tier feathers and icon motifs
before saving a fresh offer. It runs for connected F9 folders, pasted helper JSON
and manually imported helper captures. Plain PNG imports still have no positioned
OCR, so their images are preserved without invented card associations.

## Implementation and trust boundary

`shared/visual-recognition.ts` implements `browser-v2-segments`, derived
from the prototype's reference crops, geometry and score gates. It is **not** a
binary port of the frozen Python scanner and its benchmark scores are separate.
It uses bounded OCR-guided regions, sampled grayscale proposals and bilinear RGB
comparison, not the prototype's full-frame FFT/Lanczos scan or header rereads.
The frozen Python code, bank and historical reports remain unchanged.

The dictionary contains 26 names, including Black Frost, Blood Moon,
Golemancer, Murderous, Rot, Pestilent and Sadist from campaign and map screenshots
through 14 November 2026, plus Rotted and Savage from PoEDB on 16 November.
OCR preserves both spellings of the Rot card, whose expanded tooltip is headed Rotted.
Planning and effect lookups accept either name. [Versioned catalog provenance](../shared/catalog-metadata.json)
records the source/date and explicitly unresolved semantics. This expands name
recognition only; it does not associate rewards with those names or establish
native accuracy. Standard [production promotion](recognition-validation.md#required-promotion-artifact)
requires an exact-release native holdout report with minimum scene and label
coverage. An explicitly accepted [prelaunch exception](deployment.md#temporary-prelaunch-policy)
defers that requirement only before 13 November 2026, 19:00 UTC, without claiming
native accuracy. The server verifies a local measurement; it does not replay private
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

A motif match does not by itself establish a reward's kind or threshold. Orange
feathers are labelled League unique, with unknown kind and threshold. PoEDB shows
that several league uniques share the icon. A complete matching tooltip selection
or an explicit tooltip check is required before scoring, including old records
that labelled this motif Dreadmaidens' Sacrament.

On fresh captures with a reference height of at least 1080 pixels, the matcher
samples the curved frame below each matched icon. A narrow central gap splits a
silver arc into two segments. Two side gaps split it into three. A plain frame
requires a visible continuous bronze edge. Missing pixels, tooltip overlap or an
uncertain pattern leave the reward available for manual identification.

| Matched icon | Plain frame | Two silver segments | Three silver segments |
| --- | --- | --- | --- |
| Gold ring | Check tooltip | Massively Increased Item Rarity | Extremely Increased Item Rarity |
| Currency (gold grid) | Additional Currency Items | Additional Currency Items | Additional Valuable Currency Items |
| Gold stack | Gold | Hoards of Gold | Check tooltip |
| Threads (silver cluster) | Additional Threads | Many Additional Threads | Check tooltip |

Each icon counts as one occurrence. The segment count on an identified combo
sets its invocation threshold. The reward row remains open for corrections and
review. A visual identification does not record a tooltip confirmation.
The plain three-gem icon occurs with multiple quality-gem tooltips. The two-segment
orange icon occurs with both Ordered Fate and Doedre’s Tongue. Gem, unique and
equipment icons without a verified one-to-one mapping stay ambiguous.

The editor retains three prerelease combo presets with reference icons and GGG
sources. Exceptional Gem is manual only; the three-gems motif is not that combo.
The [screenshot extract](../research/SCREENSHOT_CATALOG_2026-11-15.md) adds 54
complete reward tooltip variants for explicit selection: 44 regular and 10
requiring two reward copies. It also supplies a read-only reference for 34
tier-specific Fate effects, two of them short descriptions only. The expanded
catalog does not introduce visual matches or assign rewards by Fate name.
Five further tooltip variants were checked in the Malformation offer on 17 November,
including the three-copy Valuable Currency combo.
The 18 November Black Frost tooltip confirms the three-copy Extremely Increased Item Rarity combo.
Fresh card review versions include `rewards-v8-3.30.0d`. Helper 0.10.12 reads the counter from the panel or HUD and retains its coordinates. For a verified offer, it can reread missing nameplates inside the centered row and the descriptions in their columns. On small cards it also compensates for the parchment background when reading faint descriptions. Parser `counted-offers-12` uses panel controls and the centered row to group wrapped descriptions, including raised cards beneath a tooltip. It distinguishes a wrapped quest objective from an outer card. A complete description in the same column can corroborate a header with a small OCR error. When one word is truncated on a named card, a matching phrase in its tooltip can verify the missing letters. For a shared caption underneath a translucent tooltip, helper 0.10.14 can reread the dark nameplate and keep the name if the printed letters agree with a candidate for that caption. The capture retains the screenshot and positioned OCR. The player marks the last offer manually. Saved records keep their original review.

Under a translucent tooltip, helper 0.10.15 uses the Fates panel heading to locate dim counter text. Both digit shapes and the diagonal must agree across two contrast ranges. If tooltip text crosses the slash, visible strokes on both sides and brighter ink in the gap can confirm it. The export keeps the counter and any overlapping tooltip line at their original positions.

Helper 0.10.16 also compares the visible parts of each digit when bright tooltip lettering cuts through the counter. Missing strokes can leave the count unreadable. Parser `counted-offers-13` separates an isolated row of reward circles from the last line of a card description. When a pointer obscures parts of two words, the remaining fragments and a matching phrase in the same Fate’s tooltip can identify a single catalog description. The original positioned OCR stays available in the capture.

When selected cards appear below Confirm, the importer can recover a covered upper row from its aligned captions, the counter and the selected row. A shared caption keeps its position and description with a blank name unless the visible name or the raised card's tooltip identifies it. Tier and reward matching requires a visible nameplate. On a controller, a tooltip over the panel button can be disambiguated using the Fates title, complete upper-row captions, a separate selected row and the controller footer.

On seven public 1080p video frames, the positioned counter improved from 0/7 to 7/7 on both full images and panel/HUD crops. Four offers contained fourteen card appearances. Exact descriptions assigned to the correct card improved from 0/14 to 14/14 on full images and from 3/14 to 14/14 on panel crops. The two HUD scenes and the invocation produced no offered cards. The same frames guided development and verification. This replay covers one UI scale and the displayed counts 0/4 through 4/4. [DatModz recording](https://www.twitch.tv/videos/2934270116?t=0h18m16s) · [Manni2 recording](https://www.twitch.tv/videos/2933677092?t=9h35m01s)
The separate PoEDB catalog supplies 25 Tier 3 references and 146 reward definitions.
It is read-only and does not supply new visual matches, combo thresholds or kinds.

Tiers appear as **suggested** until checked. The reward list is partial until the
user checks the whole row, including unrecognized icons, kinds, counts and
thresholds. A catalog meaning does not approve its occurrence in this image.
The advisor excludes
unconfirmed visual tiers from duplicate merges and treats incomplete visual reward
coverage as uncertainty. Saving/reviewing an offer does not implicitly confirm
either visual field. Reimport preserves existing corrections.

## Executed evidence

The results below are historical runs from 10 November. Their orange-feather
semantic mapping was superseded on 16 November; current regression tests require
an exact tooltip before Dreadmaidens' Sacrament can score. Pixel matching remains
unchanged. These historical runs are not validation of the new release.

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
