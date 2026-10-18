import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { formatMoney } from '../utils/format.js';
import Delta from './Delta.jsx';

// Portfolio value on the dashboard. Loads on its own, after the rest of
// the dashboard, so a slow price source never holds up Safe to spend.
export default function InvestmentsCard({ profileId }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    setData(null);
    setFailed(false);
    client.get('/investments', { params: { profileId } })
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [profileId]);

  const title = (
    <div className="card-title">
      Investments
      <Link to="/investments">{data?.holdings.length ? 'See all' : 'Add holdings'}</Link>
    </div>
  );

  if (failed) return <div className="card">{title}<div className="empty-state">Couldn't load your investments right now.</div></div>;
  if (!data) return <div className="card">{title}<div className="empty-state">Loading prices…</div></div>;

  if (data.holdings.length === 0) {
    return (
      <div className="card">
        {title}
        <div className="empty-state">
          <p>Track what you hold at Wealthsimple or another brokerage, valued at today's prices.</p>
        </div>
      </div>
    );
  }

  const { currency, totals } = data;
  // The biggest few by value; the page has the rest.
  const top = [...data.holdings].filter((h) => h.value !== null).sort((a, b) => b.value - a.value).slice(0, 4);
  return (
    <div className="card">
      {title}
      <div className="portfolio-total">
        <b>{formatMoney(totals.value, { currency })}</b>
        <span><Delta value={totals.dayChange} currency={currency} /> today</span>
      </div>
      <ul className="holding-list">
        {top.map((h) => (
          <li key={h.id}>
            <span className="sym">{h.symbol}<small>{h.account || h.name}</small></span>
            <span className="val">{formatMoney(h.value, { currency })}<Delta value={h.dayChange} currency={currency} /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
