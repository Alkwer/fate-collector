-- Intake retains its existing consent and expiry contract. This table stores only
-- operational decisions and a link to a separately reviewed catalog change.
CREATE TABLE symbol_report_reviews (
  report_id TEXT PRIMARY KEY NOT NULL REFERENCES symbol_reports(id),
  reviewer TEXT NOT NULL,
  claim_id TEXT,
  claim_until TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'conflict')),
  reason TEXT CHECK (reason IN ('verified', 'unreadable', 'insufficient-evidence', 'duplicate', 'conflicting-evidence', 'out-of-scope')),
  duplicate_of TEXT REFERENCES symbol_reports(id),
  decided_at TEXT,
  catalog_revision TEXT,
  catalog_entry TEXT,
  catalog_reviewer TEXT,
  catalog_recorded_at TEXT,
  CHECK ((status = 'pending' AND claim_id IS NOT NULL AND claim_until IS NOT NULL AND reason IS NULL AND decided_at IS NULL)
    OR (status <> 'pending' AND claim_id IS NULL AND claim_until IS NULL AND reason IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK ((reason IS 'duplicate' AND status = 'rejected' AND duplicate_of IS NOT NULL AND duplicate_of <> report_id)
    OR (reason IS NOT 'duplicate' AND duplicate_of IS NULL)),
  CHECK ((status = 'accepted' AND reason IS 'verified')
    OR (status = 'conflict' AND reason IS 'conflicting-evidence')
    OR (status = 'rejected' AND reason IN ('unreadable', 'insufficient-evidence', 'duplicate', 'out-of-scope'))
    OR status = 'pending'),
  CHECK ((catalog_revision IS NULL AND catalog_entry IS NULL AND catalog_reviewer IS NULL AND catalog_recorded_at IS NULL)
    OR (status = 'accepted' AND catalog_revision IS NOT NULL AND catalog_entry IS NOT NULL
      AND catalog_reviewer IS NOT NULL AND catalog_recorded_at IS NOT NULL))
);

-- Remove abandoned leases with the evidence. Completed decisions retain only
-- fixed reason codes and provenance, without duplicating the source payload.
CREATE TRIGGER clear_inactive_symbol_review_claim
AFTER UPDATE OF report_json ON symbol_reports
WHEN OLD.report_json IS NOT NULL AND NEW.report_json IS NULL
BEGIN
  DELETE FROM symbol_report_reviews WHERE report_id = NEW.id AND status = 'pending';
END;
