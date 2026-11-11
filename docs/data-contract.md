# Observation contract, version 1

The executable contract is `shared/schema.ts`. Consumers must validate `kind` and
`schemaVersion`; unknown fields and unsupported versions are rejected. Screenshots
are evidence, not trusted recognition results. All timestamps use ISO 8601 with an
explicit offset; generated captures use UTC.

## Capture bundle

`fate-collector.capture` is produced by the Windows helper. It contains a UUID,
capture time, helper version, PNG dimensions/base64 and OCR status, language, raw
text and line rectangles. `context.captureMode` is `game` or `fixture`. Game capture
sets the offer's origin to `live`; fixtures and older bundles without context
default to `test`. This provenance is a client assertion, not remote attestation.

The helper writes a local backup and replaces the clipboard. Optional direct cloud
upload sends a text-only projection described below. Imported captures retain the UUID as their offer ID. Importing the
same file opens existing corrections instead of overwriting or duplicating them.
If a metadata backup restored the offer without its screenshot, importing the
original capture restores missing screenshot/OCR evidence without changing the
offer revision, review status or existing corrections. Existing evidence is never
replaced by another copy of the same capture.
Another F9 press creates another ID, even if the screen has not changed. Capture
each encounter once. Helper 0.2.0 adds optional `context.session` with a random UUID
`id`, ISO `startedAt` and positive `sequence` (up to 1,000,000,000). A session lasts
until helper restart or a different game process is captured. Sequence counts
published captures only; it is independent of `encounterNumber` and game progression.
Legacy files without these fields remain valid.

Optional `context.possibleDuplicate` contains `ofCaptureId` and the fixed reason
`same-ocr-within-15s`. It references the preceding published capture in that session
when successful, nonempty OCR matches after whitespace/case normalization, dimensions
match and elapsed time is between zero and 15 seconds inclusive. Recalibration
clears the preceding comparison. Different modifiers, blank/failed OCR and different
sessions are not evidence of a repeat. This hint does not delete, merge, review or
exclude either record. It is not visual identity detection or proof of a duplicate.
The source context is retained as optional `offer.captureContext`, including through
reviewed corrections, export/import and the research view. Self-references are invalid.

The imported source image and raw OCR are stored separately from edited card fields.
Current extraction first requires a unique `Fates`/`Select a Fate` heading and
`Confirm` button to bound the offered area, then looks up names in its first text
row. Unknown headers retain their column space; cards below `Confirm` are excluded.
Missing or ambiguous boundaries produce no candidates, including tightly cropped
captures without these controls. Raw evidence remains available for manual review.
The small name dictionary may miss unknown names or misassign text at unsupported scales/layouts.
The app never automatically claims the offer is complete or reviewed.

Helper 0.3.2 adds optional `image.frameHeight`, the full client height before a
calibrated crop. It must be at least the PNG height and at most 8192. Offline image
exports omit it. The direct-upload projection omits it as well. Older captures
remain valid; cropped legacy captures without scale metadata receive no visual
claim. Update the website before using the new helper with strict older clients.

Local browser matching may set `card.visualReview` (`version`, `tierReviewed`,
`rewardsReviewed`) and a reward's optional catalog `visualId`. These are provenance
and review flags, not probabilities. There is one row per matched icon. The
versioned tooltip catalog can suggest a known meaning (currently Dreadmaidens'
Sacrament combo 2); ambiguous shapes retain `kind: unknown`, `identified: false`.
An identified meaning does not confirm the image match or reward completeness.
Unknown unseen icons are not invented as additional rows. The full row remains
partial until the user checks every icon, kind, count and threshold. Changes to a suggested tier or rewards reset
their corresponding review flag. These optional fields survive offer backups
and explicitly shared reviewed corrections; automatic raw cloud parsing still
receives only OCR and does not run vision.

Local evidence optionally records `visualRecognition` with version, status and
bounded warning strings. This is not an image upload or a human review. Recognition
is only applied while constructing a fresh draft; existing corrected offers retain
their fields and revision when a capture is imported again.

## Automatic folder intake

The browser reads only top-level `fate-<uuid>.json` files in the user-selected folder,
with read-only File System Access permission. Pending files, subdirectories and
unrelated files are ignored. Filename IDs must match the capture payload. Only
helper capture bundles are accepted automatically, not offer exports. The same
size, schema and decoded-image checks apply as for manual import.

