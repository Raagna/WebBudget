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

const presets = (u) => api('GET', '/dashboard/layout/presets', { token: u.token });
const addPreset = (u, name, layout = LAYOUT) => api('POST', '/dashboard/layout/presets', { token: u.token, body: { name, layout } });

test('layout presets are saved per user and follow them into every household', async () => {
  const u = await newUser(api, 'Presets');
  const other = await newUser(api, 'NotMine');
  const saved = await addPreset(u, 'Investing');
  assert.equal(saved.status, 201, saved.text);
  assert.equal(saved.body.preset.name, 'Investing');
  assert.deepEqual(saved.body.preset.layout.layouts.lg[1], { i: 'news', x: 0, y: 0, w: 5, h: 14 }); // grid extras dropped

  // A household the user joins later still sees the same presets: they
  // belong to the account, not to a budget.
  const p = await api('POST', '/profiles', { token: u.token, body: { name: 'Shared flat' } });
  assert.ok(p.status < 300, p.text);
  assert.deepEqual((await presets(u)).body.presets.map((x) => x.name), ['Investing']);
  assert.deepEqual((await presets(other)).body.presets, []);

  // Names are unique per user, ignoring case; someone else can reuse one.
  assert.equal((await addPreset(u, 'investing')).status, 409);
  assert.equal((await addPreset(other, 'Investing')).status, 201);
  assert.equal((await addPreset(u, '   ')).status, 400);
  assert.equal((await addPreset(u, 'Bad', { widgets: ['safe', 'safe'], layouts: {} })).status, 400);
});

test('a preset can be renamed, overwritten and deleted, only by its owner', async () => {
  const u = await newUser(api, 'PresetEdit');
  const other = await newUser(api, 'PresetThief');
  const { body } = await addPreset(u, 'Everyday');
  const id = body.preset.id;
  const put = (who, update) => api('PUT', `/dashboard/layout/presets/${id}`, { token: who.token, body: update });

  assert.equal((await put(other, { name: 'Mine now' })).status, 404);
  assert.equal((await put(u, { name: 'Daily' })).body.preset.name, 'Daily');
  const moved = { widgets: ['safe'], layouts: { lg: [{ i: 'safe', x: 5, y: 0, w: 7, h: 14 }] } };
  assert.deepEqual((await put(u, { layout: moved })).body.preset.layout.layouts.lg, moved.layouts.lg);
  await addPreset(u, 'Weekend');
  assert.equal((await put(u, { name: 'weekend' })).status, 409);

  assert.equal((await api('DELETE', `/dashboard/layout/presets/${id}`, { token: other.token })).status, 404);
  assert.equal((await api('DELETE', `/dashboard/layout/presets/${id}`, { token: u.token })).status, 204);
  assert.deepEqual((await presets(u)).body.presets.map((x) => x.name), ['Weekend']);
});
