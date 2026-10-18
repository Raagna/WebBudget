// Dashboard layout state: which widgets are shown and where.
//
//   { widgets: ['safe', ...],
//     layouts: { xl: [{ i, x, y, w, h }], lg: [...], sm: [{ i, x: 0, y, w: 1, h: 1 }] } }
//
// lg is the desktop grid: 12 columns of 20px rows. xl is a wide screen's:
// the dashboard spans the whole window there, with 18 columns, so the
// room to the right of the usual layout takes widgets too. Each keeps its
// own arrangement. sm is the phone order only - on a phone widgets stack
// one per row at their natural height, so only y matters.

export const COLS = { xl: 18, lg: 12 };
// Grid widths (px) where each starts; under 900px wide is the phone stack.
export const BREAKPOINTS = { xl: 1360, lg: 0 };
export const GRIDS = Object.keys(COLS);
export const ROW_HEIGHT = 20;
export const MARGIN = 18;

// The usual dashboard: the 7/5 note-and-strips row, the 7/5 card rows,
// then the trend chart and Reddit.
const DEFAULT_LG = [
  { i: 'safe', x: 0, y: 0, w: 7, h: 14 },
  { i: 'budgets', x: 7, y: 0, w: 5, h: 14 },
  { i: 'recent', x: 0, y: 14, w: 7, h: 12 },
  { i: 'categories', x: 7, y: 14, w: 5, h: 12 },
  { i: 'investments', x: 0, y: 26, w: 7, h: 14 },
  { i: 'news', x: 7, y: 26, w: 5, h: 14 },
  { i: 'trend', x: 0, y: 40, w: 7, h: 14 },
  { i: 'reddit', x: 7, y: 40, w: 5, h: 14 },
];

// Wide screens: the month's own numbers keep the left 12 columns; the
// outside world (holdings, news, Reddit) gets a column of its own.
const DEFAULT_XL = [
  { i: 'safe', x: 0, y: 0, w: 7, h: 14 },
  { i: 'budgets', x: 7, y: 0, w: 5, h: 14 },
  { i: 'recent', x: 0, y: 14, w: 7, h: 12 },
  { i: 'categories', x: 7, y: 14, w: 5, h: 12 },
  { i: 'trend', x: 0, y: 26, w: 12, h: 12 },
  { i: 'investments', x: 12, y: 0, w: 6, h: 12 },
  { i: 'news', x: 12, y: 12, w: 6, h: 12 },
  { i: 'reddit', x: 12, y: 24, w: 6, h: 18 },
];

const DEFAULTS = { lg: DEFAULT_LG, xl: DEFAULT_XL };

const byPosition = (a, b) => a.y - b.y || a.x - b.x;

function clampItem(item, widget, cols) {
  const w = Math.min(cols, Math.max(widget.min.w, item.w));
  const h = Math.max(widget.min.h, item.h);
  return { i: item.i, x: Math.min(Math.max(0, item.x), cols - w), y: Math.max(0, item.y), w, h };
}

const bottomOf = (items) => Math.max(0, ...items.map((it) => it.y + it.h));

// Phone order: the saved one, else read the desktop grid row by row.
function phoneOrder(widgets, lg, sm) {
  const order = (sm && sm.length ? [...sm].sort(byPosition) : [...lg].sort(byPosition)).map((it) => it.i);
  for (const id of widgets) if (!order.includes(id)) order.push(id);
  return order.filter((id) => widgets.includes(id)).map((i, y) => ({ i, x: 0, y, w: 1, h: 1 }));
}

export function defaultLayout(catalog) {
  const widgets = DEFAULT_LG.filter((it) => catalog[it.i]).map((it) => it.i);
  const layouts = {};
  for (const g of GRIDS) layouts[g] = DEFAULTS[g].filter((it) => catalog[it.i]);
  layouts.sm = phoneOrder(widgets, layouts.lg);
  return { widgets, layouts };
}

// A saved layout made safe to render: widgets this version of the app
// doesn't have are dropped, sizes respect each widget's minimum, and a
// shown widget with no position gets one at the bottom. A layout saved
// before wide screens had their own grid starts from its desktop grid,
// which leaves the right-hand third free to fill.
export function resolveLayout(saved, catalog) {
  if (!saved || !Array.isArray(saved.widgets)) return defaultLayout(catalog);
  const widgets = saved.widgets.filter((id) => catalog[id]);
  const layouts = {};
  for (const g of GRIDS) {
    const source = saved.layouts?.[g] || saved.layouts?.lg || [];
    const placed = new Map(source.filter((it) => widgets.includes(it.i)).map((it) => [it.i, it]));
    let bottom = bottomOf([...placed.values()]);
    layouts[g] = widgets.map((id) => {
      if (placed.has(id)) return clampItem(placed.get(id), catalog[id], COLS[g]);
      const item = { i: id, x: 0, y: bottom, ...catalog[id].size };
      bottom += item.h;
      return item;
    });
  }
  layouts.sm = phoneOrder(widgets, layouts.lg, saved.layouts?.sm);
  return { widgets, layouts };
}

export function addWidget(layout, id, catalog) {
  if (layout.widgets.includes(id)) return layout;
  const layouts = {};
  for (const g of GRIDS) {
    layouts[g] = [...layout.layouts[g], { i: id, x: 0, y: bottomOf(layout.layouts[g]), ...catalog[id].size }];
  }
  layouts.sm = [...layout.layouts.sm, { i: id, x: 0, y: layout.layouts.sm.length, w: 1, h: 1 }];
  return { widgets: [...layout.widgets, id], layouts };
}

export function removeWidget(layout, id) {
  const widgets = layout.widgets.filter((w) => w !== id);
  const layouts = {};
  for (const g of GRIDS) layouts[g] = layout.layouts[g].filter((it) => it.i !== id);
  layouts.sm = phoneOrder(widgets, [], layout.layouts.sm.filter((it) => it.i !== id));
  return { widgets, layouts };
}

// Phone: move a widget one place up (-1) or down (+1) in the stack.
export function moveOnPhone(layout, id, delta) {
  const order = [...layout.layouts.sm].sort(byPosition).map((it) => it.i);
  const from = order.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return layout;
  [order[from], order[to]] = [order[to], order[from]];
  return { ...layout, layouts: { ...layout.layouts, sm: order.map((i, y) => ({ i, x: 0, y, w: 1, h: 1 })) } };
}

// Change one widget's size on one grid from the keyboard-friendly menus;
// the grid pushes its neighbours out of the way when it next lays out.
export function resizeWidget(layout, grid, id, size, catalog) {
  return {
    ...layout,
    layouts: {
      ...layout.layouts,
      [grid]: layout.layouts[grid].map((it) => (it.i === id ? clampItem({ ...it, ...size }, catalog[id], COLS[grid]) : it)),
    },
  };
}

// Only i, x, y, w, h go to the server (the grid adds its own fields).
export function toSaved(layout) {
  const strip = (items) => items.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
  const layouts = {};
  for (const [g, items] of Object.entries(layout.layouts)) layouts[g] = strip(items);
  return { widgets: layout.widgets, layouts };
}
