import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { formatMoney } from '../utils/format.js';

// The household tab at a glance: where you stand, and who should pay
// whom to square up. The full tab is on the Debts page.
export default function DebtsCard({ profileId, currency }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const money = (v) => formatMoney(v, { currency });

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    setData(null);
    setFailed(false);
    client.get('/debts', { params: { profileId } })
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [profileId]);

  const title = (
    <div className="card-title">
      Who owes what
      <Link to="/debts">Open</Link>
    </div>
  );

  if (failed) return <div className="card">{title}<div className="empty-state">Couldn't load the tab right now.</div></div>;
  if (!data) return <div className="card">{title}<div className="empty-state">Loading…</div></div>;
  if (data.members.length < 2) {
    return (
      <div className="card">
        {title}
        <div className="empty-state"><p>Only you are in this budget. Switch to a household to keep a tab together.</p></div>
      </div>
    );
  }

  const { you, yourNet } = data;
  return (
    <div className="card">
      {title}
      <div className="portfolio-total">
        {yourNet === 0 ? <b>All square</b> : <b className={`delta ${yourNet > 0 ? 'up' : 'down'}`}>{money(Math.abs(yourNet))}</b>}
        <span>{yourNet > 0 ? 'owed to you' : yourNet < 0 ? 'you owe' : ''}</span>
      </div>
      {data.settleUp.length > 0 && (
        <ul className="settle-list">
          {data.settleUp.slice(0, 5).map((p) => (
            <li key={`${p.from}-${p.to}`}>
              <span>
                {p.from === you ? 'You' : p.fromName} → {p.to === you ? 'you' : p.toName}
              </span>
              <b>{money(p.amount)}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
