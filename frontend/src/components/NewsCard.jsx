import { useEffect, useState } from 'react';
import client from '../api/client';

// All the API sends (up to 12): a taller widget shows more of them, and
// the rest scroll inside it.
const SHOWN = 12;

function ago(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// General financial headlines. Quiet on purpose: a short list that links
// out, secondary to the money on the rest of the dashboard. It's a
// widget the user placed, so it keeps its spot (with a short note) even
// when the news can't load.
export default function NewsCard() {
  const [items, setItems] = useState(null);

  useEffect(() => {
    let cancelled = false;
    client.get('/news')
      .then((res) => { if (!cancelled) setItems(res.data.items); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="card">
      <div className="card-title">Financial news</div>
      {items === null ? (
        <div className="empty-state">Loading headlines…</div>
      ) : items.length === 0 ? (
        <div className="empty-state">No headlines right now. Check back later.</div>
      ) : (
        <ul className="news-list">
          {items.slice(0, SHOWN).map((n) => (
            <li key={n.link}>
              <a href={n.link} target="_blank" rel="noopener noreferrer">{n.title}</a>
              <span className="news-meta">{n.source}{n.publishedAt ? ` · ${ago(n.publishedAt)}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
