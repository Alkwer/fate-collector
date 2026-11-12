-- Daily, rotating source fingerprints are removed at the next UTC day cleanup.
ALTER TABLE symbol_reports ADD COLUMN source_hash TEXT;
ALTER TABLE symbol_withdrawals ADD COLUMN source_hash TEXT;
CREATE INDEX symbol_report_source_daily ON symbol_reports(source_hash, recorded_at);
CREATE INDEX symbol_withdrawal_source_daily ON symbol_withdrawals(source_hash, withdrawn_at) WHERE unknown_report = 1;

-- Enforce single use independently of Siteverify's globally convergent replay checks.
CREATE TABLE symbol_challenges (
  token_hash TEXT PRIMARY KEY NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX symbol_challenge_expiry ON symbol_challenges(expires_at);
