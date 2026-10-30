import { useEffect, useRef, useState } from 'react';
import { api, compressImage } from '../api.js';
import { CameraIcon, CheckIcon } from '../components/icons.jsx';
import { Picker, Row, SHIFTS, Segmented, fmt, shiftLabel, useDialog } from '../components/ui.jsx';

let seq = 0;
const newSection = () => ({ key: ++seq, bigId: '', smallId: '', note: '', weight: '', positions: [] });
const defaultShift = () => (new Date().getHours() < 14 ? 1 : 2);
const HANDOVER = 3; // "Giao ca 1-2"
const qtyOf = (p) => parseInt(p.qty, 10) || 0; // blank = 0
const sectionTotal = (s) => s.positions.reduce((sum, p) => sum + qtyOf(p), 0);

// Each small counter has fixed rows (mục) from the config file (GET /api/position-templates):
//   cabinet rows "Trong tủ 1, 2…" (staff can add more) when the counter has them, the fixed items, and "Lí do khác"
//   (typed reason) last. kind: 'cabinet' | 'item' | 'other' | 'extra' (a saved row no longer in the template).
const LABELS = { other: 'Lí do khác', cabinet: 'Trong tủ' };
const FALLBACK = { cabinet: true, weight: false, items: [] };
const WEIGHT = /^\d+([.,]\d{1,3})?$/; // staff may type 211,68 or 211.68
const weightOf = (s) => Number(s.weight.replace(',', '.')) || 0; // blank = 0
const lc = (s) => String(s).trim().toLocaleLowerCase('vi');
const row = (kind, no, saved) => ({
  key: ++seq, kind, no, note: saved?.note || '',
  qty: saved?.quantity ? String(saved.quantity) : '', // 0 shows as blank, like a new row
  photos: (saved?.photos || []).map((url) => ({ id: ++seq, url, preview: url })),
});
const cabinetRe = () => new RegExp(`^${LABELS.cabinet} (\\d+)$`, 'i');
// Build the rows of a counter from its template, filling in saved positions (when editing) by label.
function buildRows(tpl, saved = []) {
  const left = [...saved];
  const take = (test) => {
    const i = left.findIndex((p) => test(String(p.no)));
    return i < 0 ? null : left.splice(i, 1)[0];
  };
  const rows = [];
  if (tpl.cabinet) {
    const cabs = left.filter((p) => cabinetRe().test(p.no));
    for (const p of cabs) left.splice(left.indexOf(p), 1);
    if (!cabs.length) rows.push(row('cabinet', `${LABELS.cabinet} 1`));
    cabs.forEach((p, i) => rows.push(row('cabinet', `${LABELS.cabinet} ${i + 1}`, p)));
  }
  for (const item of tpl.items) rows.push(row('item', item, take((no) => lc(no) === lc(item))));
  const other = take((no) => lc(no) === lc(LABELS.other));
  // rows saved earlier that the template doesn't have (e.g. older "Vị trí 1" reports) stay, so nothing is lost
  rows.push(...left.map((p) => row('extra', String(p.no), p)));
  rows.push(row('other', LABELS.other, other));
  return rows;
}
const rowLabel = (p) => (/^\d+$/.test(p.no) ? `Vị trí ${p.no}` : p.no);
const renumberCabinets = (rows) => {
  let n = 0;
  return rows.map((p) => (p.kind === 'cabinet' ? { ...p, no: `${LABELS.cabinet} ${++n}` } : p));
};

// A saved submission (its per-counter reports) as form state; rows are built once the templates arrive.
const sectionsFrom = (editing) =>
  editing.reports.map((r) => ({
    key: ++seq,
    bigId: r.bigCounterId,
    smallId: r.smallCounterId,
    note: r.note || '',
    weight: r.weight == null ? '' : String(r.weight),
    positions: [],
    saved: r.positions,
  }));

