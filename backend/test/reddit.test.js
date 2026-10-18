// The Reddit widget's backend, against a fake Reddit that speaks both the
// official API (app-only OAuth) and the public RSS feeds.
const http = require('http');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, newUser } = require('./helpers');
const { resetRedditCache, threadIdFrom, normalizeSubreddit } = require('../utils/reddit');

let env;
let api;
let reddit;
let requests = [];

const HOUR = 3600;
const now = () => Math.floor(Date.now() / 1000);

// Subreddit -> posts, as the API's `data` objects.
function posts() {
  return {
    PersonalFinanceCanada: [
      { id: 'old1', title: 'Huge thread from last week', score: 2000, num_comments: 900, created_utc: now() - 5 * 24 * HOUR },
      { id: 'new1', title: 'Popular this morning', score: 400, num_comments: 120, created_utc: now() - 3 * HOUR },
      { id: 'mod1', title: 'Weekly discussion', score: 5000, num_comments: 10, created_utc: now() - HOUR, stickied: true },
      { id: 'nsfw1', title: 'Not for a dashboard', score: 9000, num_comments: 1, created_utc: now() - HOUR, over_18: true },
    ],
    CanadianInvestor: [
      { id: 'fresh1', title: 'Just posted, climbing', score: 50, num_comments: 12, created_utc: now() - HOUR },
    ],
  };
}

function apiPost(sub, p) {
  return { ...p, subreddit: sub, permalink: `/r/${sub}/comments/${p.id}/slug/`, stickied: !!p.stickied, over_18: !!p.over_18 };
}

