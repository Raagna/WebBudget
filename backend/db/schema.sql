-- Finance App Database Schema
-- SQLite. Every financial table carries a user_id foreign key so records
-- are always scoped to the authenticated owner.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Categories are global (predefined) rows with user_id = NULL, plus
-- optional custom categories a user creates for themselves (user_id set).
CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('income', 'expense', 'both')),
  icon       TEXT NOT NULL DEFAULT 'tag',
  is_default INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS transactions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, occurred_on);
CREATE INDEX IF NOT EXISTS idx_transactions_user_category ON transactions(user_id, category_id);

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
