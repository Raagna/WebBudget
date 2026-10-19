-- Migration 012: the subreddits and Reddit threads each user follows on
-- their dashboard's Reddit widget. Per user, like the dashboard layout
-- (migration 011): it's a reading list, not household data.
--
-- kind 'subreddit': name is the subreddit ("PersonalFinanceCanada").
-- kind 'thread':    name is the post id ("1x5wzdi"); subreddit and title
--                   are remembered from when it was added, so the widget
--                   can still label it if Reddit is unreachable.

CREATE TABLE IF NOT EXISTS reddit_follows (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('subreddit', 'thread')),
  name       TEXT NOT NULL,
  subreddit  TEXT,
  title      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, kind, name)
);
