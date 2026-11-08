# Diagnostic reports

Diagnostics are independent of gameplay-sharing consent. The website's
**Diagnostics** tab and the helper's tray **Report a problem** command generate a
small report locally. Review the exact JSON, optionally download a ZIP, then tick
the separate unchecked consent checkbox and explicitly send it. Downloading does
not upload anything. A capture or reviewed-offer collection key authorizes delivery;
neither key is included in the report. Local capture works without diagnostic consent.

The operator is **Fate Collector — Alkwer**, contacted through
https://github.com/Alkwer/fate-collector. A confirmed submission returns a random
report number; include it when describing the problem to the operator. Sending a
diagnostic report does not automatically create a public GitHub issue.

## Included and excluded information

`shared/diagnostics.ts` defines the strict report schema; the helper reconstructs
the same shape from explicitly allowed fields. Reports contain software versions,
coarse runtime/platform, collection environment, technical state, bounded queue
counts, generation time and up to 100 timestamped event codes/statuses. The random
report ID is newly generated, not a capture, session, account or consent identifier.

Reports never copy raw log files, exception messages/stacks, arbitrary console
output, URLs, usernames, paths, screenshots, OCR, clipboard data, offers, notes,
access keys or stored consent credentials. Browser runtime errors record only
`runtime-error`; import errors record only `import/error`. The helper reads bounded
status files, not capture bundles. A fixed vocabulary protects against incidental
secrets more reliably than trying to redact arbitrary strings after collection.

The ZIP has exactly one file: `diagnostics.json`. It does not contain private local
receipts or settings. Unknown payload fields and strings outside the schema are
rejected by the API, even if a client bypasses the UI. There is no free-text problem
description field in the report; discuss the problem separately using its number.
Collection credentials travel only in authorization headers. A separate random
deletion credential travels with the request and is stored hashed on the server;
it is never part of the diagnostic JSON or ZIP.

Browser events stay in local storage (last 100 allowed events); helper events are
bounded by fixed code/outcome slots. Clearing the browser's local diagnostic events
does not remove submission receipts. Diagnostic recording never automatically
sends reports. On a failed or missing receipt, use **Review and retry** explicitly.

## Consent, deletion and retention

The accepted text/version and device acceptance time are stored together with an
independent server receipt time. Every report needs a separate choice; generating
a new report resets the checkbox. The canonical copy is
`shared/diagnostics-policy.json`, included in the downloadable helper.

The deletion credential is saved before sending: browser local storage or Windows
DPAPI in the helper's private diagnostic records. This permits retry or deletion
even if the upload response was lost. Keep site data/helper settings until deletion
is confirmed. There is no account-based recovery after deleting these credentials.

**Withdraw consent and delete report** (or the helper's delete action) records the
request locally and blocks resending that report. Only deletion requests retry
automatically when connected or after restart. The server atomically removes the
report payload and preserves a tombstone so a late upload cannot restore it. Local
ZIPs, screenshots and gameplay data are unaffected; previously downloaded ZIPs
cannot be recalled from external recipients.

The report expires 30 days after server receipt. Worker Cron runs every 15 minutes
and sets expired `report_json` to NULL. Diagnostic uploads also run this cleanup.
Retries retain the original expiry. The minimal consent/deletion audit (random ID,
credential/content hashes, exact consent text, dates) remains after payload removal.
Cloudflare recovery backups can retain deleted data temporarily. Ordinary hosting
request metadata is separate from the report; this code logs no request bodies or
credentials. Do not restore expired/withdrawn payloads from backups into active use.

## Operator access

Reports have no public read/list endpoint. Use the Cloudflare D1 console for the
correct environment with administrator access. For a report number supplied by a
user, retrieve only a live payload:

```sql
SELECT report_json, recorded_at, expires_at
FROM diagnostic_reports
WHERE id = '<report UUID>' AND report_json IS NOT NULL
  AND withdrawn_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
```

Use staging database `fate-collector-staging` for tests. Production uses
`fate-collector`. No report data is added to research views. The operator can inspect
the fixed event codes, correlate failure status and software version, and ask the
reporter for reproduction steps without requesting keys or raw capture files.

## API

- `POST /api/diagnostics`: bearer capture or reviewed-offer key; JSON
  `{report, consent: {version, text, acceptedAt}, token}`. Limit 64 KiB.
  Returns 201 for a new report, 200 for an identical retry, with
  `{id, status: "received", receivedAt, expiresAt, consent: {..., recordedAt}}`.
- `POST /api/diagnostics/{id}/withdraw`: `X-Diagnostic-Token`, no collection key;
  body `{withdrawnAt}`. Returns `{id, status: "withdrawn", withdrawnAt}` with the
  independently recorded server date. Identical retries preserve that date.
- Missing/invalid key: 401; invalid/extra fields: 400; policy or ID conflict: 409;
  already withdrawn/expired upload: 410; oversized request: 413; storage failure:
  503. Responses never echo invalid input or keys.

## Abuse limits

Cloudflare's rate-limiter binding checks requests before parsing bodies or querying
D1: 20 requests/minute per network source, separately for send and delete routes.
It uses a short-lived keyed digest of the platform-supplied network address,
separated by environment and day. No address or digest enters a report, D1 or
application logs. Shared networks can share this allowance. Missing/failed limiter
configuration fails closed (503), rather than silently disabling protection.

Cloudflare counters are approximate and local to an edge location. A second,
strict limit inside the SQL INSERT admits at most 100 new reports per UTC day for
the entire environment. It counts retained audit rows, so deleting reports does
not replenish the allowance. Duplicate retries preserve the original receipt and
do not consume another report slot. Atomic SQL protects simultaneous requests.

Deletion has an independent edge counter and never consumes the report quota.
To prevent unauthenticated storage abuse, withdrawal tombstones for unknown IDs
have a separate global limit of 100/day. Deletion of an existing report with its
correct credential remains possible even when either creation quota is full.
Invalid credentials cannot delete another report.

Exceeded limits return 429 with `Retry-After`. Clients preserve the local package
and wait before another attempt; uploads never retry automatically. Limits cap
stored reports but do not eliminate request-volume/DDoS costs or identify people.
See [Cloudflare rate-limiter accuracy and locality](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

## Validation

`npm run check`, `npx playwright test`, `npm run test:diagnostics`, and the existing
Windows upload integration cover privacy canaries, exact consent, false/lost
receipts, duplicate submission, offline deletion, late-write prevention and
30-day expiry. The staging workflow also submits a synthetic diagnostic, verifies
rejection of a raw-log field, checks the receipt/expiry, deletes it and rejects replay.
Before promotion, inspect the desktop/mobile UI and the downloaded helper, check
D1 payload deletion, and verify the staging Worker has the `*/15 * * * *` schedule.
