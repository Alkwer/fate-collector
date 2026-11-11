# Fate Collector repository audit — 2026-11-09

The review identified **14 tasks: 1 × P1, 9 × P2 and 4 × P3**. The original findings are preserved below; the next section records their implementation status.

Audit baseline: commit `53fb4d6` (`Fix offered card row selection and retry failed autosaves`). Implementation followed a fresh check of `origin/main` and was based on `2104ee0` (`Fix offered-card parsing and capture persistence (#7)`). Line numbers in the original findings refer to the audit baseline.

## Implementation — 2026-11-09

| ID | Status | Change and verification |
| --- | --- | --- |
| A01 | Fixed | Deleted-offer tombstones in IndexedDB v3; storage and two-tab regressions for manual and automatic saves. Explicit imports can still restore data. |
| A02 | Fixed | Persistent cache invalidation after imports and UI notification when evidence is recovered; tested within the same folder connection session. |
| A03 | Fixed | Atomic capture ownership and reference immutability checks; migration 0007 preserves history, exposes conflicts and counts one canonical record. Regressions cover concurrent submissions and historical collisions. |
| A04 | Fixed | Exports split by actual UTF-8 size; large collections downloaded and restored in desktop/mobile tests. |
| A05 | Fixed | Receipt and retry recovery preserves damaged originals; a damaged gate blocks uploads until fresh, informed consent. PowerShell tests. |
| A06 | Fixed | Strict UTF-8 decoding routes damaged state to recovery; file access errors are distinguished from corruption. PowerShell tests. |
| A07 | Hardened | GDI checks intersecting windows before and after copying; automatic SDR capture switches to window WGC only when an overlay is detected. Native tests with ordinary and transparent overlays passed. Remaining limitations are listed below. |
| A08 | Fixed | History entries decoded in isolation; damaged records preserved while valid withdrawals continue. Client and diagnostics tests. |
| A09 | Implemented | Token-free receipt exports and local record deletion after confirmed withdrawal; protection against late acknowledgments and resubmission. |
| A10 | Partial; validation open | Added a strict independent-holdout evaluator, a profile matrix and tests. Independent positive game scenes and real HDR were unavailable; scaled fixtures were not used as substitutes. |
| A11 | Implemented | CI installs AHK 2.0.31 with SHA-256 verification and runs the existing calibration/syntax tests. |
| A12 | Implemented | Repeatable measurements for 1,000/10,000 files and optimization without a new index. [Results and limitations](scan-performance.md). |
| A13 | Fixed | Errors identify excess lines or the specific line exceeding 1,000 characters; text stays in the editor and saving resumes after correction. |
| A14 | Implemented | `useOfferDraft` owns the editing session, saving, conflicts and protection of newer edits; existing flow regressions remain required. |

Native WGC tests cover SDR and a forced float16 path on SDR. A system layer on this computer prevented the final clean-GDI test; the test explicitly reports a skip, and `-RequireCleanGdi` requires it before release. A short-lived overlay present only between GDI checks is still possible; forced WGC isolates the window. Game modes, real HDR and independent recognition quality remain part of the [validation procedure](recognition-validation.md). These are testing limitations, not confirmation of readiness for a broader release.

Implementation validation: `npm run check` (115 tests in 13 files, types and build),
42 Playwright tests against a local Worker/D1, 36 Python tests, all seven helper
suites and upload integration with D1. After updating the helper to 0.3.1,
capture was checked again with Windows OCR required. The rendered export was
inspected at 1440 and 390 px; tests confirm that all parts can be downloaded,
240 offers can be restored, Escape works, and there is no horizontal overflow or
console error. The native holdout validator intentionally fails `--require-coverage`
with an empty independent corpus; this is an explicit evidence gap, not a passed test.

## Scope and assessment method

