-- Migration 006: same rule as 005, for bills.
-- Migration 004 moved bills into profiles so a household shares them, but
-- bills.user_id (who entered the bill) was still ON DELETE CASCADE from
-- 001. A member deleting their account would silently remove every bill
-- they had added to the shared household. Like transactions.user_id it's
-- now only history, so it becomes nullable with ON DELETE SET NULL. A
-- profile nobody else uses is still deleted along with its bills by
-- DELETE /api/auth/account (bills.profile_id cascades).

ALTER TABLE bills ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE bills DROP CONSTRAINT IF EXISTS bills_user_id_fkey;
ALTER TABLE bills
  ADD CONSTRAINT bills_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
