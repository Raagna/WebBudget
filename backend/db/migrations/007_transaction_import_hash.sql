-- Migration 007: duplicate detection for CSV imports.
-- Bank downloads overlap (TD EasyWeb gives the last N days per download),
-- so importing this week's file after last week's would otherwise add the
-- shared days twice. Each imported row now stores a hash of its profile,
-- date, type, amount and normalized description (see utils/bankImport.js),
-- and a re-import skips any row whose hash is already in that profile.
-- Rows entered by hand keep NULL here and are never treated as duplicates.

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS import_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_import_hash
  ON transactions(profile_id, import_hash) WHERE import_hash IS NOT NULL;
