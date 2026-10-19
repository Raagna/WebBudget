import { useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { APP_NAME } from '../brand.js';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // The server answers the same for every email, so this message never
      // says whether the address has an account.
      const { data } = await client.post('/auth/forgot-password', { email });
      setSent(data.message);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="card auth-card">
        <div className="auth-brand"><span className="brand-mark" aria-hidden="true" />{APP_NAME}</div>
        <h1>Reset your password</h1>
        <p className="subtitle">We'll send a link to choose a new one. It works once, for an hour.</p>
        {error && <div className="auth-error">{error}</div>}
        {sent ? (
          <div className="auth-notice" role="status">{sent}</div>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="form-field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}
        <div className="auth-switch">
          Remembered it? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
