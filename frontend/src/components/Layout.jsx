import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
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
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Close the mobile menu automatically whenever the route changes, so
  // tapping a nav link doesn't leave the overlay sitting open on top of
  // the new page.
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  return (
    <div className="app-shell">
      <aside className={'sidebar' + (menuOpen ? ' menu-open' : '')}>
        <div className="sidebar-topbar">
          <div className="sidebar-brand">
            <span className="brand-mark">Ledger</span>
          </div>
          <button
            type="button"
            className="menu-toggle"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="menu-toggle-bar" />
            <span className="menu-toggle-bar" />
            <span className="menu-toggle-bar" />
            {!menuOpen && pendingInviteCount > 0 && <span className="menu-toggle-badge">{pendingInviteCount}</span>}
          </button>
        </div>

        <div className="sidebar-collapsible">
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
              <div className="user-chip-text">
                <div className="name">{user?.name}</div>
                <div className="email" title={user?.email}>{user?.email}</div>
              </div>
              <button className="logout-btn" onClick={logout}>Sign out</button>
            </div>
          </div>
        </div>
      </aside>

      {/* Tapping outside the open mobile menu closes it, same as most
          slide-out nav patterns. Only rendered (and only intercepts
          clicks) while the menu is actually open. */}
      {menuOpen && <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />}

      <main className="main-content">{children}</main>
    </div>
  );
}
