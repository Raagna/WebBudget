-- Migration 002: shared household profiles.
-- Profiles were previously single-owner (profiles.user_id). This adds a
-- membership table so more than one account can access the same profile -
-- e.g. two partners both adding transactions to the same "Household"
-- budget - while keeping a clear owner who controls membership.

CREATE TABLE IF NOT EXISTS profile_members (
  profile_id  INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  -- 'pending' = invited but not yet accepted; 'active' = can see and use
  -- the profile. Invites are created as pending and flip to active only
  -- when the invited person accepts - nobody gets silently added to a
  -- household budget without agreeing to it.
  status      TEXT NOT NULL CHECK (status IN ('active', 'pending')) DEFAULT 'active',
  invited_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_profile_members_user ON profile_members(user_id, status);

-- Backfill: every profile that already exists gets its original creator
-- (profiles.user_id) as an active owner, so nothing that already worked
-- breaks when authorization switches over to this table.
INSERT INTO profile_members (profile_id, user_id, role, status)
SELECT id, user_id, 'owner', 'active' FROM profiles
ON CONFLICT (profile_id, user_id) DO NOTHING;
