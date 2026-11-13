# Repository audit implementation — 13 November 2026

Scope: items 2–34 of the repository audit. Item 1 (native recognition holdout)
was excluded from this implementation request. The owner confirmed that live
Fate evidence for items 11–13 is available only after league launch. No new
mechanics, economic values or recognition labels are inferred from that absence.

## Delivery matrix

| Item | Result | Evidence / implementation |
| --- | --- | --- |
| 2 | Fixed | IndexedDB symbol migration preserves malformed rows separately; readable reports remain usable. Raw damaged entries can be exported and explicitly removed. Mixed valid/damaged migration and browser withdrawal tests. |
| 3 | Implemented | Export all offers states its scope. Separate private symbol backup restores reports, images, drafts, receipts and withdrawal tokens. Private withdrawal backup restores collection/diagnostic credentials without activating sharing. Fresh-browser withdrawal tests; public exports remain token-free. |
| 4 | Fixed | Unreadable offer drafts are counted in recovery and included in raw exports. Removal requires explicit confirmation. |
| 5 | Fixed | All helper captures are saved, while session sequence/time ordering prevents an older queued capture replacing the latest view. Dirty editor protection remains. |
| 6 | Fixed | Uncertain rewards display known gain and unresolved total; they never present an unknown total as confirmed zero. |
| 7 | Implemented | Symbol preparation persists locally, with explicit restore/discard, revision conflict checks and a 30-draft limit. Restoring does not restore consent or Turnstile verification. |
| 8 | Implemented | Symbol metadata and images use separate stores; history pages contain 20 summaries. Images load on demand and may be removed for withdrawn/expired reports while receipts and tokens remain. Migration test covers 241 valid records plus corruption. |
| 9 | Implemented | Symbol history refreshes through BroadcastChannel and focus fallback. Two-tab withdrawal browser regression. |
| 10 | Implemented | Independent manual symbol report from an empty collector, without creating a game observation. |
| 11 | Deferred by owner | Live helper 0.5.0 area transitions, instance boundaries, shortcuts, tooltip capture and scaling require the launched game. See post-launch checklist below. |
| 12 | Deferred by owner | Unresolved tier/merge/combo rules remain unresolved until sourced observations and counterexamples exist. |
| 13 | Deferred by owner | Catalog expansion requires verified evidence, negatives and holdout samples. Reports are never automatically promoted. |
| 14 | Implemented conservatively | Unknown title-case headers survive as unnamed cards only beside a known anchor with compatible size and a separate column. All-unknown, body-text, small-font and overlapping candidates abstain. Original OCR remains evidence. |
| 15 | Implemented | Optional user-supplied game version applies only to new live helper captures after activation, for at most 24 hours, with provenance in notes. Historical files and known versions remain unchanged. Raw cloud intake stays unknown without verified version evidence. |
| 16 | Implemented | Shared D1 moderation queue, expiring claims, reasoned decisions, exact-image deduplication and separate catalog commit provenance. Author-only coarse status endpoint. See [operator guide](worker-operations.md). |
| 17 | Improved | Mobile decision outcome precedes the review panel; shorter uncertainty summary and earlier collection action. At 390×844 in the audited unknown scene, outcome y≈546 (previously 826), first collection action y≈936 (previously 1417). |
| 18 | Implemented | Mobile manual-save bar remains at the viewport bottom with reserved content space. Autosave/explicit sharing semantics are unchanged. |
| 19 | Fixed in audited scenes | Close, edit, undo and tablet controls have at least 44×44 targets at 320/390/768 widths. Both themes checked, no horizontal overflow. Desktop retains its denser controls. |
| 20 | Implemented | Explicitly labelled guided practice demonstrates choose → collect → invoke with invented training rewards. Example origin remains blocked from game-data sharing. The unknown example remains available. |
| 21 | Implemented | User-facing Current area, new-area and invocation wording covers campaign and other contexts. Internal persisted map schema stays compatible. |
| 22 | Implemented | Select/filter, export selected offers with evidence, backup acknowledgement and confirmed atomic bulk deletion. All revisions are checked before deletion; stale selections abort the transaction. 250-record browser regression. |
| 23 | Implemented | Import differences show changed fields and revisions. Keep local is the default; explicit replacement checks identity/current snapshot, preserves the previous record for recovery, and advances the revision. |
| 24 | Implemented | Error boundary provides reload, offer backup and raw recovery without clearing storage. Failed lazy-chunk browser test verifies fallback and export. Credential backups remain separate. |
| 25 | Implemented | Guide, diagnostics, symbol UI and private credential export load on demand. Background withdrawal retry remains independent of opening the diagnostic UI. Chunk-failure recovery is tested. |
| 26 | Implemented | Multipart import parses each JSON once, validates every part/image before mutation, then combines the complete set. Large parsing benchmark below. |
| 27 | Implemented incrementally | Extracted archive import/export coordination, save bar, release-update hook, diagnostic withdrawal loop, conflict dialog and lazy symbol boundary from App. Existing autosave/conflict flows pass. |
| 28 | Implemented incrementally | Review/save workspace styles consolidated in `src/review-workspace.css`, preserving block/media ordering. Computed-style/rectangle comparison showed no difference for this extraction in eight theme/width scenes, before intentional mobile improvements. |
| 29 | Implemented | Narrow ESLint gate checks React hooks, relevant JSX accessibility and unsafe control flow. Corrected hook dependencies and effect-event behavior; no mass formatting. Babel parses the project's TypeScript version. |
| 30 | Implemented | Twenty Windows Chromium image comparisons: five scenes × two themes × desktop/mobile. Fixed clock, bundled fonts, reduced motion and limited masking; snapshots are reviewed artifacts in `e2e/screenshots`. |
| 31 | Partial, native verification blocked | Targeted axe checks and existing keyboard/focus/reflow tests pass. True browser zoom, screen reader and native folder-picker/repermission were not completed; see limitation below. |
| 32 | Implemented; notification destination pending | API request IDs, allowlisted failure codes and count events distinguish D1/configuration/rate-limiter/Siteverify failures. Logs exclude payloads, tokens, raw exceptions and automatic invocation URLs. Cloudflare account supports Issues notifications but has no existing policies/destinations; an email recipient was requested. |
| 33 | Fixed | Diagnostics and symbol retention execute independently, await both outcomes and fail the invocation on partial failure. Controlled-failure test proves symbol cleanup still runs. |
| 34 | Implemented | Compatibility tests cover old helpers, old backups, old consent behavior, and a frozen older parser rejecting area context. Unsupported future fields produce a refresh/update instruction while preserving the original file. New releases notify an open tab without reloading drafts automatically. |

