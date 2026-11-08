import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { UploadIcon } from '../components/icons.jsx';
import { Chevron, fmt, fmtDate, useDialog } from '../components/ui.jsx';

const info = (title, message) => ({ title, message, actions: [{ label: 'OK', style: 'bold' }] });
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (m) => `Tháng ${Number(m.slice(5))}/${m.slice(0, 4)}`;
const hours = (h) => fmt(Math.round(h * 100) / 100);
const money = (n) => `${fmt(n)} đ`;
const dayLabel = (iso) => {
  const w = new Date(`${iso}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'short' });
  return `${w} ${iso.slice(8)}/${iso.slice(5, 7)}`;
};
// file -> base64 (without the data: prefix) for the JSON upload
const base64 = (file) => new Promise((ok, bad) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1]);
  r.onerror = () => bad(new Error('Không đọc được file'));
  r.readAsDataURL(file);
});

// Month + year calendar for the pay period: ‹ year › and a 12-month grid; months that have a timesheet get a dot.
function MonthPicker({ value, onChange, withData }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number((value || thisMonth()).slice(0, 4)));
  const show = () => { setYear(Number((value || thisMonth()).slice(0, 4))); setOpen(true); };
  const now = thisMonth();
  return (
    <>
      <button type="button" className="row picker" onClick={show}>
        <span className="row-label">Kỳ lương</span>
        <span className="picker-value">{value ? monthLabel(value) : 'Chọn…'}<Chevron /></span>
      </button>
      {open && (
        <div className="backdrop sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="sheet" role="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-head">
              <h3>Chọn tháng</h3>
              <button className="btn link" onClick={() => setOpen(false)}>Đóng</button>
            </div>
            <div className="mp-year">
              <button className="btn link" aria-label="Năm trước" onClick={() => setYear((y) => y - 1)}>‹</button>
              <b>Năm {year}</b>
              <button className="btn link" aria-label="Năm sau" onClick={() => setYear((y) => y + 1)}>›</button>
            </div>
            <div className="mp-grid">
              {Array.from({ length: 12 }, (_, i) => {
                const m = `${year}-${String(i + 1).padStart(2, '0')}`;
                const cls = ['mp-month', m === value && 'on', m === now && 'now'].filter(Boolean).join(' ');
                return (
                  <button key={m} className={cls} onClick={() => { onChange(m); setOpen(false); }}>
                    Tháng {i + 1}
                    {withData.has(m) && <span className="mp-dot" title="Đã có chấm công" />}
                  </button>
                );
              })}
            </div>
            <p className="muted small mp-legend"><span className="mp-dot" /> đã có bảng chấm công</p>
          </div>
        </div>
      )}
    </>
  );
}

// Tính lương (admin, from the home screen): upload the attendance export + schedule, set rates, and see each
// employee's hours and pay.
export default function PayrollPage({ onBack }) {
  const [dialog, ask] = useDialog();
  const fail = (e) => ask(info('Lỗi', e.message));
  return (
    <main className="page">
      <header className="nav">
        <button className="btn link back" onClick={onBack}>
          <svg width="10" height="18" viewBox="0 0 10 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 1L1 9l8 8" /></svg>
          Trang chủ
        </button>
      </header>
      <h1 className="page-title">Tính lương</h1>
      <Payroll ask={ask} fail={fail} />
      {dialog}
    </main>
  );
}

function Payroll({ ask, fail }) {
  const [months, setMonths] = useState(null);
  const [month, setMonth] = useState('');
  const [data, setData] = useState(null);
  const [openCode, setOpenCode] = useState(null);
  const [busy, setBusy] = useState('');
  const sheetInput = useRef(null);
  const scheduleInput = useRef(null);

  const loadMonths = useCallback(() => api.get('/admin/payroll/months').then((list) => {
    setMonths(list);
    setMonth((m) => m || list[0]?.month || thisMonth());
  }).catch(fail), []);
  useEffect(() => { loadMonths(); }, [loadMonths]);
  const load = useCallback(() => {
    if (month) api.get(`/admin/payroll?month=${month}`).then(setData).catch(fail);
  }, [month]);
  useEffect(() => { setData(null); load(); }, [load]);

  const upload = async (kind, file, repeatIn) => {
    if (!file) return;
    setBusy(kind);
    try {
      const res = await api.post(`/admin/payroll/${kind}`, { fileName: file.name, data: await base64(file), ...(repeatIn && { month: repeatIn }) });
      if (kind === 'timesheet') {
        const dup = res.duplicates.length
          ? `\n\nTrùng ngày (${res.duplicates.length}): ${res.duplicates.map((d) => `${d.name} ${fmtDate(d.date)}`).join(', ')} — mỗi ngày chỉ tính 1 ngày công.`
          : '';
        ask(info('Đã tải bảng chấm công', `${res.rows} dòng · ${res.employees} nhân viên (${res.added} mới) · ${res.months.map(monthLabel).join(', ')}${dup}`));
        await loadMonths();
        setMonth(res.months[0]);
      } else {
        const miss = res.unmatched.length
          ? `\n\nChưa khớp với nhân viên nào: ${res.unmatched.join(', ')}. Đặt «Tên trong lịch» cho nhân viên đó nếu là cùng một người.`
          : '';
        const covers = res.from <= `${month}-31` && res.to >= `${month}-01`;
        if (res.repeated) {
          ask(info('Đã lặp lịch làm việc', `${monthLabel(month)}: ${res.days} ngày, theo lịch ${fmtDate(res.repeated.from)}–${fmtDate(res.repeated.to)} (chu kỳ ${res.repeated.cycle} ngày)${miss}`));
        } else if (!covers && month) {
          // the file is for other dates (e.g. a rotation template): offer to repeat it over the selected month
          ask({
            title: 'Lịch không có ngày nào của ' + monthLabel(month).toLowerCase(),
            message: `Lịch trong file từ ${fmtDate(res.from)} đến ${fmtDate(res.to)} (${res.days} ngày). Lặp lịch này theo chu kỳ ${res.days} ngày cho ${monthLabel(month).toLowerCase()}?`,
            actions: [{ label: 'Không' }, { label: 'Lặp lịch', style: 'bold', onClick: () => upload('schedule', file, month) }],
          });
        } else {
          ask(info('Đã tải lịch làm việc', `${res.days} ngày, từ ${fmtDate(res.from)} đến ${fmtDate(res.to)}${miss}`));
        }
      }
      load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy('');
    }
  };

  const emp = data?.employees.find((e) => e.code === openCode);
  if (emp) return <EmployeeDetail emp={emp} month={month} settings={data.settings} ask={ask} fail={fail} onBack={() => setOpenCode(null)} reload={load} />;

  const total = (k) => (data?.employees || []).reduce((t, e) => t + e.totals[k], 0);

  return (
    <>
      <div className="group">
        <MonthPicker value={month} onChange={setMonth} withData={new Set((months || []).map((m) => m.month))} />
        <div className="row snap-row">
          <span className="row-label">Chấm công</span>
          <span className="snap-info muted">
            {data?.timesheet ? (
              <>
                <span className="snap-file">{data.timesheet.fileName}</span>
                <span className="small">{data.timesheet.rows} dòng · {data.scheduleDays} ngày có lịch</span>
              </>
            ) : 'Chưa có'}
          </span>
        </div>
        <button className="add-row upload-row pay-upload" disabled={!!busy} onClick={() => sheetInput.current.click()}>
          <span className="icon-tile tile-blue"><UploadIcon size={18} /></span>
          {busy === 'timesheet' ? 'Đang tải…' : 'Tải bảng chấm công (.xlsx)'}
        </button>
        <button className="add-row upload-row pay-upload" disabled={!!busy} onClick={() => scheduleInput.current.click()}>
          <span className="icon-tile tile-blue"><UploadIcon size={18} /></span>
          {busy === 'schedule' ? 'Đang tải…' : 'Tải lịch làm việc (.xlsx)'}
        </button>
        <input ref={sheetInput} type="file" accept=".xlsx" hidden onChange={(e) => { upload('timesheet', e.target.files[0]); e.target.value = ''; }} />
        <input ref={scheduleInput} type="file" accept=".xlsx" hidden onChange={(e) => { upload('schedule', e.target.files[0]); e.target.value = ''; }} />
      </div>

      {data && <Settings settings={data.settings} fail={fail} onSaved={load} />}

      {data?.timesheet && (
        <>
          <div className="stats pay-stats">
            <div className="stat tone tone-blue"><span>Nhân viên</span><strong>{data.employees.length}</strong></div>
            <div className="stat tone tone-indigo"><span>Tổng giờ</span><strong>{hours(total('hours'))}</strong></div>
            <div className="stat tone tone-ok"><span>Tổng thực nhận</span><strong className="pay-total">{fmt(total('net'))}</strong></div>
          </div>
          {data.scheduleDays === 0 && (
            <p className="check-box cb-lech pay-warn">Chưa có lịch làm việc cho {monthLabel(month).toLowerCase()} — tải lịch để tính giờ (file lịch của tháng khác có thể lặp cho tháng này).</p>
          )}
          <div className="group">
            {data.employees.map((e) => (
              <button key={e.code} className="row list-item pay-emp" onClick={() => setOpenCode(e.code)}>
                <span className="pay-emp-main">
                  <b>{e.name}</b>
                  <span className="muted small">
                    {e.totals.workDays} ngày · {hours(e.totals.hours)} giờ
                    {e.totals.overtimeHours > 0 && ` · TC ${hours(e.totals.overtimeHours)}`}
                    {e.totals.offShiftHours > 0 && ` · trái ca ${hours(e.totals.offShiftHours)}`}
                  </span>
                </span>
                <span className="list-right">
                  {e.totals.flags > 0 && <span className="tag tag-warn">{e.totals.flags} cần xem</span>}
                  <b>{fmt(e.totals.net)}</b>
                  <Chevron />
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {data && !data.timesheet && <p className="muted center pad">Chưa có bảng chấm công cho {monthLabel(month).toLowerCase()}</p>}
    </>
  );
}

/* ---------------- Cấu hình lương ---------------- */
function Settings({ settings, fail, onSaved }) {
  const [open, setOpen] = useState(!settings.baseRate);
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(settings), [settings]);
  const num = (k) => ({
    inputMode: 'numeric', value: form[k] ?? '',
    onChange: (e) => setForm({ ...form, [k]: e.target.value.replace(/\D/g, '') === '' ? '' : Number(e.target.value.replace(/\D/g, '')) }),
  });
  const shiftTime = (s, k) => ({ type: 'time', value: form.shifts[s][k], onChange: (e) => setForm({ ...form, shifts: { ...form.shifts, [s]: { ...form.shifts[s], [k]: e.target.value } } }) });
  const save = async () => {
    setSaving(true);
    try {
      const n = (k) => Number(form[k]) || 0;
      await api.put('/admin/payroll/settings', {
        baseRate: n('baseRate'), allowancePerDay: n('allowancePerDay'), insurance: n('insurance'),
        seniorityPct: n('seniorityPct'), overtimePct: n('overtimePct'), doubleFromDay: n('doubleFromDay'), shifts: form.shifts,
      });
      setOpen(false);
      onSaved();
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="group spaced">
      <button className="row list-item" onClick={() => setOpen(!open)}>
        <span className="list-left"><span className="icon-tile tile-gray">⚙</span>Cấu hình lương</span>
        <span className="muted list-right">{settings.baseRate ? `${fmt(settings.baseRate)} đ/giờ` : 'Chưa đặt'} <Chevron open={open} /></span>
      </button>
      {open && (
        <>
          <label className="row pay-field"><span className="row-label">Lương giờ cơ bản (đ)</span><input {...num('baseRate')} placeholder="0" /></label>
          <label className="row pay-field"><span className="row-label">Phụ cấp mỗi ngày công (đ)</span><input {...num('allowancePerDay')} placeholder="0" /></label>
          <label className="row pay-field"><span className="row-label">Bảo hiểm trừ mỗi tháng (đ)</span><input {...num('insurance')} placeholder="0" /></label>
          <label className="row pay-field"><span className="row-label">Thâm niên: + % mỗi năm</span><input {...num('seniorityPct')} /></label>
          <label className="row pay-field"><span className="row-label">Lương tăng ca (% lương giờ)</span><input {...num('overtimePct')} /></label>
          <label className="row pay-field"><span className="row-label">Nhân đôi lương từ ngày</span><input {...num('doubleFromDay')} /></label>
          <div className="row pay-field"><span className="row-label">Ca 1</span><span className="pay-times"><input {...shiftTime(1, 'start')} /> – <input {...shiftTime(1, 'end')} /></span></div>
          <div className="row pay-field"><span className="row-label">Ca 2</span><span className="pay-times"><input {...shiftTime(2, 'start')} /> – <input {...shiftTime(2, 'end')} /></span></div>
          <div className="pad"><button className="btn primary block pay-save" disabled={saving} onClick={save}>{saving ? 'Đang lưu…' : 'Lưu cấu hình'}</button></div>
        </>
      )}
    </div>
  );
}

/* ---------------- Một nhân viên ---------------- */
function EmployeeDetail({ emp, month, settings, ask, fail, onBack, reload }) {
  const [noteDay, setNoteDay] = useState(null);
  const t = emp.totals;
  const edit = (field, title, value, type = 'text') => ask({
    title, input: { value: value || '', type },
    actions: [
      { label: 'Hủy' },
      { label: 'Lưu', style: 'bold', onClick: async (v) => {
        try {
          await api.put(`/admin/payroll/employees/${emp.code}`, { [field]: field === 'startDate' ? v || null : v.trim() });
          reload();
        } catch (e) { fail(e); }
      } },
    ],
  });
  const lines = [
    ['Ngày công', `${t.workDays} ngày`],
    ['Giờ làm trong ca', `${hours(t.hours)} giờ`],
    ...(t.doubleHours ? [[`  trong đó từ ngày ${settings.doubleFromDay} (×2)`, `${hours(t.doubleHours)} giờ`]] : []),
    ['Giờ tăng ca', `${hours(t.overtimeHours)} giờ`],
    ['Giờ làm trái ca', `${hours(t.offShiftHours)} giờ`],
  ];
  const pay = [
    ['Lương giờ làm', money(t.regularPay)],
    ['Lương tăng ca', money(t.overtimePay)],
    ['Phụ cấp', money(t.allowance)],
    ['Bảo hiểm', `− ${money(t.insurance)}`],
  ];
  return (
    <>
      <button className="btn link back pay-back" onClick={onBack}>
        <svg width="10" height="18" viewBox="0 0 10 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 1L1 9l8 8" /></svg>
        Tất cả nhân viên
      </button>
      <div className="counter-head"><h2>{emp.name}</h2><span className="tag tag-muted">{monthLabel(month)}</span></div>
      <div className="group">
        <button className="row list-item" onClick={() => edit('name', 'Tên hiển thị', emp.name)}>
          <span className="row-label">Mã nhân viên {emp.code}</span><span className="muted list-right">Đổi tên <Chevron /></span>
        </button>
        <button className="row list-item" onClick={() => edit('startDate', 'Ngày bắt đầu làm việc', emp.startDate, 'date')}>
          <span className="row-label">Bắt đầu làm</span>
          <span className="muted list-right">{emp.startDate ? `${fmtDate(emp.startDate)} · ${emp.years} năm` : 'Chưa đặt'} <Chevron /></span>
        </button>
        <button className="row list-item" onClick={() => edit('scheduleName', 'Tên trong lịch làm việc', emp.scheduleName)}>
          <span className="row-label">Tên trong lịch</span><span className="muted list-right">{emp.scheduleName || 'Tự khớp theo tên'} <Chevron /></span>
        </button>
        <div className="row"><span className="row-label">Lương giờ</span><b>{money(emp.rate)}{emp.years > 0 && <span className="muted small"> (+{emp.years * settings.seniorityPct}%)</span>}</b></div>
      </div>

      <div className="group">
        {lines.map(([l, v]) => <div key={l} className="row"><span className="row-label">{l}</span><span>{v}</span></div>)}
      </div>
      <div className="group">
        {pay.map(([l, v]) => <div key={l} className="row"><span className="row-label">{l}</span><span>{v}</span></div>)}
        <div className="row sub-total"><b>Thực nhận</b><b className="pay-total">{money(t.net)}</b></div>
      </div>

      <h3 className="group-title pay-days-title">Từng ngày · bấm để ghi xin phép / tăng ca</h3>
      <div className="group">
        {emp.days.map((d) => (
          <button key={d.date} className={`row list-item pay-day ${d.flags.length ? 'has-flag' : ''}`} onClick={() => setNoteDay(d)}>
            <span className="pay-day-main">
              <span><b>{dayLabel(d.date)}</b>{d.shift && <span className="muted"> · Ca {d.shift}</span>}{d.double && <span className="tag pay-x2">×2</span>}</span>
              <span className="muted small">
                Chấm {d.in || '—'} → {d.out || '—'}{d.from && ` · tính ${d.from} → ${d.to}`}
              </span>
              {(d.note.leave || d.note.overtime || d.note.text) && (
                <span className="small pay-note">
                  {[d.note.leave && 'Xin phép', d.note.overtime && 'Tăng ca', d.note.text].filter(Boolean).join(' · ')}
                </span>
              )}
              {d.flags.map((f) => <span key={f} className="small pay-flag">{f}</span>)}
              {d.info.map((f) => <span key={f} className="small muted">{f}</span>)}
            </span>
            <span className="pay-day-right">
              <b>{hours(d.minutes / 60)}h</b>
              {d.otMinutes > 0 && <span className="small d-over">+{hours(d.otMinutes / 60)}h TC</span>}
            </span>
          </button>
        ))}
      </div>
      {noteDay && <NoteSheet emp={emp} day={noteDay} fail={fail} onClose={() => setNoteDay(null)} onSaved={() => { setNoteDay(null); reload(); }} />}
    </>
  );
}

function NoteSheet({ emp, day, fail, onClose, onSaved }) {
  const [note, setNote] = useState({ leave: !!day.note.leave, overtime: !!day.note.overtime, text: day.note.text || '' });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api.put('/admin/payroll/notes', { code: emp.code, date: day.date, ...note });
      onSaved();
    } catch (e) {
      fail(e);
      setSaving(false);
    }
  };
  return (
    <div className="backdrop sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <button className="btn link" onClick={onClose}>Hủy</button>
          <h3>{emp.name} · {fmtDate(day.date)}</h3>
          <button className="btn link" disabled={saving} onClick={save}><b>Lưu</b></button>
        </div>
        <div className="group">
          <label className="row pay-check">
            <span><b>Xin phép</b><span className="muted small"> — vào muộn / về sớm vẫn tính đủ ca</span></span>
            <input type="checkbox" checked={note.leave} onChange={(e) => setNote({ ...note, leave: e.target.checked })} />
          </label>
          <label className="row pay-check">
            <span><b>Tăng ca</b><span className="muted small"> — tính giờ sau khi hết ca đến giờ ra</span></span>
            <input type="checkbox" checked={note.overtime} onChange={(e) => setNote({ ...note, overtime: e.target.checked })} />
          </label>
          <input placeholder="Ghi chú (không bắt buộc)" value={note.text} onChange={(e) => setNote({ ...note, text: e.target.value })} />
        </div>
        <p className="muted small pad">Chấm công {day.in || '—'} → {day.out || '—'}. Bỏ chọn cả hai và xóa ghi chú để tính lại theo giờ chấm công.</p>
      </div>
    </div>
  );
}
