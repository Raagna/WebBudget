-- Migration 004: bills belong to a profile, like transactions.
-- Bills were left user-scoped while they had no UI (see 001). Now that
-- the Bills page is back, a bill has to live in the same budget as the
-- expense it turns into when paid: shown in that profile's currency,
-- visible to every active member of a shared household, and gone when
-- the profile is deleted. bills.user_id stays as a record of who entered
-- it, same as transactions.user_id; access is checked through
-- profile_members.

ALTER TABLE bills ADD COLUMN IF NOT EXISTS profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE;

-- An account with bills but no profile it owns (only possible for
-- accounts older than profiles) gets the same "Personal" profile login
-- would create for it, so none of its bills are lost below.
WITH new_profiles AS (
  INSERT INTO profiles (user_id, name)
  SELECT DISTINCT b.user_id, 'Personal' FROM bills b
  WHERE b.profile_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM profile_members pm
      WHERE pm.user_id = b.user_id AND pm.role = 'owner' AND pm.status = 'active'
    )
  RETURNING id, user_id
)
INSERT INTO profile_members (profile_id, user_id, role, status)
SELECT id, user_id, 'owner', 'active' FROM new_profiles;

-- Existing bills go to the oldest profile their owner still owns - for
-- most accounts that's the "Personal" profile created at sign-up.
UPDATE bills b SET profile_id = (
  SELECT pm.profile_id FROM profile_members pm
  JOIN profiles p ON p.id = pm.profile_id
  WHERE pm.user_id = b.user_id AND pm.role = 'owner' AND pm.status = 'active'
  ORDER BY p.created_at ASC, p.id ASC
  LIMIT 1
)
WHERE b.profile_id IS NULL;

ALTER TABLE bills ALTER COLUMN profile_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bills_profile_due ON bills(profile_id, due_on);