The review covered the React frontend, IndexedDB, import/export, folder synchronization, Zod contracts, Worker, D1 migrations, consent and diagnostics handling, release scripts, CI, tests and documentation. The Windows helper received a separate review whose findings were checked against the code. The recognition prototype was assessed through its methodology documentation and existing tests; the quality of the entire algorithm was not measured again.

Priorities reflect the current product scope: a local collector and a closed group of trusted testers, rather than a public service for anonymous data collection.

| Priority | Meaning |
| --- | --- |
| P0 | Critical failure requiring immediate action. No such issue was confirmed in this review. |
| P1 | Fix in the next patch; the issue compromises the integrity of the core data flow. |
| P2 | Schedule for the next stage; significant reliability, data quality, recovery or validation work before broader use. |
| P3 | Maintenance, usability or performance improvement; address after more urgent fixes, and measure before optimizing. |

“Reproduced” means a controlled scenario was executed. “Code analysis” means the implementation and resulting scenario were confirmed without reproducing the full flow in the UI or operating system. “Improvement” and “validation gap” do not mean an observed failure.

## Task list

The original prioritized list follows. The implementation table above records the current status.

| ID | Priority | Task | Basis |
| --- | --- | --- | --- |
| A01 | **P1** | Prevent a stale-tab save from recreating a deleted offer | Reproduced, IndexedDB |
| A02 | **P2** | Refresh synchronization state after metadata restoration | Reproduced, folder reader |
| A03 | **P2** | Define and enforce reviewed-observation uniqueness per capture | Reproduced, schema and SQLite |
| A04 | **P2** | Allow the entire supported collection to be exported in smaller parts | Reproduced, export |
| A05 | **P2** | Recover damaged helper consent and withdrawal metadata | Code analysis |
| A06 | **P2** | Handle invalid UTF-8 in an individual queue item's state | Code analysis |
| A07 | **P2** | Strengthen protection against overlays in the captured region | Code analysis; on-screen test required |
| A08 | **P2** | Isolate damaged entries in local consent and diagnostics history | Code analysis |
| A09 | **P2** | Add safe archiving of completed diagnostics history | Improvement |
| A10 | **P2** | Add validation with real positive game samples, HDR and UI scales | Validation gap |
| A11 | **P3** | Run existing AHK and calibration tests in CI | CI gap |
| A12 | **P3** | Measure and reduce the cost of scanning the entire capture archive | Performance improvement |
| A13 | **P3** | Align editor-field validation with the data contract | Code analysis / usability |
| A14 | **P3** | Extract editing and save coordination from the main component | Maintenance improvement |

### A01 · P1 · A stale-tab save recreates a deleted offer

**Location:** `src/lib/storage.ts:76`, `:85`, `:147`; save calls in `src/App.tsx:87` and `:175`.

**Problem and impact:** revision checks only work while the record still exists. After tab A deletes an offer, tab B can save a previously opened draft. `saveOffer()` treats the missing record as a new offer and also restores the supplied evidence. The local state of its earlier sharing is lost in the process. Ordinary saves do not check the receipt that prevents reimporting from a folder.

**Validation:** `saveOffer → deleteOffer → saveOffer(old draft)` recreated the record in `fake-indexeddb`. This reproduces save logic, not a new test of the two-tab UI.

**Change:** distinguish creating a new offer from updating a previously existing one. Updating a missing record should report a conflict/deletion while preserving the draft. Explicit restoration imports must remain a separate permitted operation. Cross-tab notifications can improve UX, but the condition must be enforced atomically in storage.

**Done when:** neither manual saves nor autosaves from a stale tab recreate the deleted record; the draft can be exported; deliberate backup restoration still works. Add a storage regression and a two-tab scenario.

### A02 · P2 · The reader cache skips evidence recovery in the same session

**Location:** `src/lib/capture-sync.ts:16`, `:28`, `:49`; `src/lib/storage.ts:163`; `src/App.tsx:122`.

