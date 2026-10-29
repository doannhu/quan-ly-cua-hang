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

// Comparison result per counter (status only — staff never see system quantities or the difference)
const RESULT_LABEL = { khop: 'Khớp', lech: 'Lệch', cho: 'Chờ quầy khác', chua_ghep: 'Chưa ghép (admin)' };

export default function MyReports({ onBack, onEdit }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  // result of "Kiểm tra kết quả" per submission: { loading } | { error } | server response
  const [checks, setChecks] = useState({});

  const check = async (sid) => {
    setChecks((c) => ({ ...c, [sid]: { loading: true } }));
    try {
      const res = await api.get(`/reports/submissions/${sid}/check`);
      setChecks((c) => ({ ...c, [sid]: res }));
    } catch (e) {
      setChecks((c) => ({ ...c, [sid]: { error: e.message } }));
    }
  };

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
      {data && <p className="muted edit-hint">Hôm nay {fmtDate(data.today)} · bấm «Kiểm tra kết quả» sau khi admin tải tồn kho, quầy nào lệch thì «Sửa» và nộp lại</p>}

      {error && <p className="error center">{error}</p>}
      {!data && !error && <p className="muted center">Đang tải…</p>}
      {data && !subs.length && <p className="muted center pad">Hôm nay bạn chưa nộp báo cáo nào</p>}

      {subs.map((s) => {
        const editable = Boolean(s.submissionId);
        const chk = checks[s.submissionId];
        const resultOf = (r) => (chk?.status === 'ready' ? chk.counters.find((x) => x.reportId === r.id) : null);
        const lechCount = chk?.status === 'ready' ? chk.counters.filter((x) => x.result === 'lech').length : 0;
        return (
          <section key={s.submissionId || s.reports[0].id}>
            <div className="counter-head">
              <h2>{shiftLabel(s.shift)} · {s.time}</h2>
              {s.editCount > 0 && <span className="tag">Đã sửa {s.editCount} lần</span>}
            </div>
            <div className="group sub-card">
              <div className="row">
                <span className="muted">{s.storeName}</span>
                {s.partnerName && <span className="muted small">Đếm cùng: {s.partnerName}</span>}
              </div>
              {s.reports.map((r) => {
                const res = resultOf(r);
                return (
                  <div key={r.id} className={`row sub-line ${res ? `res-${res.result}` : ''}`}>
                    <span className="row-label">
                      {r.bigCounterName} › {r.smallCounterName}
                      {r.note && <span className="muted small sub-note">{r.note}</span>}
                    </span>
                    <span className="sub-line-right">
                      <b>{fmt(r.total)}</b>
                      {res && <span className={`res-chip chip-${res.result}`}>{RESULT_LABEL[res.result]}</span>}
                    </span>
                    {res?.result === 'cho' && (
                      <span className="small wait-note">
                        Cùng nhóm, chưa có ai đếm:{' '}
                        {res.waitingFor.map((n) => n.replace(`${r.bigCounterName} › `, '')).join(', ')}
                      </span>
                    )}
                  </div>
                );
              })}
              <div className="row sub-total">
                <b>Tổng</b>
                <b>{fmt(s.total)}</b>
              </div>
              {chk && !chk.loading && (
                <div className={`check-box ${chk.error ? 'cb-error' : chk.status === 'pending' ? 'cb-pending' : chk.allOk ? 'cb-ok' : lechCount ? 'cb-lech' : 'cb-wait'}`}>
                  {chk.error
                    ? chk.error
                    : chk.status === 'pending'
                      ? 'Chưa có kết quả từ admin — admin chưa tải báo cáo tồn kho (BC008) cho ngày này.'
                      : chk.allOk
                        ? 'Tất cả quầy đều khớp với hệ thống.'
                        : lechCount
                          ? `${lechCount} quầy lệch — kiểm tra lại số lượng, bấm «Sửa» để sửa và nộp lại.`
                          : 'Chưa đủ dữ liệu để so — xem ghi chú từng quầy.'}
                </div>
              )}
              {editable && (
                <div className="sub-actions">
                  <button className="btn check-btn" disabled={chk?.loading} onClick={() => check(s.submissionId)}>
                    {chk?.loading ? 'Đang kiểm tra…' : chk ? 'Kiểm tra lại' : 'Kiểm tra kết quả'}
                  </button>
                  <button className="btn edit-btn" onClick={() => onEdit(s)}><PencilIcon size={16} /> Sửa</button>
                </div>
              )}
            </div>
          </section>
        );
      })}
    </main>
  );
}
