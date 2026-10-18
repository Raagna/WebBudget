-- Migration 011: each user's own dashboard layout.
-- Stored per user, not per profile: rearranging a shared household's
-- dashboard shouldn't rearrange it for the other members. NULL means the
-- default layout. The shape is checked by routes/dashboard.js; which
-- widgets exist is the frontend's business, so adding a widget never
-- needs a migration.

ALTER TABLE users ADD COLUMN IF NOT EXISTS dashboard_layout JSONB;
