-- Migration 017: a debt payoff plan for a profile's own loans and cards.
--
-- Separate from the household "who owes what" tab (migration 014): these
-- are debts owed to lenders - a credit card, a student loan, a line of
-- credit - and the plan works out how to clear them. Each row is what
-- the user types in today; the month-by-month plan is worked out from it
-- on every request (utils/payoff.js), so nothing derived is stored.
--
-- rate_bps is the annual interest rate in basis points (19.99% = 1999),
-- so it's an exact integer like the money columns.
-- created_by is history only, ON DELETE SET NULL like budgets.created_by,
-- so a member deleting their account never removes a household's plan.

CREATE TABLE IF NOT EXISTS payoff_debts (
  id                SERIAL PRIMARY KEY,
  profile_id        INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  balance_cents     BIGINT NOT NULL CHECK (balance_cents > 0),
  rate_bps          INTEGER NOT NULL CHECK (rate_bps >= 0 AND rate_bps <= 10000),
  min_payment_cents BIGINT NOT NULL CHECK (min_payment_cents >= 0),
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payoff_debts_profile_idx ON payoff_debts (profile_id);

-- The plan's two choices: how much extra goes to debt each month, and
-- which way to spend it. One row per profile, created on first change.
CREATE TABLE IF NOT EXISTS payoff_settings (
  profile_id  INTEGER PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  extra_cents BIGINT NOT NULL DEFAULT 0 CHECK (extra_cents >= 0),
  strategy    TEXT NOT NULL DEFAULT 'avalanche' CHECK (strategy IN ('avalanche', 'snowball')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
