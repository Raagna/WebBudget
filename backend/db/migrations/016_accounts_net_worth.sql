-- Migration 016: accounts and net worth.
--
-- An account is something a profile owns or owes: a chequing or savings
-- account, cash, a house or car, a credit card, a loan, a mortgage. Its
-- balance is whatever the user last said it was - each update is kept as
-- a dated row in account_balances, so net worth has a history without the
-- app needing a bank connection. A debt's balance is entered as the
-- positive amount owed; the account's kind says to subtract it.
--
-- Investments already have live values (holdings, migration 010). To
-- give them a history too, the net worth page records one snapshot of the
-- portfolio's value per profile per day in investment_snapshots.

CREATE TABLE IF NOT EXISTS accounts (
  id         SERIAL PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN (
               'chequing', 'savings', 'cash', 'property', 'other_asset',
               'credit_card', 'loan', 'mortgage', 'other_debt')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS accounts_profile_idx ON accounts (profile_id);

CREATE TABLE IF NOT EXISTS account_balances (
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  as_of         DATE NOT NULL,
  balance_cents BIGINT NOT NULL,
  PRIMARY KEY (account_id, as_of)
);

CREATE TABLE IF NOT EXISTS investment_snapshots (
  profile_id  INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  as_of       DATE NOT NULL,
  value_cents BIGINT NOT NULL,
  PRIMARY KEY (profile_id, as_of)
);