**Problem and impact:** `CaptureReader.handled` remembers IDs and skips them before checking the current IndexedDB state. If the user deletes an offer and explicitly restores its metadata after a file has been processed, the same reader will not recover the image from the file that is still in the folder. Reconnecting or reloading creates a new reader and removes this obstacle. In addition, restoring evidence alone returns `created = false`, so the `onSaved` callback does not notify the UI of the change.

**Validation:** two scans with the same reader, separated by deletion and metadata import, left `getEvidence() === null`. A scan with a new instance recovered the evidence. Only input-image decoding was replaced in this test; the reader and storage were real.

**Change:** invalidate the relevant IDs after data restoration, or base the cache on a local-state version. Distinguish “new offer”, “evidence recovered” and “unchanged” results so the UI can refresh the image.

**Done when:** a record restored from backup receives its missing evidence and displays it without disconnecting the folder or refreshing the page; ordinary deletion still does not trigger automatic restoration.

### A03 · P2 · Two reviewed offers can count the same capture twice

**Location:** `migrations/0002_capture_uploads.sql:16`, `worker/index.ts:77`, `shared/schema.ts:56`; compare `scripts/research-corpus-stats.mjs:13`.

**Problem and impact:** the `research_observations` view excludes a raw capture replaced by a reviewed offer, but returns every row from `latest_observations`. Two offers with different `id` values and the same `captureId` remain two observations. Neither the contract nor the API write path requires a capture to belong uniquely to one offer ID. The local statistics script rejects such a collection, so the layers do not follow the same rule.

**Validation:** two records valid under `offerSchema`, inserted into SQLite after migrations 0001–0002, produced two view rows for one `captureId`. This was not reproduced through the deployed API. Ordinary helper imports set `offer.id = captureId`, so the issue concerns other inputs permitted by the contract, not every import.

**Change:** establish one canonical offer ID per capture and enforce it on writes, or explicitly resolve collisions. Check existing data before adding a constraint; preserve revisions and provenance instead of unconditionally deleting duplicates. Keep the existing semantics for manual offers without a `captureId`.

**Done when:** two different IDs referencing one capture do not increase the independent-observation count; the API, research view and statistics report apply the same rule. The test should also cover two concurrent write attempts.

### A04 · P2 · A valid local collection may be impossible to export in bulk

**Location:** `src/lib/imports.ts:61`, `shared/schema.ts:3`, `src/App.tsx:235`.

**Problem and impact:** the 250-offer limit does not guarantee an export will fit within 12 MiB. `Export all data` passes all metadata at once. When the limit is exceeded, the message recommends exporting without images from history, even though the user is already using that option. There is no range selection or automatic backup splitting. Exporting offers individually is the remaining option.

**Validation:** 250 contract-valid offers, each with two cards and 30 modifiers of 1000 characters, exceeded the limit without any images. This is a boundary case allowed by the schema, not a claim about typical current data sizes.

**Change:** split exports into files that fit the import limit, or add range selection and a clear size indicator. A full backup with evidence stored as separate archive files would also be useful. The current omission of images from history exports is documented; a full backup is a feature extension, not a hidden defect in the existing contract.

**Done when:** every collection the application allows users to save can be exported and restored without manually opening 250 offers. The test compares all metadata after restoration, and evidence as well for the full-backup option.

### A05 · P2 · The helper does not recover some damaged consent metadata

**Location:** `helpers/CloudUpload.Common.ps1:175`, `:411`, `:455`; `helpers/Consent.Common.ps1:137`, `:164`; `helpers/FateCollector.ahk:319`.

**Problem and impact:** invalid JSON in `gate.json` or `recorded.json` can interrupt successive runs. Reconfiguration uses some of the same reads. A damaged withdrawal receipt or retry file causes withdrawal to be skipped, even when the actual marker and token may still be valid. The AHK scheduler also bases some decisions solely on whether an acknowledgment exists.

**Basis:** exception-flow analysis; the PowerShell parser's behavior with damaged JSON was also checked in memory. These file failures were not fully simulated in a running uploader. Existing queue and consent tests pass but do not cover these variants.

