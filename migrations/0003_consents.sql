-- Do not manufacture consent for historical uploads. Legacy rows stay unassigned.
CREATE TABLE data_consents (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('captures', 'observations')),
  policy_version TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  origin TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  token_hash TEXT NOT NULL
);
CREATE TABLE consent_withdrawals (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  withdrawn_at TEXT NOT NULL
);
ALTER TABLE capture_uploads ADD COLUMN consent_id TEXT REFERENCES data_consents(id);
ALTER TABLE observations ADD COLUMN consent_id TEXT REFERENCES data_consents(id);
CREATE INDEX capture_consent ON capture_uploads(consent_id);
CREATE INDEX observation_consent ON observations(consent_id);

-- Revocation and removal are one atomic SQLite statement. Upload inserts also
-- check this tombstone inside their INSERT, preventing a concurrent late write.
CREATE TRIGGER remove_withdrawn_contributions AFTER INSERT ON consent_withdrawals
BEGIN
  DELETE FROM capture_uploads WHERE consent_id = NEW.id;
  DELETE FROM observations WHERE consent_id = NEW.id;
END;
