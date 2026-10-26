import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { PencilIcon } from '../components/icons.jsx';
import { fmt, fmtDate, shiftLabel } from '../components/ui.jsx';

// Group the user's per-counter reports back into submissions (one card per "Nộp thông tin").
function groupSubmissions(reports) {
  const map = new Map();
  for (const r of reports) {
    const key = r.submissionId || r.id; // reports from before submissions existed stand alone
    const g = map.get(key) || {
      submissionId: r.submissionId, storeId: r.storeId, storeName: r.storeName, shift: r.shift,
      partnerId: r.partnerId, partnerName: r.partnerName,
      date: r.date, time: r.time, editCount: r.editCount || 0, editedAt: r.editedAt, reports: [], total: 0,
    };
    g.reports.push(r);
    g.total += r.total;
    map.set(key, g);
  }
  // newest submission first (by original time); counters inside a submission in the order they were entered
  const subs = [...map.values()].sort((a, b) => b.time.localeCompare(a.time));
  subs.forEach((s) => s.reports.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  return subs;
}

export default function MyReports({ onBack, onEdit }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/reports/mine?date=today').then(setData).catch((e) => setError(e.message));
  }, []);

  const subs = data ? groupSubmissions(data.reports) : [];

  return (
    <main className="page">
      <header className="nav">
        <button className="btn link back" onClick={onBack}>
          <svg width="10" height="18" viewBox="0 0 10 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 1L1 9l8 8" /></svg>
          Trang chủ
        </button>
      </header>
      <h1 className="page-title">Báo cáo đã nộp</h1>
      {data && <p className="muted edit-hint">Hôm nay {fmtDate(data.today)} · bấm vào báo cáo để sửa và nộp lại</p>}

      {error && <p className="error center">{error}</p>}
      {!data && !error && <p className="muted center">Đang tải…</p>}
      {data && !subs.length && <p className="muted center pad">Hôm nay bạn chưa nộp báo cáo nào</p>}

      {subs.map((s) => {
        const editable = Boolean(s.submissionId);
        return (
          <section key={s.submissionId || s.reports[0].id}>
            <div className="counter-head">
              <h2>{shiftLabel(s.shift)} · {s.time}</h2>
              {s.editCount > 0 && <span className="tag">Đã sửa {s.editCount} lần</span>}
            </div>
            <button className="group sub-card" disabled={!editable} onClick={() => onEdit(s)}>
              <div className="row">
                <span className="muted">{s.storeName}</span>
                {s.partnerName && <span className="muted small">Đếm cùng: {s.partnerName}</span>}
              </div>
              {s.reports.map((r) => (
                <div key={r.id} className="row sub-line">
                  <span className="row-label">
                    {r.bigCounterName} › {r.smallCounterName}
                    {r.note && <span className="muted small sub-note">{r.note}</span>}
                  </span>
                  <b>{fmt(r.total)}</b>
                </div>
              ))}
              <div className="row sub-total">
                <b>Tổng</b>
                <span className="sub-total-right">
                  <b>{fmt(s.total)}</b>
                  {editable && <span className="sub-edit"><PencilIcon size={16} /> Sửa</span>}
                </span>
              </div>
            </button>
          </section>
        );
      })}
    </main>
  );
}
