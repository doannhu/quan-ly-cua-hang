import { useEffect, useState } from 'react';
import { session, setUnauthorizedHandler } from './api.js';
import Login from './pages/Login.jsx';
import StaffHome from './pages/StaffHome.jsx';
import StaffReport from './pages/StaffReport.jsx';
import MyReports from './pages/MyReports.jsx';
import Admin from './pages/Admin.jsx';

export default function App() {
  const [auth, setAuth] = useState(() => session.get());
  // home | report | mine | edit | admin
  const [view, setView] = useState('home');
  const [editing, setEditing] = useState(null);

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
  const home = () => setView('home');
  const mine = () => setView('mine');
  const edit = (s) => { setEditing(s); setView('edit'); };

  if (view === 'admin' && isAdmin) return <Admin onBack={home} />;
  if (view === 'report') return <StaffReport user={auth.user} onBack={home} onOpenMine={mine} onEdit={edit} />;
  if (view === 'mine')
    return <MyReports onBack={home} onEdit={edit} />;
  if (view === 'edit' && editing)
    return <StaffReport key={editing.submissionId} user={auth.user} editing={editing} onBack={mine} />;
  return (
    <StaffHome
      user={auth.user}
      onOpenReport={() => setView('report')}
      onOpenMine={mine}
      onOpenAdmin={isAdmin ? () => setView('admin') : undefined}
      onLogout={logout}
    />
  );
}
