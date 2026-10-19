import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext.jsx';
import { APP_NAME } from '../brand.js';
import { passwordProblem, MIN_PASSWORD_LENGTH } from '../utils/password.js';

// Opened from the emailed link: #/reset-password?token=...
export default function ResetPassword() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const token = useSearchParams()[0].get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const problem = passwordProblem(password);
    if (problem) { setError(problem); return; }
    if (password !== confirmPassword) { setError('The two passwords don’t match.'); return; }
    setLoading(true);
    try {
      await client.post('/auth/reset-password', { token, password });
      // Every session was just signed out on the server, this browser's
      // included - drop it here too so the login page doesn't bounce.
      logout();
      navigate('/login', { replace: true, state: { notice: 'Password changed. Sign in with your new password.' } });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reset your password.');
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="card auth-card">
        <div className="auth-brand"><span className="brand-mark" aria-hidden="true" />{APP_NAME}</div>
        <h1>Choose a new password</h1>
        {!token ? (
          <>
            <div className="auth-error">This link is missing its reset code. Open the link from the email again, or ask for a new one.</div>
            <div className="auth-switch"><Link to="/forgot-password">Ask for a new link</Link></div>
          </>
        ) : (
          <>
            <p className="subtitle">This also signs you out on every device.</p>
            {error && <div className="auth-error">{error}</div>}
            <form className="auth-form" onSubmit={handleSubmit}>
              <div className="form-field">
                <label htmlFor="new-password">New password</label>
                <input id="new-password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="form-field">
                <label htmlFor="confirm-password">Confirm new password</label>
                <input id="confirm-password" type="password" required autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </div>
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? 'Saving…' : 'Set new password'}
              </button>
            </form>
            <div className="auth-switch">
              Link expired? <Link to="/forgot-password">Ask for a new one</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
