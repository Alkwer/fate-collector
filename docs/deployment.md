# Staging and production releases

Production is `https://app.fate-collector.workers.dev`; staging is
`https://app-staging.fate-collector.workers.dev`. Both serve the website and API.
The staging page displays a gold **STAGING** notice and sends a `noindex` header.
The staging URL is accessible to anyone with the link; uploads require its private
keys. Do not copy real user captures into staging.

## Isolated resources

| Target | Worker | D1 database | Upload keys |
| --- | --- | --- | --- |
| Local | Wrangler simulation | local SQLite | `.dev.vars`, development values only |
| Staging | `app-staging` | `fate-collector-staging` | Separate `COLLECTOR_CAPTURE_KEY` and `COLLECTOR_INGEST_KEY` |
| Production | `app` | `fate-collector` | Existing production keys, preserved on deployment |

The account, database IDs and origins are pinned in
[`deployment/environments.json`](../deployment/environments.json). These IDs are
not credentials. Deployment checks reject identical database IDs/names and wrong
Worker targets. `wrangler.jsonc` retains a zero database UUID for local development.
The deployment script generates environment-specific configs in ignored `.wrangler/`.
There is no fallback from staging to production configuration.

The older production URL `https://fate-collector.fate-collector.workers.dev`
continues through `wrangler.legacy.jsonc` and its service binding to `app`.
Staging deployments never update that compatibility Worker.

## GitHub settings

`CLOUDFLARE_API_TOKEN` remains the existing repository deployment secret. It needs
Workers Scripts Edit and D1 Edit on the configured account. It is an administrative
credential and must never be given to testers or entered in the helper.

Create these GitHub environments:

| Environment | Setting | Kind |
| --- | --- | --- |
| `staging` | `CLOUDFLARE_ACCOUNT_ID` | Variable, matching `deployment/environments.json` |
| `staging` | `COLLECTOR_CAPTURE_KEY` | Secret, independently generated, at least 32 characters |
| `staging` | `COLLECTOR_INGEST_KEY` | Secret, different from capture and production keys |
| `production` | `CLOUDFLARE_ACCOUNT_ID` | Existing secret |

The previous `CLOUDFLARE_D1_DATABASE_ID` production variable is no longer used;
the reviewed target configuration is the source of truth. Never store upload keys
in source, frontend variables, release artifacts or workflow inputs.

Restrict the `production` environment to branch `main`. Protect `main` with the
`app`, `windows-helper` and `vision-prototype` checks, up-to-date branches, resolved conversations,
no force pushes and no deletions. These settings complement the workflow checks;
repo owners and Cloudflare administrators can still change protections or deploy
directly. This is a controlled release process, not a restriction on account owners.

Required environment reviewers can add another approval when the GitHub plan and
repository visibility support them. The workflow also requires an explicit manual
test confirmation, independently of that feature. Do not make the repository public
just to enable reviewers.

## 1. Validate changes

Use a branch and pull request. **Validate collector** runs on pushes and PRs and
is reused by the staging workflow. It runs:

- TypeScript, unit/integration tests and the frontend build;
- browser flows against a local Worker and local D1;
- diagnostic privacy, explicit consent, deletion and 30-day retention;
- Windows capture and upload queue tests;
- the real Windows helper-to-local-Worker upload integration test.

The app job packages the tested `dist`, a bundled Worker, the downloadable helper,
SQL migrations and runtime settings into the `collector-release` artifact. A
manifest records the commit SHA and SHA-256 of every file. Packaging uses Wrangler
`deploy --dry-run`; it makes no remote changes. Artifacts are retained for 30 days.
A failed Windows job prevents staging deployment even if the app artifact exists.

## 2. Deploy and test staging

In **Actions → Deploy staging → Run workflow**, select the desired branch.
The workflow repeats the complete reusable validation for that exact commit,
downloads its package, applies migrations only to staging, and deploys `app-staging`.
It supplies the two staging upload secrets with the deployment through a temporary
JSON file that is removed afterwards. Production keys are never read or rotated.

The live smoke test checks the environment, commit and package ID, homepage and
helper ZIP, then sends a clearly labelled synthetic capture and reviewed correction
to staging. It verifies duplicate receipts, authorization and invalid-input rejection.
The test records separate capture and reviewed-offer consents, verifies uploads are
blocked without them, then withdraws both and verifies that replay is blocked.
Successful smoke tests remove their own submitted data; the minimal consent audit
stays in staging. Failed runs may leave synthetic records for diagnosis.
The smoke test also verifies a diagnostic report's independent consent, strict
privacy schema, duplicate receipt, 30-day expiry and deletion/replay denial.
Migration `0004_diagnostics.sql` stores reports separately from research data.
The immutable release includes the `*/15 * * * *` Worker schedule for expiry
cleanup. Verify that schedule after deployment and monitor Cron failures.
It also includes `DIAGNOSTIC_RATE_LIMITER` (20 requests/minute per source and
operation). Environment-specific keys isolate staging counters from production.
Migration `0005_diagnostic_limits.sql` supports the atomic daily creation limits.
A failed smoke test makes the run ineligible for promotion; staging is left available
for diagnosis and the previous production stays active.

