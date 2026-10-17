-- Migration 008: monthly budgets per category.
-- A budget belongs to a profile (so a household shares one set of
-- budgets) and caps one expense category per month. The same amount
-- applies every month until changed. "Spent" isn't stored; it's always
-- summed from transactions, so it can't drift out of date.
--
-- created_by is history only (who set it), ON DELETE SET NULL like
-- transactions.user_id, so a member deleting their account never removes
-- a household's budgets (see migration 005).

CREATE TABLE IF NOT EXISTS budgets (
  id           SERIAL PRIMARY KEY,
  profile_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, category_id)
);
