# Fate Collector

An English-language observation collector for Path of Exile 1. Capture the whole
Fate offer, preserve the evidence, and build a dataset before making reward
recommendations. This is a working foundation, not a finished Fate Advisor.

The collection routine is **F9 in the game → automatically queued → shared Cloudflare database**.
Enable **Cloud upload settings** once in the Windows helper with the deployed
collector's HTTPS URL and capture upload key. Keep the helper running; the website
can be closed. Offline captures wait on disk and retry automatically. Only new game
captures after enabling are sent. Screenshots remain local; OCR and capture metadata
reach the shared database as unverified observations.

For local review, use **Connect folder** to select the `captures` folder in desktop
Chrome or Edge. The browser reads completed files and saves them locally; no paste,
confirmation or save click is required. This local review connection needs an open page.
The Windows helper performs local OCR. The website suggests known Fate names and
descriptions; uncertain tiers and reward icons stay unknown. Area, modifiers,
rewards and the chosen card are optional. The main screen has no fields to fill in;
manual corrections are under **Edit details** and save automatically while connected.
Automatic records stay unverified until explicitly reviewed. Manual file import,
paste and **Confirm and save** remain available when the helper is disconnected.

Include the **Fates / Select a Fate** heading and **Confirm** button in the capture.
If OCR cannot establish both boundaries, the screenshot is saved without suggested
cards. A failed automatic correction save offers **Retry save**; a revision conflict
instead asks you to export the draft and reopen the newer saved offer.

## Run locally

Install Node.js 24, then run from this directory:

```sh
npm ci
npm run build
npm run db:local
npm run preview
```

Open **http://127.0.0.1:8787**. No Cloudflare account is needed for local use.
Try **More actions → Load example**, save, and open it from **Saved offers**.
Open **Edit details** only if you want to change a card or its context.
Examples cannot be shared as live observations.

For frontend development, run `npm run dev:api` and `npm run dev` in separate
terminals after the initial build. Vite serves the app and proxies `/api` locally.

Local sharing is disabled by default. To exercise it, copy `.dev.vars.example`
to `.dev.vars`, restart the Worker, and enter that development key in **Saved
offers → Shared research collection**. Never use the example key in production.

## Capture from Windows

Download the helper ZIP from the website, extract it, and run `FateCollector.ahk`
with AutoHotkey v2. Right-click its tray icon and open **Cloud upload settings** to
enable direct uploads to your deployed collection. Calibrate the panel with F6/F7
once, then press F9 for each new offer. The selection is saved between sessions;
F8 previews it and checks a same-aspect resolution change. The helper creates a local
`captures` folder; its tray menu can open it. Connect that folder on the website when
you want to inspect or correct captures. Direct upload does not download cloud
history into the website; local review and reviewed sharing remain separate.

See the [Windows guide](docs/windows-helper.md) for prerequisites and limitations.
The helper captures the selected game region and runs OCR locally. No game actions
are automated.

## What is implemented

- Local screenshot and positioned OCR bundles, clipboard/file import and drag/drop.
- Read-only capture-folder connection, automatic local intake and correction saving,
  persistent connection handles, duplicate receipts and deletion protection.
- Candidate card-name and description extraction from a small prerelease dictionary.
- Editable whole offers, optional choice/reward annotations, partial/complete coverage.
- IndexedDB evidence and history, correction revisions, JSON export/import.
- Direct helper uploads, encrypted Windows credentials, durable queue, offline retry
  and duplicate receipts, without an open browser.
- Receipt-backed upload feedback, automatic session/capture sequence, and possible-repeat
  hints for matching OCR within 15 seconds. Both records remain available; no extra fields.
- Cloudflare Worker API and D1 migrations; separate automatic/raw and reviewed
  collection, bounded payloads and a combined view that avoids double-counting corrections.
- GitHub validation and a manual production deployment workflow.

