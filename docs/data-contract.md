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
each encounter once; visual duplicate detection is not implemented.

The imported source image and raw OCR are stored separately from edited card fields.
Current extraction uses a small name dictionary and the topmost recognized card
row. It may miss unknown names or misassign text at unsupported scales/layouts.
The app never automatically claims the offer is complete or reviewed.

## Automatic folder intake

The browser reads only top-level `fate-<uuid>.json` files in the user-selected folder,
with read-only File System Access permission. Pending files, subdirectories and
unrelated files are ignored. Filename IDs must match the capture payload. Only
helper capture bundles are accepted automatically, not offer exports. The same
size, schema and decoded-image checks apply as for manual import.

Intake saves the offer, evidence and receipt in one IndexedDB transaction. Concurrent
tabs and repeated polling cannot create another copy or replace corrected data.
Deletion retains a receipt, so reconnecting does not resurrect the observation.
If the user explicitly restores that offer from a metadata backup, reconnecting
can recover its missing evidence from the original helper file.
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
`COLLECTOR_CAPTURE_KEY`. Its fields are `captureId`, `capturedAt`, `source`,
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
submitted revisions. Use `latest_observations`, not all rows, when counting offers.
Higher revisions represent corrections, not additional encounters. First write wins
for the same ID and revision; identical retries succeed without another record.

## Export and limits

`fate-collector.export` wraps up to 250 offer/evidence pairs. Current-offer exports
include local evidence. History exports contain metadata only. Metadata imports
cannot reconstruct missing screenshots on their own. Existing offer fields are kept
unchanged during import, including corrections; matching missing evidence can be restored.
Multi-offer imports are atomic and reject a storage-cap overflow before writing.

JSON imports/exports are limited to 12 MiB. Images are limited to 8192 pixels per
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
They do not provide contributor ownership or prevent a trusted key holder from
submitting fabricated observations. Browser deletion is local only.

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
