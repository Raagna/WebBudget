-- Migration 013: holdings that come from Wealthsimple instead of the form.
--
-- source says where a holding came from:
--   manual            typed in on the Investments page (every holding so far)
--   wealthsimple_csv  a Wealthsimple "Holdings report" CSV import
--   snaptrade         a SnapTrade sync of a connected brokerage account
--
-- external_account is that account's id at the source (the Wealthsimple
-- account number, or SnapTrade's account UUID). An import or sync is a
-- snapshot of an account, so it REPLACES that account's rows: a position
-- sold since the last one disappears instead of lingering. Manual rows
-- never have an external_account and are never touched by a sync.
--
-- ws_account_last4 is set only for Wealthsimple accounts, from either
-- source. The CSV has the full account number and SnapTrade only the last
-- four characters, so this is how the two recognise the same account: a
-- SnapTrade sync of a TFSA replaces that TFSA's CSV-imported rows (and the
-- other way round) instead of counting the account twice.

ALTER TABLE holdings ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'wealthsimple_csv', 'snaptrade'));
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS external_account TEXT;
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS ws_account_last4 TEXT;

CREATE INDEX IF NOT EXISTS holdings_external_idx ON holdings (profile_id, source, external_account);

-- When each profile last imported or synced from each source, so the page
-- can say "Synced 2 hours ago" and the server can skip a sync that just ran.
-- as_of is the time the data describes (the report's "As of" line, or
-- SnapTrade's data_freshness), synced_at is when this app pulled it in.
CREATE TABLE IF NOT EXISTS holding_syncs (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source     TEXT NOT NULL CHECK (source IN ('wealthsimple_csv', 'snaptrade')),
  synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  as_of      TIMESTAMPTZ,
  synced_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (profile_id, source)
);
