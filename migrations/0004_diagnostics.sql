CREATE TABLE diagnostic_reports (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  report_json TEXT,
  consent_version TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  withdrawn_at TEXT
);
CREATE INDEX diagnostic_expiry ON diagnostic_reports(expires_at) WHERE report_json IS NOT NULL;
CREATE TABLE diagnostic_withdrawals (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  withdrawn_at TEXT NOT NULL
);
CREATE TRIGGER remove_withdrawn_diagnostic AFTER INSERT ON diagnostic_withdrawals
BEGIN
  UPDATE diagnostic_reports SET report_json = NULL, withdrawn_at = NEW.withdrawn_at WHERE id = NEW.id;
END;
