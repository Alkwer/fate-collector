# Architecture

```text
PoE visible panel
  → AHK foreground validation and crop calibration (F6/F7/F9)
  → Windows PowerShell: GDI/Windows Graphics Capture image + local WinRT OCR passes
  → completed local JSON file (clipboard as a manual fallback)
  → optional durable helper upload queue → Worker /api/captures → D1 capture_uploads
    (works while the browser is closed; raw text, no screenshot pixels)
  → read-only connected folder → candidate extraction → automatic unverified save
  → optional user corrections and review
  → IndexedDB offers and evidence → JSON backup
  → explicit Share → same-origin Worker → D1 observations
```

| Module | Responsibility |
| --- | --- |
| `helpers/` | Persistent/previewed crop calibration, SDR/HDR capture, Windows OCR, explicit upload setup, durable queue and retries |
| `shared/` | Versioned Zod contracts, defaults and upload eligibility |
| `shared/recognition.ts` | Shared browser/Worker prerelease text extraction adapter |
| `shared/visual-recognition.ts` | Bounded OCR-guided pixel matcher using generated reference crops |
| `shared/visual-suggestions.ts` | Unreviewed, position-based mapping from motifs to fresh card fields |
| `src/lib/visual-worker.ts` | Local image decoding/matching off the main thread; bounded timeout/fallback |
| `shared/advisor.ts` | Local goal-based ranking, bounded invocation search and explicit uncertainty |
| `src/components/FateAdvisor.tsx` | Unified offer/advice screen and collection for the current map |
| `src/lib/advisor-workspace.ts` | Map identity, explicit offer membership, validated tab persistence and v1 migration |
| `src/lib/imports.ts` | Bounded imports, decoded-image validation, exports |
| `src/lib/storage.ts` | Local evidence, revisions and atomic archive imports |
| `src/lib/capture-sync.ts` | Bounded folder intake and duplicate-safe delivery |
| `src/lib/useCaptureSync.ts` | Persistent connection, permissions, polling and resume |
| `src/lib/useOfferDraft.ts` | Draft sessions, edits, save acknowledgements and conflict preservation |
| `src/lib/local-history.ts` | Per-record decoding and corruption isolation for local receipts |
| `src/components/` | Source inspection, optional corrections and saved history |
| `worker/index.ts` | Authenticated bounded ingestion and idempotency |
| `migrations/` | D1 schema and latest-revision view |
| `.github/workflows/` | Validation and manual production deployment |

React/Vite produces static files. Cloudflare Workers static assets and the API share
one origin, keeping deployment and browser requests simple. D1 holds structured
observations and optional raw OCR. The separate opt-in symbol-report endpoint stores
two bounded PNG images in its own D1 table with 30-day retention and withdrawal;
normal capture and observation endpoints remain text-only. See [symbol reports](symbol-reports.md).
No server-rendering framework or paid OCR service is required.

Direct cloud delivery runs in Windows PowerShell 5.1, launched asynchronously by
AHK after capture, at startup and every 30 seconds. A cross-process file lock,
atomic immutable queue writes, durable acknowledgements and server-side ID/hash
deduplication cover concurrent starts and lost responses. The upload key is protected
with Windows DPAPI. Scope isolation prevents old pending data from being sent to
a newly configured site. Enable times prevent silent historical backfill.
The automatic and reviewed ingestion endpoints have separate secrets and schemas.
The `research_observations` view prefers reviewed corrections over their raw capture.

Optional local review uses the browser's File System Access API. It needs one
explicit directory selection/read permission;
only matching helper files are read. The browser remembers the directory handle and
queries permission before restarting intake. A suspended tab catches up on resume.
The helper keeps sending to Cloudflare when local browser intake is suspended or closed.

Browser behavior references: [file-system access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access),
[persistent permissions](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api),
[background timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88).

The recognition adapter is deliberately separate from data storage. Later versions
can add a verified name catalog, calibrated icon detection, context extraction and
offer-change detection without replacing the capture evidence format. Validate
those adapters against real screenshots at several resolutions before claiming
automatic coverage. The reward advisor should follow a verified mechanics model
and an assessed dataset, not inferred card-name-to-reward mappings.

Helper 0.3.1 uses window-targeted Windows Graphics Capture for HDR and for detected
SDR desktop occlusion, with guarded GDI otherwise. It compares multiple OCR passes.
Both OCR passes come from one original screenshot. Helper 0.3.3 can use an exact
Confirm button to break a header-preserving tie, then optionally reread one bounded
crop around a truncated `CONFIR`. Only an exact overlapping Confirm result replaces
that line; all geometry maps to original pixels. Capture/upload v1 contracts stay unchanged.
Calibration ratios are restored after process restarts, while a resolution change
requires preview and an aspect-ratio change requires new corners. The helper
captures evidence without automating game input.

IndexedDB v3 retains deletion tombstones so stale editors cannot recreate removed
offers. Explicit archive restoration clears the corresponding tombstone atomically
and invalidates folder-reader caches, allowing missing evidence to return during
the same connection. Warm scans preload receipt IDs without reading image blobs.
See [scan measurements](scan-performance.md).

`scripts/research-corpus-stats.mjs` validates exported archives using the shared
schema and produces separate live/test quality counts. The [Fate advisor](fate-advisor.md)
uses a separate conservative rules engine and uncertainty model; research observations
are not converted into drop probabilities or market values.
