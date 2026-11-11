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

For each profile, take at least **10 offers, 3 invocations and 5 frames without a Fate panel**, from distinct encounters. Include at least 30 known offered-name labels, 20 tier labels and 20 motif occurrences per profile, five distinct known offered names and both supported tiers (2 and 3). Across all offers cover each of the eight supported motifs. These preset minima (`native-holdout-v2`) are a smoke corpus policy, **not a statistical confidence guarantee**. Across the offers, include a visible collected card with a known name, a tooltip obscuring the reward area of a named offered card, and a visible offered name absent from the frozen dictionary. Record the game build, window mode, exact in-game settings and display scaling. For HDR, confirm that HDR is active on the monitor showing the game and record how the capture was encoded. With the current helper, WGC reads float16 scRGB on an HDR monitor and tone-maps the crop to SDR before saving the PNG.

Assign each scene to development or holdout before running a recognizer. Keep all related frames from an encounter in the same split. The new holdout accepts one frame per scene. Capture separate scenes for development and keep the holdout originals, labels and settings fixed before the first run. If the holdout informs a subsequent change, use fresh scenes to evaluate the new revision. Keep private images and full capture bundles in an ignored local directory and share only reviewed results.

### Production F9 release gate

Use the staging helper package with upload disabled and check out its exact release revision. Record the release ID and helper version from the staging manifest. Calibrate in game with F6 and F7, inspect the crop with F8, then capture with F9. Include the panel controls and the relevant card regions. Keep the original helper bundle and label the screenshot manually before seeing suggestions. If a captured scene is refused or OCR fails, retain the failed case in the record. For the live staging build, also open a captured offer, confirm the image and OCR are available, and exercise correcting an omission in review.

Run with the default `auto` backend. Expect guarded GDI on clear SDR and WGC on HDR or detected SDR occlusion. Verify HDR in Windows display settings on the monitor containing the calibrated crop. Record the expected path from the settings. Record `observedBackend` only when directly verified by separate evidence. The helper bundle does not identify the backend.

Save the manifest and original bundle files together in an ignored local directory such as `.qa/native-recognition/`. The [empty holdout manifest](../tests/fixtures/recognition-validation-holdout.json) is the starting format. Its `release` needs `revision` (full Git SHA), `releaseId` (staging release ID) and `helperVersion`. Add one entry to `scenes` per encounter.

| Field | Value |
| --- | --- |
| `sceneId`, `profile`, `scene` | Unique lowercase ID with digits or hyphens, one of the profiles above, and `offer`, `invoke` or `negative`. |
| `provenance` | Set `source` to `native-f9`. Record `gameBuild`, `windowsBuild`, `windowMode`, `uiScale` (`default` or `alternate`), exact `uiScaleSetting`, `displayScaling` in percent, `clientSize` as `[width, height]`, `hdrActive`, `captureColorPath`, `configuredBackend` (`auto`), `occluded`, optional `observedBackend` (`gdi` or `wgc`), and the `calibration` result. Set `independentlyLabeled` to `true` after assigning the holdout split and completing manual annotation. |
| `capture` | For a successful capture, use `outcome: "captured"`, relative `file`, lowercase `bundleSha256` and `pngSha256`, and calibrated `crop` with `x`, `y`, `width` and `height` in client pixels. For a refusal, use `outcome: "refused"` and a sanitized `reason`. |
| `tooltip`, `cards` | Record visible tooltip occlusion. For each visible header, record `group` (`offered`, `collected`, `invoked` or `tooltip`) and its nonoverlapping `headerBox` as `[x, y, width, height]` **within the captured crop**. Add a box for any visible tooltip text that could be mistaken for a card name. Use `cards: []` and `tooltip: false` for a negative. |
| `cards[].name`, `observedName` | Use the exact [frozen dictionary name](../shared/fate-names.json). Use `name: null` with the observed text in `observedName` for a visible name outside the dictionary. Use `name: null` alone for an unreadable header. |
| `cards[].tier`, `cards[].visualIds` | For offered cards with known names, use `2`, `3` or `null` for unsupported or obscured tiers. List each visible, attributable [supported motif](../shared/visual-suggestions.ts), preserving repetitions. Use `[]` for a visible region with no supported motif and `null` for an obscured or unattributable region. Set both fields to `null` for other headers. |

Hash the original bundle and its decoded PNG without modifying either file.

```powershell
Get-FileHash -Algorithm SHA256 .qa/native-recognition/fate-CAPTURE_ID.json
node --input-type=module -e "import { readFileSync } from 'node:fs'; import { createHash } from 'node:crypto'; const {image} = JSON.parse(readFileSync(process.argv[1], 'utf8').replace(/^\uFEFF/, '')); console.log(createHash('sha256').update(Buffer.from(image.dataBase64, 'base64')).digest('hex'));" .qa/native-recognition/fate-CAPTURE_ID.json
```

Run from the repository root with the installed project dependencies and Playwright Chromium. Set `$env:FATE_VALIDATION_BROWSER_CHANNEL = 'chrome'` to use an installed Chrome instead.

```powershell
node scripts/recognition-validation.mjs
node scripts/recognition-validation.mjs .qa/native-recognition/manifest.json > .qa/native-recognition/report.json
```

