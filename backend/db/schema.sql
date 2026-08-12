-- Finance App Database Schema
-- SQLite. Every financial table carries a user_id foreign key so records
-- are always scoped to the authenticated owner; transactions are further
-- scoped to a profile (e.g. "Personal" vs "Household") so one account can
-- track multiple separate budgets.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A profile is a separate budgeting context owned by one user, e.g.
-- "Personal" and "Household". All transactions belong to exactly one
-- profile, so switching profiles switches the entire financial picture.
CREATE TABLE IF NOT EXISTS profiles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);

-- Categories are global (predefined) rows with user_id = NULL, plus
-- optional custom categories a user creates for themselves (user_id set).
-- Categories are shared across all of a user's profiles on purpose - a
-- user manages one category list and applies it to both budgets.
CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('income', 'expense', 'both')),
  icon       TEXT NOT NULL DEFAULT 'tag',
  is_default INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, name)
);
-- IMPORTANT: SQLite treats NULL as distinct from every other NULL, so the
-- UNIQUE(user_id, name) constraint above does NOT stop duplicate rows for
-- the global default categories (user_id IS NULL) - every insert looked
-- "unique" to SQLite even when the name already existed. This partial
-- index closes that gap by enforcing uniqueness specifically within the
-- global (user_id IS NULL) rows.
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
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id          INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category_id         INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  amount_cents        INTEGER NOT NULL CHECK (amount_cents > 0),
  type                TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  description          TEXT NOT NULL DEFAULT '',
  occurred_on         TEXT NOT NULL,               -- ISO date YYYY-MM-DD
  is_recurring        INTEGER NOT NULL DEFAULT 0,
  recurring_interval  TEXT CHECK (recurring_interval IN ('weekly','monthly','yearly') OR recurring_interval IS NULL),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_transactions_profile_date ON transactions(profile_id, occurred_on);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);

-- Subscriptions and bills remain available as an API (no longer surfaced
-- in the UI per current design), so they're left user-scoped rather than
-- migrated to profiles. Revisit if they come back into the interface.
CREATE TABLE IF NOT EXISTS subscriptions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id      INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),
  billing_cycle    TEXT NOT NULL CHECK (billing_cycle IN ('weekly','monthly','yearly')),
  next_billing_on  TEXT NOT NULL,                  -- ISO date
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);

CREATE TABLE IF NOT EXISTS bills (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  due_on       TEXT NOT NULL,                      -- ISO date
  is_paid      INTEGER NOT NULL DEFAULT 0,
  is_recurring INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bills_user ON bills(user_id);
