import { useEffect, useRef, useState } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { COLS, BREAKPOINTS, GRIDS, ROW_HEIGHT, MARGIN, moveOnPhone, removeWidget, resizeWidget } from './layout.js';

const Grid = WidthProvider(Responsive);

// Below this width the dashboard is one stacked column (as before), so a
// widget is as tall as its content instead of a fixed number of rows.
const PHONE_QUERY = '(max-width: 899px)';

function usePhone() {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

// Size menus: the keyboard (and precise) way to resize, next to dragging
// a corner. Widths are columns of the current grid (12, or 18 on a wide
// screen); heights are grid rows.
const FRACTIONS = [[1 / 4, 'Quarter'], [1 / 3, 'Third'], [1 / 2, 'Half'], [2 / 3, 'Two thirds'], [3 / 4, 'Three quarters'], [1, 'Full width']];
function widthOptions(cols) {
  const out = [];
  for (let n = 1; n <= cols; n++) {
    const named = FRACTIONS.find(([f]) => Math.abs(f * cols - n) < 1e-9);
    out.push([n, named ? named[1] : `${n}/${cols}`]);
  }
  return out;
}
const HEIGHTS = [[6, 'Compact'], [9, 'Short'], [12, 'Medium'], [14, 'Tall'], [18, 'Taller'], [24, 'Tallest']];

function SizeSelect({ label, value, options, min, onChange }) {
  const list = options.filter(([n]) => n >= min);
  const known = list.some(([n]) => n === value);
  return (
    <label className="widget-size">
      <span className="visually-hidden">{label}</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
        {!known && <option value={value}>Custom</option>}
        {list.map(([n, text]) => <option key={n} value={n}>{text}</option>)}
      </select>
    </label>
  );
}

// The bar a widget wears while customizing: grab it to move the widget,
// pick a size, or take the widget off the dashboard.
function WidgetBar({ id, widget, item, grid, phone, first, last, onChange, layout, catalog }) {
  return (
    <div className="widget-bar">
      <span className={phone ? 'widget-title' : 'widget-handle'} title={phone ? undefined : 'Drag to move'}>
        {!phone && <span className="grip" aria-hidden="true">⠿</span>}
        {widget.title}
      </span>
      <span className="widget-tools">
        {phone ? (
          <>
            <button type="button" className="btn btn-secondary btn-sm" disabled={first}
                    onClick={() => onChange(moveOnPhone(layout, id, -1))} aria-label={`Move ${widget.title} up`}>↑</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={last}
                    onClick={() => onChange(moveOnPhone(layout, id, 1))} aria-label={`Move ${widget.title} down`}>↓</button>
          </>
        ) : (
          <>
            <SizeSelect label={`${widget.title} width`} value={item.w} options={widthOptions(COLS[grid])} min={widget.min.w}
                        onChange={(w) => onChange(resizeWidget(layout, grid, id, { w }, catalog))} />
            <SizeSelect label={`${widget.title} height`} value={item.h} options={HEIGHTS} min={widget.min.h}
                        onChange={(h) => onChange(resizeWidget(layout, grid, id, { h }, catalog))} />
          </>
        )}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange(removeWidget(layout, id))}
                aria-label={`Remove ${widget.title} from the dashboard`}>Remove</button>
      </span>
    </div>
  );
}

const samePlace = (a, b) => a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export default function DashboardGrid({ layout, catalog, ctx, editing, onChange }) {
  const phone = usePhone();
  // Which grid is showing (12 or 18 columns) - the size menus and the
  // layout being edited follow it.
  // The ref is for onLayoutChange: the grid reports the new breakpoint's
  // layout right after switching, before React has re-rendered.
  const [grid, setGrid] = useState('lg');
  const gridRef = useRef('lg');

  if (phone) {
    const order = [...layout.layouts.sm].sort((a, b) => a.y - b.y).map((it) => it.i).filter((id) => catalog[id]);
    return (
      <div className={`phone-stack${editing ? ' editing' : ''}`}>
        {order.map((id, n) => (
          <div key={id} className="widget">
            {editing && (
              <WidgetBar id={id} widget={catalog[id]} phone first={n === 0} last={n === order.length - 1}
                         layout={layout} catalog={catalog} onChange={onChange} />
            )}
            {/* While customizing on a phone, widgets fold down to their bar
                so the whole order fits on screen. */}
            {!editing && <div className="widget-body">{catalog[id].render(ctx)}</div>}
          </div>
        ))}
      </div>
    );
  }

  const withMins = (items) => items.map((it) => ({ ...it, minW: catalog[it.i].min.w, minH: catalog[it.i].min.h }));
  const layouts = {};
  for (const g of GRIDS) layouts[g] = withMins(layout.layouts[g]);
  const items = layouts[grid] || layouts.lg;

  return (
    <Grid
      className={`dash-grid${editing ? ' editing' : ''}`}
      layouts={layouts}
      breakpoints={BREAKPOINTS}
      cols={COLS}
      rowHeight={ROW_HEIGHT}
      margin={[MARGIN, MARGIN]}
      containerPadding={[0, 0]}
      isDraggable={editing}
      isResizable={editing}
      draggableHandle=".widget-handle"
      resizeHandles={['se', 'e', 's']}
      onBreakpointChange={(bp) => { gridRef.current = bp; setGrid(bp); }}
      onLayoutChange={(current) => {
        // The grid reports a layout on every render too; only an edit in
        // progress, on the grid being shown, should change what's saved.
        if (!editing) return;
        const g = gridRef.current;
        const next = current.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
        const before = layout.layouts[g];
        if (next.every((it) => samePlace(it, before.find((o) => o.i === it.i)))) return;
        onChange({ ...layout, layouts: { ...layout.layouts, [g]: next } });
      }}
    >
      {items.map((item) => (
        <div key={item.i} className="widget">
          {editing && <WidgetBar id={item.i} widget={catalog[item.i]} item={item} grid={grid} layout={layout} catalog={catalog} onChange={onChange} />}
          {/* inert while customizing: a drag that ends on a link shouldn't
              follow it, and Tab should reach the widget tools, not the
              links inside every card. */}
          <div className="widget-body" {...(editing ? { inert: '' } : {})}>{catalog[item.i].render(ctx)}</div>
        </div>
      ))}
    </Grid>
  );
}
