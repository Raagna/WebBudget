// Reddit posts for the dashboard's Reddit widget.
//
// Two ways in, picked by whether this server has a Reddit app key:
//   'api' - the official API, with an app-only OAuth token, when
//           REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are set (a free
//           "script" app from reddit.com/prefs/apps). Gives upvotes and
//           comment counts.
//   'rss' - Reddit's public RSS feeds otherwise. No key, but no vote or
//           comment counts either; Reddit's own "top" order stands in.
// Reddit blocks its keyless JSON endpoints, so there's no third option.
//
// Everything is cached for REDDIT_TTL_MS (default 15 min) per subreddit
// and per thread: Reddit rate-limits hard, and a dashboard reload must
// never cost a request. A failed fetch serves the last good copy.
//
// REDDIT_AUTH_URL / REDDIT_API_URL / REDDIT_RSS_URL exist for the tests.

const { parseFeed } = require('./rss');

const USER_AGENT = 'web:webbudget:1.0 (personal finance dashboard)';
const TIMEOUT_MS = 10_000;
const PER_SUBREDDIT = 30;

function settings() {
  return {
    clientId: process.env.REDDIT_CLIENT_ID || '',
    clientSecret: process.env.REDDIT_CLIENT_SECRET || '',
    authUrl: (process.env.REDDIT_AUTH_URL || 'https://www.reddit.com').replace(/\/+$/, ''),
    apiUrl: (process.env.REDDIT_API_URL || 'https://oauth.reddit.com').replace(/\/+$/, ''),
    rssUrl: (process.env.REDDIT_RSS_URL || 'https://www.reddit.com').replace(/\/+$/, ''),
    ttlMs: Number(process.env.REDDIT_TTL_MS) || 15 * 60 * 1000,
  };
}

function mode() {
  const s = settings();
  return s.clientId && s.clientSecret ? 'api' : 'rss';
}

class RedditNotFound extends Error {}

// ---------- Names and links ----------

