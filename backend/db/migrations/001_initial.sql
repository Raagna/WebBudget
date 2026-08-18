-- Migration 001: initial schema (Postgres dialect).
-- This is the full baseline schema (users, profiles, categories,
-- transactions, subscriptions, bills) plus the 12 default categories.
-- Every fresh database starts here; every future schema change is a new
-- numbered migration file in this directory, never an edit to this one.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A profile is a separate budgeting context owned by one user, e.g.
-- "Personal" and "Household". All transactions belong to exactly one
-- profile, so switching profiles switches the entire financial picture.
CREATE TABLE IF NOT EXISTS profiles (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);

-- Categories are global (predefined) rows with user_id = NULL, plus
-- optional custom categories a user creates for themselves (user_id set).
-- Categories are shared across all of a user's profiles on purpose - a
-- user manages one category list and applies it to both budgets.
CREATE TABLE IF NOT EXISTS categories (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('income', 'expense', 'both')),
  icon       TEXT NOT NULL DEFAULT 'tag',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(user_id, name)
);
-- Just like SQLite, Postgres treats every NULL as distinct from every
-- other NULL, so the UNIQUE(user_id, name) constraint above does NOT stop
-- duplicate rows among the global default categories (user_id IS NULL).
-- This partial index closes that gap for the global rows specifically.
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_global_name ON categories(name) WHERE user_id IS NULL;

-- A user can remove a default category from their own view without
-- deleting the shared global row (which would remove it for every other
-- user of this instance too). Hiding is per-user and reversible.
CREATE TABLE IF NOT EXISTS hidden_categories (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, category_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id          INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category_id         INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  amount_cents        INTEGER NOT NULL CHECK (amount_cents > 0),
  type                TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  description         TEXT NOT NULL DEFAULT '',
  occurred_on         DATE NOT NULL,
  is_recurring        BOOLEAN NOT NULL DEFAULT FALSE,
  recurring_interval  TEXT CHECK (recurring_interval IN ('weekly','monthly','yearly') OR recurring_interval IS NULL),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transactions_profile_date ON transactions(profile_id, occurred_on);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);

-- Subscriptions and bills remain available as an API (no longer surfaced
-- in the UI per current design), left user-scoped rather than migrated to
-- profiles. Revisit if they come back into the interface.
CREATE TABLE IF NOT EXISTS subscriptions (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id      INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),
  billing_cycle    TEXT NOT NULL CHECK (billing_cycle IN ('weekly','monthly','yearly')),
  next_billing_on  DATE NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);

CREATE TABLE IF NOT EXISTS bills (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  due_on       DATE NOT NULL,
  is_paid      BOOLEAN NOT NULL DEFAULT FALSE,
  is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bills_user ON bills(user_id);

-- Default categories every user sees. ON CONFLICT + the partial unique
-- index above make this safe to re-run.
INSERT INTO categories (user_id, name, type, icon, is_default) VALUES
  (NULL, 'Subscription',   'expense', 'repeat',        TRUE),
  (NULL, 'Bill',           'expense', 'file-text',     TRUE),
  (NULL, 'Food',           'expense', 'utensils',      TRUE),
  (NULL, 'Groceries',      'expense', 'shopping-cart', TRUE),
  (NULL, 'Transportation', 'expense', 'car',           TRUE),
  (NULL, 'Entertainment',  'expense', 'film',          TRUE),
  (NULL, 'Rent/Mortgage',  'expense', 'home',          TRUE),
  (NULL, 'Utilities',      'expense', 'zap',           TRUE),
  (NULL, 'Shopping',       'expense', 'bag',           TRUE),
  (NULL, 'Healthcare',     'expense', 'heart',         TRUE),
  (NULL, 'Salary/Income',  'income',  'briefcase',     TRUE),
  (NULL, 'Other',          'both',    'circle',        TRUE)
ON CONFLICT (name) WHERE user_id IS NULL DO NOTHING;
