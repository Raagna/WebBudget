import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { formatMoney, localToday } from '../utils/format.js';
import Delta from './Delta.jsx';

// Net worth at a glance: the figure, its change since last month, and
// what's owned versus owed. The accounts behind it are on the Net worth page.
export function NetWorthCard({ profileId }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    setData(null);
    setFailed(false);
    client.get('/networth', { params: { profileId, today: localToday() } })
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [profileId]);

  const title = <div className="card-title">Net worth<Link to="/net-worth">Open</Link></div>;
  if (failed) return <div className="card">{title}<div className="empty-state">Couldn't load your net worth right now.</div></div>;
  if (!data) return <div className="card">{title}<div className="empty-state">Loading…</div></div>;
  if (data.accounts.length === 0 && data.investments === null) {
    return <div className="card">{title}<div className="empty-state"><p>Add your accounts, cards and loans to see what you’re worth. <Link to="/net-worth">Add an account</Link></p></div></div>;
  }
  const money = (v) => formatMoney(v, { currency: data.currency });
  return (
    <div className="card">
      {title}
      <div className="portfolio-total">
        <b className={data.totals.netWorth < 0 ? 'delta down' : ''}>{money(data.totals.netWorth)}</b>
        {data.changeSinceLastMonth !== null && <span><Delta value={data.changeSinceLastMonth} currency={data.currency} /> this month</span>}
      </div>
      <ul className="settle-list">
        <li><span>Owned</span><b>{money(data.totals.assets)}</b></li>
        <li><span>Owed</span><b>{money(data.totals.debts)}</b></li>
      </ul>
    </div>
  );
}

// Savings goals at a glance: each goal's progress bar.
export function GoalsCard({ profileId, currency }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    setData(null);
    setFailed(false);
    client.get('/goals', { params: { profileId, today: localToday() } })
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [profileId]);

  const title = <div className="card-title">Savings goals<Link to="/goals">Open</Link></div>;
  if (failed) return <div className="card">{title}<div className="empty-state">Couldn't load your goals right now.</div></div>;
  if (!data) return <div className="card">{title}<div className="empty-state">Loading…</div></div>;
  if (data.goals.length === 0) {
    return <div className="card">{title}<div className="empty-state"><p>Saving for something? <Link to="/goals">Add a goal</Link> and see how much to put aside each month.</p></div></div>;
  }
  const money = (v) => formatMoney(v, { currency });
  return (
    <div className="card">
      {title}
      <ul className="budget-list">
        {data.goals.map((g) => (
          <li key={g.id}>
            <div className="acct-row"><span>{g.name}</span><span className="news-meta" style={{ margin: 0 }}>{money(g.saved)} of {money(g.target)}</span></div>
            <div className="progress"><span style={{ width: `${g.percent}%`, background: 'var(--accent)' }} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}
