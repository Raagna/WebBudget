import { useCallback, useEffect, useState } from 'react';
import client from '../api/client';
import { timeAgo } from '../utils/format.js';

// Finance subreddits offered when nothing is followed yet.
const SUGGESTED = ['PersonalFinanceCanada', 'CanadianInvestor', 'personalfinance', 'investing'];

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

function PostMeta({ post, showSub = true }) {
  const parts = [];
  if (showSub && post.subreddit) parts.push(`r/${post.subreddit}`);
  if (post.score !== null && post.score !== undefined) parts.push(`${compact.format(post.score)} upvotes`);
  if (post.comments !== null && post.comments !== undefined) parts.push(`${compact.format(post.comments)} comments`);
  if (post.createdAt) parts.push(timeAgo(post.createdAt));
  if (post.unavailable) parts.push("couldn't refresh");
  return <span className="news-meta">{parts.join(' · ')}</span>;
}

// Threads from the subreddits the user follows, ranked by upvotes and
// recency together, plus threads they follow on their own. The list of
// what's followed is edited right here, under "Manage".
export default function RedditCard() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [managing, setManaging] = useState(false);
  const [subInput, setSubInput] = useState('');
  const [threadInput, setThreadInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await client.get('/reddit');
      setData(res.data);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function follow(body, reset) {
    setBusy(true);
    setError('');
    try {
      await client.post('/reddit/follows', body);
      reset?.();
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add that.');
    } finally {
      setBusy(false);
    }
  }

  async function unfollow(id) {
    setError('');
    try {
      await client.delete(`/reddit/follows/${id}`);
      await load();
    } catch {
      setError('Could not remove that.');
    }
  }

  const title = (
    <div className="card-title">
      Reddit
      {data && (
        <button type="button" className="link-button" onClick={() => { setManaging((m) => !m); setError(''); }} aria-expanded={managing}>
          {managing ? 'Done' : 'Manage'}
        </button>
      )}
    </div>
  );

  if (failed) return <div className="card">{title}<div className="empty-state">Couldn't load Reddit right now.</div></div>;
  if (!data) return <div className="card">{title}<div className="empty-state">Loading threads…</div></div>;

  const nothingFollowed = data.subreddits.length === 0 && data.threads.length === 0;

  return (
    <div className="card">
      {title}
      {error && <div className="auth-error" style={{ marginBottom: 10 }}>{error}</div>}

      {(managing || nothingFollowed) && (
        <div className="reddit-manage">
          <form onSubmit={(e) => { e.preventDefault(); if (subInput.trim()) follow({ subreddit: subInput }, () => setSubInput('')); }}>
            <label htmlFor="reddit-sub">Follow a subreddit</label>
            <div className="inline-field">
              <input id="reddit-sub" value={subInput} onChange={(e) => setSubInput(e.target.value)} placeholder="e.g. PersonalFinanceCanada" spellCheck={false} />
              <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>Add</button>
            </div>
          </form>
          {nothingFollowed && (
            <div className="chip-row">
              {SUGGESTED.map((s) => (
                <button key={s} type="button" className="tag" onClick={() => follow({ subreddit: s })} disabled={busy}>+ r/{s}</button>
              ))}
            </div>
          )}
          {data.subreddits.length > 0 && (
            <div className="chip-row">
              {data.subreddits.map((s) => (
                <span key={s.id} className="tag">
                  r/{s.name}
                  <button type="button" className="chip-x" onClick={() => unfollow(s.id)} aria-label={`Stop following r/${s.name}`}>×</button>
                </span>
              ))}
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); if (threadInput.trim()) follow({ thread: threadInput }, () => setThreadInput('')); }}>
            <label htmlFor="reddit-thread">Follow a thread</label>
            <div className="inline-field">
              <input id="reddit-thread" value={threadInput} onChange={(e) => setThreadInput(e.target.value)} placeholder="Paste a thread link" spellCheck={false} />
              <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>Add</button>
            </div>
          </form>
        </div>
      )}

      {data.threads.length > 0 && (
        <>
          <h3 className="reddit-heading">Threads you follow</h3>
          <ul className="news-list">
            {data.threads.map((t) => (
              <li key={t.followId} className="reddit-item">
                <span>
                  <a href={t.link} target="_blank" rel="noopener noreferrer">{t.title}</a>
                  <PostMeta post={t} />
                </span>
                {managing && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => unfollow(t.followId)}>Unfollow</button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {data.subreddits.length > 0 && (
        <>
          <h3 className="reddit-heading">Popular now in your subreddits</h3>
          {data.trending.length === 0 ? (
            <p className="fine-print" style={{ marginTop: 0 }}>No threads to show yet.</p>
          ) : (
            <ul className="news-list">
              {data.trending.map((p) => (
                <li key={p.id}>
                  <a href={p.link} target="_blank" rel="noopener noreferrer">{p.title}</a>
                  <PostMeta post={p} showSub={data.subreddits.length > 1} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {data.problems.length > 0 && <p className="fine-print">{data.problems.join(' ')}</p>}
      {data.mode === 'rss' && !nothingFollowed && (
        <p className="fine-print">
          Ranked by Reddit’s top list and how recent each thread is. Upvote and comment counts appear once a Reddit app key is set up on the server.
        </p>
      )}
    </div>
  );
}
