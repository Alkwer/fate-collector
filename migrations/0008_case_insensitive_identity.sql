-- Preserve historical payloads and hashes; consolidate identity in read views.
CREATE INDEX capture_uploads_identity ON capture_uploads(lower(id));
CREATE INDEX observations_identity ON observations(lower(id), revision);
CREATE INDEX data_consents_identity ON data_consents(lower(id));
CREATE INDEX consent_withdrawals_identity ON consent_withdrawals(lower(id));

DROP VIEW observation_capture_conflicts;
CREATE VIEW observation_capture_conflicts AS
SELECT lower(json_extract(payload_json, '$.captureId')) AS capture_id,
  count(DISTINCT lower(id)) AS offer_count
FROM observations
WHERE json_extract(payload_json, '$.captureId') IS NOT NULL
GROUP BY lower(json_extract(payload_json, '$.captureId'))
HAVING count(DISTINCT lower(id)) > 1;

DROP VIEW research_observations;
DROP VIEW canonical_observations;
DROP VIEW latest_observations;
CREATE VIEW latest_observations AS
SELECT o.* FROM observations o
WHERE NOT EXISTS (
  SELECT 1 FROM observations n WHERE lower(n.id) = lower(o.id)
    AND (n.revision > o.revision OR (n.revision = o.revision
      AND (n.received_at < o.received_at OR (n.received_at = o.received_at AND n.id < o.id))))
);
CREATE VIEW canonical_observations AS
SELECT o.* FROM latest_observations o
WHERE json_extract(o.payload_json, '$.captureId') IS NULL
  OR lower(o.id) = (
    SELECT lower(n.id) FROM observations n
    JOIN latest_observations current_owner ON lower(current_owner.id) = lower(n.id)
    WHERE lower(json_extract(n.payload_json, '$.captureId')) = lower(json_extract(o.payload_json, '$.captureId'))
      AND lower(json_extract(current_owner.payload_json, '$.captureId')) = lower(json_extract(o.payload_json, '$.captureId'))
    ORDER BY n.received_at, n.id, n.revision LIMIT 1
  );
CREATE VIEW research_observations AS
SELECT lower(id) AS id, revision, payload_json AS offer_json, game_version, completeness,
  1 AS reviewed, 'reviewed' AS intake, captured_at, received_at
FROM canonical_observations
UNION ALL
SELECT lower(c.id), 1, c.parsed_offer_json, 'unknown', 'unverified',
  0, 'automatic', c.captured_at, c.received_at
FROM capture_uploads c
WHERE NOT EXISTS (
  SELECT 1 FROM capture_uploads n WHERE lower(n.id) = lower(c.id)
    AND (n.received_at < c.received_at OR (n.received_at = c.received_at AND n.id < c.id))
)
AND NOT EXISTS (
  SELECT 1 FROM canonical_observations o
  WHERE lower(o.id) = lower(c.id) OR lower(json_extract(o.payload_json, '$.captureId')) = lower(c.id)
);

DROP TRIGGER remove_withdrawn_contributions;
CREATE TRIGGER remove_withdrawn_contributions AFTER INSERT ON consent_withdrawals
BEGIN
  DELETE FROM capture_uploads WHERE lower(consent_id) = lower(NEW.id);
  DELETE FROM observations WHERE lower(consent_id) = lower(NEW.id);
END;
