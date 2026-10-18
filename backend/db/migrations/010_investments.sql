-- Migration 010: investment holdings and cached stock quotes.
--
-- A holding belongs to a profile (so a household sees one portfolio, the
-- same rule as transactions and budgets): a Yahoo Finance symbol
-- ("AAPL", "XEQT.TO", "BTC-USD") and how many shares. Fractional shares
-- are normal at Wealthsimple, so shares is NUMERIC, not an integer.
-- book_cost_cents is what was paid in total, in the profile's currency,
-- and is optional - without it the app shows value but no gain.
--
-- created_by is history only, ON DELETE SET NULL like transactions.user_id
-- (see migration 005).

CREATE TABLE IF NOT EXISTS holdings (
  id              SERIAL PRIMARY KEY,
  profile_id      INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  symbol          TEXT NOT NULL,
  account         TEXT NOT NULL DEFAULT '',
  shares          NUMERIC(20, 8) NOT NULL CHECK (shares > 0),
  book_cost_cents BIGINT CHECK (book_cost_cents >= 0),
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS holdings_profile_idx ON holdings (profile_id);

-- Last known price per symbol, shared by every profile that holds it, so
-- one fetch serves everyone until it goes stale. Currency pairs used to
-- convert a USD holding into a CAD profile ("USDCAD=X") live here too.
CREATE TABLE IF NOT EXISTS quotes (
  symbol         TEXT PRIMARY KEY,
  name           TEXT,
  currency       TEXT NOT NULL,
  price          NUMERIC(20, 6) NOT NULL,
  previous_close NUMERIC(20, 6),
  -- When the market set this price (Friday's close, all weekend), as
  -- opposed to fetched_at, when this app last asked for it.
  market_time    TIMESTAMPTZ,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
