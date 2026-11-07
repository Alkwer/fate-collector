# Architecture

```text
PoE visible panel
  → AHK foreground validation and crop calibration (F6/F7/F9)
  → Windows PowerShell: GDI image + local WinRT OCR
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
| `helpers/` | Capture, Windows OCR, explicit upload setup, durable queue and retries |
| `shared/` | Versioned Zod contracts, defaults and upload eligibility |
| `shared/recognition.ts` | Shared browser/Worker prerelease text extraction adapter |
| `src/lib/imports.ts` | Bounded imports, decoded-image validation, exports |
| `src/lib/storage.ts` | Local evidence, revisions and atomic archive imports |
| `src/lib/capture-sync.ts` | Bounded folder intake and duplicate-safe delivery |
| `src/lib/useCaptureSync.ts` | Persistent connection, permissions, polling and resume |
| `src/components/` | Source inspection, optional corrections and saved history |
| `worker/index.ts` | Authenticated bounded ingestion and idempotency |
| `migrations/` | D1 schema and latest-revision view |
| `.github/workflows/` | Validation and manual production deployment |

React/Vite produces static files. Cloudflare Workers static assets and the API share
one origin, keeping deployment and browser requests simple. D1 holds structured
observations and optional raw OCR; screenshots need no cloud object storage in this first version.
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
