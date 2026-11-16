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
| `shared/overlay.ts`, `src/lib/overlay-channel.ts` | Bounded local overlay protocol, capture/snapshot identity, heartbeat and command acknowledgement |
| `src/lib/overlay-advice.ts`, `src/lib/useOverlayConnection.ts` | Existing advisor results adapted for a compact display; explicit folder-write connection and single-tab ownership |
| `helpers/Overlay.ahk`, `helpers/FateOverlay.cs` | Game-scoped overlay lifecycle, capture isolation, native display and advertised keyboard actions |
| `helpers/AutoCapture.ahk`, `helpers/Watch-FatePanel.ps1`, `helpers/AutoCapture.Common.ps1` | Foreground/calibration-gated polling, conservative offer detection, stable-row deduplication and local-only capture publication |
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

The optional [in-game overlay](overlay.md) exchanges local messages under
`captures/.overlay`. The helper writes capture markers and commands; the local
WebView2 app or connected browser writes a leased display snapshot using the
same advisor. In browser mode an explicit second folder permission enables these writes while ordinary local review stays
read-only. Commands must match the live connection, capture and snapshot, and
area/choice changes remain explicit. No overlay message enters cloud ingestion.

Helper 0.7.0 defaults to the bundled standalone WebView2 app. `Desktop.ahk` owns
its process and mode; `FateDesktop.cs` maps bundled assets to `https://fate.local`,
blocks remote network/navigation, and exposes bounded capture reads plus overlay
state writes over origin-checked messages. `src/lib/desktop.ts` adapts that bridge
to the existing folder readers. Native timer events drive capture/overlay polling
while hidden. Local IndexedDB and localStorage persist in a dedicated Windows
profile; current-area notes use localStorage in this mode, sessionStorage on the
website. One profile mutex prevents concurrent desktop writers. SDK libraries
are downloaded at build time from a pinned, SHA-256-checked NuGet package;
the helper bundles the current frontend build without a nested helper ZIP.

Automatic detection runs only with that live connection and a calibrated foreground
game. The persistent PowerShell worker keeps probe pixels in memory, returns bounded
request-bound results and stages a bundle only after two matching name rows. AHK
rechecks foreground identity and a five-second frame deadline before publication.
The browser also accepts `auto-fate-<id>.json`; the uploader and older helpers ignore
that prefix, preserving the existing F9-only consent. Manual F9 stays available.

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
