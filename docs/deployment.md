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

Symbol reports use separate managed Cloudflare Turnstile widgets for staging and
production. Their public sitekeys and exact permitted request hostnames are reviewed
in `deployment/environments.json`; deploy passes them as `TURNSTILE_SITEKEY` and
`TURNSTILE_HOSTNAMES`. Set each widget's secret directly on its corresponding Worker
as `TURNSTILE_SECRET` before deployment. Never put that secret in frontend code,
GitHub workflow inputs, artifacts or logs. Wrangler preserves this binding when the
staging secrets file updates only the two collection keys. Production configuration
rejects test sitekeys and localhost allowlists. Both release verification and staging
smoke require public reporting to be enabled with the expected real sitekey.

Restrict the `production` environment to branch `main`. Protect `main` with the
`app`, `windows-helper` and `vision-prototype` checks, up-to-date branches, resolved conversations,
no force pushes and no deletions. These settings complement the workflow checks;
repo owners and Cloudflare administrators can still change protections or deploy
directly. This is a controlled release process, not a restriction on account owners.

Required environment reviewers can add another approval when the GitHub plan and
repository visibility support them. The workflow also requires either full native
validation or explicit acceptance of the time-limited prelaunch exception below.
Do not make the repository public
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

For the standard `native-holdout` promotion, manually check:

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
successful **Deploy staging** run ID from its summary and choose a validation mode.