// "r/PersonalFinanceCanada", "/r/x/", "PersonalFinanceCanada" -> the name.
function normalizeSubreddit(raw) {
  const s = String(raw || '').trim().replace(/^\/?r\//i, '').replace(/\/+$/, '');
  return /^[A-Za-z0-9_]{2,21}$/.test(s) ? s : null;
}

// A thread link in any of Reddit's shapes (www/old/new reddit, redd.it,
// a share link's /comments/ path), or a bare post id -> the post id.
function threadIdFrom(raw) {
  const s = String(raw || '').trim();
  if (/^[a-z0-9]{4,10}$/i.test(s)) return s.toLowerCase();
  let url;
  try { url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'redd.it') {
    const id = url.pathname.split('/')[1];
    return /^[a-z0-9]{4,10}$/i.test(id || '') ? id.toLowerCase() : null;
  }
  if (!/(^|\.)reddit\.com$/.test(host)) return null;
  const m = url.pathname.match(/\/comments\/([a-z0-9]{4,10})(\/|$)/i);
  return m ? m[1].toLowerCase() : null;
}

// ---------- Fetching ----------

async function get(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  if (res.status === 404 || res.status === 403) throw new RedditNotFound(url); // missing, private or banned
  if (!res.ok) throw new Error(`Reddit returned ${res.status}`);
  return res;
}

let token = { value: null, expiresAt: 0 };

async function accessToken(s) {
  if (token.value && Date.now() < token.expiresAt - 60_000) return token.value;
  const res = await fetch(`${s.authUrl}/api/v1/access_token`, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      Authorization: `Basic ${Buffer.from(`${s.clientId}:${s.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Reddit sign-in returned ${res.status} - check REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET`);
  const body = await res.json();
  token = { value: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
  return token.value;
}

async function apiJson(path) {
  const s = settings();
  const res = await get(`${s.apiUrl}${path}`, { Authorization: `Bearer ${await accessToken(s)}` });
  return res.json();
}

// One post, the same shape from either source. score and comments are
// null from RSS, which doesn't carry them.
function fromApi(d) {
  return {
    id: d.id,
    subreddit: d.subreddit,
    title: d.title,
    link: `https://www.reddit.com${d.permalink}`,
    score: d.score,
    comments: d.num_comments,
    createdAt: new Date(d.created_utc * 1000).toISOString(),
    pinnedBySub: !!d.stickied,
    nsfw: !!d.over_18,
  };
}

function fromRss(item) {
  const m = item.link.match(/\/r\/([A-Za-z0-9_]+)\/comments\/([a-z0-9]+)/i);
  if (!m) return null;
  return {
    id: m[2].toLowerCase(), subreddit: m[1], title: item.title, link: item.link,
    score: null, comments: null, createdAt: item.publishedAt, pinnedBySub: false, nsfw: false,
  };
}

const cache = new Map(); // key -> { at, value }

// Fresh copy if cached recently; otherwise fetch, falling back to the
// last good copy (marked stale) when Reddit is unreachable. "Not found"
// is never papered over.
async function cached(key, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < settings().ttlMs) return { value: hit.value, stale: false };
  try {
    const value = await load();
    cache.set(key, { at: Date.now(), value });
    return { value, stale: false };
  } catch (err) {
    if (err instanceof RedditNotFound || !hit) throw err;
    console.error(`[reddit] ${key}:`, err.message);
    return { value: hit.value, stale: true };
  }
}

// The week's top posts in a subreddit, best first.
function subredditPosts(name) {
  const m = mode();
  return cached(`${m}:sub:${name.toLowerCase()}`, async () => {
    if (m === 'api') {
      const body = await apiJson(`/r/${name}/top?t=week&limit=${PER_SUBREDDIT}&raw_json=1`);
      return (body?.data?.children || []).map((c) => fromApi(c.data));
    }
    const res = await get(`${settings().rssUrl}/r/${name}/top/.rss?t=week&limit=${PER_SUBREDDIT}`);
    const xml = await res.text();
    if (!/<feed|<rss/i.test(xml)) throw new RedditNotFound(name);
    return parseFeed(xml).map(fromRss).filter(Boolean);
  });
}

// One post by id, with its current votes and comments where available.
function threadPost(id) {
  const m = mode();
  return cached(`${m}:thread:${id}`, async () => {
    if (m === 'api') {
      const body = await apiJson(`/by_id/t3_${id}?raw_json=1`);
      const d = body?.data?.children?.[0]?.data;
      if (!d) throw new RedditNotFound(id);
      return fromApi(d);
    }
    // A thread's feed starts with the post itself, then its comments.
    const res = await get(`${settings().rssUrl}/comments/${id}/.rss?limit=1`);
    const post = parseFeed(await res.text()).map(fromRss).find((p) => p && p.id === id);
    if (!post) throw new RedditNotFound(id);
    return post;
  });
}

// ---------- Ranking ----------

// "High upvotes + recency": upvotes divided by age, with gravity, the way
// Hacker News ranks its front page - a 2,000-vote post from five days ago
// sinks below a 400-vote post from this morning. RSS has no votes, so a
// post's place in Reddit's own top list stands in for them.
function trendScore(post, rank, now = Date.now()) {
  const ageHours = Math.max(0, (now - Date.parse(post.createdAt || 0)) / 3_600_000);
  const votes = post.score ?? (PER_SUBREDDIT - rank) * 20;
  return Math.max(votes, 0) / Math.pow(ageHours + 2, 1.5);
}

function rankTrending(lists, now = Date.now(), limit = 30) {
  const seen = new Set();
  return lists
    .flatMap((posts) => posts.filter((p) => !p.pinnedBySub && !p.nsfw).map((p, rank) => ({ post: p, trend: trendScore(p, rank, now) })))
    .sort((a, b) => b.trend - a.trend)
    .filter(({ post }) => (seen.has(post.id) ? false : seen.add(post.id)))
    .slice(0, limit)
    .map(({ post }) => post);
}

// Tests start each case from an empty cache and no token.
function resetRedditCache() {
  cache.clear();
  token = { value: null, expiresAt: 0 };
}

module.exports = {
  mode, normalizeSubreddit, threadIdFrom, subredditPosts, threadPost,
  trendScore, rankTrending, RedditNotFound, resetRedditCache,
};