function atom(sub, list) {
  const entries = list.map((p) => `<entry><id>t3_${p.id}</id><link href="https://www.reddit.com/r/${sub}/comments/${p.id}/slug/" />
    <published>${new Date(p.created_utc * 1000).toISOString()}</published><title>${p.title}</title></entry>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`;
}

before(async () => {
  reddit = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const send = (status, body, type = 'application/json') => { res.statusCode = status; res.setHeader('Content-Type', type); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    const all = posts();
    const findSub = (name) => Object.keys(all).find((k) => k.toLowerCase() === name.toLowerCase());

    if (req.method === 'POST' && req.url === '/api/v1/access_token') {
      const ok = req.headers.authorization === `Basic ${Buffer.from('id:secret').toString('base64')}`;
      return ok ? send(200, { access_token: 'tok', expires_in: 3600 }) : send(401, {});
    }
    let m;
    if ((m = req.url.match(/^\/r\/(\w+)\/top\/\.rss/))) {
      const sub = findSub(m[1]);
      return sub ? send(200, atom(sub, all[sub]), 'application/atom+xml') : send(404, 'nope', 'text/html');
    }
    if ((m = req.url.match(/^\/comments\/(\w+)\/\.rss/))) {
      for (const [sub, list] of Object.entries(all)) {
        const p = list.find((x) => x.id === m[1]);
        if (p) return send(200, atom(sub, [p]), 'application/atom+xml');
      }
      return send(404, 'nope', 'text/html');
    }
    // Everything else is the OAuth API and needs the token.
    if (req.headers.authorization !== 'Bearer tok') return send(401, {});
    if ((m = req.url.match(/^\/r\/(\w+)\/top\?/))) {
      const sub = findSub(m[1]);
      if (!sub) return send(404, {});
      return send(200, { data: { children: all[sub].map((p) => ({ data: apiPost(sub, p) })) } });
    }
    if ((m = req.url.match(/^\/by_id\/t3_(\w+)/))) {
      for (const [sub, list] of Object.entries(all)) {
        const p = list.find((x) => x.id === m[1]);
        if (p) return send(200, { data: { children: [{ data: apiPost(sub, p) }] } });
      }
      return send(200, { data: { children: [] } });
    }
    send(404, {});
  });
  await new Promise((r) => reddit.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${reddit.address().port}`;
  process.env.REDDIT_AUTH_URL = url;
  process.env.REDDIT_API_URL = url;
  process.env.REDDIT_RSS_URL = url;
  env = await start('reddit');
  api = client(env.origin);
});
after(async () => {
  await env.stop();
  await new Promise((r) => reddit.close(r));
});
beforeEach(() => {
  resetRedditCache();
  requests = [];
  delete process.env.REDDIT_CLIENT_ID;
  delete process.env.REDDIT_CLIENT_SECRET;
});

function useApi() {
  process.env.REDDIT_CLIENT_ID = 'id';
  process.env.REDDIT_CLIENT_SECRET = 'secret';
}
const follow = (u, body) => api('POST', '/reddit/follows', { token: u.token, body });
const widget = (u) => api('GET', '/reddit', { token: u.token });

test('subreddit names and thread links are read in any of their shapes', () => {
  assert.equal(normalizeSubreddit('r/PersonalFinanceCanada'), 'PersonalFinanceCanada');
  assert.equal(normalizeSubreddit('/r/investing/'), 'investing');
  assert.equal(normalizeSubreddit('not a sub!'), null);
  assert.equal(threadIdFrom('https://www.reddit.com/r/PersonalFinanceCanada/comments/1x5wzdi/easyfinancial_nightmare/'), '1x5wzdi');
  assert.equal(threadIdFrom('old.reddit.com/r/x/comments/abc123/'), 'abc123');
  assert.equal(threadIdFrom('https://redd.it/1x5wzdi'), '1x5wzdi');
  assert.equal(threadIdFrom('https://evil.example/r/x/comments/abc123/'), null);
});

test('with an app key, threads are ranked by upvotes and recency together', async () => {
  useApi();
  const u = await newUser(api, 'RedditApi');
  assert.equal((await follow(u, { subreddit: 'r/personalfinancecanada' })).body.name, 'PersonalFinanceCanada');
  assert.equal((await follow(u, { subreddit: 'CanadianInvestor' })).status, 201);

  const res = await widget(u);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.mode, 'api');
  // 400 votes this morning beats 2,000 votes five days ago, and a fresh
  // 50-vote post beats the old one too. Sub-pinned and NSFW posts are out.
  assert.deepEqual(res.body.trending.map((p) => p.id), ['new1', 'fresh1', 'old1']);
  const top = res.body.trending[0];
  assert.deepEqual([top.score, top.comments, top.subreddit], [400, 120, 'PersonalFinanceCanada']);
  assert.equal(top.link, 'https://www.reddit.com/r/PersonalFinanceCanada/comments/new1/slug/');

  // Cached: a second load doesn't go back to Reddit.
  requests = [];
  await widget(u);
  assert.deepEqual(requests, []);
});

test('without a key the RSS feeds stand in, with no vote counts', async () => {
  const u = await newUser(api, 'RedditRss');
  assert.equal((await follow(u, { subreddit: 'PersonalFinanceCanada' })).status, 201);
  const res = await widget(u);
  assert.equal(res.body.mode, 'rss');
  assert.ok(res.body.trending.length >= 2);
  assert.ok(res.body.trending.every((p) => p.score === null && p.comments === null));
  assert.ok(requests.every((r) => r.includes('.rss')));
});

test('following is checked: unknown subreddits, duplicates and bad links are refused', async () => {
  const u = await newUser(api, 'RedditChecks');
  assert.equal((await follow(u, { subreddit: 'NoSuchPlace' })).status, 400);
  assert.equal((await follow(u, { subreddit: 'bad name!' })).status, 400);
  assert.equal((await follow(u, { subreddit: 'CanadianInvestor' })).status, 201);
  assert.equal((await follow(u, { subreddit: 'canadianinvestor' })).status, 409);
  assert.equal((await follow(u, { thread: 'https://example.com/not-reddit' })).status, 400);
  assert.equal((await follow(u, { thread: 'https://www.reddit.com/r/x/comments/zzzz99/gone/' })).status, 400);
  assert.equal((await follow(u, {})).status, 400);
});

test('a followed thread shows its live score, and only its owner can unfollow it', async () => {
  useApi();
  const u = await newUser(api, 'RedditThread');
  const other = await newUser(api, 'RedditOther');
  const added = await follow(u, { thread: 'https://www.reddit.com/r/PersonalFinanceCanada/comments/old1/huge_thread/' });
  assert.equal(added.status, 201, added.text);
  assert.equal(added.body.thread.title, 'Huge thread from last week');

  const res = await widget(u);
  assert.equal(res.body.threads.length, 1);
  assert.deepEqual([res.body.threads[0].score, res.body.threads[0].comments], [2000, 900]);
  assert.equal(res.body.trending.length, 0); // no subreddits followed
  assert.equal((await widget(other)).body.threads.length, 0);

  const id = res.body.threads[0].followId;
  assert.equal((await api('DELETE', `/reddit/follows/${id}`, { token: other.token })).status, 404);
  assert.equal((await api('DELETE', `/reddit/follows/${id}`, { token: u.token })).status, 204);
  assert.equal((await widget(u)).body.threads.length, 0);
});

test('wide-screen dashboard layouts have 18 columns', async () => {
  const u = await newUser(api, 'WideLayout');
  const put = (layout) => api('PUT', '/dashboard/layout', { token: u.token, body: { layout } });
  const ok = await put({ widgets: ['reddit'], layouts: { xl: [{ i: 'reddit', x: 12, y: 0, w: 6, h: 18 }] } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await put({ widgets: ['reddit'], layouts: { xl: [{ i: 'reddit', x: 13, y: 0, w: 6, h: 18 }] } })).status, 400);
  assert.equal((await put({ widgets: ['reddit'], layouts: { lg: [{ i: 'reddit', x: 12, y: 0, w: 6, h: 18 }] } })).status, 400);
});
