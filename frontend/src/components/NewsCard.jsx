import { useEffect, useState } from 'react';
import client from '../api/client';
import { timeAgo } from '../utils/format.js';

// All the API sends (up to 12): a taller widget shows more of them, and
// the rest scroll inside it.
const SHOWN = 12;

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
              <span className="news-meta">{n.source}{n.publishedAt ? ` · ${timeAgo(n.publishedAt)}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
