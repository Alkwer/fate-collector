# Baseline — 8 November 2026

**The tier matcher is promising on this small sample. The reward matcher is not
ready for automatic collection:** it accepts few icons in compressed 720p video.
It abstained instead of assigning an incorrect class in this benchmark.

Full-frame scanning, without ground-truth boxes supplied to the recognizer:

| Dataset | Frames | Correct tiers / labelled tiers | Correct known icons / labelled known icons | Incorrect accepted labels |
| --- | ---: | ---: | ---: | ---: |
| Reference, including template sources | 3 | 10/10 | 21/22 | 0 |
| Related presentation validation | 2 | 5/5 | 4/5 | 0 |
| Separate 720p showcase, held out from templates | 4 | 7/7 | 4/22 (18.2%) | 0 |

The holdout includes three adjacent Fate-panel frames and one negative gameplay
frame. Its seven tier instances are five T2 and two T3 appearances; they do not
represent seven independent encounters. The 22 known-icon instances contain
repeated appearances of blue-diamond, gold-grid and gold-stack. Five other visual
icon classes have **no holdout coverage**. Zero observed errors is not proof of
zero error probability, and 7/7 is not a general accuracy estimate.

Seven additional labelled symbols across all splits were obscured, desaturated
or outside the template catalog. None received an accepted label, both in the
full-frame scan and in the separate labelled-patch check. The frame without a
Fate panel also produced no accepted labels. Rejected search peaks include
background clutter and are not counted as recognised icons or safe detections
of every unsupported icon.

The full-frame metric uses the correct family and visual class plus at least
50% overlap of the smaller box, with one-to-one assignment. Duplicate or wrong
labels count as false positives; a wrong class also leaves a missed true target.
Predictions on unsupported symbols or unlabelled background count as false
positives. No image was truncated by the proposal budget.

The companion `baseline-2026-11-08.json` preserves all per-image counts and
labelled-patch outputs, including scores and abstentions. Reproduce with
`python prototypes/vision/evaluate.py`. Templates, labels and thresholds were
fixed before the initial holdout run; inspection of that run means these frames
must become development data for subsequent algorithm revisions.

## Verification

- Eight Python tests passed: FFT/direct correlation agreement, constant/noise
  rejection, ambiguous-class abstention, scaled full-frame location, crop bounds,
  evaluation penalties and template-source separation.
- Existing `npm run check` passed: TypeScript, all 34 app tests and production
  build. The app, helper, network contract and production deployment were not
  changed. Browser/helper tests were not repeated for this isolated Python tool.
- The ten enlarged template crops and numbered overlays for a reference offer
  and the held-out merged/third-card state were visually inspected.

## Next engineering step

Improve icon matching across compressed video and UI scales while keeping an
explicit unknown outcome. Add separate unframed/combined-icon references and
local alignment/scale handling, then evaluate on new untouched screenshots.
Do not lower thresholds using these same holdout results and report the outcome
as independent validation. Associating detections with cards and verifying reward
semantics are separate prerequisites for F9 integration or recommendations.
