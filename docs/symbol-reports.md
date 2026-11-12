# Reward symbol reports

Open a captured offer and choose **More actions → Report symbol**. Select the Fate
and reward (or **New / unrecorded symbol**). Crop one icon from the original capture,
including its border, or choose a tightly cropped image. Add a separate image of the
tooltip with its effect and threshold. Optional names and descriptions may stay unknown.
Check the game version and both image previews, then accept the independent
image-sharing consent. No collection key or account is required. **Send symbol report**
saves the immutable submission locally and opens Cloudflare Turnstile verification
before contacting the server. Allow its verification script and complete any prompt.

**More actions → Symbol report history** works on every screen, including without
an active map. It distinguishes saved/pending, received, withdrawal pending,
withdrawn and expired reports. Retry sends the same report ID and payload; it cannot
create another observation. Receipt validation includes the accepted consent.
Withdrawal is saved locally before the request, blocks later retries and can be
retried after reopening the panel. Received reports need only the per-report token;
cancelling an upload that has not reached the server also requires fresh Turnstile
verification, preventing unchecked requests from exhausting cancellation capacity. Keep browser site
data until withdrawal is confirmed. Uploaded credentials are never stored in reports;
the locally retained per-report token authorizes withdrawal only.

## Data and limits

`POST /api/symbol-reports` requires a fresh Turnstile token and separate per-report
consent. The server validates the token's hostname, action, report ID and age, and
atomically rejects reused tokens. Existing helper OCR consent and reviewed-offer consent do not authorize
image submission. The existing capture and observation upload paths remain text-only.
The report references the local offer ID/revision, capture ID if available, card and
reward IDs, game version, origin and area level. Its source offer need not already be
shared. No full offer, raw OCR, file name or full screenshot is silently attached.

Images are decoded and re-encoded as PNG in the browser, dropping source metadata.
Only the two displayed images are submitted: icon at most 256 × 256 / 64 KiB;
tooltip at most 1600 × 1600 / 384 KiB; request at most 640 KiB. The server checks PNG
structure, chunk checksums, dimensions, bounded pixel decompression and strict fields.
Text/profile metadata, animation and unsupported chunks are rejected. Payloads remain
below D1's 2 MB row limit.
The independent `symbol_reports` D1 table retains images as bounded base64 JSON.
The existing rate-limit binding uses separate `fate-symbols` keys. Atomic database
limits allow 5 new reports per network per UTC day, 200 across the site per UTC day,
and at most 100 MiB of active report payloads. A separate 20 requests/minute rate limit
applies per network and operation. Shared networks share their allowance. Retries of
an existing report do not consume a new daily slot but require fresh verification.
Unknown-report cancellations have separate limits of 5/network/day and 200/site/day;
withdrawing an already received report remains possible when those limits are full.
There is no public list/read API. Raw IP addresses are not stored in report tables;
daily secret-derived source hashes are cleared after their UTC day. Used challenge
hashes expire after ten minutes and are capped at 2,000 records.

`GET /api/symbol-reports/config` exposes only availability and the public sitekey.
The secret stays in the Worker. Intake fails closed when verification is unavailable;
received reports can still be withdrawn with their locally retained report token.

Images/descriptions expire after 30 days through the scheduled cleanup and on new
uploads. Withdrawal immediately clears the live payload and keeps a minimal audit
and replay tombstone, including for a lost upload receipt. Database recovery backups
can retain deleted data temporarily. Local originals are unaffected. Do not copy
real reports to staging or attach them to public PRs.

## Maintainer review

Reports are evidence candidates, not training labels or established mechanics.
With authorized D1 operator access, export only active rows to a private local file:

```sql
SELECT id, report_json, expires_at, withdrawn_at FROM symbol_reports
WHERE report_json IS NOT NULL AND withdrawn_at IS NULL
  AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
ORDER BY recorded_at LIMIT 50;
```

Save the Wrangler `--json` result as `queue.json`, then run:

```sh
node scripts/export-symbol-reports.mjs queue.json .qa/symbol-review-YYYYMMDD
```

The command validates all rows before writing, refuses an existing directory,
excludes withdrawn/expired content, and produces an icon, tooltip and metadata for
each report plus `review.json`. No credentials are exported and no templates change.
Delete private exports at expiry or withdrawal as well; recheck the source table
before using a candidate. Do not publish user submissions as fixtures without
separately establishing permission for that use.

Review the full tooltip and border, distinguish normal/combo variants and conflicting
thresholds, and compare independent examples. Record verified facts, contradictions,
reviewer and date in `review.json`. A verified meaning still does not establish a
market price, drop rate or a reliable visual matcher. Catalog/template changes remain
reviewed code changes with source provenance, negative cases and separate holdout
validation. Reports never automatically alter another player's recognition, personal
templates or solver weights.
