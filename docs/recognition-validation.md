# Recognition validation for PoE captures

The production F9 helper captures the calibrated panel and reads positioned OCR. The browser's `extractCards` suggests known names in the offered row. Its separate [browser visual matcher](browser-recognition.md) proposes supported tiers and motifs, with a limited tooltip catalog and explicit review. Record whether it preserved the image and abstained when the row or name was uncertain. Collected and invoked cards remain outside this importer's scope. Track OCR, image matches and semantic suggestions separately.

The offline whole-offer prototype reads a separate, uncropped game frame. It measures `offered`, `collected` and `invoked` assignments, names and supported reward motifs. Keep the two results separate even when both inputs come from the same encounter.

## Native sample plan

| Profile | Native frame | Display | UI scale |
| --- | --- | --- | --- |
| `1080p-sdr-default` | 1920×1080 | SDR | Default |
| `1440p-sdr-alternate` | 2560×1440 | SDR | A documented setting with a different effective game UI size |
| `4k-hdr-default` | 3840×2160 | HDR | Default |
| `ultrawide-sdr-default` | 3440×1440 | SDR | Default |

For each profile, take an offer, an invocation and a frame without a Fate panel from distinct encounters. Across the positive frames, include a collected row, a tooltip covering a card or reward area, and a visible name absent from the frozen dictionary. Record the game build, window mode, exact in-game settings and display scaling. For HDR, confirm that HDR was active on the capture monitor and record how the original pixels were encoded or converted when the PNG was saved.

Assign each scene to development or holdout before running a recognizer. Keep all related frames from an encounter in the same split. The new holdout accepts one frame per scene. Capture separate scenes for development and keep the holdout originals, labels and settings fixed before the first run. If the holdout informs a subsequent change, use fresh scenes to evaluate the new revision. Keep private images and full capture bundles in an ignored local directory and share only reviewed results.

### Production F9 release record

Use the staging helper package and browser build from the same release. For each sample, record the release and parser versions, profile, scene ID, Windows build, game window mode, configured backend, crop dimensions and calibration result. Run F9 with the default automatic backend. Expect guarded GDI on clear SDR, window-targeted WGC for detected SDR occlusion, and WGC on HDR. Record which path the configured mode and monitor state imply, and mark direct observation separately if available. The bundle has no backend field. Record whether a failure prevented the bundle from being written and attach the sanitized result to the staging verification record.

| Scene | Record against the manually checked panel |
| --- | --- |
| Offer | Number of visible known offered names, correct suggestions, omitted known names, unknown-name abstentions and incorrect suggestions. Count any collected or tooltip text suggested as offered as incorrect. |
| Invocation or no panel | Capture outcome, whether the browser preserved the image for review if imported, and the number of erroneous offer suggestions. |
| Every scene | OCR status and crop check. Record skipped or failed cases and the reason separately from the result counts. |

Confirm that review still permits correcting omissions and that unsafe suggestions are absent in the checked release cases. Report sample counts by profile. A fixture-only pass leaves this manual release record incomplete.

### Whole-offer prototype holdout

Put a local manifest with `schemaVersion: 1` and an `images` array beside the original, unresized PNGs. Use the profile IDs above and include the following fields in each sample.

| Field | Value |
| --- | --- |
| `file`, `sha256` | Local path relative to the manifest and SHA-256 of the original PNG |
| `source`, `profile`, `scene` | `native-game`, the profile ID, and `offer`, `invoke` or `negative` |
| `sceneId`, `gameBuild` | Unique encounter ID and exact game build |
| `uiScaleSetting`, `prototypeUiScale` | Observed game setting as text and the fixed prototype factor between `0.5` and `2`. Choose the factor before inspecting outputs. Use `1` for the baseline. |
| `captureColorPath` | Capture method and color representation, for example an HDR session with a screenshot already tone-mapped to SDR |
| `tooltip` | Boolean indicating visible Fate tooltip occlusion |
| `cards` | Each visible card's `group` (`offered`, `collected` or `invoked`), `headerBox` (`[x, y, width, height]` in original pixels), `name` and `visualIds`. Mark the entire header region and use nonoverlapping boxes. Use `null` for a name outside the frozen dictionary, with the observed name in a note. |
| `sharedVisualIds` | Visible supported motifs in the shared reward bar |

For either symbol field, preserve repeated motifs, use `[]` for a confirmed empty region, and use `null` where the symbols are wholly obscured or cannot be attributed. A negative frame has empty `cards` and `sharedVisualIds` arrays and `tooltip: false`. Include notes for unreadable or partially hidden content. Record separately if a card can be seen but its name cannot be annotated.

Run these commands from the repository root on Windows with the prototype's pinned dependencies.

```powershell
$py = './prototypes/vision/.venv/Scripts/python.exe'
& $py prototypes/vision/evaluate_native_holdout.py --require-coverage
New-Item -ItemType Directory -Force prototypes/vision/output | Out-Null
& $py prototypes/vision/evaluate_native_holdout.py --manifest PATH_TO_LOCAL_MANIFEST --require-coverage > prototypes/vision/output/native-holdout-report.json
```

The default invocation uses the checked-in inventory. It currently reports zero measured images and exits `1` with `--require-coverage`. For a populated manifest, the evaluator checks image hashes against both the inventory and previously used fixtures, reads Windows OCR, then prints per-scene counts and totals. An OCR failure does not count toward coverage. Card groups are scored by physical header location across all groups, so a correct name in the wrong row still counts as a row error. Missing cards, unknown-name abstentions, incorrect acceptances and accepted symbols in unattributable regions have separate counters. `unknownSymbolProposals` counts proposals that the whole-offer result retained as unknown. It has no ground-truth denominator.

Coverage and recognition quality are separate checks. Set the minimum recall for known names, supported motifs and card detection before running the holdout. Integration requires complete coverage, meeting those recall targets, and zero false acceptances or wrong row assignments on the independent set. Record the acceptance criteria and decision with the tested commit and manifest hash.

## Evidence currently available

| Pipeline and corpus | Evidence |
| --- | --- |
| Production parser fixture | [Parser tests](../tests/recognition.test.ts) cover the offered row at three scaled OCR geometries, unknown names and invocation abstention. |
| Frozen visual V2, six prerelease test frames | 16/16 known reward motifs and 12/12 tiers. One unsafe reward acceptance under a tooltip. [Visual V2 results](../prototypes/vision/RESULTS-V2.md) |
| Whole-offer V2, six development frames | 25/25 names and group placements, 33/33 card symbols and 3/3 shared symbols. [Development metrics](../prototypes/vision/offers-v2-2026-11-08.json) |
| Whole-offer controlled resize check | Six Lanczos resizes of two development scenes, with fresh OCR at 720p, 1440p and 2160p. All 27 card placements, names and tiers and 36 card symbols matched. [Resize metrics](../prototypes/vision/offer-scales-2026-11-08.json) |
| Whole-offer native press check | Four original 3840×2160 prerelease press frames from known scenes. [Original press metrics](../prototypes/vision/native-press-2026-11-08.json) |
| Whole-offer archived native negative check | Six 3840×2160 gameplay frames without a Fate panel, with no accepted cards or symbols. Their HDR status and game UI scale are unknown. [Archived native negative metrics](../prototypes/vision/native-negatives-2026-11-08.json) |

The available positive scenes come from prerelease press materials or a showcase broadcast. Independent positive PoE frames, the target HDR and alternate UI profiles, and production F9 staging results remain open.
