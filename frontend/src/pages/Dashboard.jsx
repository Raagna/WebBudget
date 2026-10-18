import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useProfiles } from '../context/ProfileContext.jsx';
import { localToday } from '../utils/format.js';
import { WIDGETS } from '../components/dashboard/widgets.jsx';
import { resolveLayout, defaultLayout, addWidget, toSaved } from '../components/dashboard/layout.js';
import DashboardGrid from '../components/dashboard/DashboardGrid.jsx';

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

  useEffect(() => {
    client.get('/dashboard/layout')
      .then((res) => setLayout(resolveLayout(res.data.layout, WIDGETS)))
      .catch(() => { /* keep the default layout */ });
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

  if (error) return <div className="empty-state">{error}</div>;
  if (!summary) return <div className="empty-state">Loading your dashboard…</div>;

  const safe = summary.safeToSpend;
  const currency = activeProfile?.currency || 'USD';
  const monthName = new Date(`${summary.month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const editing = draft !== null;
  const shown = editing ? draft : layout;
  const hidden = Object.keys(WIDGETS).filter((id) => !shown.widgets.includes(id));
  const ctx = { summary, trends, budgets, currency, profileId: activeProfileId };

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
            <button type="button" className="btn btn-secondary" onClick={() => { setLayoutError(''); setDraft(layout); }}>
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
