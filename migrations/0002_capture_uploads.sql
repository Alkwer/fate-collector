-- Automatic OCR is evidence awaiting review, not a verified offered set.
CREATE TABLE capture_uploads (
  id TEXT PRIMARY KEY NOT NULL,
  content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  parsed_offer_json TEXT NOT NULL CHECK (json_valid(parsed_offer_json)),
  parser_version TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX capture_uploads_time ON capture_uploads(captured_at);
CREATE INDEX observations_capture ON observations(json_extract(payload_json, '$.captureId'));

-- Use this view when combining both channels. A later reviewed submission takes
-- precedence over its automatic capture; never count the two as separate rolls.
CREATE VIEW research_observations AS
SELECT id, revision, payload_json AS offer_json, game_version, completeness,
  1 AS reviewed, 'reviewed' AS intake, captured_at, received_at
FROM latest_observations
UNION ALL
SELECT c.id, 1 AS revision, c.parsed_offer_json AS offer_json,
  'unknown' AS game_version, 'unverified' AS completeness,
  0 AS reviewed, 'automatic' AS intake, c.captured_at, c.received_at
FROM capture_uploads c
WHERE NOT EXISTS (
  SELECT 1 FROM latest_observations o
  WHERE o.id = c.id OR json_extract(o.payload_json, '$.captureId') = c.id
);
