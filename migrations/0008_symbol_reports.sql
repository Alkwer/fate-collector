-- Independent opt-in image research; existing observation/capture contracts stay unchanged.
CREATE TABLE symbol_reports (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  report_json TEXT,
  consent_version TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  withdrawn_at TEXT,
  payload_bytes INTEGER NOT NULL
);
CREATE INDEX symbol_report_expiry ON symbol_reports(expires_at) WHERE report_json IS NOT NULL;
CREATE INDEX symbol_report_daily ON symbol_reports(recorded_at);
CREATE TABLE symbol_withdrawals (
  id TEXT PRIMARY KEY NOT NULL, token_hash TEXT NOT NULL,
  requested_at TEXT NOT NULL, withdrawn_at TEXT NOT NULL, unknown_report INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX symbol_withdrawal_daily ON symbol_withdrawals(withdrawn_at) WHERE unknown_report = 1;
CREATE TRIGGER remove_withdrawn_symbol AFTER INSERT ON symbol_withdrawals
BEGIN
  UPDATE symbol_withdrawals SET unknown_report = 0 WHERE id = NEW.id AND EXISTS (SELECT 1 FROM symbol_reports WHERE id = NEW.id);
  UPDATE symbol_reports SET report_json = NULL, withdrawn_at = NEW.withdrawn_at WHERE id = NEW.id;
END;
