-- Preserve all historical submissions. Expose collisions for operator review,
-- while choosing the first submitted offer ID for each capture in research counts.
CREATE INDEX observations_capture_normalized ON observations(lower(json_extract(payload_json, '$.captureId')));

CREATE VIEW observation_capture_conflicts AS
SELECT lower(json_extract(payload_json, '$.captureId')) AS capture_id,
  count(DISTINCT id) AS offer_count
FROM observations
WHERE json_extract(payload_json, '$.captureId') IS NOT NULL
GROUP BY lower(json_extract(payload_json, '$.captureId'))
HAVING count(DISTINCT id) > 1;

CREATE VIEW canonical_observations AS
SELECT o.* FROM latest_observations o
WHERE json_extract(o.payload_json, '$.captureId') IS NULL
  OR o.id = (
    SELECT n.id FROM observations n
    JOIN latest_observations current_owner ON current_owner.id = n.id
    WHERE lower(json_extract(n.payload_json, '$.captureId')) = lower(json_extract(o.payload_json, '$.captureId'))
      AND lower(json_extract(current_owner.payload_json, '$.captureId')) = lower(json_extract(o.payload_json, '$.captureId'))
    ORDER BY n.received_at, n.id, n.revision LIMIT 1
  );

DROP VIEW research_observations;
CREATE VIEW research_observations AS
SELECT id, revision, payload_json AS offer_json, game_version, completeness,
  1 AS reviewed, 'reviewed' AS intake, captured_at, received_at
FROM canonical_observations
UNION ALL
SELECT c.id, 1 AS revision, c.parsed_offer_json AS offer_json,
  'unknown' AS game_version, 'unverified' AS completeness,
  0 AS reviewed, 'automatic' AS intake, c.captured_at, c.received_at
FROM capture_uploads c
WHERE NOT EXISTS (
  SELECT 1 FROM canonical_observations o
  WHERE lower(o.id) = lower(c.id) OR lower(json_extract(o.payload_json, '$.captureId')) = lower(c.id)
);
