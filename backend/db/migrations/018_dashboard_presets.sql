-- Migration 018: named dashboard layouts ("Everyday", "Investing").
-- Saved per user, like the current layout (migration 011), so every
-- preset is there in every household the user belongs to. The layout
-- JSON has the same shape the current layout uses, checked by
-- routes/dashboard.js. (017 is taken by other open work.)

CREATE TABLE IF NOT EXISTS dashboard_presets (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  layout     JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS dashboard_presets_name_idx ON dashboard_presets (user_id, lower(name));
