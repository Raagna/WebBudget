-- Migration 014: who owes what inside a household.
--
-- A household profile keeps a running tab between its members, like a
-- shared IOU sheet. Two kinds of entry:
--   'expense' - someone paid for something shared ("Costco run, $120,
--               paid by Sam, split between Sam, Alex and Jo")
--   'payment' - someone paid another member back ("Alex paid Sam $40")
-- debts.paid_by is who handed over the money; debt_shares say whose cost
-- it was. For a payment the single share is the person who received it.
-- Everyone's balance is (what they paid) - (their shares), so nothing
-- derived is stored and the totals can't drift.
--
-- People are kept as ON DELETE SET NULL, like transactions.user_id
-- (migration 005): if a member deletes their account, the tab still adds
-- up for everyone else, with that person shown as a former member.

CREATE TABLE IF NOT EXISTS debts (
  id             SERIAL PRIMARY KEY,
  profile_id     INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('expense', 'payment')),
  description    TEXT NOT NULL DEFAULT '',
  amount_cents   BIGINT NOT NULL CHECK (amount_cents > 0),
  paid_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  occurred_on    DATE NOT NULL,
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS debts_profile_idx ON debts (profile_id, occurred_on DESC);

CREATE TABLE IF NOT EXISTS debt_shares (
  id           SERIAL PRIMARY KEY,
  debt_id      INTEGER NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0)
);
CREATE INDEX IF NOT EXISTS debt_shares_debt_idx ON debt_shares (debt_id);
