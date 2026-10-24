-- Migration 019: revocable sessions and password resets.
--
-- users.token_version is copied into every JWT the API signs, and
-- middleware/auth.js rejects a token whose version no longer matches.
-- Bumping it ("sign out everywhere", a password change or reset) kills
-- every session at once without keeping a list of issued tokens. Tokens
-- signed before this migration carry no version and count as 0, so
-- deploying it doesn't sign anyone out.
--
-- password_resets holds one row per "forgot password" request. Only the
-- SHA-256 of the token is stored: the plain token exists only in the
-- emailed link, so a database leak can't be turned into account takeovers.
-- A row is spent by setting used_at, and is only accepted before
-- expires_at (one hour after it was issued).

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS password_resets (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