The runner replays the original F9 bundle through the production importer and its real visual worker in a local Chromium session. It records the checked-out revision, manifest, dictionary and template hashes, browser and parser versions, OCR status, crop and capture provenance, image and OCR preservation, manual review flags and per-scene metrics. It matches suggestions against annotated physical locations, so a correct name from a collected or invoked row is a wrong-row suggestion. Motifs are counted individually, including repeated motifs. The report keeps failures, omissions and abstentions separate. It omits image bytes, OCR text and bundle paths.

The independent gate requires the scene, denominator and distinct-label minima above in each profile and all special offer cases. The preset per-profile minimum recall is 95% for known names and 90% for supported tiers and motifs. Any incorrect name, wrong row, unexpected tier or motif, result in an unattributable region, failed evidence check, or refused or unmeasurable scene fails the gate. Empty coverage exits `1` with `FAIL`; invalid manifest or tool setup exits `2` if the run cannot produce a scene report. A regression manifest may use `mode: "replay"` with `release: null` and `provenance.source` set to `press-replay` or `historical-f9`, plus a description. It checks the supplied expectations and reports `independentReleaseGate: "NOT_EVALUATED"`.

The hashes catch modified files, exact duplicate PNGs and previously indexed fixture hashes. Scene independence, calibration, monitor settings and release-package provenance still rely on the capture record. Review and sanitize the report before attaching it to the staging verification record.

### Required promotion artifact

Production promotion now requires a `recognition_run_id` from **Verify local native recognition report** (`recognition-validation.yml`), in this repository on main at the exact staging SHA. Run the native holdout locally first. With the original staging package at `.release`, generate the sanitized submission:

```powershell
node scripts/verify-recognition-release.mjs .qa/native-recognition/report.json .release/release.json --github-input > .qa/native-recognition/github-input.txt
```

Submit the file contents as `report_gzip_base64`, set `staging_run_id` and attest `native_execution_attested` only after independently labeling fresh scenes and running the local holdout. Gzip/base64 fits the GitHub dispatch input limit; decompression has a 2 MB cap. No image bytes, OCR text, file paths or arbitrary URLs are submitted. The workflow checks the trusted staging package, rechecks release ID/SHA/helper version and frozen asset hashes, validates counters, uniqueness and native profiles, and recomputes coverage and recall. It publishes the sanitized `recognition-holdout` artifact only on success. Promotion verifies that artifact's workflow/repository/main/SHA identity and repeats the report checks against its downloaded staging package. A `PASS` string alone cannot satisfy the gate. Missing or expired artifacts block promotion.

This is **server-side verification of a maintainer-attested local measurement**, not server-side replay of private screenshots or cryptographic proof that a capture was native. The Windows execution, independent annotation and physical HDR state remain the attesting operator's responsibility. Keep original captures and labels privately for review. Do not submit secrets or personal text in labels. The versioned partial dictionary and evidence ledger are in [catalog metadata](../shared/catalog-metadata.json).

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
| Production importer replay | Five scenes on 10 November 2026. Two press offers matched 8/8 names, 8/8 tiers and 13/13 motifs with zero wrong-row suggestions. One showcase invocation and two historical Character-panel F9 bundles produced zero suggestions. All five retained the image and positioned OCR. The historical F9 cases lack confirmed display settings. |
| Production independent release holdout | **FAIL**. The checked-in inventory has zero measured scenes and no staging release attached. |
| Production parser fixture | [Parser tests](../tests/recognition.test.ts) cover the offered row at three scaled OCR geometries, unknown names and invocation abstention. |
| Frozen visual V2, six prerelease test frames | 16/16 known reward motifs and 12/12 tiers. One unsafe reward acceptance under a tooltip. [Visual V2 results](../prototypes/vision/RESULTS-V2.md) |
| Whole-offer V2, six development frames | 25/25 names and group placements, 33/33 card symbols and 3/3 shared symbols. [Development metrics](../prototypes/vision/offers-v2-2026-11-08.json) |
| Whole-offer controlled resize check | Six Lanczos resizes of two development scenes, with fresh OCR at 720p, 1440p and 2160p. All 27 card placements, names and tiers and 36 card symbols matched. [Resize metrics](../prototypes/vision/offer-scales-2026-11-08.json) |
| Whole-offer native press check | Four original 3840×2160 prerelease press frames from known scenes. [Original press metrics](../prototypes/vision/native-press-2026-11-08.json) |
| Whole-offer archived native negative check | Six 3840×2160 gameplay frames without a Fate panel, with no accepted cards or symbols. Their HDR status and game UI scale are unknown. [Archived native negative metrics](../prototypes/vision/native-negatives-2026-11-08.json) |

The available positive scenes come from prerelease press materials or a showcase broadcast. Independent positive PoE frames, the target HDR and alternate UI profiles, and production F9 staging results remain open. The Fate league launches on Friday **13 November 2026 (PST)**; positive live Fate validation is unavailable before launch. Native F9 checks on the current Character/statistics screen verify negative behavior only. Complete the positive holdout after launch; its absence currently blocks production promotion without implying that unavailable scenes can be captured now.