For a feature branch, review and merge the changes, then run **Deploy staging**
again on `main`. Production promotion requires a staging run from the exact `main`
commit selected when launching promotion.

Before promotion, manually check:

- the gold STAGING notice and the version under `/api/status`;
- F9 capture, crop calibration and OCR with the downloaded helper;
- offline queuing, restarting the helper and eventual receipt-backed upload;
- local folder review, correction and explicit reviewed sharing.
- unchecked consent, exact accepted text/dates, withdrawal online and offline,
  browser reload/helper restart, and denial of uploads under a withdrawn consent.

Use a separate extracted helper directory and test captures. The helper's cloud
settings are shared per Windows user: two extracted copies do not create separate
cloud profiles. For parallel production and staging use a separate Windows user or
VM. When switching the site in Cloud upload settings, enter the staging origin and
capture key explicitly; the existing queue isolation starts a new scope. Re-enabling
production does not backfill captures created while it was disabled.

During initial setup, staging credentials can be retained in the ignored
`.wrangler/staging-access.clixml` file, encrypted with Windows DPAPI for the local
Windows user. GitHub secrets cannot be read back. Do not attach this file to issues.

Migration `0003_consents.sql` adds consent records and links new submissions to
them. Existing rows retain a null consent ID: no historical consent is invented.
Legacy clients without the new consent headers are rejected after deployment.
Before production promotion, distribute the updated helper and decide how to
handle previously collected data, which cannot be attributed to these new grants.
Withdrawal is intentionally destructive only for data attached to that consent.

## 3. Promote exactly that package

In **Actions → Promote tested release → Run workflow**, select `main`, enter the
successful **Deploy staging** run ID from its summary and confirm the manual tests.
The confirmation defaults to **false**. No deployment starts without it.

Before accessing the production environment, the workflow verifies that:

1. The source run belongs to this repository's staging workflow, was manually
   dispatched on `main`, finished successfully and matches this exact commit.
2. The downloaded artifact has the expected commit and unchanged checksums.
3. The live staging still reports that same commit and package, both upload paths
   are enabled, and the homepage and helper are reachable.

Staging and promotion share one concurrency group, so a staging deployment cannot
replace the tested version in the middle of promotion. The production job downloads
the same artifact; it never rebuilds the frontend, helper or Worker. It rechecks
staging immediately before applying production migrations and deploying `app`.
After deployment it verifies production identity and upload configuration with GET;
it does not insert synthetic data into production.

If staging is newer, the artifact expired, the commit changed, or any check failed,
run staging again for the intended `main` commit and retest it. Do not bypass the
checks with a direct Wrangler deployment.

## Local validation and dry runs

The [native recognition validation record](recognition-validation.md) defines the
independent game/HDR/UI-scale coverage still required before broader release.
Synthetic WGC float16 tests on an SDR display do not complete that gate. Run
`npm run test:capture-backend -- -RequireCleanGdi` on an unobstructed interactive
release desktop; the default fixture suite reports a skip if a system layer
prevents a clean GDI measurement.

Migration `0007_canonical_capture_observations.sql` retains all submitted rows,
adds a capture-conflict inspection view and changes research counting to one
canonical reviewed offer per capture. Inspect `observation_capture_conflicts`
on staging before promoting; corrections must retain their original capture ID.

```sh
npm ci
npm run check
npx playwright test
npm run test:helper
npm run test:upload
npm run test:upload:integration
npm run release:pack
npm run deploy -- staging --dry-run
npm run deploy -- production --dry-run
```

The helper tests require Windows. `release:pack` requires an absent `.release/`
directory to avoid mixing packages; archive or remove only that generated directory
before packaging a new build. Local packaging does not certify the working tree as
a tested Git commit. Remote deployment through `scripts/deploy.mjs` is restricted
to the designated GitHub workflows; plain `npm run deploy` fails closed.

The smoke test uses `STAGING_URL`, `EXPECTED_REVISION`, `EXPECTED_RELEASE_ID`,
`COLLECTOR_CAPTURE_KEY` and `COLLECTOR_INGEST_KEY`. `STAGING_READ_ONLY=true` skips all
POST requests and needs no keys. It refuses production URLs or mismatched identity.

## Recovery and database changes

Use additive/backward-compatible migrations so the previously deployed Worker can
still run while the new version is being deployed. Test migrations with representative
synthetic data on staging, including older records. A fresh test database alone does
not establish that a destructive migration is safe for production.

Before a production migration that changes existing data, create and verify a D1
backup/recovery point and review the migration separately. There are no destructive
migrations in this staging setup. Code rollback does not restore the database.

For an incident, identify the last good **production Worker version**, check that
its code remains compatible with the current schema, and use Cloudflare's rollback
for `app` only. Do not roll back the staging Worker or compatibility Worker by
mistake. Restore D1 only as a separately reviewed recovery operation. Follow up with
a corrected release through staging. A failed post-deploy check requires diagnosis;
the workflow does not blindly roll back schema changes.

References: [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/),
[Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/),
[D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/),
[Worker rollback limits](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/),
[GitHub environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
