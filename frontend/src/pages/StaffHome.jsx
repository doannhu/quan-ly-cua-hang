import { ClipboardIcon, GearIcon } from '../components/icons.jsx';

export default function StaffHome({ user, onOpenReport, onOpenAdmin, onLogout }) {
  return (
    <main className="page home">
      <img className="logo" src="/logo.png" alt="Logo" />
      <h1 className="center">Quản lý cửa hàng</h1>
      <p className="muted center hello">Xin chào, {user.name}</p>

      <button className="menu-btn" onClick={onOpenReport}>
        <span className="menu-icon"><ClipboardIcon size={22} /></span>
        <span className="menu-text">
          <b>Báo cáo hàng thực tế</b>
          <span className="muted small">Nhập số lượng hàng theo khay</span>
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

      <button className="btn link block" onClick={onLogout}>Đăng xuất</button>
    </main>
  );
}