**Change:** validate each metadata type and distinguish corruption from transient I/O errors. Preserve the damaged file for diagnostics and recreate auxiliary acknowledgments through an idempotent request with the same ID. Capture uploads must remain disabled when consent evidence is unreadable. Do not delete withdrawal markers or tokens as part of a general “reset”.

**Done when:** damaged gate/receipt/retry tests show a clear state, safe recovery or a specific repair path; valid withdrawals still reach the server, and game data is not sent without confirmed consent.

### A06 · P2 · A UTF-8 error bypasses existing queue-state recovery

**Location:** `helpers/CloudUpload.Common.ps1:65`, `:470`, `:486`; `helpers/tests/Test-CloudUpload.ps1:377`.

**Problem and impact:** reads use strict UTF-8. A decoding error reaches `catch { continue }` before `damagedState` is set. The item can be skipped on every run despite the original capture and unchanged payload still being available. The existing recovery path handles damaged JSON that could be read as text.

**Basis:** code analysis and a check of the strict decoder's exception on an invalid byte. The existing test covers truncated JSON in valid UTF-8, not encoding corruption.

**Change:** route `DecoderFallbackException` to controlled damaged-state recovery. Handle temporary file locks separately. Continue comparing the payload against the original capture before retrying.

**Done when:** an invalid UTF-8 byte does not leave a valid item being skipped indefinitely; modified payloads are still not sent, and other items are processed.

### A07 · P2 · Five checkpoints do not rule out an overlay in the captured panel

**Location:** `helpers/Export-FateCapture.ps1:69`, `:141`, `:153`, `:161`; `helpers/CaptureImage.cs:435`.

**Problem and impact:** the occlusion check samples the panel's corners and center. GDI copies desktop pixels, while WGC captures the monitor. A small always-on-top window or notification between the checkpoints can appear in the image despite a successful check. When uploads are enabled, recognized overlay text can also be included in the uploaded OCR.

**Basis:** five-point sampling and monitor capture were confirmed in the code. An on-screen notification was not reproduced, and no actual upload of unrelated text was observed.

**Change:** investigate capturing the verified game window instead of the monitor. For a backend that requires the desktop, check whether the region intersects visible windows above the game, accounting for the race between validation and image copying. Choose the approach based on testing in supported game modes.

**Done when:** a controlled overlay outside the five checkpoints does not appear in an accepted capture/OCR result; the test also covers a clean panel, SDR and the available WGC backend.

### A08 · P2 · One damaged history entry blocks the remaining entries

**Location:** `src/lib/consent.ts:12`, `:17`, `:86`; `src/lib/diagnostics.ts:11`, `:15`, `:87`.

**Problem and impact:** `consentRecords()` and `diagnosticHistory()` parse the entire history without isolating failures in individual entries. One invalid record aborts the read. Disabling uploads is safe, but withdrawal retries also begin by reading the entire history, so valid pending requests for other records are not processed.

**Basis:** code analysis. This is not a claim that localStorage corruption occurred during normal use.

**Change:** validate records independently, clearly identify unreadable entries and preserve their contents for recovery. Valid withdrawals should be able to continue. A damaged active record must still not authorize uploads. Do not propose clearing all site data as the primary repair.

**Done when:** one invalid entry does not prevent withdrawal of another valid consent/report; the UI explains the problem, retains tokens and does not activate sharing based on incomplete data.

### A09 · P2 · The 50-report diagnostics history needs a safe lifecycle

**Location:** `src/lib/diagnostics.ts:65`, `:98`; `src/components/Diagnostics.tsx:43`.

**Limitation and impact:** the limit also counts expired reports and reports whose deletion has been confirmed. The interface displays these states but does not allow local records to be archived. After 50 attempts that create records, new submissions remain blocked unless local data is modified. This intentional protection against growing history needs a safe path for continued use.