Intake saves the offer, evidence and receipt in one IndexedDB transaction. Concurrent
tabs and repeated polling cannot create another copy or replace corrected data.
Deletion retains a receipt, so reconnecting does not resurrect the observation.
If the user explicitly restores that offer from a metadata backup, the current
connection recovers its missing evidence from the original helper file on a later
scan, without changing corrections or counting it as a new capture.
A failed/full save does not acknowledge the file; it can be retried. Deletion receipts
are lightweight local IDs and are not included in exports. Clearing browser site
data clears these receipts and the saved connection too.

Automatic captures have `reviewed: false` and `completeness: unverified`, even when
OCR appears successful. Local corrections also save automatically while connected;
editing resets review as below. `/api/observations` continues to require explicit
review and manual Share. No upload is triggered by folder intake itself; the
separately enabled helper uploader uses `/api/captures`.

The directory handle is stored locally in IndexedDB, and existing version-1 journals
are upgraded without deleting their records. Permission is checked before reading;
revocation pauses intake. Browser suspension delays work but completed files remain
on disk. The feature is designed for desktop Chrome/Edge and a secure origin.

## Direct automatic upload

`POST /api/captures` accepts `fate-collector.upload` schema version 1, authorized by
`COLLECTOR_CAPTURE_KEY` and a current capture consent (see below). Its fields are `captureId`, `capturedAt`, `source`,
`helperVersion`, required `context.captureMode`, `image: {width, height}` and the
original `ocr` object. Image bytes and all unknown fields are rejected. Only game
captures are accepted; this is still a client assertion, not verified provenance.
The body limit is 128 KiB, including UTF-8 encoding. Screenshots stay in the local
bundle. Raw OCR can contain anything visible inside the selected panel, so the
helper explicitly describes the upload before enabling it.

The Windows helper queues only captures newer than the explicit enable time.
It persists immutable request bodies, retry state and receipts separately from
the original files. HTTPS is required, redirects are not followed and certificate
checks remain enabled. The CLI-only local test exception allows an explicit
`http://127.0.0.1:<port>` origin; the interactive helper never enables this exception.
The encrypted key and upload state belong to the Windows user, not the browser.

An atomic D1 insert returns `201 {id, status: "accepted", reviewed: false}`.
An identical retry returns `200 {id, status: "duplicate", reviewed: false}`;
different content for the same ID returns 409. A successful receipt must match the
capture ID, status and unreviewed flag. Network errors, missing/invalid receipts,
408, 429 and server failures keep the queue for retry. 401/403 pause until settings
are corrected. Invalid or conflicting captures are recorded as rejected, with the
original file preserved for inspection. They are never acknowledged as accepted.

`capture_uploads` preserves raw OCR, the parsed candidate and parser version. OCR
errors and unavailable OCR are retained as empty unverified candidates, not dropped
from the sample. No automatic upload claims complete coverage. Game version and
area are not inferred. `research_observations` combines raw candidates and the
latest reviewed offers, preferring a reviewed offer with the same ID or capture
reference. The raw evidence stays available even after a reviewed correction.
There is no public cloud read endpoint or automatic correction sync in this version.

## Offer

`fate-collector.offer` contains an ID, revision, capture reference, timestamps,
source/origin, game version, optional area/level, encounter number, offered cards,
optional selected card, review/coverage flags and notes. Each card has its own ID,
name, nullable tier, modifiers and reward annotations. Rewards have a label, kind
(`regular`, `combo`, `unknown`), count, optional threshold and identification flag.
These are observations entered by a reviewer, not validated recipes.

- `unverified`: coverage has not been checked. It can be saved locally.
- `partial`: the reviewer knows some offered cards are missing.
- `complete`: all offered cards are included, named and manually checked.
- `reviewed`: the extraction was compared against its evidence. Unknown icons or
  tiers can remain unknown even in a reviewed, complete offer.

Corrections reset review; editing a previously complete offer resets coverage to
unverified. **Confirm and save** is an explicit user assertion that all offered
cards are listed correctly. It sets reviewed/complete together, or preserves partial
coverage if the user already marked the offer incomplete. It requires source evidence
and at least one named card. **More actions → Save for later** keeps the capture
unverified. Unread evidence is saved without marking it complete or reviewed.
Under **Edit details**, one Review status selector replaces separate coverage and
review controls. Area, tier, modifiers, rewards and selection are never required to save.
Manual encounter number defaults to 1 and is not a measured roll sequence. Game
captures initially use version `unknown`; exclude that cohort from version-specific
statistics until corrected. No area or patch metadata is read from the game yet.

