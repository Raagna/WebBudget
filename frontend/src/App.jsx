import { HashRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { ProfileProvider } from './context/ProfileContext.jsx';
import Layout from './components/Layout.jsx';
import PwaNotices from './components/PwaNotices.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Transactions from './pages/Transactions.jsx';
import Bills from './pages/Bills.jsx';
import Budgets from './pages/Budgets.jsx';
import Reports from './pages/Reports.jsx';
import Investments from './pages/Investments.jsx';
import Debts from './pages/Debts.jsx';
import Goals from './pages/Goals.jsx';
import NetWorth from './pages/NetWorth.jsx';
import Profiles from './pages/Profiles.jsx';
import Settings from './pages/Settings.jsx';

// Wraps every authenticated route ONCE, so ProfileProvider (and its
// profiles list / active-profile state) persists across navigation
// instead of refetching on every page change.
function RequireAuth() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return (
    <ProfileProvider>
      <Layout>
        <Outlet />
      </Layout>
    </ProfileProvider>
  );
}

function PublicOnlyRoute({ children }) {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
          <Route path="/register" element={<PublicOnlyRoute><Register /></PublicOnlyRoute>} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/bills" element={<Bills />} />
            <Route path="/budgets" element={<Budgets />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/investments" element={<Investments />} />
            <Route path="/debts" element={<Debts />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/net-worth" element={<NetWorth />} />
            <Route path="/profiles" element={<Profiles />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <PwaNotices />
      </HashRouter>
    </AuthProvider>
  );
}
