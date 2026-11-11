# Repository audit implementation — 11 November 2026

Scope: the 28 audit items, on top of the map-advisor branch (PR #9). Existing
uncommitted helper, backup and review work is included. No deployment or production
data mutation is part of this change. A pass on synthetic or showcase material
does not establish native Fate recognition quality.

Later release-policy update: the owner approved a [temporary prelaunch
exception](deployment.md#temporary-prelaunch-policy), expiring on 13 November
2026 at 00:00 UTC. The native evidence gaps below remain open; standard promotion
still verifies the exact-package holdout, while prelaunch explicitly defers it.

| # | Audit item | Implementation / remaining evidence |
| --- | --- | --- |
| 1 | Damaged evidence blocked a valid offer | Metadata opens independently, with a recovery warning; browser regression covers malformed OCR and undecodable PNG. |
| 2 | Invalid PNG survived backup validation | Full export decodes each image, omits damaged evidence and reports it; originals remain available for recovery. |
| 3 | UUID case variants duplicated identities | Contract canonicalizes UUIDs; Worker lookups and migration 0008 deduplicate read views without rewriting payloads/hashes. Historical browser collisions require explicit recovery. Evidence collisions leave metadata readable/exportable; recovery exports every original, and explicit repair archives all variants atomically. |
| 4 | Corrupt withdrawal marker prevented retry | Original is preserved; recoverable credentials retry with an explicit recovery timestamp. |
| 5 | Disabled upload skipped diagnostic withdrawal repair | Scheduler rechecks diagnostic receipts/markers even when capture upload is disabled. |
| 6 | Staging smoke cleanup skipped on failure | Cleanup runs in finally, including ambiguous registration ACKs; cleanup errors remain visible. |
| 7 | Independent native positives missing | Native Character/Offence F9 negative passed. Positive Fate scenes cannot be captured before the Friday 13 November launch; independent positives and target profile coverage remain required. |
| 8 | Release report not bound to package | Dedicated workflow verifies report/repository/main/SHA/release/helper/recognition hashes; promotion requires its trusted artifact and recomputes metrics. Local execution is explicitly attested, not falsely claimed as replayed on GitHub. |
| 9 | Weak holdout minimum | Per-profile minima for offer/invoke/negative scenes, label counts, distinct names and T2/T3; all eight motifs required globally. Empty inventory fails. These are smoke-corpus minima, not statistical guarantees. |
| 10 | Small dictionary/catalog | Added visually sourced Dryad/Avalanche and versioned provenance. Unsupported reward meanings remain unknown. |
| 11 | Unresolved game mechanics | Refreshed source research; mixed-tier, third-copy and general duplicate/combo rules remain unresolved. Advisor retains explicit uncertainty; in-game verification must follow launch. |
| 12 | Review lacked card-region context | Imported positioned headers create normalized card regions; selected card is highlighted and can be enlarged separately. Full capture remains available. |
| 13 | Capture/OCR had no total deadline | AHK owns the exporter handle and limits F9 to 90 seconds; interrupted OCR leaves a recovery PNG. |
| 14 | Incomplete recovery workflow | Explicit evidence repair preserves damaged originals; unreadable records can be isolated/exported; salvage import reports invalid entries and preserves source files. |
| 15 | Storage limit/quota not visible | Journal shows count/250, estimated usage/quota, early warning and optional browser persistence. |
| 16 | Unsaved crash recovery absent | Separate draft records preserve valid unsaved corrections without changing saved revisions. Failure/invalid-field warnings are explicit; recovery copies are isolated per editor. |
| 17 | Other tabs showed stale history | Broadcast/focus refresh updates clean copies and the journal, while pending edits retain revision/deletion conflicts. |
| 18 | Oversized sharing attempted network request | UTF-8 128 KiB preflight explains how to keep a backup and shorten optional fields. |
| 19 | Backup parts had no set identity | Set UUID, part/total and unique filenames; multi-file import validates completeness/mixing/duplicates before mutation. Corpus CLI combines complete sets and rejects incomplete ones. Individual part import remains supported with an explicit count warning. |
| 20 | Collection/map clearing had no undo | Last ten collection changes/map resets can be undone during the visit; restoring another map requires instance confirmation. |
| 21 | Performed invocation left cards usable | Explicit completion consumes exactly the plan's cards and prevents reselecting their source offers; undo restores them. |
| 22 | Collected snapshots hid source corrections | Saved source differences are highlighted; applying a correction is explicit and undoable. |
| 23 | Journal lacked filters | Search by name/area/ID, UTC date range, review, sharing and stored-evidence filters. |
| 24 | Mobile actions were hard to reach | Stacked journal rows, wrapping actions and responsive filters; reviewed at representative widths. |
| 25 | Withdrawal endpoint lacked limiter | Dedicated 20-per-60-second binding runs before body/D1; missing binding fails closed. |
| 26 | Regressions missing | Added Worker/consent/smoke/helper tests plus IndexedDB and browser recovery, conflict, backup and advisor tests. |
| 27 | Browser/accessibility coverage incomplete | Automated Edge/Firefox manual import, keyboard, journal, dialog focus and narrow layout scenarios added. Native folder-picker and actual 200% browser zoom remain unverified: Computer Use stopped because it could not establish the browser URL for policy enforcement. A 640px layout test is not reported as true browser zoom. |
| 28 | Documentation contradicted backup behavior | Data contract, statistics, helper, advisor and release-validation documentation updated. |

Compatibility testing also found and fixed two issues: backup dialogs now return
keyboard focus to their trigger, and browser schemas initialize with Zod's
interpreted validation before any eval capability probe. The CSP remains unchanged.

Codex Review identified three further regressions, now covered: negative/invocation
measurements may legitimately skip visual suggestions, recovery exports include
evidence referenced by isolated offers, and historical identity conflicts abort
the entire pending write transaction (including saves, imports and deletion).

## Native negative run

Before the user reported game servers going offline, helper 0.3.4 captured the
actual Character/Offence panel through F8 preview and F9. The capture was 1344×1728,
OCR status `ok` with 32 positioned lines. The production importer produced zero
cards; save/reload/reopen preserved evidence at revision 1, unreviewed, with no
uploaded revision, no POST requests and no page errors. The helper used isolated
local settings without upload credentials and was stopped afterwards. Private
capture files remain outside Git under `.qa/audit-native-20261111`.

F6/F7 selection, positive Fate recognition, exhaustive OCR correctness and the full
native HDR/resolution/UI-scale matrix are not established by this negative test.

## Repeatable validation

Use Node 24: `npm run check`, `npm run test:e2e`, `npm run test:compat`.
Windows: `test:helper`, `test:calibration`, `test:diagnostics`, `test:upload`,
`test:upload:integration`, `test:capture-image`, `test:ocr`, `test:capture-backend`.
Python: template generator `--check` and the 36 prototype unit tests. Backend tests
use generated windows; they are distinct from the live-game negative above.

The native backend fixture passed WGC with/without forced float16 while Windows
reported HDR active, and rejected intersecting overlays in GDI. The unobscured
GDI fixture check was skipped because its desktop visibility prerequisite was
not met. No native positive holdout or production promotion was performed.
