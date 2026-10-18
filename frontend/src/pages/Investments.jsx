import { useCallback, useEffect, useRef, useState } from 'react';
import client from '../api/client';
import { useProfiles } from '../context/ProfileContext.jsx';
import { formatMoney } from '../utils/format.js';
import Delta from '../components/Delta.jsx';

const EMPTY_FORM = { symbol: '', shares: '', account: '', bookCost: '' };

function sharesText(n) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function asOfText(asOf, stale) {
  if (!asOf) return '';
  // The market's own time, so over a weekend it says Friday's close.
  const d = new Date(asOf);
  const today = d.toDateString() === new Date().toDateString();
  const t = d.toLocaleString(undefined, today
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return stale ? `Couldn't refresh prices; showing the last ones, from ${t}` : `Prices as of ${t}`;
}

function whenText(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const SOURCE_TEXT = { wealthsimple_csv: 'imported Wealthsimple report', snaptrade: 'SnapTrade sync' };

// What an import or sync did, as one sentence plus the rows it skipped.
function ResultCard({ result, onDismiss }) {
  return (
    <div className="card" style={{ marginBottom: 20, borderColor: result.error ? 'var(--brick)' : 'var(--line)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          {result.error ? (
            <p style={{ color: 'var(--brick)', margin: 0 }}>{result.error}</p>
          ) : (
            <>
              <p style={{ margin: 0 }}>
                {result.kind === 'snaptrade' ? 'Synced' : 'Imported'} <strong>{result.imported}</strong> holding{result.imported === 1 ? '' : 's'} in{' '}
                {result.accounts.length} account{result.accounts.length === 1 ? '' : 's'}
                {result.accounts.length > 0 && ` (${result.accounts.map((a) => a.label).join(', ')})`}.
                {result.removed > 0 && ` Replaced ${result.removed} from before.`}
                {result.skipped.length > 0 && ` ${result.skipped.length} skipped.`}
              </p>
              {(result.skipped.length > 0 || result.unpriced.length > 0 || result.broken?.length > 0) && (
                <ul style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8, paddingLeft: 18 }}>
                  {result.broken?.map((b) => <li key={b}>{b} needs reconnecting in SnapTrade; these are its last known positions.</li>)}
                  {result.unpriced.length > 0 && <li>No Yahoo price for {result.unpriced.join(', ')}: saved, but left out of the total.</li>}
                  {result.skipped.map((x, i) => <li key={i}>{x.row ? `Row ${x.row}: ` : x.account ? `${x.account}: ` : ''}{x.reason}</li>)}
                </ul>
              )}
            </>
          )}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}

export default function Investments() {
  const { activeProfileId, activeProfile } = useProfiles();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(''); // 'import' | 'sync' while one runs
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    if (!activeProfileId) return;
    try {
      const res = await client.get('/investments', { params: { profileId: activeProfileId } });
      setData(res.data);
      setError('');
    } catch {
      setError('Could not load your investments right now.');
    }
  }, [activeProfileId]);

  useEffect(() => { setData(null); setEditingId(null); setForm(EMPTY_FORM); setResult(null); load(); }, [load]);

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // so the same file can be picked again
    if (!file) return;
    setBusy('import');
    setResult(null);
    try {
      const csv = await file.text();
      const { data: r } = await client.post('/investments/import', { profileId: activeProfileId, csv });
      setResult({ ...r, kind: 'wealthsimple_csv' });
      await load();
    } catch (err) {
      setResult({ error: err.response?.data?.error || 'Could not import this file.' });
    } finally {
      setBusy('');
    }
  }

  async function handleSync() {
    setBusy('sync');
    setResult(null);
    try {
      const { data: r } = await client.post('/investments/snaptrade/sync', { profileId: activeProfileId });
      setResult({ ...r, kind: 'snaptrade' });
      await load();
    } catch (err) {
      setResult({ error: err.response?.data?.error || 'Could not sync with SnapTrade right now.' });
    } finally {
      setBusy('');
    }
  }

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    const shares = Number(form.shares);
    if (!editingId && !form.symbol.trim()) { setError('Enter a symbol, e.g. XEQT.TO or AAPL.'); return; }
    if (!shares || shares <= 0) { setError('Enter how many shares you hold.'); return; }
    const bookCost = form.bookCost === '' ? null : Number(form.bookCost);
    if (bookCost !== null && !(bookCost >= 0)) { setError('Book cost must be zero or more, or left blank.'); return; }
    setSaving(true);
    try {
      const body = { shares, account: form.account, bookCost };
      if (editingId) await client.put(`/investments/${editingId}`, body);
      else await client.post('/investments', { ...body, profileId: activeProfileId, symbol: form.symbol });
      setForm(EMPTY_FORM);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this holding.');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(h) {
    setEditingId(h.id);
    setForm({ symbol: h.symbol, shares: String(h.shares), account: h.account, bookCost: h.bookCost === null ? '' : String(h.bookCost) });
    setError('');
    document.getElementById('holding-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function handleRemove(h) {
    const comesBack = h.source !== 'manual' ? `\n\nIt comes back with the next ${SOURCE_TEXT[h.source]} if you still hold it.` : '';
    if (!confirm(`Remove ${h.symbol}${h.account ? ` (${h.account})` : ''} from your investments?${comesBack}`)) return;
    try {
      await client.delete(`/investments/${h.id}`);
      await load();
    } catch {
      setError('Could not remove this holding.');
    }
  }

  if (!data) return <div className="empty-state">{error || 'Loading your investments…'}</div>;

  const currency = data.currency || activeProfile?.currency || 'USD';
  const money = (v) => formatMoney(v, { currency });
  const { totals, holdings } = data;
  const sources = data.sources || {};
  const snap = sources.snaptrade || {};
  const imported = sources.wealthsimpleCsv;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Investments</h1>
          <div className="subtitle">
            Stocks, ETFs and funds{activeProfile ? ` for ${activeProfile.name}` : ''}
            {data.asOf && ` · ${asOfText(data.asOf, data.stale)}`}
          </div>
        </div>
        <div className="header-actions">
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleFileSelected} />
          <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={!!busy}
                  title="Wealthsimple > Documents > Holdings report (CSV)">
            {busy === 'import' ? 'Importing…' : 'Import Wealthsimple report'}
          </button>
          {snap.available && (
            <button className="btn btn-secondary" onClick={handleSync} disabled={!!busy}>
              {busy === 'sync' ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 14 }}>{error}</div>}
      {result && <ResultCard result={result} onDismiss={() => setResult(null)} />}

      {holdings.length > 0 && (
        <p className="budget-summary">
          <span><b>{money(totals.value)}</b>total value</span>
          <span><b><Delta value={totals.dayChange} currency={currency} /></b>today</span>
          {totals.gain !== null && (
            <span>
              <b><Delta value={totals.gain} currency={currency} /></b>gain
              <span className="change">on {money(totals.bookCost)} book cost</span>
            </span>
          )}
        </p>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">Holdings</div>
        {holdings.length === 0 ? (
          <div className="empty-state">
            <h3>No holdings yet</h3>
            <p>Import a Wealthsimple holdings report, or add what you hold at any brokerage below, and its value updates with the market.</p>
          </div>
        ) : (
          <table className="ledger stack">
            <thead>
              <tr>
                <th>Holding</th><th>Account</th><th>Shares</th><th>Price</th>
                <th style={{ textAlign: 'right' }}>Value</th><th>Today</th><th>Gain</th>
                <th><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <tr key={h.id}>
                  <td className="col-desc">
                    {h.symbol}
                    {h.name !== h.symbol && <span className="holding-name">{h.name}</span>}
                  </td>
                  <td className="col-by">{h.account}</td>
                  <td className="col-date">{sharesText(h.shares)} sh</td>
                  <td className="col-date">{h.price === null ? 'No price' : formatMoney(h.price, { currency: h.currency })}</td>
                  <td className="amount col-amount">{h.value === null ? '—' : money(h.value)}</td>
                  <td className="col-rec"><Delta value={h.dayChange} currency={currency} /></td>
                  <td className="col-status">{h.gain === null ? '' : <Delta value={h.gain} currency={currency} suffix=" gain" />}</td>
                  <td className="col-actions" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {h.source === 'manual' && <><button className="btn btn-secondary btn-sm" onClick={() => startEdit(h)}>Edit</button>{' '}</>}
                    <button className="btn btn-danger btn-sm" onClick={() => handleRemove(h)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {totals.unpriced > 0 && (
          <p className="fine-print">{totals.unpriced} holding{totals.unpriced === 1 ? " couldn't" : "s couldn't"} be priced right now and {totals.unpriced === 1 ? "isn't" : "aren't"} in the total.</p>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">From Wealthsimple</div>
        <p style={{ margin: 0 }}>
          {snap.available
            ? <>Synced through SnapTrade once a day{snap.last ? `, last ${whenText(snap.last.syncedAt)}` : ''}. Press <b>Sync now</b> after you trade.</>
            : <>In Wealthsimple on the web, open <b>Documents</b>, choose <b>Holdings report (CSV)</b>, pick your accounts and download it. Then press <b>Import Wealthsimple report</b>.</>}
        </p>
        <p className="fine-print">
          Each account in a report or sync replaces what came in for it last time, so sold positions drop off. Holdings you add by hand are never changed.
          {imported && ` Last report imported ${whenText(imported.syncedAt)}${imported.asOf ? `, as of ${new Date(imported.asOf).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}.`}
          {snap.reason === 'not_configured' && ' To sync automatically instead, connect Wealthsimple to a free SnapTrade Personal key and add it to the server settings (see backend/.env.example).'}
          {snap.reason === 'no_owner' && " A SnapTrade key is set on the server, but SNAPTRADE_OWNER_EMAIL isn't, so nobody can sync with it yet."}
        </p>
      </div>

      <form className="card" id="holding-form" onSubmit={handleSubmit}>
        <div className="card-title">{editingId ? `Edit ${form.symbol}` : 'Add a holding'}</div>
        <div className="filter-bar" style={{ marginBottom: 0 }}>
          <div className="form-field">
            <label htmlFor="holding-symbol">Symbol</label>
            <input id="holding-symbol" value={form.symbol} onChange={set('symbol')} placeholder="e.g. XEQT.TO"
                   disabled={!!editingId} autoCapitalize="characters" spellCheck={false} />
          </div>
          <div className="form-field">
            <label htmlFor="holding-shares">Shares</label>
            <input id="holding-shares" type="number" min="0" step="any" value={form.shares} onChange={set('shares')} placeholder="e.g. 12.5" />
          </div>
          <div className="form-field">
            <label htmlFor="holding-account">Account (optional)</label>
            <input id="holding-account" value={form.account} onChange={set('account')} placeholder="e.g. Wealthsimple TFSA" maxLength={80} />
          </div>
          <div className="form-field">
            <label htmlFor="holding-cost">Book cost, {currency} (optional)</label>
            <input id="holding-cost" type="number" min="0" step="0.01" value={form.bookCost} onChange={set('bookCost')} placeholder="Total you paid" />
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving}>{editingId ? 'Save' : 'Add holding'}</button>
          {editingId && (
            <button type="button" className="btn btn-secondary" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }}>Cancel</button>
          )}
        </div>
        <p className="fine-print">
          Symbols as Yahoo Finance shows them: US stocks as is (AAPL), Toronto listings end in .TO (XEQT.TO), crypto like BTC-CAD.
          Prices come from Yahoo Finance, delayed about 15 minutes, and are converted to {currency}.
        </p>
      </form>
    </div>
  );
}
