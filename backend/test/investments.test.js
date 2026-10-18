// Holdings, live prices (from a fake Yahoo Finance), currency conversion
// and the price cache; plus the news feed reader.
const http = require('http');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, newUser } = require('./helpers');
const { parseFeed } = require('../utils/rss');

let env;
let api;
let yahoo;
let feeds;

// Symbol -> chart meta. Edit between tests to move "the market".
const MARKET = {};
let quoteRequests = [];
let yahooDown = false;

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  })));
}

before(async () => {
  yahoo = await listen((req, res) => {
    const symbol = decodeURIComponent(req.url.split('/chart/')[1].split('?')[0]);
    quoteRequests.push(symbol);
    res.setHeader('Content-Type', 'application/json');
    if (yahooDown) { res.statusCode = 503; res.end('{}'); return; }
    const meta = MARKET[symbol];
    if (!meta) {
      res.statusCode = 404;
      res.end(JSON.stringify({ chart: { result: null, error: { code: 'Not Found' } } }));
      return;
    }
    res.end(JSON.stringify({ chart: { result: [{ meta: { symbol, ...meta } }], error: null } }));
  });
  feeds = await listen((req, res) => {
    res.setHeader('Content-Type', 'application/rss+xml');
    if (req.url === '/a') {
      res.end(`<?xml version="1.0"?><rss><channel><title>Feed A</title>
        <item><title><![CDATA[Bank of Canada holds rate at 2.25%]]></title><link>https://a.example/rate</link><pubDate>Fri, 16 Oct 2026 14:00:00 GMT</pubDate></item>
        <item><title>Loonie &amp; TSX &#x2018;rally&#x2019;</title><link>https://a.example/tsx</link><pubDate>Sat, 17 Oct 2026 09:00:00 GMT</pubDate></item>
        <item><title>Sneaky</title><link>javascript:alert(1)</link></item>
      </channel></rss>`);
    } else if (req.url === '/b') {
      res.end(`<rss><channel><item><title>Bank of Canada holds rate at 2.25%!</title><link>https://b.example/dup</link><pubDate>Fri, 16 Oct 2026 15:00:00 GMT</pubDate></item>
        <item><title>Markets close mixed</title><link>https://b.example/close</link><pubDate>Fri, 16 Oct 2026 21:00:00 GMT</pubDate></item></channel></rss>`);
    } else {
      res.statusCode = 500;
      res.end('down');
    }
  });
  process.env.QUOTES_URL = yahoo.url;
  process.env.NEWS_FEEDS = `Feed A|${feeds.url}/a,Feed B|${feeds.url}/b,Broken|${feeds.url}/broken`;
  env = await start('investments');
  api = client(env.origin);
});
after(async () => {
  await env.stop();
  await yahoo.close();
  await feeds.close();
});
beforeEach(() => {
  quoteRequests = [];
  yahooDown = false;
  process.env.QUOTE_TTL_MS = '900000';
});

async function cadUser(name) {
  const u = await newUser(api, name);
  const p = await api('POST', '/profiles', { token: u.token, body: { name: 'TFSA', currency: 'CAD' } });
  assert.equal(p.status, 201, p.text);
  return { ...u, profileId: p.body.profile?.id ?? p.body.id };
}

const add = (u, body) => api('POST', '/investments', { token: u.token, body: { profileId: u.profileId, ...body } });
const portfolio = (u) => api('GET', `/investments?profileId=${u.profileId}`, { token: u.token });

test('holdings are valued at live prices, converted into the profile currency', async () => {
  MARKET['XEQT.TO'] = { currency: 'CAD', regularMarketPrice: 45.46, chartPreviousClose: 45.85, longName: 'iShares Core Equity ETF' };
  MARKET.AAPL = { currency: 'USD', regularMarketPrice: 343.46, chartPreviousClose: 342.0, longName: 'Apple Inc.' };
  MARKET['USDCAD=X'] = { currency: 'CAD', regularMarketPrice: 1.4, chartPreviousClose: 1.4 };
  const u = await cadUser('Investor');

  assert.equal((await add(u, { symbol: 'xeqt.to', shares: 10.5, account: 'Wealthsimple TFSA', bookCost: 400 })).status, 201);
  assert.equal((await add(u, { symbol: 'AAPL', shares: 2 })).status, 201);

  const res = await portfolio(u);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.currency, 'CAD');
  const bySym = new Map(res.body.holdings.map((h) => [h.symbol, h]));
  const xeqt = bySym.get('XEQT.TO');
  assert.equal(xeqt.name, 'iShares Core Equity ETF');
  assert.equal(xeqt.account, 'Wealthsimple TFSA');
  assert.equal(xeqt.value, 477.33); // 10.5 x 45.46
  assert.equal(xeqt.dayChange, -4.1); // 10.5 x (45.46 - 45.85)
  assert.equal(xeqt.gain, 77.33);
  const aapl = bySym.get('AAPL');
  assert.equal(aapl.currency, 'USD');
  assert.equal(aapl.value, 961.69); // 2 x 343.46 x 1.4 CAD
  assert.equal(aapl.gain, null); // no book cost given

  assert.equal(res.body.totals.value, 1439.02);
  assert.equal(res.body.totals.gain, 77.33); // only what has a book cost
  assert.equal(res.body.totals.bookCost, 400);
  assert.equal(res.body.stale, false);
});