// `editing` (optional): a submission from "Báo cáo đã nộp hôm nay" to edit and resubmit.
export default function StaffReport({ user, onBack, editing, onOpenMine }) {
  const [dialog, ask] = useDialog();
  const [catalog, setCatalog] = useState(null);
  const [storeId, setStoreId] = useState(() => editing?.storeId || localStorage.getItem('lastStore') || '');
  const [shift, setShift] = useState(() => editing?.shift || defaultShift());
  const [sections, setSections] = useState(() => (editing ? sectionsFrom(editing) : [newSection()]));
  // "Giao ca 1-2" is counted by two people: pick the other staff member.
  const [partnerId, setPartnerId] = useState(() => editing?.partnerId || '');
  const [staff, setStaff] = useState([]);
  // rows of each small counter of the selected store: { [smallCounterId]: { cabinet, items } }
  const [templates, setTemplates] = useState(null);
  const tplOf = (smallId) => templates?.[smallId] || FALLBACK;
  const isHandover = shift === HANDOVER;
  const [now, setNow] = useState(new Date());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const fileFor = useRef(null);
  const fileInput = useRef(null);

  useEffect(() => {
    api.get('/stores').then(setCatalog).catch((e) => ask(info('Lỗi', e.message)));
    api.get('/staff').then((list) => setStaff(list.filter((u) => u.id !== user.id))).catch(() => {});
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!storeId) return;
    setTemplates(null);
    api.get(`/position-templates?storeId=${storeId}`)
      .then((r) => setTemplates(r.counters))
      .catch((e) => {
        setTemplates({});
        ask(info('Không tải được các mục báo cáo', e.message));
      });
  }, [storeId]);
  // when editing, turn the saved positions into rows once the templates are known
  useEffect(() => {
    if (templates)
      setSections((ss) => ss.map((s) => (s.saved ? { ...s, positions: buildRows(tplOf(s.smallId), s.saved), saved: null } : s)));
  }, [templates]);

  const store = catalog?.find((s) => s.id === storeId);
  const bigOf = (s) => store?.bigCounters.find((b) => b.id === s.bigId);
  const smallOf = (s) => bigOf(s)?.smallCounters.find((c) => c.id === s.smallId);
  const total = sections.reduce((sum, s) => sum + sectionTotal(s), 0);

  const pickStore = (id) => {
    setStoreId(id);
    localStorage.setItem('lastStore', id);
    setSections([newSection()]);
  };

  // --- state helpers ---
  const patchSection = (sk, fn) => setSections((ss) => ss.map((s) => (s.key === sk ? fn(s) : s)));
  const patchPosition = (sk, pk, patch) =>
    patchSection(sk, (s) => ({ ...s, positions: s.positions.map((p) => (p.key === pk ? { ...p, ...patch } : p)) }));
  // add "Trong tủ N" after the last cabinet row
  const addCabinet = (sk) =>
    patchSection(sk, (s) => {
      const at = s.positions.findLastIndex((p) => p.kind === 'cabinet') + 1;
      const rows = [...s.positions.slice(0, at), row('cabinet', ''), ...s.positions.slice(at)];
      return { ...s, positions: renumberCabinets(rows) };
    });
  const removePosition = (sk, pk) =>
    patchSection(sk, (s) => ({ ...s, positions: renumberCabinets(s.positions.filter((p) => p.key !== pk)) }));
  const pickSmall = (sk, smallId) =>
    patchSection(sk, (s) => ({ ...s, smallId, weight: '', positions: smallId ? buildRows(tplOf(smallId)) : [] }));
  // a big counter with a single small counter (e.g. Quầy nhẫn tròn) doesn't need the second pick
  const pickBig = (sk, bigId) => {
    const taken = new Set(sections.filter((x) => x.key !== sk).map((x) => x.smallId));
    const free = (store?.bigCounters.find((b) => b.id === bigId)?.smallCounters || []).filter((c) => !taken.has(c.id));
    const smallId = free.length === 1 ? free[0].id : '';
    patchSection(sk, (s) => ({ ...s, bigId, smallId, weight: '', positions: smallId ? buildRows(tplOf(smallId)) : [] }));
  };
  const removeSection = (sk) => setSections((ss) => ss.filter((s) => s.key !== sk));

  const addPhotos = (files) => {
    const { sk, pk } = fileFor.current;
    const added = [...files].map((file) => ({ id: ++seq, file, preview: URL.createObjectURL(file) }));
    patchSection(sk, (s) => ({
      ...s,
      positions: s.positions.map((p) => (p.key === pk ? { ...p, photos: [...p.photos, ...added] } : p)),
    }));
  };
  const removePhoto = (sk, pk, id) =>
    patchSection(sk, (s) => ({
      ...s,
      positions: s.positions.map((p) => (p.key === pk ? { ...p, photos: p.photos.filter((x) => x.id !== id) } : p)),
    }));

  // --- validation ---
  const problem = (() => {
    if (isHandover && !partnerId) return 'Giao ca 1-2: vui lòng chọn nhân viên đếm hàng cùng';
    if (!storeId) return 'Vui lòng chọn cửa hàng';
    for (const [i, s] of sections.entries()) {
      const label = `Quầy ${i + 1}`;
      if (!s.bigId) return `${label}: vui lòng chọn quầy lớn`;
      if (!s.smallId) return `${label}: vui lòng chọn quầy nhỏ`;
      if (!s.positions.length) return `${label}: đang tải các mục, vui lòng đợi`;
      if (s.positions.some((p) => p.qty && !/^\d+$/.test(p.qty))) return `${label}: số lượng không hợp lệ`;
      if (s.positions.some((p) => p.kind === 'other' && qtyOf(p) > 0 && !p.note.trim()))
        return `${label}: vui lòng nhập lí do khác`;
      if (tplOf(s.smallId).weight) {
        if (sectionTotal(s) > 0 && !s.weight.trim()) return `${label}: vui lòng nhập tổng trọng lượng`;
        if (s.weight.trim() && !WEIGHT.test(s.weight.trim())) return `${label}: tổng trọng lượng không hợp lệ (tối đa 3 số lẻ)`;
      }
    }
    const ids = sections.map((s) => s.smallId);
    if (new Set(ids).size !== ids.length) return 'Mỗi quầy nhỏ chỉ được chọn một lần';
    return '';
  })();

  const submit = async () => {
    setBusy(true);
    try {
      const body = {
        storeId,
        shift,
        partnerId: isHandover ? partnerId : null,
        sections: await Promise.all(
          sections.map(async (s) => ({
            bigCounterId: s.bigId,
            smallCounterId: s.smallId,
            note: s.note.trim(),
            weight: tplOf(s.smallId).weight ? weightOf(s) : null,
            positions: await Promise.all(
              s.positions.map(async (p) => ({
                no: p.no.trim(),
                note: p.note.trim(),
                quantity: qtyOf(p), // blank = 0
                // keep already-saved photos, upload new ones
                photos: await Promise.all(
                  p.photos.map(async (x) => x.url || (await api.upload(await compressImage(x.file))).url),
                ),
              })),
            ),
          })),
        ),
      };
      const result = editing
        ? await api.put(`/reports/submissions/${editing.submissionId}`, body)
        : await api.post('/reports', body);
      sections.forEach((s) => s.positions.forEach((p) => p.photos.forEach((x) => x.file && URL.revokeObjectURL(x.preview))));
      setDone(result);
    } catch (e) {
      ask(info('Không thể nộp', e.message));
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (problem) return ask(info('Chưa đủ thông tin', problem));
    const lines = sections.map((s) =>
      `• ${bigOf(s).name} › ${smallOf(s).name}: ${fmt(sectionTotal(s))}${tplOf(s.smallId).weight ? ` · TL ${fmt(weightOf(s))}` : ''}`).join('\n');
    ask({
      title: editing ? 'Nộp lại số' : 'Nộp số',
      message: `${store.name} · ${shiftLabel(shift)}${
        isHandover ? `\nĐếm cùng: ${staff.find((u) => u.id === partnerId)?.name || ''}` : ''
      }\n${lines}${editing ? `\n\nSố mới sẽ thay thế báo cáo đã nộp lúc ${editing.time}.` : ''}`,
      actions: [{ label: 'Hủy' }, { label: editing ? 'Nộp lại' : 'Nộp', style: 'bold', onClick: submit }],
    });
  };

  const reset = () => {
    setDone(null);
    setSections([newSection()]);
  };

  if (done) {
    return (
      <main className="page center-screen">
        <div className="check"><CheckIcon size={44} /></div>
        <h1 className="center">{editing ? 'Đã cập nhật báo cáo' : 'Đã nộp thành công'}</h1>
        <p className="muted center">
          {done.storeName} · {shiftLabel(done.shift)} · {done.time}
          {done.editCount > 0 && ` · đã sửa ${done.editCount} lần`}
          {done.partnerName && <><br />Đếm cùng: {done.partnerName}</>}
        </p>
        <div className="group">
          {done.reports.map((r) => (
            <div key={r.id} className="row">
              <span className="row-label">{r.bigCounterName} › {r.smallCounterName}</span>
              <b>{fmt(r.total)}{r.weight != null && ` · TL ${fmt(r.weight)}`}</b>
            </div>
          ))}
          <div className="row"><b>Tổng</b><b>{fmt(done.total)}</b></div>
        </div>
        {editing ? (
          <button className="btn primary block" onClick={onBack}>Xem báo cáo đã nộp</button>
        ) : (
          <>
            <button className="btn primary block" onClick={reset}>Nhập báo cáo mới</button>
            <button className="btn link block" onClick={onOpenMine}>Xem báo cáo đã nộp hôm nay</button>
            <button className="btn link block" onClick={onBack}>Về trang chủ</button>
          </>
        )}
      </main>
    );
  }

  return (
    <main className="page">
      <header className="nav">
        <button className="btn link back" onClick={onBack}>
          <svg width="10" height="18" viewBox="0 0 10 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 1L1 9l8 8" /></svg>
          {editing ? 'Báo cáo đã nộp' : 'Trang chủ'}
        </button>
      </header>

      <h1 className="page-title">{editing ? 'Sửa báo cáo' : 'Báo cáo hàng thực tế'}</h1>
      {editing && (
        <p className="muted edit-hint">
          Đã nộp lúc {editing.time}{editing.editCount > 0 ? ` · đã sửa ${editing.editCount} lần` : ''}. Sửa xong bấm “Nộp lại”.
        </p>
      )}
      <div className="group">
        <Row label="Nhân viên"><span>{user.name}</span></Row>
        <Row label="Ngày"><span>{now.toLocaleDateString('vi-VN')}</span></Row>
        <Row label="Thời gian"><span>{now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span></Row>
        <div className="row shift-row">
          <span className="row-label">Ca làm</span>
          <Segmented options={SHIFTS} value={shift} onChange={setShift} />
        </div>
        {isHandover && (
          <Picker label="Đếm cùng" value={partnerId} onChange={setPartnerId} placeholder="Chọn nhân viên…"
            options={staff.map((u) => ({ value: u.id, label: u.name }))} />
        )}
      </div>

      <div className="group">
        <Picker label="Cửa hàng" value={storeId} onChange={pickStore} placeholder={catalog ? 'Chọn…' : 'Đang tải…'}
          options={(catalog || []).map((s) => ({ value: s.id, label: s.name }))} />
      </div>

      {sections.map((s, i) => {
        const big = bigOf(s);
        const small = smallOf(s);
        // A small counter already used in another section can't be picked again.
        const taken = new Set(sections.filter((x) => x.key !== s.key).map((x) => x.smallId));
        return (
          <section key={s.key}>
            <div className="counter-head">
              <h2>Quầy {i + 1}{small ? ` · ${small.name}` : ''}</h2>
              {sections.length > 1 && (
                <button className="btn link small danger-text" onClick={() => removeSection(s.key)}>Xóa quầy</button>
              )}
            </div>
            <div className="group">
              <Picker label="Quầy lớn" value={s.bigId} disabled={!store}
                onChange={(v) => pickBig(s.key, v)}
                options={(store?.bigCounters || []).map((x) => ({ value: x.id, label: x.name }))} />
              <Picker label="Quầy nhỏ" value={s.smallId} disabled={!big || !templates}
                onChange={(v) => pickSmall(s.key, v)}
                options={(big?.smallCounters || []).filter((x) => !taken.has(x.id)).map((x) => ({ value: x.id, label: x.name }))} />
            </div>

            {s.smallId && (
            <div className="group positions">
              <div className="pos-head">
                <span>Mục</span><span>Số lượng</span><span>Ảnh</span><span />
              </div>
              {!s.positions.length && <p className="muted center pad small">Đang tải các mục…</p>}
              {s.positions.map((p, pi) => {
                const cabinets = s.positions.filter((x) => x.kind === 'cabinet').length;
                const lastCabinet = p.kind === 'cabinet' && s.positions[pi + 1]?.kind !== 'cabinet';
                return (
                <div key={p.key} className={`pos-wrap ${p.kind}`}>
                <div className="pos">
                  <span className="pos-label">
                    {rowLabel(p)}
                    {p.kind === 'extra' && p.note && <span className="muted"> · {p.note}</span>}
                  </span>
                  <input className="pos-qty" inputMode="numeric" placeholder="0" aria-label={`Số lượng ${rowLabel(p)}`} value={p.qty}
                    onChange={(e) => patchPosition(s.key, p.key, { qty: e.target.value.replace(/\D/g, '') })} />
                  <button className="cam" aria-label="Thêm ảnh"
                    onClick={() => { fileFor.current = { sk: s.key, pk: p.key }; fileInput.current.click(); }}>
                    <CameraIcon size={20} />
                    {p.photos.length > 0 && <span className="cam-count">{p.photos.length}</span>}
                  </button>
                  {(p.kind === 'cabinet' && cabinets > 1) || p.kind === 'extra' ? (
                    <button className="pos-del" aria-label={`Xóa ${rowLabel(p)}`} onClick={() => removePosition(s.key, p.key)}>×</button>
                  ) : <span />}
                  {p.kind === 'other' && (
                    <input className={`pos-other ${qtyOf(p) > 0 && !p.note.trim() ? 'need' : ''}`} maxLength={60}
                      placeholder="Nhập lí do khác…" aria-label="Lí do khác" value={p.note}
                      onChange={(e) => patchPosition(s.key, p.key, { note: e.target.value })} />
                  )}
                  {p.photos.length > 0 && (
                    <div className="photos">
                      {p.photos.map((x) => (
                        <div className="thumb" key={x.id}>
                          <img src={x.preview} alt="" />
                          <button aria-label="Xóa ảnh" onClick={() => removePhoto(s.key, p.key, x.id)}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {lastCabinet && (
                  <button className="add-row add-cabinet" onClick={() => addCabinet(s.key)}>
                    <span className="plus">+</span> Thêm {LABELS.cabinet.toLocaleLowerCase('vi')} {cabinets + 1}
                  </button>
                )}
                </div>
                );
              })}
              <div className="row counter-total">
                <span>Tổng {small ? small.name : `quầy ${i + 1}`}</span>
                <strong>{fmt(sectionTotal(s))}</strong>
              </div>
              {tplOf(s.smallId).weight && (
                <div className="row weight-row">
                  <span>Tổng trọng lượng (TL)</span>
                  <input inputMode="decimal" placeholder="0" aria-label="Tổng trọng lượng" maxLength={12} value={s.weight}
                    onChange={(e) => patchSection(s.key, (x) => ({ ...x, weight: e.target.value.replace(/[^\d.,]/g, '') }))} />
                </div>
              )}
              <div className="counter-note">
                <textarea rows={2} maxLength={300} value={s.note}
                  placeholder={`Chú thích cho ${small ? small.name : `quầy ${i + 1}`} (không bắt buộc)`}
                  aria-label="Chú thích quầy nhỏ"
                  onChange={(e) => patchSection(s.key, (x) => ({ ...x, note: e.target.value }))} />
              </div>
            </div>
            )}
          </section>
        );
      })}

      <div className="group spaced">
        <button className="add-row" disabled={!store} onClick={() => setSections((ss) => [...ss, newSection()])}>
          <span className="plus">+</span> Thêm quầy
        </button>
      </div>

      <input ref={fileInput} type="file" accept="image/*" multiple hidden
        onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />

      <div className="total-bar">
        <div>
          <span className="muted">Tổng số hàng{sections.length > 1 ? ` · ${sections.length} quầy` : ''}</span>
          <strong>{fmt(total)}</strong>
        </div>
        <button className="btn primary" disabled={busy} onClick={confirm}>
          {busy ? 'Đang nộp…' : editing ? 'Nộp lại' : 'Nộp thông tin'}
        </button>
      </div>
      {dialog}
    </main>
  );
}

const info = (title, message) => ({ title, message, actions: [{ label: 'OK', style: 'bold' }] });
