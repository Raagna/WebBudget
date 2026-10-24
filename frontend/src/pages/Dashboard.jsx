import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useProfiles } from '../context/ProfileContext.jsx';
import { localToday } from '../utils/format.js';
import { WIDGETS } from '../components/dashboard/widgets.jsx';
import { resolveLayout, defaultLayout, addWidget, toSaved } from '../components/dashboard/layout.js';
import DashboardGrid from '../components/dashboard/DashboardGrid.jsx';

// Two layouts are the same when they show the same widgets in the same
// places on every grid; the order things were listed in doesn't matter.
function sameLayout(a, b) {
  const key = (l) => {
    const saved = toSaved(l);
    const byId = (x, y) => x.i.localeCompare(y.i);
    return JSON.stringify({
      widgets: [...saved.widgets].sort(),
      layouts: Object.fromEntries(Object.entries(saved.layouts).sort().map(([g, items]) => [g, [...items].sort(byId)])),
    });
  };
  return key(a) === key(b);
}

export default function Dashboard() {
  const { activeProfileId, activeProfile } = useProfiles();
  const [summary, setSummary] = useState(null);
  const [trends, setTrends] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [error, setError] = useState('');

  // The layout is the user's own (not the profile's), loaded once.
  const [layout, setLayout] = useState(() => defaultLayout(WIDGETS));
  const [draft, setDraft] = useState(null); // non-null while customizing
  const [saving, setSaving] = useState(false);
  const [layoutError, setLayoutError] = useState('');

  // Named layouts. Also the user's own, so every preset is there in every
  // household. `basedOn` is the preset being edited, if any, so it can be
  // updated in place.
  const [presets, setPresets] = useState([]);
  const [basedOn, setBasedOn] = useState(null);
  const [naming, setNaming] = useState(false);
  const [presetName, setPresetName] = useState('');

  const loadPresets = () => client.get('/dashboard/layout/presets')
    .then((res) => setPresets(res.data.presets))
    .catch(() => { /* presets are optional */ });

  useEffect(() => {
    client.get('/dashboard/layout')
      .then((res) => setLayout(resolveLayout(res.data.layout, WIDGETS)))
      .catch(() => { /* keep the default layout */ });
    loadPresets();
  }, []);

  useEffect(() => {
    if (!activeProfileId) return;
    let cancelled = false;
    setError('');
    async function load() {
      try {
        const [summaryRes, trendsRes, budgetsRes] = await Promise.all([
          client.get('/dashboard/summary', { params: { profileId: activeProfileId, today: localToday() } }),
          client.get('/dashboard/trends', { params: { profileId: activeProfileId, months: 9, today: localToday() } }),
          // Budgets are a bonus here: if they fail, still show the dashboard.
          client.get('/budgets', { params: { profileId: activeProfileId, today: localToday() } }).catch(() => null),
        ]);
        if (cancelled) return;
        setSummary(summaryRes.data);
        setTrends(trendsRes.data.trends);
        setBudgets(budgetsRes?.data.budgets || []);
      } catch {
        if (!cancelled) setError('Could not load your dashboard right now. Check your connection and refresh.');
      }
    }
    load();
    return () => { cancelled = true; };
  }, [activeProfileId]);

  async function save(next) {
    setSaving(true);
    setLayoutError('');
    try {
      const res = await client.put('/dashboard/layout', { layout: next ? toSaved(next) : null });
      setLayout(resolveLayout(res.data.layout, WIDGETS));
      setDraft(null);
    } catch {
      setLayoutError('Could not save your layout. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function presetRequest(request, after) {
    setLayoutError('');
    try {
      await request();
      await loadPresets();
      after?.();
    } catch (err) {
      setLayoutError(err.response?.data?.error || 'Could not save the preset. Try again.');
    }
  }

  function savePreset(e) {
    e.preventDefault();
    presetRequest(
      () => client.post('/dashboard/layout/presets', { name: presetName, layout: toSaved(draft) })
        .then((res) => setBasedOn(res.data.preset.id)),
      () => { setNaming(false); setPresetName(''); }
    );
  }

  function deletePreset(p) {
    if (!confirm(`Delete the "${p.name}" preset? Your current layout stays as it is.`)) return;
    presetRequest(() => client.delete(`/dashboard/layout/presets/${p.id}`), () => { if (basedOn === p.id) setBasedOn(null); });
  }

  if (error) return <div className="empty-state">{error}</div>;
  if (!summary) return <div className="empty-state">Loading your dashboard…</div>;

  const safe = summary.safeToSpend;
  const currency = activeProfile?.currency || 'USD';
  const monthName = new Date(`${summary.month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const editing = draft !== null;
  const shown = editing ? draft : layout;
  const hidden = Object.keys(WIDGETS).filter((id) => !shown.widgets.includes(id));
  const ctx = { summary, trends, budgets, currency, profileId: activeProfileId };
  // A preset is "active" when the layout matches it exactly - nothing
  // extra to store or keep in sync.
  const presetLayout = (p) => resolveLayout(p.layout, WIDGETS);
  const activePreset = presets.find((p) => sameLayout(presetLayout(p), layout));
  const draftMatches = editing ? presets.find((p) => sameLayout(presetLayout(p), draft)) : null;
  const editingPreset = presets.find((p) => p.id === basedOn);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{monthName}</h1>
          <div className="subtitle">
            {activeProfile?.name}{safe ? ` · ${safe.daysLeft} day${safe.daysLeft === 1 ? '' : 's'} left this month` : ''}
          </div>
        </div>
        {!editing && (
          <div className="header-actions">
            {presets.length > 0 && (
              <select className="preset-picker" aria-label="Dashboard layout" value={activePreset?.id ?? ''} disabled={saving}
                      onChange={(e) => {
                        const p = presets.find((x) => String(x.id) === e.target.value);
                        if (p) save(presetLayout(p));
                      }}>
                {!activePreset && <option value="">Custom layout</option>}
                {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => {
              setLayoutError('');
              setBasedOn(activePreset?.id ?? null);
              setNaming(false);
              setDraft(layout);
            }}>
              Customize
            </button>
            <Link to="/transactions?add=1" className="btn btn-primary">Add or scan a transaction</Link>
          </div>
        )}
      </div>

      {editing && (
        <div className="edit-bar" role="region" aria-label="Customize dashboard">
          <p>
            <strong>Customizing.</strong>{' '}
            <span className="edit-hint-wide">Drag a widget by its bar to move it anywhere, and drag its edge or corner to resize it.</span>
            <span className="edit-hint-phone">Move widgets up or down. Wider screens can also place them side by side and resize them.</span>
          </p>
          <div className="edit-actions">
            <select value="" disabled={hidden.length === 0} aria-label="Add a widget"
                    onChange={(e) => e.target.value && setDraft(addWidget(draft, e.target.value, WIDGETS))}>
              <option value="">{hidden.length ? 'Add a widget…' : 'All widgets shown'}</option>
              {hidden.map((id) => <option key={id} value={id}>{WIDGETS[id].title}</option>)}
            </select>
            <button type="button" className="btn btn-secondary" onClick={() => setDraft(defaultLayout(WIDGETS))}>Reset to default</button>
            <button type="button" className="btn btn-secondary" onClick={() => setDraft(null)} disabled={saving}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={() => save(draft)} disabled={saving}>
              {saving ? 'Saving…' : 'Done'}
            </button>
          </div>
          <div className="edit-actions preset-row">
            <span className="preset-label">Presets</span>
            {presets.length > 0 && (
              <select value="" aria-label="Load a preset" onChange={(e) => {
                const p = presets.find((x) => String(x.id) === e.target.value);
                if (p) { setDraft(presetLayout(p)); setBasedOn(p.id); }
              }}>
                <option value="">Load a preset…</option>
                {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            {editingPreset && !draftMatches && (
              <button type="button" className="btn btn-secondary"
                      onClick={() => presetRequest(() => client.put(`/dashboard/layout/presets/${editingPreset.id}`, { layout: toSaved(draft) }))}>
                Update “{editingPreset.name}”
              </button>
            )}
            {naming ? (
              <form className="inline-field" onSubmit={savePreset}>
                <input autoFocus value={presetName} maxLength={40} placeholder="e.g. Investing" aria-label="Preset name"
                       onChange={(e) => setPresetName(e.target.value)} />
                <button type="submit" className="btn btn-primary btn-sm" disabled={!presetName.trim()}>Save preset</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNaming(false)}>Cancel</button>
              </form>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={() => setNaming(true)}>Save as new preset…</button>
            )}
            {draftMatches && <span className="fine-print" style={{ margin: 0 }}>This is your “{draftMatches.name}” preset.</span>}
          </div>
          {presets.length > 0 && (
            <div className="chip-row preset-chips">
              {presets.map((p) => (
                <span key={p.id} className="tag">
                  {p.name}
                  <button type="button" className="chip-x" onClick={() => deletePreset(p)} aria-label={`Delete the ${p.name} preset`}>×</button>
                </span>
              ))}
            </div>
          )}
          {layoutError && <div className="auth-error" style={{ marginTop: 10 }}>{layoutError}</div>}
        </div>
      )}

      {shown.widgets.length === 0 ? (
        <div className="empty-state">
          <h3>Your dashboard is empty</h3>
          <p>{editing ? 'Pick a widget from “Add a widget” above.' : <>Use <strong>Customize</strong> to add widgets back.</>}</p>
        </div>
      ) : (
        <DashboardGrid layout={shown} catalog={WIDGETS} ctx={ctx} editing={editing} onChange={setDraft} />
      )}
    </div>
  );
}
