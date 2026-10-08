import { useEffect, useState } from 'react';
import { session, setUnauthorizedHandler } from './api.js';
import Login from './pages/Login.jsx';
import StaffHome from './pages/StaffHome.jsx';
import StaffReport from './pages/StaffReport.jsx';
import Admin from './pages/Admin.jsx';

export default function App() {
  const [auth, setAuth] = useState(() => session.get());
  const [view, setView] = useState('home');

  const logout = () => {
    session.clear();
    setAuth(null);
    setView('home');
  };
  useEffect(() => setUnauthorizedHandler(logout), []);

  if (!auth) {
    return (
      <Login
        onLogin={(s) => {
          session.set(s);
          setAuth(s);
        }}
      />
    );
  }
  const isAdmin = auth.user.role === 'admin';
  return view === 'admin' && isAdmin ? (
    <Admin onBack={() => setView('home')} />
  ) : view === 'report' ? (
    <StaffReport user={auth.user} onBack={() => setView('home')} />
  ) : (
    <StaffHome user={auth.user} onOpenReport={() => setView('report')} onOpenAdmin={isAdmin ? () => setView('admin') : undefined} onLogout={logout} />
  );
}