## Local validation

- Node 24.14.0: lint, typecheck, **311 unit/integration tests passed**, one optional
  native symbol fixture test skipped locally. The Windows CI job generates and
  validates that fixture separately.
- Chromium: **128 browser tests passed** against an isolated real local Worker/D1.
- CI Windows: **30 Edge/Firefox tests passed**. Local Edge scenarios passed but
  teardown stalled removing its temporary profile; that local suite was not counted
  as a complete pass. The clean Windows CI run completed normally.
- Windows Chromium visual comparisons: **20 passed** after creating and inspecting
  the baselines. Scene coverage includes unknown, recommendation, invocation,
  editing and symbol reporting in both themes at 1440×1000 and 390×844.
- Both themes measured at 320, 390, 768 and 1440 px. No horizontal overflow in the
  audited scene; 320/390/768 px had no rendered buttons below 44×44.
- Impeccable detect on changed UI files: exit 0, no primary findings; 17 advisory
  typography findings for existing headings, numbers and utility text. Reviewed against the
  established interface and rendered checks; no broad typography rewrite.
- Additive migration 0010 and claim/accept workflow exercised on isolated local D1.
- Existing CI remains responsible for the complete Windows helper/OCR/queue,
  helper-to-Worker upload integration, Python vision checks and exact release package.

