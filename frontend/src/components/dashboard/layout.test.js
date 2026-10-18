import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultLayout, resolveLayout, addWidget, removeWidget, moveOnPhone, resizeWidget, toSaved } from './layout.js';

// The real catalog's shape, without its React render functions.
const CATALOG = {
  safe: { size: { w: 7, h: 14 }, min: { w: 4, h: 9 } },
  budgets: { size: { w: 5, h: 14 }, min: { w: 3, h: 7 } },
  recent: { size: { w: 7, h: 12 }, min: { w: 3, h: 6 } },
  categories: { size: { w: 5, h: 12 }, min: { w: 3, h: 6 } },
  investments: { size: { w: 7, h: 14 }, min: { w: 3, h: 6 } },
  news: { size: { w: 5, h: 14 }, min: { w: 3, h: 6 } },
  trend: { size: { w: 12, h: 9 }, min: { w: 4, h: 7 } },
};

test('the default layout shows every widget, and phones read it row by row', () => {
  const l = defaultLayout(CATALOG);
  assert.deepEqual(l.widgets, ['safe', 'budgets', 'recent', 'categories', 'investments', 'news', 'trend']);
  assert.deepEqual(l.layouts.sm.map((it) => it.i), l.widgets);
  assert.equal(resolveLayout(null, CATALOG).widgets.length, 7);
});

test('a saved layout is cleaned up before it is drawn', () => {
  const l = resolveLayout({
    widgets: ['news', 'gone-widget', 'safe', 'trend'],
    layouts: { lg: [
      { i: 'news', x: 0, y: 0, w: 1, h: 2 },      // smaller than news allows
      { i: 'safe', x: 10, y: 0, w: 7, h: 14 },    // runs off the right edge
      { i: 'gone-widget', x: 0, y: 0, w: 4, h: 4 },
    ] },
  }, CATALOG);
  assert.deepEqual(l.widgets, ['news', 'safe', 'trend']); // unknown widget dropped
  const at = Object.fromEntries(l.layouts.lg.map((it) => [it.i, it]));
  assert.deepEqual(at.news, { i: 'news', x: 0, y: 0, w: 3, h: 6 });
  assert.deepEqual(at.safe, { i: 'safe', x: 5, y: 0, w: 7, h: 14 });
  assert.deepEqual(at.trend, { i: 'trend', x: 0, y: 14, w: 12, h: 9 }); // no spot saved: goes to the bottom
  // No phone order saved: the desktop grid, row by row, left to right.
  assert.deepEqual(l.layouts.sm.map((it) => it.i), ['news', 'safe', 'trend']);
});

test('widgets can be removed, added back at the bottom, resized and reordered on a phone', () => {
  let l = defaultLayout(CATALOG);
  l = removeWidget(l, 'news');
  assert.ok(!l.widgets.includes('news'));
  assert.ok(!l.layouts.lg.some((it) => it.i === 'news'));
  assert.deepEqual(l.layouts.sm.map((it) => it.y), [0, 1, 2, 3, 4, 5]);

  l = addWidget(l, 'news', CATALOG);
  const news = l.layouts.lg.find((it) => it.i === 'news');
  assert.deepEqual(news, { i: 'news', x: 0, y: 49, w: 5, h: 14 }); // below the trend chart
  assert.equal(l.layouts.sm.at(-1).i, 'news');
  assert.equal(addWidget(l, 'news', CATALOG), l); // already shown: no change

  l = resizeWidget(l, 'news', { w: 12 }, CATALOG);
  assert.equal(l.layouts.lg.find((it) => it.i === 'news').w, 12);
  l = resizeWidget(l, 'news', { h: 1 }, CATALOG);
  assert.equal(l.layouts.lg.find((it) => it.i === 'news').h, 6); // never below its minimum

  l = moveOnPhone(l, 'budgets', -1);
  assert.deepEqual(l.layouts.sm.slice(0, 2).map((it) => it.i), ['budgets', 'safe']);
  assert.equal(moveOnPhone(l, 'budgets', -1), l); // already first
});

test('only positions are saved, not the grid library’s own fields', () => {
  const l = defaultLayout(CATALOG);
  l.layouts.lg[0] = { ...l.layouts.lg[0], moved: false, static: false, minW: 4 };
  assert.deepEqual(Object.keys(toSaved(l).layouts.lg[0]), ['i', 'x', 'y', 'w', 'h']);
});
