CREATE INDEX diagnostic_daily_reports ON diagnostic_reports(recorded_at);
ALTER TABLE diagnostic_withdrawals ADD COLUMN unknown_report INTEGER NOT NULL DEFAULT 1;
UPDATE diagnostic_withdrawals SET unknown_report = 0 WHERE EXISTS (SELECT 1 FROM diagnostic_reports WHERE id = diagnostic_withdrawals.id);
CREATE INDEX diagnostic_daily_withdrawals ON diagnostic_withdrawals(withdrawn_at) WHERE unknown_report = 1;
CREATE TRIGGER classify_diagnostic_withdrawal AFTER INSERT ON diagnostic_withdrawals
BEGIN
  UPDATE diagnostic_withdrawals SET unknown_report = 0 WHERE id = NEW.id AND EXISTS (SELECT 1 FROM diagnostic_reports WHERE id = NEW.id);
END;
