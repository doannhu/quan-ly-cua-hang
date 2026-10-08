import { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onLogin }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onLogin(await api.post('/auth/login', { name, password }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page login">
      <img className="logo" src="/logo.png" alt="Logo" />
      <h1 className="center">Quản lý cửa hàng</h1>
      <p className="muted center">Đăng nhập để tiếp tục</p>
      <form onSubmit={submit}>
        <div className="group">
          <input
            placeholder="Tên đăng nhập"
            autoCapitalize="none"
            autoComplete="username"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="password"
            placeholder="Mật khẩu"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="error center">{error}</p>}
        <button className="btn primary block" disabled={busy || !name || !password}>
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>
    </main>
  );
}
