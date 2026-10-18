const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { parseFeed } = require('../utils/rss');

// General financial news for the dashboard: headlines (title, source,
// time, link out) from public RSS feeds - nothing is republished beyond
// the headline, and reading the story means going to the source.
//
// Feeds are fetched by the API, not the browser, and cached in memory for
// NEWS_TTL_MS (default 30 min), so a busy dashboard costs the publishers
// one request per feed per half hour. If every feed fails, the last good
// set is served rather than an empty card.
//
// NEWS_FEEDS overrides the list: "Name|url,Name|url".
const DEFAULT_FEEDS = [
  ['CBC Business', 'https://www.cbc.ca/webfeed/rss/rss-business'],
  ['The Globe and Mail', 'https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/business/'],
  ['MarketWatch', 'https://feeds.content.dowjones.io/public/rss/mw_topstories'],
  ['Bank of Canada', 'https://www.bankofcanada.ca/content_type/press-releases/feed/'],
];
const PER_SOURCE = 4; // so one chatty feed can't fill the card
const MAX_ITEMS = 12;
const TIMEOUT_MS = 8000;

function feeds() {
  if (!process.env.NEWS_FEEDS) return DEFAULT_FEEDS;
  return process.env.NEWS_FEEDS.split(',')
    .map((entry) => entry.split('|').map((s) => s.trim()))
    .filter(([name, url]) => name && url);
}

async function fetchFeed([source, url]) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (WebBudget news)', Accept: 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${source} returned ${res.status}`);
  return parseFeed(await res.text())
    .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))
    .slice(0, PER_SOURCE)
    .map((item) => ({ ...item, source }));
}

let cache = { items: [], fetchedAt: 0 };

async function loadNews() {
  const ttl = Number(process.env.NEWS_TTL_MS) || 30 * 60 * 1000;
  if (cache.fetchedAt && Date.now() - cache.fetchedAt < ttl) return cache;

  const results = await Promise.allSettled(feeds().map(fetchFeed));
  for (const r of results) if (r.status === 'rejected') console.error('[news]', r.reason?.message || r.reason);
  const seen = new Set();
  const unique = results
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))
    // The same wire story often runs in two feeds; keep the newest copy.
    .filter((item) => {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  // Take turns between sources, newest first within each: a feed that
  // posts every hour would otherwise fill the whole card by itself.
  const bySource = new Map();
  for (const item of unique) {
    if (!bySource.has(item.source)) bySource.set(item.source, []);
    bySource.get(item.source).push(item);
  }
  const items = [];
  for (let round = 0; items.length < MAX_ITEMS && round < PER_SOURCE; round++) {
    for (const list of bySource.values()) if (list[round] && items.length < MAX_ITEMS) items.push(list[round]);
  }

  if (items.length > 0 || !cache.fetchedAt) cache = { items, fetchedAt: Date.now() };
  return cache;
}

const router = express.Router();
router.use(requireAuth);

// GET /api/news -> { items: [{ title, link, source, publishedAt }], fetchedAt }
router.get('/', asyncHandler(async (req, res) => {
  const { items, fetchedAt } = await loadNews();
  res.json({ items, fetchedAt: new Date(fetchedAt).toISOString() });
}));

module.exports = router;