Build comparison: main JavaScript decreased from 592.71 to 453.21 kB (gzip
193.64 → 152.29 kB). A shared 94.26 kB chunk also loads initially, and a 16.56 kB
diagnostic module supports background withdrawal retry. The main-chunk reduction
is not a claim that total startup bytes or startup time improved by the same ratio.
Guide, diagnostics UI and symbols are separate optional chunks.

Synthetic multipart benchmark: 134,229,040 bytes across eight parts / 16 offers,
Node 24, separate processes. Old double parsing took 361 ms and peak RSS 474 MiB;
single parsing took 128 ms and peak RSS 346 MiB. This isolates JSON/schema work:
image decoding is mocked equally in both paths. It is not a 512 MiB import, a
browser memory benchmark, or an end-to-end timing claim. Existing image validation
and incomplete/corrupt-part tests remain enabled.

Native accessibility limitation: computer-use stopped before app input because it
could not establish the active Windows browser URL with sufficient confidence.
No native zoom, reader or picker result is reported as passed. Isolated Playwright
tests do not replace these checks. No WCAG conformance claim is made.

Local supporting logs/screenshots are in ignored `.qa/`: `check-release.log`,
`e2e-release.log`, `compat-release.log`, `visual-compare.log`, `audit-release/`,
`impeccable-release.json` and `backup-benchmark-*.json`.

## Backup and compatibility boundaries

Offer backup, solver profile, private symbol backup, private collection/diagnostic
withdrawal backup and raw recovery have distinct scopes. Private backups contain
withdrawal credentials and must not be attached to public issues or research data.
Restore accepts only the same collector origin, preserves conflicting credentials
and monotonically retains withdrawal state. It does not enable sharing.

Older helper captures 0.1 / 0.3.4 / 0.4 / 0.5 are accepted by the new site. New area
metadata still cannot be made readable by an already deployed old parser; update
the site before distributing helper formats. The release notice starts with this
site version, so tabs running an even older bundle cannot display it retroactively.

Each schema imports the shared configured validator. This preserves interpreted
validation before lazy/shared chunks construct schemas and prevents Firefox CSP
eval-probe errors without adding `unsafe-eval`. Compatibility tests keep asserting
that there are no console or page errors.

Codex Review identified one valid restore edge case: a pending local withdrawal
overrode an imported server acknowledgement in the lower-level save helper. Both
collection and diagnostic stores now retain the acknowledgement monotonically.
A regression verifies pending → confirmed restore, older-backup replay and no
unnecessary network retry.

Migration 0010 adds review metadata only. Rolling back the Worker leaves this
table in place; do not reverse migrations or erase report data. A rollback after
the local symbol-store migration must preserve site data and private backups.

## Post-launch evidence checklist

1. Record helper build, site revision, game patch, display mode/resolution/UI scale
   and timestamps. Use independent offer/invocation/negative samples, not training
   templates, for recognition validation.
2. Exercise campaign → map → hideout/disconnect, same-area new instance, process
   restart and stale/missing Client.txt context. Verify no automatic instance claim.
3. Exercise F9 and Ctrl+Shift+F9 with visible tooltip, calibration, multiple DPI/UI
   scales and SDR/HDR. Keep consent/Turnstile checks independent of draft recovery.
4. For each proposed tier/merge/combo rule, retain before/after evidence plus a
   counterexample. Enable only sourced rules with regression tests.
5. For each catalog addition, record motif versus meaning, reward kind/threshold,
   provenance, negative cases and independent holdout, then review the catalog PR.
6. Complete real zoom 200–400%, screen-reader announcement order and native folder
   permission/repermission after computer-use or a human tester can perform them.

Production uses the existing staging-first immutable release workflow. The owner
authorized the release with live-game checks deferred. The prelaunch exception
still expires **13 November 2026 at 19:00 UTC**; it has not been extended.