Local saves update one offer and increment its revision. D1 retains immutable
submitted revisions. Use `research_observations` for encounter counts;
`latest_observations` alone can contain historical capture collisions.
Higher revisions represent corrections, not additional encounters. First write wins
for the same ID and revision; identical retries succeed without another record.
Local edits must also match the currently stored revision. A stale editor cannot
overwrite a newer save from another tab; its draft remains available for export
before reopening the latest offer. Auto-save retains text typed during its own
pending write and uses that write's committed revision for the next save.

Deletion also stores a local tombstone. A stale manual or automatic save fails
without replacing the draft. Explicit backup import can restore the offer and
clear that tombstone; ordinary saves cannot.

Migration `0007` preserves historical rows and exposes collisions through
`observation_capture_conflicts`. `canonical_observations` selects the latest
revision of the first submitted offer still referencing each capture. The research
view uses that canonical row instead of counting several reviewed IDs for one
capture. Manual offers without a capture remain independent. New submissions
cannot claim another offer's capture or change an existing capture reference.
Capture UUID comparisons are case-insensitive. Historical collision owners can
still submit corrections with the same reference; no history is silently deleted.

## Export and limits

`fate-collector.export` wraps up to 250 offer/evidence pairs. Current-offer exports
include local evidence. History exports offer a full evidence backup (the default)
or metadata only. Metadata imports
cannot reconstruct missing screenshots on their own. Existing offer fields are kept
unchanged during import, including corrections; matching missing evidence can be restored.
Multi-offer imports are atomic and reject a storage-cap overflow before writing.
Offer and archive imports, including single-offer backups, restore directly to
local storage without changing the saved revision, timestamp or review status.
This allows a previously shared revision to be retried unchanged under the same
consent. A subsequent edit creates the next revision. New screenshots and helper
captures still open as drafts when imported manually.

Capture and plain-image imports remain limited to 12 MiB. Archive imports accept
up to 32 MiB, so an already valid capture plus later corrections can be restored
together. **Export all data** splits a journal into numbered, independently importable
files, normally at 12 MiB. An individual pair over that size gets its own part, up
to 32 MiB. Download every part. Full backups include local image/OCR evidence;
metadata-only backups omit it. Each part includes a backup set UUID, part number
and total. Select all parts together to validate completeness before importing;
single-part imports explicitly report their position. Export reads each offer
with its evidence in one IndexedDB transaction, then decodes the image outside it,
serializes one bounded part at a time and retains downloadable blobs rather than
all image strings. Unsaved editor changes are not part of the saved journal.

Unreadable offers are excluded from normal history and backup with a visible count;
the original records remain in IndexedDB. Missing or invalid evidence is also
reported and the readable offer metadata is exported. **Export recovery data**
creates a separate `fate-collector.recovery` file containing raw invalid records,
associated evidence and validation errors. It is for manual repair and is not
accepted as an ordinary import; listing, backup and recovery export never delete it.
Explicit isolation moves unreadable records to recovery storage. Explicit evidence
repair keeps the damaged original there too. Recovery import salvages valid offers
from an export, reports omissions, and does not modify the original input file.

Unsaved valid drafts have separate IndexedDB recovery copies; they do not change
saved offer revisions. Recovery is offered after reload. Invalid or unsaved recovery
writes show an error rather than claiming persistence. History broadcasts refresh
other tabs; pending edits retain revision conflicts. Storage usage, the 250-offer
limit and browser persistence are visible in the journal. Sharing preflight checks
the actual UTF-8 request size against 128 KiB.
The editor accepts at most 40 modifier lines per card and 1,000 characters per
line, shows the invalid line, and preserves the draft until corrected.
Images are limited to 8192 pixels per
edge and 16,777,216 pixels overall. API bodies are limited to 128 KiB. Reviewed
`/api/observations` accepts an offer only and rejects image/raw OCR fields;
`/api/captures` accepts the text-only upload contract. The app checks actual
decoded image dimensions, not just the bundle's claims.

## Sharing and privacy

