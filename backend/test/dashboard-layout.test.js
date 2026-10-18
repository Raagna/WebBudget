// Saving each user's own dashboard layout.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, newUser } = require('./helpers');

let env;
let api;
before(async () => {
  env = await start('dashboard_layout');
  api = client(env.origin);
});
after(() => env.stop());

const LAYOUT = {
  widgets: ['safe', 'news'],
  layouts: {
    lg: [{ i: 'safe', x: 5, y: 0, w: 7, h: 14 }, { i: 'news', x: 0, y: 0, w: 5, h: 14, moved: false }],
    sm: [{ i: 'news', x: 0, y: 0, w: 1, h: 1 }, { i: 'safe', x: 0, y: 1, w: 1, h: 1 }],
  },
};

const getLayout = (u) => api('GET', '/dashboard/layout', { token: u.token });
const putLayout = (u, layout) => api('PUT', '/dashboard/layout', { token: u.token, body: { layout } });

test('a layout is saved per user, and null goes back to the default', async () => {
  const a = await newUser(api, 'LayoutA');
  const b = await newUser(api, 'LayoutB');
  assert.deepEqual((await getLayout(a)).body, { layout: null });

  const saved = await putLayout(a, LAYOUT);
  assert.equal(saved.status, 200, saved.text);
  // Extra fields from the grid library are dropped.
  assert.deepEqual(saved.body.layout.layouts.lg[1], { i: 'news', x: 0, y: 0, w: 5, h: 14 });
  assert.deepEqual((await getLayout(a)).body.layout.widgets, ['safe', 'news']);
  assert.equal((await getLayout(b)).body.layout, null); // someone else's dashboard is untouched

  assert.equal((await putLayout(a, null)).status, 200);
  assert.equal((await getLayout(a)).body.layout, null);
  assert.equal((await api('GET', '/dashboard/layout')).status, 401);
});

test('malformed layouts are rejected', async () => {
  const u = await newUser(api, 'LayoutBad');
  const bad = [
    'nope',
    { widgets: 'safe', layouts: {} },
    { widgets: ['safe', 'safe'], layouts: {} }, // duplicate widget
    { widgets: ['Safe!'], layouts: {} }, // not a widget id
    { widgets: ['safe'], layouts: { xxl: [] } }, // unknown breakpoint
    { widgets: ['safe'], layouts: { lg: [{ i: 'news', x: 0, y: 0, w: 4, h: 4 }] } }, // not a shown widget
    { widgets: ['safe'], layouts: { lg: [{ i: 'safe', x: 6, y: 0, w: 7, h: 4 }] } }, // past column 12
    { widgets: ['safe'], layouts: { lg: [{ i: 'safe', x: 0, y: 0, w: 4, h: 0 }] } }, // no height
    { widgets: ['safe'], layouts: { sm: [{ i: 'safe', x: 0, y: 0, w: 2, h: 1 }] } }, // phones are one column
    { widgets: Array.from({ length: 30 }, (_, n) => `w${n}`), layouts: {} }, // too many
  ];
  for (const layout of bad) {
    const res = await putLayout(u, layout);
    assert.equal(res.status, 400, `accepted ${JSON.stringify(layout)}`);
  }
  assert.equal((await getLayout(u)).body.layout, null);
});
