import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { formatMoney, localToday } from '../utils/format.js';
import { monthName, monthShort } from '../utils/payoff.js';

// The payoff plan at a glance: when you'll be debt-free on the plan you
// picked, and which debt is next. The full plan is on the Payoff plan page.
export default function PayoffCard({ profileId, currency }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const money = (v) => formatMoney(v, { currency });

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    setData(null);
    setFailed(false);
    client.get('/payoff', { params: { profileId, today: localToday() } })
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [profileId]);

  const title = (
    <div className="card-title">
      Payoff plan
      <Link to="/payoff">Open</Link>
    </div>
  );

  if (failed) return <div className="card">{title}<div className="empty-state">Couldn't load your payoff plan right now.</div></div>;
  if (!data) return <div className="card">{title}<div className="empty-state">Loading…</div></div>;
  if (data.debts.length === 0) {
    return (
      <div className="card">
        {title}
        <div className="empty-state"><p>No debts in your plan. <Link to="/payoff">Add your loans and cards</Link> to see when you could be debt-free.</p></div>
      </div>
    );
  }

  const plan = data.plans[data.strategy];
  const next = plan.order[0];
  return (
    <div className="card">
      {title}
      <div className="portfolio-total">
        {plan.paidOff
          ? <><b>{monthName(plan.debtFreeMonth)}</b><span>debt-free</span></>
          : <><b className="delta down">Not paid off</b><span>at this rate</span></>}
      </div>
      <ul className="settle-list">
        <li><span>Owed now</span><b>{money(data.totals.balance)}</b></li>
        {plan.paidOff && <li><span>Interest along the way</span><b>{money(plan.totalInterest)}</b></li>}
        {next && <li><span>Next cleared: {next.name}</span><b>{monthShort(next.month)}</b></li>}
      </ul>
    </div>
  );
}