- `native-holdout` is the default. Confirm `manual_tests_passed` only after the
  manual checks above and supply `recognition_run_id` from a successful
  [native recognition verification](recognition-validation.md#required-promotion-artifact)
  for this exact staging release. Both are mandatory, including before launch.
- `prelaunch` is a temporary, explicitly accepted exception while live Fate
  encounters are unavailable. It is allowed only **before 13 November 2026,
  19:00 UTC** (20:00 in Poland), the Friday launch time confirmed by the owner on
  11 November. Set `prelaunch_acknowledged=true`, leave `recognition_run_id`
  empty, and leave `manual_tests_passed=false` if the full manual checklist was
  not completed. This records deferred validation, never a passing native report.
- `hotfix-20261116` accepts the single 0.10.3 package identified below. Select
  its staging run, set `hotfix_update_acknowledged=true`, keep
  `manual_tests_passed=false` and leave `recognition_run_id` empty. The
  workflow requires full CI, Windows helper/browser checks, package integrity
  verification and live synthetic staging tests before deployment.

### Pinned Fate advisor 0.10.3 exception

On 18 November the owner approved publication of the campaign, duplicate Fate,
build danger and last-offer fixes with in-game checks deferred. This promotion
uses the package verified on staging. Native gameplay, the full manual staging
checklist and interaction with a real Turnstile widget remain unverified.

- Source revision `0443214e5e27d6aa4ccb3c0d3f6c1cc66554d7d1`
- Package ID `def6417d5d31efb3f604e5b6ca629bde2fa0fb6923c5b05154c755697b8d3558`
- Staging run [44361514730](https://github.com/Alkwer/fate-collector/actions/runs/44361514730)
- Downloadable helper SHA-256 `807d0d15934a87399015f576e13bbeb6ef7c88be35a02f595bf94e862c2251ef`

All 120 manifest checksums passed. The staged application entry point, its
JavaScript and CSS, and the 141-file helper ZIP matched the release artifact.
Seven live browser checks covered the two-input campaign limit, six regular
reward icons from the Alchemist pair, last-offer ties at three screen widths
and the completed Conjurer Currency set.

### Previous Fate advisor 0.10.2 release (historical)

On 18 November the owner authorized promotion of the matching T2 Currency combo
update after CI and staging. For this package the owner explicitly deferred
in-game validation, the full manual staging checklist and a real Turnstile
interaction. Production Turnstile verification stays enabled.

- Source revision `42058309d2e2eb9cf5d491f1d8c00a33b1011055`
- Package ID `86d8c7186d48b0df69f41d4fac5a99ec6db3dc64f7406255ffd7d0c76b89e94d`
- Staging run [44346808731](https://github.com/Alkwer/fate-collector/actions/runs/44346808731)
- Downloadable helper SHA-256 `1355173e4729d70084e7a79e870c7b56d23990816c4cde68aef1f80d32503126`

The staging workflow passed full CI and live API smoke. All 120 manifest
checksums verified. The published application and 141-file helper matched
the immutable package. Five live browser checks covered Conjurer collection and
invocation, the Malformation choice, and the Malformation and Belfry overlay
headers. With a suggested Bloodthirsty tier the overlay showed the 5-point
Stacked Decks route. With T2 confirmed it showed 9 points for another T2
Bloodthirsty. The packaged Windows renderer displayed this condition in compact mode.

### Previous Fate advisor 0.10.1 release (historical)

On 18 November the owner authorized production publication of the two-line
Windows overlay header after CI and staging verification. The owner deferred
in-game F9/HDR and native recognition checks, the full manual staging checklist
and a real Turnstile interaction for this package. Production Turnstile stays enabled.

- Source revision `151b9081b12e507cb47a570d9047ae8419bd5514`
- Package ID `6839e181340632950bc1b549678d1f1eb5abe56fa28caad3e96ec760e9e7edb5`
- Staging run [44318878022](https://github.com/Alkwer/fate-collector/actions/runs/44318878022)
- Downloadable helper SHA-256 `da66cc1bb7f720e0ebd510258264df4a0d586e65fb1244807f2e2202f03e45d5`

The staging run passed application, vision, Windows helper and live API checks.
All 120 artifact checksums verified. The live application entry point and the
141-file Windows helper matched the manifest. Browser replays of Malformation
and Belfry verified the immediate choice or tie and the conditional icon and
points. The native layout test covers both conditions at 100%, 150% and 200%.

### Previous Fate advisor 0.10.0 release (historical)

On 18 November the owner authorized production publication of the Fate advisor
and 62 Trade weights together. The exception covers in-game F9/HDR capture and
native recognition, the full manual staging checklist and real Turnstile
interaction for this package. The campaign card limit still awaits in-game
confirmation. Production Turnstile verification stays enabled.

- Source revision `d7816181ff3a4ad828003b8dcbcf01db1a23abb8`
- Package ID `74f433691820114b314f5b617a1432950793bf285f087adc34f7cc6dfc907bc5`
- Staging run [44298821576](https://github.com/Alkwer/fate-collector/actions/runs/44298821576)
- Downloadable helper SHA-256 `0efb28df926791e51b626026c36e4c0e01f4392cc72dd0b9a03fe1bed5fe3b62`

Staging passed application, vision and Windows helper CI, plus the live API
checks. Five additional browser scenarios on the deployed site verified
conditional Trade scoring at 390, 820 and 1440 px, reward tooltip selection,
Viscera targeting, challenge progress and fight outcomes. All 120 artifact
checksums verified. The live application entry point and the 140-file Windows
helper matched the manifest.

### Previous build profiles 0.9.0 release (historical)

On 17 November the owner requested production publication without in-game tests.
PR #58 adds up to 20 named build profiles, legacy migration, full-library backup
and recovery, and protection against stale tabs and delayed imports. It packages
the same interface in Windows helper 0.9.0. Capture algorithms, API, migrations
and upload verification are unchanged.

This release used the previous package-specific exception.

- Source revision: `680cd745ab36211b866bb1ea584d2dbcc88dc159`
- Package ID: `ac4c865fa34f60c111b6d6683c261125c0e356e8140867efbd909845bdf351a0`
- Successful staging run: `44146493587`
- Downloadable helper SHA-256: `559232c4492c397b290286628250bbd9ddfcbffc45c31bb2089d4c8b61e9ab22`

The complete staging workflow passed application, Windows helper/browser and vision
checks, including 383 unit tests (one existing skip), 168 E2E scenarios, 30 browser
compatibility cases, 20 visual comparisons and live synthetic API smoke. All 13
build-profile scenarios also passed against the live staging site, including
1440, 820 and 390 px layouts, both themes, migration, map preservation, import/export,
failed storage and delayed file reads. Local verification checked all 79 artifact
checksums and the live staging identity. The downloaded helper matches the manifest
and contains all 100 files, the bundled application and version 0.9.0 metadata.
Codex Review of PR #58 completed without findings.

In-game testing, native recognition holdout and the full manual checklist remain
deferred, not passed. The owner's prior real-widget deferral is retained for the
unchanged verification flow; no new live-widget check is attested. Production
Turnstile remained enabled at promotion.

Website and helper libraries are separate. When upgrading the helper, close it,
replace the complete program bundle and retain `captures`, `symbol-reports` and
`fate-collector.ini`. Export the library before downgrading: older helpers read
only the preserved original single profile. The advisor 0.8.0 package is superseded.

### Previous advisor 0.8.0 release (historical)

On 17 November the owner authorized publication of the completed planning changes
and explicitly deferred tests in the game. PR #56 adds incomplete-combo guidance,
six build-danger categories, a separate boss Viscera objective and manual invocation
recording with undo. It packages the same planner in Windows helper 0.8.0. API,
migrations, capture algorithms and upload contracts are unchanged.

This historical package is no longer eligible for the `hotfix-20261116` mode:

- Source revision: `27b03552b3d530dbe3268d0bc437039f82c189df`
- Package ID: `2f3251370a46279db12a9058625987d2e1561edcfc57c12d5c92405467535fbb`
- Successful staging run: `44063315418`
- Downloadable helper SHA-256: `fea63beb1c9e8fa15921c3e8f0c92d7c00384d95a631208c41b3af7bc1273a36`

The staging workflow passed the complete application, Windows helper/browser and
vision checks, including 155 E2E scenarios, 30 compatibility cases, 20 visual
comparisons and live synthetic ingestion/consent/withdrawal/diagnostic smoke.
Four additional planner scenarios passed against the live staging site at desktop,
tablet and mobile sizes. Local verification checked every artifact checksum and
confirmed that the live helper matches the manifest and contains all 100 files,
including the bundled application, version 0.8.0 producer metadata and changelog.

Local generated-window checks passed the desktop bridge, clean GDI, overlay
rejection, WGC window isolation and a forced float16 path while Windows HDR was off.
These are fixture checks, not game tests or physical HDR validation. The live
real-widget submission/replay/withdrawal check timed out during verification,
before any report submission. On 17 November the owner explicitly deferred this
check as well for this pinned release. It is not recorded as passed. Production
Turnstile verification remains enabled; the automated local suite uses its
existing test-only verifier.

In-game testing, native recognition holdout and the full manual staging checklist
are not attested as passed. The package-specific deferral does not change the
standard native gate or expired prelaunch deadline. Promotion rechecks the pinned
main staging workflow, checksums and live staging identity, then deploys the exact
artifact without rebuilding it. The dependency maintenance package is superseded.

### Previous dependency maintenance release (historical)

On 17 November the owner requested production deployment of PR #51 and explicitly
confirmed that this dependency update does not need in-game testing. The update
changes Workers types, Playwright, the Vite React plugin, fake-indexeddb, Vite,
Wrangler and the matching Playwright CI image. Application, native helper, shared
recognition, API and migration source files are unchanged from the previous
production revision `d8a791e40d917865d53e8a074cce59b61e158d87`.

This historical package is no longer eligible for the `hotfix-20261116` mode:

- Source revision: `f6001e50cbf579577f69df735fb1e210f713601c`
- Package ID: `9757a0c80a2bd0c963258acca508df5f370f0504fb4b587087ab586b7bb09835`
- Successful staging run: `43985917681`

The staging run passed the complete application, Windows helper/browser and
vision checks, then deployed the immutable artifact and passed live synthetic
ingestion, consent, withdrawal and diagnostic smoke tests. Local verification
confirmed every artifact checksum and that the live staging helper matches the
manifest SHA-256:
`9a38d61d720df7fa6c2d87c3a36339f72880248d4888e528fcb328918ad4f2d7`.

In-game validation and the full manual staging checklist are not attested as
passed. The explicit waiver applies only to this package; the standard native
gate and expired prelaunch deadline remain unchanged. Promotion still checks the
staging workflow, main revision, package checksums and live staging identity,
then deploys that same artifact without rebuilding it. The prior standalone
advisor package is no longer eligible for this exception.

### Previous standalone advisor release (historical)

On 16 November the owner requested publication of the overlay and updated
downloadable helper, then extended the task to automatic Fate detection and
explicitly approved a standalone advisor with local advice and collection storage.
The previous pin covered the tested package from PRs #50, #52 and #53 and
replaced the manual overlay 0.6.0 package. The record below is historical
evidence; this package is no longer eligible for the current exception:

- Source revision: `d8a791e40d917865d53e8a074cce59b61e158d87`
- Package ID: `b100b4c8dda595540ddfcde17b08d6b7f50e7b37291304175f9ac0934439832f`
- Successful staging run: `43977132704`

That run passed application, Windows helper/browser and vision checks, plus
live staging ingestion smoke. Four overlay browser flows also passed against
the deployed staging site. The downloaded helper's 99 files include the
local application, native host, WebView2 SDK and automatic detection worker.
Its SHA-256 matches the immutable release manifest:
`fddd57f61109627c4fc6d3d64370e053f5f4665e2884c6c63895d793806e860c`.

The first staging attempt exposed an OPFS snapshot race in the E2E state reader:
replacement between getFile() and text() raised NotReadableError. A native Chromium
probe reproduced it, and the publication PR bounds retries to that specific error
while allowing other failures to surface. Twenty repeated overlay scenarios passed;
the unchanged product package then passed the staging workflow on retry.

Local validation covered automatic detection and deduplication with generated
native windows and archived OCR, native WebView2 RPC and network blocking,
hidden-window updates, choice recording and collection restoration after restart.
Desktop browser fixtures cover automatic connection, persistence, responsive
layout and keeping the public website usable in other WebView2 hosts. The native
capture backend passed clean GDI and WGC overlay exclusion, including float16,
while Windows reported HDR active. The separate overlay foreground-window fixture
could not acquire focus on this desktop; its pure protocol/rendering checks passed.
Actual Fate gameplay, recognition holdout and the full physical HDR/display matrix
remain unvalidated. Full manual staging checks are deferred, not attested as passed.

The promotion workflow runs from reviewed `main`, which contains this policy
change, and deploys the existing artifact without rebuilding it. The package
revision differs from the policy commit only in this mode. Package verification
and deployment both enforce the pinned revision and package ID; the workflow
also enforces the staging run identity and rechecks live staging.

This is a package-specific waiver, not a general bypass. The standard native gate
and expired prelaunch deadline are unchanged. Helper 0.7.0 can run advice and
collection storage locally without a browser tab or internet; the installed
Microsoft Edge WebView2 Runtime is required. Automatic detection reads the
calibrated panel, requires two matching known English card-name rows, and leaves
game input and recording the chosen card to the user. F9 remains the fallback.
Automatic captures remain local and are excluded from existing F9 upload consent.
PoE must use windowed or borderless mode. API, migrations and collection upload
contracts are unchanged. Missing details that cannot fit in the overlay require
review in the local advisor or website and disable the affected overlay actions.

### Temporary prelaunch policy

The repository owner requested this exception on 11 November because live Fate
offers and invocations cannot be captured before the league launches. Full CI,
Windows capture/OCR/queue/recovery tests, browser review tests, the real
helper-to-local-Worker integration, and the live synthetic staging smoke remain
required through the successful staging workflow. These automated checks replace
the manual staging attestation for this temporary mode; they do not establish
native Fate recognition accuracy or physical HDR/UI-scale coverage.

A native Character-panel check on 11 November additionally exercised F6/F7,
F8 and F9 with helper 0.3.4 from release `f8c39605593adb3202b44b3a79966d2b8fff4f48`:
the 3840 × 2160 client produced a 1310 × 1715 crop, OCR returned 32 lines,
the app proposed zero Fate cards, and local save/reopen passed without uploads.
Private evidence is retained locally under `.qa/native-review-20261111/`.
This single negative is supporting evidence, not a substitute holdout.

The workflow summary explicitly records the deferral. The deadline is checked
both before artifact verification and again in the production deployment script,
so a job waiting for approval cannot use an expired exception. Expiry prevents
new prelaunch promotions; it does not remove an already deployed version.
After launch, complete the native sample plan and full manual checks on the
intended staging package before the next production promotion. Extending the
exception requires a reviewed code change; there is no caller-supplied deadline.

Before accessing the production environment, the workflow verifies that:

1. The source run belongs to this repository's staging workflow, was manually
   dispatched on `main`, finished successfully and matches this exact commit.
2. The downloaded artifact has the expected commit and unchanged checksums.
3. The live staging still reports that same commit and package, both upload paths
   are enabled, and the homepage and helper are reachable.
4. The selected validation policy is satisfied. Standard promotion verifies the
   native report workflow identity and recomputes its gate against the package;
   prelaunch records the explicit, unexpired deferral instead.

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
independent game/HDR/UI-scale coverage required by standard promotion after the
temporary prelaunch exception expires.
Synthetic WGC float16 tests on an SDR display do not complete that gate. Run
`npm run test:capture-backend -- -RequireCleanGdi` on an unobstructed interactive
release desktop; the default fixture suite reports a skip if a system layer
prevents a clean GDI measurement.

Migration `0007_canonical_capture_observations.sql` retains all submitted rows,
adds a capture-conflict inspection view and changes research counting to one
canonical reviewed offer per capture. Inspect `observation_capture_conflicts`
on staging before promoting; corrections must retain their original capture ID.

Migration `0008_symbol_reports.sql` adds independent image-research storage and
withdrawal tombstones. Additive migration `0009_public_symbol_reports.sql` adds daily
source hashes and a short-lived, atomic Turnstile replay ledger. Scheduled cleanup
expires symbol payloads after 30 days, source hashes after their UTC day and used
challenge hashes after ten minutes. Intake reuses the rate-limit binding and D1.

Automated staging smoke checks public configuration and rejection of missing or
forged Turnstile tokens, including attempts to bypass it with a collection key.
Successful submission, retry, consent, quotas and withdrawal run against the real
local Worker with a test-only Siteverify transport in the ignored E2E entrypoint;
that transport is never packaged for deployment. Before promotion, also verify a
fresh real-widget token on staging: submit synthetic evidence, confirm the receipt,
check replay rejection and withdraw it. For the November 18 release, the owner
deferred this interaction under the
[pinned Fate advisor 0.10.3 exception](#pinned-fate-advisor-0103-exception).
Real user evidence must not enter staging.
Never disable production verification or deploy a test-key bypass to run smoke tests.

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