The app stores at most 250 offers per browser origin. At capacity, auto-import pauses
and new files remain on disk; export/remove old records and click **Resume local review**.
Export backups regularly:
browser storage can be cleared or evicted. **Export all data** omits screenshots;
open an offer and use **Export JSON** to include its image and raw OCR.
After restoring a metadata-only backup, import the original helper files to recover
missing screenshots and OCR while preserving your corrections and review status.

## Deployment and data

[Deployment guide](docs/deployment.md) explains GitHub, Cloudflare Workers with
static assets, D1 and the collection key step by step. Source code lives on GitHub;
the website and API run together on Cloudflare. No GitHub Pages service is required.

[Data contract](docs/data-contract.md) describes provenance, revisions and dataset
limitations. [Architecture](docs/architecture.md) maps the modules and trust boundaries.
The [repository audit and implementation status](docs/AUDYT_REPO_2026-11-09.md)
tracks priorities, completed fixes and remaining native validation. Reproducible
[scan measurements](docs/scan-performance.md) cover 1,000 and 10,000 capture files.

## Verification

```sh
npm run check
npx playwright install chromium
npm run test:e2e
npm run test:helper
npm run test:calibration
npm run test:capture-image
npm run test:ocr
npm run test:capture-backend
npm run test:upload
npm run test:upload:integration
```

The helper/upload commands require Windows PowerShell 5.1; add `-- -RequireOcr` to
`npm run test:helper` to require an installed OCR recognizer. The native upload
integration test starts an isolated local Worker/D1 on port 8791 and checks offline
recovery, process restarts, duplicate delivery and image exclusion without a browser.
Browser tests run a real local Worker and D1 database
on port 8790 with a disposable development key. They never contact production.
Folder tests substitute the native folder picker with a real browser-private
directory (OPFS); they exercise file I/O and persistent native handles. The external
Windows picker/permission prompt and live F9 capture need manual validation.

## Current limits

The prerelease OCR fixture verifies four offered cards against GGG's showcase
image. Live PoE capture, HDR and different UI scales still need validation. The
current helper uses guarded GDI for SDR and window-targeted Windows Graphics Capture
for detected HDR or intersecting SDR windows in
windowed/borderless mode. Native WGC tests cover SDR and float16 fixture capture;
real HDR/game coverage remains unvalidated. Plain image imports are
preserved but do not run browser OCR. Unknown names may be missing from suggestions;
the source image and raw OCR remain available for correction.

Automatic folder access requires desktop Chrome/Edge and HTTPS (or localhost).
The folder is remembered, but the browser may ask to allow access again on reopening.
Background throttling or tab suspension can delay import; the app catches up from
disk when it resumes. Closing the page stops import until it is reopened. Folder
polling checks about every two seconds while the browser allows it to run.

The separate [visual recognition prototype](prototypes/vision/README.md) scans
saved screenshots for eight icon motifs and tier 2/3 feathers. Its measured
coverage and abstentions are documented; it is not connected to F9 or uploads.
Its [whole-offer reader](prototypes/vision/OFFERS-V2.md) adds positioned Windows OCR,
offered/collected/invoked card grouping and tooltip masking, with explicit unknowns.

Reward icons, exact combinations and probabilities are not inferred by the collector. There is no
continuous screen watcher, automatic choice detection or public anonymous ingestion.
Capture each offer once: importing the same file is deduplicated, but pressing F9
again creates a new capture. Shared collection is currently for trusted testers
with a private key, not an open crowd-sourcing launch.

For a local dataset quality report, run `npm run research:stats -- path/to/export.json`.
The [report guide](docs/research-statistics.md) explains Markdown/JSON output,
report consistency checks and why session counts or repeat hints are not independent encounters.

## License

Original Fate Collector code and documentation are licensed under [MIT](LICENSE).
See [third-party notices](THIRD_PARTY_NOTICES.md) for component licenses and the
scope of game and presentation materials.

Independent community project. Not affiliated with Grinding Gear Games. Game names
and content remain the property of their respective owners.
