# Symbol moderation and Worker operations

## Review a symbol report

Use a Cloudflare operator identity with D1 access to the intended environment.
Review commands default to local D1. For a remote queue, add
`--remote --config .wrangler/deploy-production.json` (or the corresponding
staging config) before the command. Use the deployment config for the intended
account and database. Operators can use separate reviewer handles for audit.

1. Run `node scripts/review-symbol-reports.mjs list` to list open entries, oldest
   first, followed by recent decisions.
   Add a report ID to look up a specific decision or catalog reference.
2. Run `node scripts/review-symbol-reports.mjs claim REPORT_ID REVIEWER`. D1
   grants one 30-minute claim at a time. Keep the returned claim ID in your
   private session. Another reviewer can claim the item after the lease expires.
3. Run `node scripts/review-symbol-reports.mjs evidence REPORT_ID CLAIM_ID` and
   redirect stdout to a private JSON file. The existing
   `scripts/export-symbol-reports.mjs` converts that JSON into local PNGs and
   report metadata. Treat the shared D1 decision as authoritative. Delete local
   evidence at expiry or withdrawal and check the live claim before use.
4. Run `node scripts/review-symbol-reports.mjs decide REPORT_ID CLAIM_ID STATUS REASON`
   or `release REPORT_ID CLAIM_ID` to give up an active claim.

| Decision | Reason |
| --- | --- |
| `accepted` | `verified` |
| `rejected` | `unreadable`, `insufficient-evidence`, `out-of-scope`, `duplicate` |
| `conflict` | `conflicting-evidence` |

The evidence query lists up to ten possible duplicates with identical encoded
icon and tooltip images. A second active report with that same pair
cannot be accepted after the first. For `rejected duplicate`, append the ID of
the active accepted report with those images. Different encodings or crops
still require visual comparison. A different threshold or effect can require
a `conflict` decision.

Report authors can check coarse status in their report history while their
report remains active. Reviewer handles, reason codes, and duplicate links
stay in the operator queue. Withdrawing or expiring a report deletes its source
payload and any open claim. The queue retains completed decisions and catalog
references as audit metadata.

Acceptance verifies evidence. Apply any resulting catalog changes through
normal code review and source-provenance checks. After the change merges, run
`node scripts/review-symbol-reports.mjs catalog REPORT_ID REVIEWER MERGED_COMMIT_SHA CATALOG_ENTRY`
against the same database. Use the actual merged commit and the catalog key.
The command records one catalog reference per accepted report.

## Investigate Worker failures

API responses include a generated `X-Request-ID`. Filter Workers Logs by
`event = api_failure` and the matching `requestId` to look up a server failure.
Use **Count** in Query Builder and group by `code` or `status` for totals over a
time window. Each record represents one failure. Codes distinguish
configuration, D1, rate limiter, and Siteverify service failures. Logs contain
only fixed event fields and generated IDs.
[Workers Query Builder](https://developers.cloudflare.com/workers/observability/query-builder/)

For scheduled retention, filter `event = retention_cleanup` and group by
`task` and `status`. Diagnostics and symbols each emit a result with the same
request ID. A `d1_failed` or `missing_binding` result makes the Cron invocation
fail after both tasks finish. Use the Cron Events dashboard to check the next
15-minute run and look for a successful result from each task.
[Cron Events](https://developers.cloudflare.com/workers/configuration/cron-triggers/#view-past-events)

Worker failures and error logs are visible in Cloudflare Workers Issues.
To receive notifications, configure a Worker-scoped Issues automation for
the production Worker and use the maintainers' approved destination. Use an
occurrence threshold of 1 for retention cleanup failures and agree on a
threshold with the on-call operator for request errors. Keep the notification
destination private. Confirm the configuration against synthetic staging
failures.
[Workers Issues automations](https://developers.cloudflare.com/workers/observability/issues/automations/)
