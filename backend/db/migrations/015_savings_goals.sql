-- Migration 015: savings goals ("Emergency fund", "Japan trip").
-- A goal belongs to a profile, so a household saves toward it together,
-- same rule as budgets (migration 008). What's been saved isn't stored:
-- it's the sum of the goal's contributions, so it can't drift, and the
-- list of contributions doubles as the goal's history. A contribution can
-- be negative - money taken back out.
--
-- People are ON DELETE SET NULL, like transactions.user_id (migration 005).

CREATE TABLE IF NOT EXISTS savings_goals (
  id           SERIAL PRIMARY KEY,
  profile_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  target_cents BIGINT NOT NULL CHECK (target_cents > 0),
  target_date  DATE,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS savings_goals_profile_idx ON savings_goals (profile_id);

CREATE TABLE IF NOT EXISTS goal_contributions (
  id           SERIAL PRIMARY KEY,
  goal_id      INTEGER NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents <> 0),
  occurred_on  DATE NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS goal_contributions_goal_idx ON goal_contributions (goal_id, occurred_on);