**Change:** add export/archiving and local deletion of completed entries while retaining necessary acknowledgments. Do not automatically delete records with pending withdrawals or ambiguous upload outcomes. Expiration shown according to the client clock requires a more cautious rule than confirmed deletion.

**Done when:** completed reports can free up space without clearing offers, captures or active data needed for withdrawal; the test covers 50 completed records and one still-pending record.

### A10 · P2 · Add recognition-quality evidence from real captures

**Location:** `README.md:127`, `prototypes/vision/README.md:14`, `:43`; `docs/deployment.md:105`.

**Gap and impact:** the documentation openly identifies missing real-game/HDR validation and the lack of a fresh positive native holdout for the whole-offer reader. Passing fixture tests confirm behavior on known images but do not establish quality in the target game. The prototype is separate from the production parser, and its results must not be attributed to the running collector.

**Change:** prepare a small labeled corpus of real positive and negative captures covering several resolutions, UI scales, supported aspect ratios, SDR/HDR modes, tooltips and unknown names. Separate development material from a frozen holdout. Add specific environments and results to the existing manual release gate, rather than merely confirming that a test was performed.

**Done when:** results report misses, false recognitions, abstentions and offered/collected/invoked classification accuracy together with sample counts. The production parser and prototype have separate results. Integrating the prototype requires a passing result on independent samples.

### A11 · P3 · AHK and calibration tests run locally but do not protect CI

**Location:** `.github/workflows/ci.yml:45`, `scripts/test-helper.mjs:6`; `helpers/tests/Validate-Helper.ahk`, `helpers/tests/Test-Calibration.ahk`.

**Gap:** the Windows job checks PowerShell, image conversion, OCR, uploads and diagnostics but does not run the existing AHK validation or calibration test. Local `npm run test:calibration` passed during the audit.

**Change:** provide a pinned AutoHotkey v2 version on the runner and add this command to the Windows job. Keep the WGC test requiring an interactive desktop as a separate release check; do not equate compilation/pixel-conversion tests with full capture.

**Done when:** helper syntax errors and calibration conversion regressions fail CI, and the requirements for manual backend testing are explicit.

### A12 · P3 · Scan cost grows with file history

**Location:** `helpers/CloudUpload.Common.ps1:423`, `:432`, `:452`; `src/lib/capture-sync.ts:22`; `src/lib/useCaptureSync.ts:54`.

**Observation:** the helper enumerates the directory again while holding a lock; the limit of 32 applies to newly processed files, not all checks of old files. The browser also enumerates the folder on subsequent scans despite its ID cache. The 250-local-record limit does not constrain the number of files in the folder. Full-scan complexity grows with the archive; no performance problem has yet been measured.

**Change:** first measure time, I/O, memory use and new-capture latency for 1,000 and 10,000 files. Only then consider a journal/index, archive rotation or less frequent reconciliation. Preserve discovery of files whose producing process stopped before writing an index entry.

**Done when:** a recorded benchmark justifies the change; after optimization, a new file arrives with predictable latency, and restarts or missing index entries do not lose captures.

### A13 · P3 · The editor accepts modifiers that violate the schema

**Location:** `src/components/OfferEditor.tsx:33`; `shared/schema.ts:45`; `src/App.tsx:83`.

**Problem:** the textarea accepts 12,000 characters and splits its contents on newlines, while the contract allows at most 40 entries of 1000 characters each. A single 1001-character line or 41 short lines can block saving and draft export. Validation preserves the content, but the message is generic and points to a schema path.

**Change:** display an error beside the field, identify the specific overlong line/excess entry count and make the save state clear. Separate the form's working text from the valid domain object if temporarily invalid values need to be retained. Do not truncate content without the user's knowledge.

**Done when:** 1001-character lines, 41 lines and returning to a valid value produce clear feedback; autosave resumes after correction without removing the entered text.

### A14 · P3 · Simplify editing-session management in `App.tsx`

