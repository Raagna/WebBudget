// Dashboard layout state: which widgets are shown and where.
//
//   { widgets: ['safe', ...],
//     layouts: { lg: [{ i, x, y, w, h }], sm: [{ i, x: 0, y, w: 1, h: 1 }] } }
//
// lg is the desktop grid: 12 columns, rows of ROW_HEIGHT px. sm is the
// phone order only - on a phone widgets stack one per row at their
// natural height, so only y (the position in the stack) matters there.

export const COLS = 12;
export const ROW_HEIGHT = 20;
export const MARGIN = 18;

// Today's dashboard, as a grid: the 7/5 note-and-strips row, then the
// 7/5 card rows, then the trend chart across the full width.
export const DEFAULT_LG = [
  { i: 'safe', x: 0, y: 0, w: 7, h: 14 },
  { i: 'budgets', x: 7, y: 0, w: 5, h: 14 },
  { i: 'recent', x: 0, y: 14, w: 7, h: 12 },
  { i: 'categories', x: 7, y: 14, w: 5, h: 12 },
  { i: 'investments', x: 0, y: 26, w: 7, h: 14 },
  { i: 'news', x: 7, y: 26, w: 5, h: 14 },
  { i: 'trend', x: 0, y: 40, w: 12, h: 9 },
];

const byPosition = (a, b) => a.y - b.y || a.x - b.x;

function clampItem(item, widget) {
  const w = Math.min(COLS, Math.max(widget.min.w, item.w));
  const h = Math.max(widget.min.h, item.h);
  return { i: item.i, x: Math.min(Math.max(0, item.x), COLS - w), y: Math.max(0, item.y), w, h };
}

// Phone order: the saved one, else read the desktop grid row by row.
function phoneOrder(widgets, lg, sm) {
  const order = (sm && sm.length ? [...sm].sort(byPosition) : [...lg].sort(byPosition)).map((it) => it.i);
  for (const id of widgets) if (!order.includes(id)) order.push(id);
  return order.filter((id) => widgets.includes(id)).map((i, y) => ({ i, x: 0, y, w: 1, h: 1 }));
}

export function defaultLayout(catalog) {
  const lg = DEFAULT_LG.filter((it) => catalog[it.i]);
  const widgets = lg.map((it) => it.i);
  return { widgets, layouts: { lg, sm: phoneOrder(widgets, lg) } };
}

// A saved layout made safe to render: widgets this version of the app
// doesn't have are dropped, sizes respect each widget's minimum, and a
// shown widget with no position gets one at the bottom.
export function resolveLayout(saved, catalog) {
  if (!saved || !Array.isArray(saved.widgets)) return defaultLayout(catalog);
  const widgets = saved.widgets.filter((id) => catalog[id]);
  const placed = new Map((saved.layouts?.lg || []).filter((it) => widgets.includes(it.i)).map((it) => [it.i, it]));
  let bottom = Math.max(0, ...[...placed.values()].map((it) => it.y + it.h));
  const lg = widgets.map((id) => {
    if (placed.has(id)) return clampItem(placed.get(id), catalog[id]);
    const item = { i: id, x: 0, y: bottom, ...catalog[id].size };
    bottom += item.h;
    return item;
  });
  return { widgets, layouts: { lg, sm: phoneOrder(widgets, lg, saved.layouts?.sm) } };
}

export function addWidget(layout, id, catalog) {
  if (layout.widgets.includes(id)) return layout;
  const bottom = Math.max(0, ...layout.layouts.lg.map((it) => it.y + it.h));
  const widgets = [...layout.widgets, id];
  return {
    widgets,
    layouts: {
      lg: [...layout.layouts.lg, { i: id, x: 0, y: bottom, ...catalog[id].size }],
      sm: [...layout.layouts.sm, { i: id, x: 0, y: layout.layouts.sm.length, w: 1, h: 1 }],
    },
  };
}

export function removeWidget(layout, id) {
  const widgets = layout.widgets.filter((w) => w !== id);
  return {
    widgets,
    layouts: {
      lg: layout.layouts.lg.filter((it) => it.i !== id),
      sm: phoneOrder(widgets, [], layout.layouts.sm.filter((it) => it.i !== id)),
    },
  };
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

// Change one widget's size from the keyboard-friendly menus; the grid
// pushes its neighbours out of the way when it next lays out.
export function resizeWidget(layout, id, size, catalog) {
  return {
    ...layout,
    layouts: {
      ...layout.layouts,
      lg: layout.layouts.lg.map((it) => (it.i === id ? clampItem({ ...it, ...size }, catalog[id]) : it)),
    },
  };
}

// Only i, x, y, w, h go to the server (the grid adds its own fields).
export function toSaved(layout) {
  const strip = (items) => items.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
  return { widgets: layout.widgets, layouts: { lg: strip(layout.layouts.lg), sm: strip(layout.layouts.sm) } };
}
