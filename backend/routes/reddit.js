const express = require('express');
const { query, queryOne, run } = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const {
  mode, normalizeSubreddit, threadIdFrom, subredditPosts, threadPost, rankTrending, RedditNotFound,
} = require('../utils/reddit');

// The dashboard's Reddit widget: subreddits and threads each user follows.
// Fetching, caching and ranking live in utils/reddit.js.

const MAX_SUBREDDITS = 20;
const MAX_THREADS = 30;

const router = express.Router();
router.use(requireAuth);

// GET /api/reddit
// -> { mode, subreddits: [{ id, name }], threads: [post + followId],
//      trending: [post], problems: [text] }
// A subreddit or thread that fails to load is reported in `problems`; the
// rest still show.
router.get('/', asyncHandler(async (req, res) => {
  const follows = await query(
    `SELECT id, kind, name, subreddit, title FROM reddit_follows WHERE user_id = ? ORDER BY created_at, id`,
    [req.userId]
  );
  const subs = follows.filter((f) => f.kind === 'subreddit');
  const problems = [];
  let stale = false;

  // One at a time: they're nearly always cached, and when they aren't,
  // Reddit is kinder to a trickle than a burst.
  const lists = [];
  for (const s of subs) {
    try {
      const r = await subredditPosts(s.name);
      lists.push(r.value);
      stale ||= r.stale;
    } catch (err) {
      problems.push(err instanceof RedditNotFound ? `r/${s.name} wasn't found or is private.` : `Couldn't load r/${s.name} right now.`);
    }
  }

  const threads = [];
  for (const t of follows.filter((f) => f.kind === 'thread')) {
    try {
      const r = await threadPost(t.name);
      threads.push({ ...r.value, followId: t.id });
      stale ||= r.stale;
    } catch {
      // Still listed, from what was saved when it was followed.
      threads.push({
        followId: t.id, id: t.name, subreddit: t.subreddit, title: t.title,
        link: `https://www.reddit.com/comments/${t.name}/`, score: null, comments: null, createdAt: null, unavailable: true,
      });
    }
  }

  res.json({
    mode: mode(),
    subreddits: subs.map((s) => ({ id: s.id, name: s.name })),
    threads,
    trending: rankTrending(lists),
    problems,
    stale,
  });
}));

// POST /api/reddit/follows  { subreddit } or { thread: link or id }
router.post('/follows', asyncHandler(async (req, res) => {
  const { subreddit, thread } = req.body || {};
  const existing = await query(`SELECT kind, name FROM reddit_follows WHERE user_id = ?`, [req.userId]);

  if (subreddit !== undefined) {
    const name = normalizeSubreddit(subreddit);
    if (!name) return res.status(400).json({ error: 'Enter a subreddit name, like PersonalFinanceCanada.' });
    if (existing.some((f) => f.kind === 'subreddit' && f.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: `You already follow r/${name}.` });
    }
    if (existing.filter((f) => f.kind === 'subreddit').length >= MAX_SUBREDDITS) {
      return res.status(400).json({ error: `You can follow up to ${MAX_SUBREDDITS} subreddits.` });
    }
    let display = name;
    try {
      const { value } = await subredditPosts(name);
      display = value[0]?.subreddit || name; // Reddit's own capitalization
    } catch (err) {
      if (err instanceof RedditNotFound) return res.status(400).json({ error: `r/${name} wasn't found, or it's private.` });
      // Reddit unreachable: follow it anyway; it loads once Reddit is back.
    }
    const row = await queryOne(
      `INSERT INTO reddit_follows (user_id, kind, name) VALUES (?, 'subreddit', ?) RETURNING id`,
      [req.userId, display]
    );
    return res.status(201).json({ id: row.id, name: display });
  }

  if (thread !== undefined) {
    const id = threadIdFrom(thread);
    if (!id) return res.status(400).json({ error: 'Paste a link to a Reddit thread.' });
    if (existing.some((f) => f.kind === 'thread' && f.name === id)) {
      return res.status(409).json({ error: 'You already follow that thread.' });
    }
    if (existing.filter((f) => f.kind === 'thread').length >= MAX_THREADS) {
      return res.status(400).json({ error: `You can follow up to ${MAX_THREADS} threads.` });
    }
    let post;
    try {
      post = (await threadPost(id)).value;
    } catch (err) {
      return res.status(400).json({
        error: err instanceof RedditNotFound ? "That thread wasn't found, or it was removed." : "Couldn't reach Reddit to check that thread. Try again in a minute.",
      });
    }
    const row = await queryOne(
      `INSERT INTO reddit_follows (user_id, kind, name, subreddit, title) VALUES (?, 'thread', ?, ?, ?) RETURNING id`,
      [req.userId, id, post.subreddit, post.title.slice(0, 300)]
    );
    return res.status(201).json({ id: row.id, thread: post });
  }

  res.status(400).json({ error: 'Send a subreddit or a thread.' });
}));

// DELETE /api/reddit/follows/:id
router.delete('/follows/:id', asyncHandler(async (req, res) => {
  const result = await run(`DELETE FROM reddit_follows WHERE id = ? AND user_id = ?`, [Number(req.params.id) || 0, req.userId]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
}));

module.exports = router;
