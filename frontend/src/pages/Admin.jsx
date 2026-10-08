import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { ChartIcon, PencilIcon, StoreIcon, TrashIcon, UsersIcon } from '../components/icons.jsx';
import { Picker, fmt, fmtDate, useDialog } from '../components/ui.jsx';

const info = (title, message) => ({ title, message, actions: [{ label: 'OK', style: 'bold' }] });
const today = (offset = 0) => {
  const d = new Date(Date.now() - offset * 864e5);
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
};

export default function Admin({ onBack }) {
  const [tab, setTab] = useState('reports');
  const [dialog, ask] = useDialog();
  const fail = (e) => ask(info('Lỗi', e.message));

  return (
    <main className="page has-tabbar">
      <header className="nav">
        <button className="btn link back" onClick={onBack}>
          <svg width="10" height="18" viewBox="0 0 10 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 1L1 9l8 8" /></svg>
          Trang chủ
        </button>
      </header>
      <h1 className="page-title">{{ reports: 'Báo cáo', staff: 'Nhân viên', catalog: 'Cửa hàng' }[tab]}</h1>
      {tab === 'reports' && <Reports fail={fail} />}
      {tab === 'staff' && <Staff ask={ask} fail={fail} />}
      {tab === 'catalog' && <Catalog ask={ask} fail={fail} />}
      <nav className="tabbar">
        {[['reports', ChartIcon, 'Báo cáo'], ['staff', UsersIcon, 'Nhân viên'], ['catalog', StoreIcon, 'Cửa hàng']].map(([k, Icon, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            <Icon size={24} />{l}
          </button>
        ))}
      </nav>
      {dialog}
    </main>
  );
}

/* ---------------- Reports ---------------- */
function Reports({ fail }) {
  const [from, setFrom] = useState(today(6));
  const [to, setTo] = useState(today());
  const [storeId, setStoreId] = useState('');
  const [stores, setStores] = useState([]);
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => { api.get('/stores').then(setStores).catch(fail); }, []);
  useEffect(() => {
    setList(null);
    const q = new URLSearchParams({ from, to, ...(storeId && { storeId }) });
    api.get(`/admin/reports?${q}`).then(setList).catch(fail);
  }, [from, to, storeId]);

  const days = useMemo(() => {
    const byDay = {};
    for (const r of list || []) {
      const d = (byDay[r.date] ||= { date: r.date, total: 0, shifts: { 1: [], 2: [] } });
      d.total += r.total;
      d.shifts[r.shift].push(r);
    }
    return Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date));
  }, [list]);

  const sum = (rs) => rs.reduce((s, r) => s + r.total, 0);

  return (
    <>
      <div className="group">
        <div className="row"><span className="row-label">Từ ngày</span><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="row"><span className="row-label">Đến ngày</span><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
        <Picker label="Cửa hàng" value={storeId} onChange={setStoreId} placeholder="Tất cả" clearLabel="Tất cả"
          options={stores.map((s) => ({ value: s.id, label: s.name }))} />
      </div>

      {!list && <p className="muted center">Đang tải…</p>}
      {list && !days.length && <p className="muted center">Chưa có báo cáo trong khoảng này</p>}

      {days.map((d) => (
        <section key={d.date}>
          <h2 className="section">{fmtDate(d.date)} · Tổng {fmt(d.total)}</h2>
          <div className="stats">
            {[1, 2].map((s) => (
              <div key={s} className="stat"><span className="muted">Ca {s}</span><strong>{fmt(sum(d.shifts[s]))}</strong></div>
            ))}
          </div>
          {[1, 2].map((s) => d.shifts[s].length > 0 && (
            <div className="group" key={s}>
              <div className="group-title">Ca {s}</div>
              {d.shifts[s].map((r) => (
                <div key={r.id} className="report">
                  <button className="report-head" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <div>
                      <b>{r.storeName}</b>
                      <div className="muted small">{r.bigCounterName} › {r.smallCounterName} · {r.userName} · {r.time}</div>
                    </div>
                    <strong>{fmt(r.total)}</strong>
                  </button>
                  {open === r.id && (
                    <div className="report-detail">
                      {r.trays.map((t, i) => (
                        <div key={i} className="detail-row">
                          <span>Khay {t.no}</span><b>{fmt(t.quantity)}</b>
                          <div className="photos">
                            {t.photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" /></a>)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}
    </>
  );
}

/* ---------------- Staff ---------------- */
function Staff({ ask, fail }) {
  const [users, setUsers] = useState(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const load = useCallback(() => api.get('/users').then(setUsers).catch(fail), []);
  useEffect(() => { load(); }, [load]);

  const act = (fn) => async (...a) => { try { await fn(...a); await load(); } catch (e) { fail(e); } };

  const create = act(async (e) => {
    e.preventDefault();
    await api.post('/users', { name, password });
    setName(''); setPassword('');
    ask(info('Đã lưu', `Đã tạo tài khoản cho ${name.trim()}`));
  });
  const manage = (u) => ask({
    title: u.name,
    message: 'Chọn thao tác',
    actions: [
      { label: 'Đổi mật khẩu', onClick: () => ask({
          title: 'Mật khẩu mới', message: u.name, input: { type: 'text', placeholder: 'Tối thiểu 4 ký tự' },
          actions: [{ label: 'Hủy' }, { label: 'Lưu', style: 'bold', onClick: act((pw) => api.patch(`/users/${u.id}`, { password: pw })) }],
        }) },
      { label: u.active ? 'Vô hiệu hóa' : 'Kích hoạt lại', onClick: act(() => api.patch(`/users/${u.id}`, { active: !u.active })) },
      { label: 'Xóa', style: 'danger', onClick: () => ask({
          title: `Xóa ${u.name}?`, message: 'Báo cáo cũ vẫn được giữ lại.',
          actions: [{ label: 'Hủy' }, { label: 'Xóa', style: 'danger', onClick: act(() => api.del(`/users/${u.id}`)) }],
        }) },
      { label: 'Đóng' },
    ],
  });

  return (
    <>
      <h2 className="section">Tạo tài khoản</h2>
      <form className="group" onSubmit={create}>
        <input placeholder="Tên nhân viên" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Mật khẩu" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="form-actions">
          <button className="btn primary" disabled={!name.trim() || password.length < 4}>Lưu</button>
        </div>
        {password && password.length < 4 && <p className="error small pad">Mật khẩu tối thiểu 4 ký tự</p>}
      </form>

      <h2 className="section">Danh sách ({users?.length ?? 0})</h2>
      <div className="group">
        {users?.map((u) => (
          <button key={u.id} className="list-item" onClick={() => manage(u)}>
            <span>{u.name}</span>
            <span className={u.active ? 'muted' : 'error'}>{u.active ? '' : 'Đã vô hiệu hóa  '}›</span>
          </button>
        ))}
        {users?.length === 0 && <p className="muted center pad">Chưa có nhân viên</p>}
      </div>
    </>
  );
}

/* ---------------- Stores / counters ---------------- */
function Actions({ onEdit, onDelete }) {
  return (
    <span className="actions">
      <button className="icon-btn" aria-label="Sửa" onClick={onEdit}><PencilIcon size={18} /></button>
      <button className="icon-btn danger" aria-label="Xóa" onClick={onDelete}><TrashIcon size={18} /></button>
    </span>
  );
}

function Catalog({ ask, fail }) {
  const [stores, setStores] = useState(null);
  const load = useCallback(() => api.get('/stores').then(setStores).catch(fail), []);
  useEffect(() => { load(); }, [load]);

  const act = (fn) => async (...a) => { try { await fn(...a); await load(); } catch (e) { fail(e); } };
  const prompt = (title, placeholder, fn) => ask({
    title, input: { placeholder },
    actions: [{ label: 'Hủy' }, { label: 'Thêm', style: 'bold', onClick: act((v) => v.trim() && fn(v.trim())) }],
  });
  const rename = (title, current, path) => ask({
    title, input: { value: current, placeholder: 'Tên mới' },
    actions: [{ label: 'Hủy' }, { label: 'Lưu', style: 'bold', onClick: act((v) => v.trim() && v.trim() !== current && api.patch(path, { name: v.trim() })) }],
  });
  const remove = (what, path) => ask({
    title: `Xóa ${what}?`, message: 'Các quầy bên trong cũng sẽ bị xóa. Báo cáo cũ vẫn được giữ lại.',
    actions: [{ label: 'Hủy' }, { label: 'Xóa', style: 'danger', onClick: act(() => api.del(path)) }],
  });

  return (
    <>
      {stores?.map((s) => (
        <section key={s.id}>
          <div className="store-head">
            <h2>{s.name}</h2>
            <Actions
              onEdit={() => rename('Sửa cửa hàng', s.name, `/admin/stores/${s.id}`)}
              onDelete={() => remove(`cửa hàng "${s.name}"`, `/admin/stores/${s.id}`)} />
          </div>
          <div className="group">
            {s.bigCounters.map((b) => (
              <div key={b.id} className="big">
                <div className="row-between">
                  <b>{b.name}</b>
                  <Actions
                    onEdit={() => rename('Sửa quầy lớn', b.name, `/admin/counters/${b.id}`)}
                    onDelete={() => remove(`quầy "${b.name}"`, `/admin/counters/${b.id}`)} />
                </div>
                <div className="chips">
                  {b.smallCounters.map((c) => (
                    <span key={c.id} className="chip">
                      {c.name}
                      <button aria-label="Sửa" onClick={() => rename('Sửa quầy nhỏ', c.name, `/admin/counters/${c.id}`)}><PencilIcon size={14} /></button>
                      <button aria-label="Xóa" onClick={() => remove(`quầy "${c.name}"`, `/admin/counters/${c.id}`)}>×</button>
                    </span>
                  ))}
                  <button className="chip add" onClick={() => prompt(`Quầy nhỏ trong ${b.name}`, 'Tên quầy nhỏ',
                    (name) => api.post(`/admin/stores/${s.id}/counters`, { name, parentId: b.id }))}>+ Quầy nhỏ</button>
                </div>
              </div>
            ))}
            <button className="add-row" onClick={() => prompt(`Quầy lớn trong ${s.name}`, 'Tên quầy lớn',
              (name) => api.post(`/admin/stores/${s.id}/counters`, { name }))}>
              <span className="plus">+</span> Thêm quầy lớn
            </button>
          </div>
        </section>
      ))}
      {stores?.length === 0 && <p className="muted center">Chưa có cửa hàng nào</p>}
      <div className="group spaced">
        <button className="add-row" onClick={() => prompt('Cửa hàng mới', 'Tên cửa hàng', (name) => api.post('/admin/stores', { name }))}>
          <span className="plus">+</span> Thêm cửa hàng
        </button>
      </div>
    </>
  );
}
