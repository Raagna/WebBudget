-- Migration 009: default categories that real bank downloads need.
-- A TD file is full of rows no spending category fits: e-transfers and
-- moves between your own accounts, bank fees, and mutual-fund or TFSA
-- contributions. Without a home for them the CSV importer had to leave
-- them uncategorized. Same ON CONFLICT rule as the defaults in 001, so
-- this is safe to re-run.

INSERT INTO categories (user_id, name, type, icon, is_default) VALUES
  (NULL, 'Transfers',   'both',    'repeat',      TRUE),
  (NULL, 'Bank Fees',   'expense', 'file-text',   TRUE),
  (NULL, 'Investments', 'expense', 'trending-up', TRUE)
ON CONFLICT (name) WHERE user_id IS NULL DO NOTHING;
