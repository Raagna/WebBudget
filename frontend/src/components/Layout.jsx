import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useProfiles } from '../context/ProfileContext.jsx';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/transactions', label: 'Transactions' },
  { to: '/reports', label: 'Reports' },
  { to: '/profiles', label: 'Profiles' },
  { to: '/settings', label: 'Settings' },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { profiles, activeProfileId, switchProfile, loading, pendingInviteCount } = useProfiles();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">Ledger</span>
        </div>

        {!loading && profiles.length > 0 && (
          <div className="profile-switcher">
            <label htmlFor="profile-select">Budget</label>
            <select
              id="profile-select"
              value={activeProfileId || ''}
              onChange={(e) => switchProfile(Number(e.target.value))}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        <ul className="nav-list">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
              >
                {item.label}
                {item.to === '/profiles' && pendingInviteCount > 0 && (
                  <span className="nav-badge">{pendingInviteCount}</span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="sidebar-footer">
          <div className="user-chip">
            <div>
              <div className="name">{user?.name}</div>
              <div className="email">{user?.email}</div>
            </div>
            <button className="logout-btn" onClick={logout}>Sign out</button>
          </div>
        </div>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
