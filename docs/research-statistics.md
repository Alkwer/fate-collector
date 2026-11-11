# Research corpus quality

Run the report locally with the project's Node 24 and installed dependencies. Use
a version 1 Fate Collector JSON export from **Saved offers** for a history
summary. Full backups and current-offer exports include available local evidence;
offer-data-only backups omit it.

```powershell
node scripts/research-corpus-stats.mjs offers.json
node scripts/research-corpus-stats.mjs offers.json --format json
node scripts/research-corpus-stats.mjs offers.json > quality.md
node scripts/research-corpus-stats.mjs offers.json --check quality.md
node scripts/research-corpus-stats.mjs backup-001.json backup-002.json --format json
```

Markdown is the default. To check a previously saved JSON report, include
`--format json` with `--check`. Check mode compares UTF-8 content, accepting a BOM
and either LF or CRLF line endings. It exits successfully when the report matches
and returns an error for a difference, an unreadable file or invalid input.
The CLI itself only reads files and writes the requested summary to standard
output. Keep the source export private if it includes screenshots or raw OCR.

The script accepts one export or all parts of one backup (32 MiB per part,
512 MiB total, up to 250 offers). Backup set IDs and part counts must match;
missing or duplicate parts are rejected. Legacy exports without part metadata
can also be combined. It uses the app's export schema and rejects repeated offer or capture
IDs, including case variants. Export one current revision per offer. Helper
capture bundles and D1 dumps use separate formats. The report contains counts
grouped by the saved `origin` value and a combined total.

## Reading the counts

- Review records whether a user checked the offer. Coverage records whether
  all cards were included. Partial and unverified offers may omit cards.
- Distinct helper sessions count session UUIDs represented in the export.
  Captures without a session have a capture ID and no session metadata. Manual
  offers without a capture ID are outside that count. A helper session can span
  multiple encounters. Possible repeat hints remain in the totals, including
  hints whose referenced capture is outside the export.
- Embedded image and OCR counts describe evidence included in this export.
  Full history backups include available evidence; offer-data-only exports omit it. The report validates the archive
  schema and counts image fields without decoding image pixels. Successful OCR
  with text requires status `ok` and nonblank text in the stored text or lines.
- Card counts cover the records present in the archive. A blank name and a
  null tier are counted separately. A card with no reward annotations has no
  reward information recorded. Each reward annotation counts once, regardless
  of its quantity. Unidentified annotations and annotations of unknown kind
  are separate, potentially overlapping counts.

Use these figures to track data collection and review coverage. Estimating
frequencies requires a separate analysis of coverage, sampling and game
context. See [Observation contract](data-contract.md#rules-for-later-frequency-analysis).
