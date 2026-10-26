import { useState } from 'react';
import { ClipboardIcon, GearIcon, HistoryIcon } from '../components/icons.jsx';
import { Segmented } from '../components/ui.jsx';
import { getTheme, setTheme } from '../theme.js';

const THEMES = [
  { value: 'auto', label: 'Tự động' },
  { value: 'light', label: 'Sáng' },
  { value: 'dark', label: 'Tối' },
];

export default function StaffHome({ user, onOpenReport, onOpenMine, onOpenAdmin, onLogout }) {
  const [theme, setThemeState] = useState(getTheme);
  const changeTheme = (t) => {
    setTheme(t);
    setThemeState(t);
  };
  return (
    <main className="page home">
      <img className="logo" src="/logo.png" alt="Logo" />
      <h1 className="center">Quản lý cửa hàng</h1>
      <p className="muted center hello">Xin chào, {user.name}</p>

      <button className="menu-btn" onClick={onOpenReport}>
        <span className="menu-icon"><ClipboardIcon size={22} /></span>
        <span className="menu-text">
          <b>Báo cáo hàng thực tế</b>
          <span className="muted small">Nhập số lượng hàng theo quầy, vị trí</span>
        </span>
        <svg className="menu-chev" width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l6 6-6 6" /></svg>
      </button>

      <button className="menu-btn" onClick={onOpenMine} style={{ marginTop: 12 }}>
        <span className="menu-icon" style={{ background: '#34c759' }}><HistoryIcon size={22} /></span>
        <span className="menu-text">
          <b>Báo cáo đã nộp hôm nay</b>
          <span className="muted small">Xem, sửa và nộp lại</span>
        </span>
        <svg className="menu-chev" width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l6 6-6 6" /></svg>
      </button>

      {onOpenAdmin && (
        <button className="menu-btn" onClick={onOpenAdmin} style={{ marginTop: 12 }}>
          <span className="menu-icon" style={{ background: '#8e8e93' }}><GearIcon size={22} /></span>
          <span className="menu-text">
            <b>Quản trị</b>
            <span className="muted small">Báo cáo tổng, nhân viên, cửa hàng</span>
          </span>
          <svg className="menu-chev" width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l6 6-6 6" /></svg>
        </button>
      )}

      <div className="group theme-row">
        <div className="row">
          <span className="row-label">Giao diện</span>
          <Segmented options={THEMES} value={theme} onChange={changeTheme} />
        </div>
      </div>

      <button className="btn link block" onClick={onLogout}>Đăng xuất</button>
    </main>
  );
}
