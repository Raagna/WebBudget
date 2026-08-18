-- Migration 003: per-profile currency.
-- Each profile is denominated in exactly one currency - no cross-currency
-- conversion or aggregation is supported (deliberately out of scope; see
-- the README). amount_cents already stores a currency-agnostic fixed-point
-- value (major unit * 100), so no other schema change is needed for this -
-- it's purely what code and formatting treat that value as meaning.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';

-- Guards against garbage values slipping in outside the app's own
-- validated currency list (defense in depth, not the primary check).
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_currency_format;
ALTER TABLE profiles ADD CONSTRAINT profiles_currency_format CHECK (currency ~ '^[A-Z]{3}$');

-- Note: multiple owners per profile (co-ownership) needed NO schema
-- change - profile_members.role already allows 'owner' on more than one
-- row per profile; "exactly one owner" was only ever an application-layer
-- rule in routes/profiles.js, not a database constraint. See that file
-- for the promote/demote/remove logic that changed instead.
