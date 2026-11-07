# Publish with GitHub and Cloudflare

GitHub stores the source and runs checks. A single Cloudflare Worker serves the
built website and `/api/*`; a D1 database holds reviewed observations and automatic
OCR captures in separate tables.
Local saves remain in the user's browser. No separate Pages project, Vercel account
or custom domain is required for the initial deployment.

## 1. Put the source on GitHub

Create a repository named `fate-collector`, with `main` as its default branch.
Push this project's source and lockfile. Do not commit `.dev.vars`, `.env`, captures,
`node_modules`, `dist` or `.wrangler`; the ignore files already cover them.
Review the existing `research/` folder separately before publishing it.

The `Validate collector` workflow runs on pushes and pull requests. It checks
TypeScript, unit/integration tests, browser flows and the Windows exporter. This
repository does not automatically deploy pull requests or changes to `main`.

## 2. Create the Cloudflare database

Install dependencies locally, sign into the intended Cloudflare account and create
the database:

```sh
npm ci
npx wrangler login
npx wrangler d1 create fate-collector
```

Save the returned **database UUID**. Keep `wrangler.jsonc`'s all-zero UUID for local
development; decline any automatic configuration update offered by the CLI. The
deployment script generates a separate configuration using the real UUID. The
repository deliberately cannot deploy using the local placeholder.

## 3. Configure GitHub Actions

Create a GitHub environment named `production`. Add these repository or environment
settings under **Settings → Secrets and variables → Actions**:

| Setting | Type | Value |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret | Token scoped to your account, with Workers Scripts Edit and D1 Edit permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Your Cloudflare account ID |
| `CLOUDFLARE_D1_DATABASE_ID` | Variable | The database UUID from step 2 |

Use Cloudflare's **Edit Cloudflare Workers** token template and include D1 Edit.
Restrict account resources to the intended account. A `workers.dev` deployment does
not require managing a custom DNS zone. The Cloudflare API token is an administrator
credential; it must never be entered into the collector's website or Windows helper.

In GitHub **Actions → Deploy to Cloudflare → Run workflow**, choose **main**. The
workflow runs validation, applies migrations, and deploys `fate-collector`. Wrangler
prints the site's `workers.dev` URL. Local IndexedDB data belongs to each origin:
data collected on localhost does not automatically appear on the public URL.

## 4. Enable private research sharing

### Automatic helper uploads

Generate a long random capture key in your password manager and configure the
dedicated Worker secret (use a different value from the reviewed-offer key):

```sh
npx wrangler secret put COLLECTOR_CAPTURE_KEY --name fate-collector
```

Give trusted testers the deployed site's HTTPS origin and this capture key. They
enter both once under **Cloud upload settings** in the helper's tray menu and
explicitly enable upload. F9 captures then reach `/api/captures` without an open
browser. The helper stores pending uploads on disk and retries while running.
Screenshots remain local; raw OCR, line positions, dimensions and capture metadata
are uploaded. Only game captures created after enabling the feature are eligible.

`GET /api/status` exposes `captureIngestionEnabled` separately from reviewed sharing.
It is a configuration check, not a database health check. Capture uploads remain
unreviewed, including successful OCR. This key cannot submit reviewed observations
when the two secrets have different values. Neither key is a Cloudflare API token.

### Reviewed offers from the website

The deployed website works locally in each browser without a collection key. The
reviewed-offer API rejects uploads until its secret is configured. Generate a long random key in
your password manager, then run this command in the project directory:

```sh
npx wrangler secret put COLLECTOR_INGEST_KEY --name fate-collector
```

Paste the key into Wrangler's hidden prompt. Give it only to your trusted testers.
They enter it under **Saved offers → Shared research collection** and click **Share**
for each reviewed live offer. Their key stays in memory and is cleared on reload.
Use **Check connection** after enabling the secret. This checks configuration, not
database health; an actual submission reports database errors separately.

This key grants write access to the shared dataset. There are no individual accounts,
quotas, contributor identities or moderation in v0.1. Before inviting the general
public, add per-contributor authentication, abuse controls and a moderation process.
Do not publish the shared key in source, frontend environment variables or screenshots.

## Deploy from a local terminal instead

After logging into Cloudflare, in PowerShell:

```powershell
$env:CLOUDFLARE_D1_DATABASE_ID = 'YOUR_DATABASE_UUID'
npm run check
npm run test:e2e
npm run deploy
```

`npm run deploy` applies remote migrations and uploads the **existing `dist` build**.
Always build and check first. It refuses a missing or placeholder database UUID.
If more than one Cloudflare account is available, set `CLOUDFLARE_ACCOUNT_ID` too.

## Operations

The API has no public read endpoint. Use the Cloudflare D1 console to inspect
`capture_uploads` for automatic raw OCR and unverified parsed candidates, and
`research_observations` to combine automatic captures with reviewed corrections.
The combined view prefers the latest reviewed offer over its raw capture, avoiding
double counting. Filter `reviewed = 1` and the appropriate completeness/context
when analyzing checked samples. Never treat `unverified` as complete.

`latest_observations` returns the highest submitted reviewed revision for each offer.
The underlying `observations` table preserves earlier revisions. An API retry of
the same ID/revision/payload returns `duplicate`; conflicting content returns 409.
Automatic captures instead deduplicate by capture ID and raw payload hash. Their
parser version is stored so recognition can be revisited without inventing a new
observation. OCR failures are retained to measure recognition coverage.

Deleting a browser record does not remove shared D1 data. At this stage, deletion
requests are handled manually by the database owner using the offer/capture ID,
including `capture_uploads` and any linked reviewed revisions. Keep backups
before destructive database work. Never run the browser test fixtures against a
production endpoint. Use the local test runner instead.

Cloudflare plan limits and billing are account-specific. Check the account dashboard
before opening a public deployment. A domain is optional and can be connected later.

References checked for this foundation: [Workers static assets](https://developers.cloudflare.com/workers/static-assets/),
[D1 getting started](https://developers.cloudflare.com/d1/get-started/),
[GitHub Actions deployment](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
and [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