test('a symbol Yahoo does not know is rejected with a hint', async () => {
  const u = await cadUser('Typo');
  const res = await add(u, { symbol: 'XEQT', shares: 1 });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /\.TO/);
  assert.equal((await add(u, { symbol: 'bad symbol!', shares: 1 })).status, 400);
  assert.equal((await add(u, { symbol: 'AAPL', shares: -1 })).status, 400);
});

test('prices are cached, and the last known price is used when Yahoo is down', async () => {
  MARKET.MSFT = { currency: 'CAD', regularMarketPrice: 100, chartPreviousClose: 100 };
  const u = await cadUser('Cache');
  await add(u, { symbol: 'MSFT', shares: 1 });
  quoteRequests = [];
  await portfolio(u);
  await portfolio(u);
  assert.deepEqual(quoteRequests, []); // fresh from the add, then cached

  process.env.QUOTE_TTL_MS = '1'; // everything is stale now
  MARKET.MSFT.regularMarketPrice = 110;
  assert.equal((await portfolio(u)).body.totals.value, 110);

  yahooDown = true;
  const down = await portfolio(u);
  assert.equal(down.status, 200);
  assert.equal(down.body.totals.value, 110); // last known price
  assert.equal(down.body.stale, true);
});

test('holdings can be edited and removed only by members of the profile', async () => {
  MARKET.VFV = { currency: 'CAD', regularMarketPrice: 150, chartPreviousClose: 149 };
  const u = await cadUser('Owner');
  const other = await cadUser('Stranger');
  const { body } = await add(u, { symbol: 'VFV', shares: 3 });

  assert.equal((await api('PUT', `/investments/${body.id}`, { token: other.token, body: { shares: 99 } })).status, 404);
  assert.equal((await api('GET', `/investments?profileId=${u.profileId}`, { token: other.token })).status, 404);

  const put = await api('PUT', `/investments/${body.id}`, { token: u.token, body: { shares: 4, bookCost: 500, account: 'RRSP' } });
  assert.equal(put.status, 200, put.text);
  let h = (await portfolio(u)).body.holdings[0];
  assert.deepEqual([h.shares, h.bookCost, h.account, h.value, h.gain], [4, 500, 'RRSP', 600, 100]);

  await api('PUT', `/investments/${body.id}`, { token: u.token, body: { bookCost: null } });
  h = (await portfolio(u)).body.holdings[0];
  assert.equal(h.bookCost, null);

  assert.equal((await api('DELETE', `/investments/${body.id}`, { token: other.token })).status, 404);
  assert.equal((await api('DELETE', `/investments/${body.id}`, { token: u.token })).status, 204);
  assert.equal((await portfolio(u)).body.holdings.length, 0);
});

test('the feed reader handles CDATA, entities and drops unsafe links', () => {
  const items = parseFeed(`<rss><channel>
    <item><title><![CDATA[Rates <b>hold</b>]]></title><link>https://x.example/1</link><pubDate>Fri, 16 Oct 2026 14:00:00 GMT</pubDate></item>
    <item><title>Q&amp;A &#8212; &#x201C;TFSA&#x201D;</title><link> https://x.example/2 </link></item>
    <item><title>Bad</title><link>data:text/html,hi</link></item>
    <item><title></title><link>https://x.example/empty</link></item>
  </channel></rss>`);
  assert.deepEqual(items, [
    { title: 'Rates hold', link: 'https://x.example/1', publishedAt: '2026-10-16T14:00:00.000Z' },
    { title: 'Q&A — “TFSA”', link: 'https://x.example/2', publishedAt: null },
  ]);
  // Atom-style links work too.
  assert.equal(parseFeed('<feed><entry><title>A</title><link href="https://x.example/a"/></entry></feed>')[0].link, 'https://x.example/a');
});

test('news takes turns between feeds, drops duplicates, and survives a broken feed', async () => {
  const u = await newUser(api, 'Reader');
  const res = await api('GET', '/news', { token: u.token });
  assert.equal(res.status, 200, res.text);
  // The newest story of each source, then each source's next one (A has
  // no second story: its copy of the rate story lost to B's newer one).
  assert.deepEqual(res.body.items.map((i) => [i.source, i.title]), [
    ['Feed A', 'Loonie & TSX ‘rally’'],
    ['Feed B', 'Markets close mixed'],
    ['Feed B', 'Bank of Canada holds rate at 2.25%!'],
  ]);
  // Same story in both feeds: only the newer copy is kept.
  assert.equal(res.body.items.filter((i) => i.title.startsWith('Bank of Canada')).length, 1);
  assert.ok(res.body.items.every((i) => i.link.startsWith('https://')));

  assert.equal((await api('GET', '/news')).status, 401);
});