Local Save never uploads observations. Share is disabled for an offer with unsaved
corrections, so an older reviewed revision cannot be sent while edits are pending.
Share sends all structured offer fields,
including card descriptions, area, notes and capture time, to this site's API. It
does not send image bytes or the raw OCR bundle. Do not put personal information
in notes or manual fields that you intend to share. The API stores no account name,
installation ID or client IP in its observation table. Hosting infrastructure may
retain ordinary request logs; the application does not log bodies or access keys.

Only reviewed live offers with at least one card and partial/complete coverage are
accepted by the reviewed endpoint. Examples cannot be reclassified as live. The
server enforces these rules again. Automatic captures use a separate endpoint/key
and remain unverified. These collection keys are intended for a small trusted research group.
They do not provide accounts or prevent a trusted key holder from submitting
fabricated observations. Individual consent credentials control submissions and
withdrawal within their scope. Browser offer deletion is local only.

## Explicit sharing consent

The canonical copy is `shared/consent-policy.json`, packaged with both the website
and Windows helper. Operator: **Fate Collector — Alkwer**; contact:
https://github.com/Alkwer/fate-collector. Each grant covers one channel (`captures`
or `observations`), device/profile and API origin. Local capture/review remains
available without a grant. The checkbox starts unchecked. Accepting website
consent never sends an offer by itself; each offer still needs explicit Share.

`POST /api/consents` requires the channel's collection bearer key and a strict
JSON object: `id` (random UUID), `scope`, `policyVersion`, `acceptedAt` (device ISO
time), `text` (the exact displayed copy including destination), and `token`
(cryptographically random 32 bytes, encoded as 64 lowercase hexadecimal digits).
The server verifies current version/text and rejects future dates beyond five
minutes. It stores an immutable record with an independent server `recordedAt`
time and a SHA-256 token hash. The response (201 new / 200 identical retry)
contains the record without the token, plus `withdrawnAt: null`.

Both data endpoints require `X-Consent-Id` and `X-Consent-Token` in addition to
their collection key. Missing consent returns 428; invalid, withdrawn, wrong-scope
or outdated consent returns 403. Captures predating acceptance are rejected (422).
Clients validate the exact consent receipt before sending gameplay data. Updating
the policy version requires a new explicit choice. Previously enabled helper
settings are not consent evidence. Reviewed revisions cannot reuse another
consent's offer ID (409), including unassigned legacy rows.

`POST /api/consents/{id}/withdraw` accepts `X-Consent-Token` and
`{ "withdrawnAt": "<device ISO time>" }`, without a collection key. It returns
`{id, status: "withdrawn", withdrawnAt: "<server ISO time>"}`. Requests are
idempotent; an early withdrawal also blocks a delayed grant. The database records
the request and server dates, deletes capture/observation rows attached to that
consent in the same statement through a trigger, and rejects late writes.
Another consent's data and local files are preserved. Only the minimal consent
audit remains; Cloudflare recovery backups may retain deleted data temporarily.
Unknown consent IDs have an atomic limit of 100 new withdrawal records per UTC
day, returning 429 with Retry-After until the next day. Deleting known consents
and repeating existing withdrawals do not consume this allowance. Both clients
persist the retry time while keeping sharing disabled locally.

The website's **Saved offers → Shared research collection** contains the consent
text, acceptance time, one-click **Withdraw consent**, history, accepted text and
an audit export without credentials. The helper provides these controls in
**Cloud upload settings** and stores records under its local `consents` folder.
Withdrawal immediately disables local sends and is retried on connection/restart
until confirmed. An in-flight send may finish before the server receives the
withdrawal. Data already sent under that consent is then removed from D1.

Website records use browser local storage; helper credentials use Windows DPAPI.
Do not clear site data or delete helper settings while withdrawal is pending:
without the local credential, this version has no account-based recovery.
Withdrawing website consent does not withdraw helper consent or another device's
consent. A grant is permission scoped to a random credential, not identity proof.
Old rows stay unassigned; no consent is inferred for historical collection data.

## Rules for later frequency analysis

Keep full offered sets, including rejected Fates. Do not estimate offer probabilities
from chosen cards. Analyze each game-version, area-level and other relevant context
separately when those mechanics are known. Use only one latest revision per offer;
track complete versus partial coverage and recognition failures explicitly.

Complete-card samples can still have unidentified reward icons. A reward analysis
needs its own recognition-coverage denominator. Never silently treat unknown as zero.
Retain unread captures to measure missed recognition and avoid collecting only
interesting rewards. Voluntary/manual samples may have selection bias; this
foundation does not estimate probabilities or assert a random sampling process.