**Location:** `src/App.tsx:18`, `:75`, `:120`, `:168`.

**Observation:** the main component combines the draft, revisions, dirty/busy state, session references, autosave, import, restoration, history and sharing. Safeguards exist, and some races have good E2E coverage. However, continuing to expand the same function makes valid transitions harder to assess, especially when the active draft changes during an asynchronous operation.

**Change:** after fixing A01–A02, extract a small editing/save session controller or hook with explicit operation results. Reuse the existing storage/import modules; this does not justify adding a new state library or rebuilding the entire UI.

**Done when:** the main component primarily composes the interface, and save coordination has one owner. Existing conflict, retry and typing-during-autosave tests, plus the new A01–A02 regressions, remain green.

## Suggested order

1. **Data integrity:** A01, A02, A03. Add a scenario test for each fix; the current passing tests do not cover these gaps.
2. **Recovery and backup:** A04, A05, A06, A08. A05 and A06 can be implemented together in the queue module while retaining separate acceptance criteria.
3. **Before broader use and automated recognition:** A07 and A10; in parallel, A09 for long-term diagnostics use.
4. **Maintenance:** A11 and A13 as small tasks; A12 after benchmarking; A14 after the save fixes stabilize.

## Validation performed

| Check | Result |
| --- | --- |
| `npm run check` | PASS: typecheck, tests and build |
| `npm test` on Node 24.14.0 | PASS: 109 tests, 12 files |
| `npm run test:e2e` on Node 24.14.0 | PASS: build and 36 Chromium tests against a local Worker/D1 |
| Python tests in `prototypes/vision/.venv` | PASS: 32 tests |
| `npm run test:helper` | PASS: fixture capture, real local OCR, session context and validation boundaries |
| `npm run test:upload` | PASS: configuration, consent, queue, retries, withdrawals and existing damaged-state scenarios |
| `npm run test:upload:integration` | PASS: helper → local Worker → D1, offline/restart, acknowledgments, deduplication and withdrawals |
| `npm run test:diagnostics` | PASS |
| `npm run test:calibration` | PASS |
| `npm run test:ocr` | PASS |
| `npm run test:capture-image` | PASS: conversion and backend compilation, not full game capture |
| Four additional audit probes | Confirmed the existing unwanted behavior in A01–A04 |

The additional probes were saved locally in the ignored `.qa/repo-audit/` directory (`reproductions.test.ts`, `vitest.config.mjs`). They can be run with `npx vitest run --config .qa/repo-audit/vitest.config.mjs`. Their assertions describe the **existing bug**, so PASS means the problem was reproduced, not fixed. During implementation, convert them into proper regressions that expect correct behavior.

Initial E2E attempts and some helper and Python tests were blocked by sandbox restrictions. They passed after the local tests were run with the required permissions. The default Node version was 26.13.0; unit tests were repeated on the required Node 24.14.0, which was also used for the final build/E2E run. These environmental issues were not counted as repository defects.

No real F9 capture in PoE, `test:capture-backend`, on-screen overlay test, production/staging tests or inspection of current remote-service state was performed. There was no full dependency-vulnerability audit. The UI assessment here is based on code and existing browser tests, including narrow screens; it is not a separate visual review of every view.

## Approaches worth retaining

- Strict schemas and data limits; no image pixels sent to research endpoints.
- Separation of automatic, unreviewed captures from manually reviewed observations.
- Atomic IndexedDB operations, revision checks for existing offers and idempotent server receipts.
- Preservation of original evidence and user corrections during reimport.
- Persistent queue, DPAPI, separate consent scopes and withdrawal without the collection key.
- Tests against a real local Worker/D1 and promotion of the same verified artifact from staging.
- Explicit recognition limitations and separation of the prototype from production.

There is no basis for replacing React/Vite, adding a large state framework or rebuilding the architecture as a first step. Targeted data-integrity and recovery fixes offer the most value now.
