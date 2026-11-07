CREATE TABLE observations (
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  game_version TEXT NOT NULL,
  completeness TEXT NOT NULL CHECK (completeness IN ('partial', 'complete')),
  captured_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (id, revision)
);
CREATE INDEX observations_version ON observations(game_version, captured_at);
-- Revisions are corrections, never independent rolls. Partial and complete offers
-- remain separate. A downstream model must also account for unidentified icons.
CREATE VIEW latest_observations AS
SELECT o.* FROM observations o
WHERE o.revision = (SELECT MAX(n.revision) FROM observations n WHERE n.id = o.id);
