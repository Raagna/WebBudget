-- Migration 005: deleting an account must not delete other people's data.
-- profiles.user_id (the profile's original creator) and transactions.user_id
-- (who entered a transaction) were ON DELETE CASCADE. Access has been
-- governed by profile_members since migration 002, so these columns are
-- now only history - but the cascade meant that when a creator deleted
-- their account, a household they had since handed over to other owners
-- was deleted for everyone, and a member leaving the app silently took
-- every transaction they had entered out of the shared ledger.
--
-- Both become nullable with ON DELETE SET NULL. Profiles that nobody else
-- uses are still removed when their last member deletes their account -
-- that cleanup happens explicitly in DELETE /api/auth/account.

ALTER TABLE profiles ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE transactions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_user_id_fkey;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
