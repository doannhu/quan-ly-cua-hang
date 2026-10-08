import { useEffect, useMemo, useRef, useState } from 'react';
import { api, compressImage } from '../api.js';
import { CameraIcon, CheckIcon } from '../components/icons.jsx';
import { Picker, Row, Segmented, fmt, useDialog } from '../components/ui.jsx';

let seq = 0;
const newTray = (no) => ({ key: ++seq, no: String(no), qty: '', photos: [] });
const defaultShift = () => (new Date().getHours() < 14 ? 1 : 2);

export default function StaffReport({ user, onBack }) {
  const [dialog, ask] = useDialog();
  const [catalog, setCatalog] = useState(null);
  const [storeId, setStoreId] = useState(() => localStorage.getItem('lastStore') || '');
  const [shift, setShift] = useState(defaultShift);
  const [bigId, setBigId] = useState('');
  const [smallId, setSmallId] = useState('');
  const [trays, setTrays] = useState(() => [newTray(1)]);
  const [now, setNow] = useState(new Date());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const fileFor = useRef(null);
  const fileInput = useRef(null);

  useEffect(() => {
    api.get('/stores').then(setCatalog).catch((e) => ask(info('Lỗi', e.message)));
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  const store = catalog?.find((s) => s.id === storeId);
  const big = store?.bigCounters.find((b) => b.id === bigId);
  const total = useMemo(() => trays.reduce((s, t) => s + (parseInt(t.qty, 10) || 0), 0), [trays]);

  const pickStore = (id) => {
    setStoreId(id);
    localStorage.setItem('lastStore', id);
    setBigId('');
    setSmallId('');
  };
  const patchTray = (key, patch) => setTrays((ts) => ts.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  const addTray = () =>
    setTrays((ts) => {
      const nums = ts.map((t) => parseInt(t.no, 10)).filter((n) => !isNaN(n));
      return [...ts, newTray((nums.length ? Math.max(...nums) : ts.length) + 1)];
    });

  const addPhotos = async (files) => {
    const key = fileFor.current;
    const added = [...files].map((file) => ({ id: ++seq, file, preview: URL.createObjectURL(file) }));
    setTrays((ts) => ts.map((t) => (t.key === key ? { ...t, photos: [...t.photos, ...added] } : t)));
  };
  const removePhoto = (key, id) =>
    setTrays((ts) => ts.map((t) => (t.key === key ? { ...t, photos: t.photos.filter((p) => p.id !== id) } : t)));

  const problem = !storeId
    ? 'Vui lòng chọn cửa hàng'
    : !bigId
      ? 'Vui lòng chọn quầy lớn'
      : !smallId
        ? 'Vui lòng chọn quầy nhỏ'
        : trays.some((t) => !t.no.trim())
          ? 'Vui lòng nhập số khay'
          : trays.some((t) => t.qty === '' || !/^\d+$/.test(t.qty))
            ? 'Vui lòng nhập số lượng hàng cho mỗi khay'
            : '';

  const submit = async () => {
    setBusy(true);
    try {
      const body = {
        storeId,
        shift,
        bigCounterId: bigId,
        smallCounterId: smallId,
        trays: await Promise.all(
          trays.map(async (t) => ({
            no: t.no.trim(),
            quantity: parseInt(t.qty, 10),
            photos: await Promise.all(
              t.photos.map(async (p) => (await api.upload(await compressImage(p.file))).url),
            ),
          })),
        ),
      };
      const report = await api.post('/reports', body);
      trays.forEach((t) => t.photos.forEach((p) => URL.revokeObjectURL(p.preview)));
      setDone(report);
    } catch (e) {
      ask(info('Không thể nộp', e.message));
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (problem) return ask(info('Chưa đủ thông tin', problem));
    ask({
      title: 'Nộp thông tin?',
      message: `${store.name} · ${big.name} › ${big.smallCounters.find((s) => s.id === smallId).name}\nCa ${shift} · Tổng ${fmt(total)} hàng. Bạn chắc chắn muốn nộp?`,
      actions: [{ label: 'Hủy' }, { label: 'Nộp', style: 'bold', onClick: submit }],
    });
  };

  const reset = () => {
    setDone(null);
    setTrays([newTray(1)]);
    setSmallId('');
  };

  if (done) {
    return (
      <main className="page center-screen">
        <div className="check"><CheckIcon size={44} /></div>
        <h1 className="center">Đã nộp thành công</h1>
        <p className="muted center">
          {done.storeName} · {done.bigCounterName} › {done.smallCounterName}
          <br />
          Ca {done.shift} · {done.time} · Tổng <b>{fmt(done.total)}</b> hàng
        </p>
        <button className="btn primary block" onClick={reset}>Nhập báo cáo mới</button>
        <button className="btn link block" onClick={onBack}>Về trang chủ</button>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="nav">
        <button className="btn link back" onClick={onBack}>
          <svg width="10" height="18" viewBox="0 0 10 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 1L1 9l8 8" /></svg>
          Trang chủ
        </button>
      </header>

      <h1 className="page-title">Báo cáo hàng thực tế</h1>
      <div className="group">
        <Row label="Nhân viên"><span>{user.name}</span></Row>
        <Row label="Ngày"><span>{now.toLocaleDateString('vi-VN')}</span></Row>
        <Row label="Thời gian"><span>{now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span></Row>
        <Row label="Ca làm">
          <Segmented options={[{ value: 1, label: 'Ca 1' }, { value: 2, label: 'Ca 2' }]} value={shift} onChange={setShift} />
        </Row>
      </div>

      <div className="group">
        <Picker label="Cửa hàng" value={storeId} onChange={pickStore} placeholder={catalog ? 'Chọn…' : 'Đang tải…'}
          options={(catalog || []).map((s) => ({ value: s.id, label: s.name }))} />
        <Picker label="Quầy lớn" value={bigId} disabled={!store} onChange={(v) => { setBigId(v); setSmallId(''); }}
          options={(store?.bigCounters || []).map((x) => ({ value: x.id, label: x.name }))} />
        <Picker label="Quầy nhỏ" value={smallId} disabled={!big} onChange={setSmallId}
          options={(big?.smallCounters || []).map((x) => ({ value: x.id, label: x.name }))} />
      </div>

      <h2 className="section">Khay hàng</h2>
      <div className="group trays">
        <div className="tray-head">
          <span>Khay số</span><span>Số lượng</span><span>Hình chụp</span>
        </div>
        {trays.map((t) => (
          <div className="tray" key={t.key}>
            <input
              className="tray-no"
              inputMode="numeric"
              aria-label="Khay số"
              value={t.no}
              onChange={(e) => patchTray(t.key, { no: e.target.value })}
            />
            <input
              className="tray-qty"
              inputMode="numeric"
              placeholder="0"
              aria-label="Số lượng"
              value={t.qty}
              onChange={(e) => patchTray(t.key, { qty: e.target.value.replace(/\D/g, '') })}
            />
            <div className="photos">
              {t.photos.map((p) => (
                <div className="thumb" key={p.id}>
                  <img src={p.preview} alt="" />
                  <button aria-label="Xóa ảnh" onClick={() => removePhoto(t.key, p.id)}>×</button>
                </div>
              ))}
              <button
                className="cam"
                aria-label="Thêm ảnh"
                onClick={() => { fileFor.current = t.key; fileInput.current.click(); }}
              >
                <CameraIcon size={20} />
              </button>
            </div>
            {trays.length > 1 && (
              <button className="tray-del" aria-label="Xóa khay" onClick={() => setTrays((ts) => ts.filter((x) => x.key !== t.key))}>
                −
              </button>
            )}
          </div>
        ))}
        <button className="add-row" onClick={addTray}><span className="plus">+</span> Thêm khay</button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }}
      />

      <div className="total-bar">
        <div>
          <span className="muted">Tổng số hàng</span>
          <strong>{fmt(total)}</strong>
        </div>
        <button className="btn primary" disabled={busy} onClick={confirm}>
          {busy ? 'Đang nộp…' : 'Nộp thông tin'}
        </button>
      </div>
      {dialog}
    </main>
  );
}

const info = (title, message) => ({ title, message, actions: [{ label: 'OK', style: 'bold' }] });
