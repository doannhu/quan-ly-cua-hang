import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { UploadIcon } from '../components/icons.jsx';
import {
  Chevron, CounterBadge, Picker, SHIFTS, Segmented, counterColors, fmt, fmtDate, shiftLabel,
} from '../components/ui.jsx';

const todayIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
};
const defaultShift = () => (new Date().getHours() < 14 ? 1 : 2);
const signed = (n) => (n > 0 ? `+${fmt(n)}` : fmt(n));
const diffClass = (d) => (d === 0 ? 'd-ok' : d < 0 ? 'd-short' : 'd-over');
const statusOf = (d) => (d === 0 ? 'ok' : d < 0 ? 'short' : 'over');
const diffWord = (d) => (d === 0 ? 'khớp' : d < 0 ? 'thiếu' : 'dư');
// "03:40, 26/10"
const stamp = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}, ${p(d.getDate())}/${p(d.getMonth() + 1)}`;
};

// Admin › Báo cáo › So sánh tồn: counted stock (staff reports) vs system stock (PMV BC008 upload).
export default function Comparison({ ask, fail }) {
  const [stores, setStores] = useState([]);
  const [storeId, setStoreId] = useState(() => localStorage.getItem('cmpStore') || '');
  const [date, setDate] = useState(todayIso);
  const [shift, setShift] = useState(defaultShift);
  const [filter, setFilter] = useState('all'); // all | short | over | ok
  const [scope, setScope] = useState('all'); // 'all' or a big counter id: compare everything or one quầy lớn
  const [showUncounted, setShowUncounted] = useState(false);
  const [showLinks, setShowLinks] = useState(false);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);
  const colorOf = useMemo(() => counterColors(stores), [stores]);

  useEffect(() => { api.get('/stores').then(setStores).catch(fail); }, []);
  // default to the first store once the list arrives
  useEffect(() => {
    if (stores.length && !stores.some((s) => s.id === storeId)) setStoreId(stores[0].id);
  }, [stores]);

  const load = useCallback(() => {
    if (!storeId) return;
    setData(null);
    api.get(`/admin/comparison?${new URLSearchParams({ storeId, date, shift })}`).then(setData).catch(fail);
  }, [storeId, date, shift]);
  useEffect(() => { load(); }, [load]);

  const pickStore = (id) => {
    setStoreId(id);
    setScope('all');
    localStorage.setItem('cmpStore', id);
  };

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await api.post('/admin/system-stock', { storeId, fileName: file.name, csv: await file.text() });
      ask({
        title: 'Đã tải tồn hệ thống',
        message: `${res.pmvStoreName}\nNgày ${fmtDate(res.date)} · ${res.items} dòng · ${fmt(res.totalQty)} món`,
        actions: [{ label: 'OK', style: 'bold' }],
      });
      if (res.date !== date) setDate(res.date); // jump to the file's date
      else load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const link = async (counterId, pmvName) => {
    try {
      await api.patch(`/admin/counters/${counterId}`, { pmvName: pmvName || null });
      load();
    } catch (e) {
      fail(e);
    }
  };
  const confirmSuggestions = async () => {
    const auto = data.rows.flatMap((r) => r.counters.filter((c) => c.auto).map((c) => [c.counterId, r.pmvName]));
    try {
      for (const [id, name] of auto) await api.patch(`/admin/counters/${id}`, { pmvName: name });
      load();
    } catch (e) {
      fail(e);
    }
  };

  // Scope: all counters, or only PMV lines linked to one big counter (quầy lớn) of the app
  const store = stores.find((s) => s.id === storeId);
  const bigs = store ? store.bigCounters : [];
  const inScope = (r) => scope === 'all' || r.counters.some((c) => c.bigId === scope);
  const scopeName = scope === 'all' ? 'tất cả quầy' : bigs.find((b) => b.id === scope)?.name || '';
  // per big counter: PMV lines linked to it, and how many of them were counted (for the buttons)
  const bigStats = (bigId) => {
    const rows = data ? data.rows.filter((r) => r.counters.some((c) => c.bigId === bigId)) : [];
    return { linked: rows.length, counted: rows.filter((r) => r.counted).length };
  };
  // other big counters sharing a PMV line with the selected one (its system stock can't be split)
  const sharedWith = (r) =>
    scope === 'all' ? [] : [...new Set(r.counters.filter((c) => c.bigId !== scope).map((c) => c.bigName))];

  // PMV lines someone counted (largest difference first) vs lines nobody counted yet
  const counted = data ? data.rows.filter((r) => r.counted && inScope(r)).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)) : [];
  const shown = filter === 'all' ? counted : counted.filter((r) => statusOf(r.diff) === filter);
  // per status: number of PMV lines and their summed difference (for the filter chips)
  const byStatus = { short: { n: 0, diff: 0 }, over: { n: 0, diff: 0 }, ok: { n: 0, diff: 0 } };
  for (const r of counted) {
    const b = byStatus[statusOf(r.diff)];
    b.n += 1;
    b.diff += r.diff;
  }
  const uncounted = data ? data.rows.filter((r) => !r.counted && inScope(r)) : [];
  // app counters of the selected big counter that aren't linked to PMV at all
  const unlinkedInScope = data && scope !== 'all' ? data.unmatched.filter((c) => c.bigId === scope) : [];
  const uncountedQty = uncounted.reduce((s, r) => s + r.system, 0);
  // headline numbers only over counted lines, so uncounted ones don't swamp the difference
  const sub = counted.reduce((t, r) => ({ actual: t.actual + r.actual, system: t.system + r.system }), { actual: 0, system: 0 });
  sub.diff = sub.actual - sub.system;
  const autoCount = data ? data.rows.reduce((n, r) => n + r.counters.filter((c) => c.auto).length, 0) : 0;
  // every app small counter with its current link, for the "Ghép quầy" list — those needing action first:
  // not linked, then suggested (unconfirmed), then confirmed
  const linkRank = (c) => (!c.pmvName ? 0 : c.auto ? 1 : 2);
  const links = data
    ? [
        ...data.rows.flatMap((r) => r.counters.map((c) => ({ ...c, pmvName: r.pmvName }))),
        ...data.unmatched.map((c) => ({ ...c, pmvName: '' })),
      ].sort((a, b) => linkRank(a) - linkRank(b) || a.bigName.localeCompare(b.bigName) || a.name.localeCompare(b.name))
    : [];

  // One badge per big counter followed by its small counters (e.g. "Quầy nhẫn tròn · 5 chỉ, 2 chỉ, …").
  // `withTag`: show the "gợi ý" tag (used in the linking list; the table shows one notice instead)
  const counterChips = (list, withTag) => {
    const groups = [];
    for (const c of list) {
      const g = groups.find((x) => x.bigId === c.bigId);
      if (g) g.items.push(c);
      else groups.push({ bigId: c.bigId, bigName: c.bigName, items: [c] });
    }
    return groups.map((g) => (
      <span key={g.bigId} className="cmp-chip">
        <CounterBadge color={colorOf(g.bigId)}>{g.bigName}</CounterBadge>
        {g.items.map((c, i) => (
          <span key={c.counterId} className="chip-name">
            {c.name}{i < g.items.length - 1 ? ',' : ''}
            {withTag && c.auto && <span className="tag">gợi ý</span>}
          </span>
        ))}
      </span>
    ));
  };
  const autoInTable = counted.reduce((n, r) => n + r.counters.filter((c) => c.auto).length, 0);

  return (
    <>
      <div className="group">
        <Picker label="Cửa hàng" value={storeId} onChange={pickStore}
          options={stores.map((s) => ({ value: s.id, label: s.name }))} />
        <div className="row"><span className="row-label">Ngày</span><input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
        <div className="row shift-row">
          <span className="row-label">Ca đếm</span>
          <Segmented options={SHIFTS} value={shift} onChange={setShift} />
        </div>
      </div>

      {/* system stock file */}
      <div className="group">
        <div className="row snap-row">
          <span className="row-label">Tồn hệ thống</span>
          {!data ? <span className="muted">…</span> : data.snapshot ? (
            <span className="snap-info">
              <span className="snap-file">{data.snapshot.fileName || 'PMV BC008'}</span>
              <span className="muted small">{data.snapshot.lines} dòng · tải {stamp(data.snapshot.uploadedAt)}{data.snapshot.uploadedBy ? ` · ${data.snapshot.uploadedBy}` : ''}</span>
            </span>
          ) : (
            <span className="snap-info muted">Chưa có cho ngày {fmtDate(date)}</span>
          )}
        </div>
        <button className="add-row upload-row" disabled={!storeId || busy} onClick={() => fileInput.current.click()}>
          <span className="icon-tile tile-blue"><UploadIcon size={18} /></span>
          {busy ? 'Đang tải…' : data?.snapshot ? 'Tải lại file BC008 (.csv)' : 'Tải file tồn kho PMV BC008 (.csv)'}
        </button>
        <input ref={fileInput} type="file" accept=".csv,text/csv" hidden
          onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} />
      </div>

      {data?.snapshot && (
        <div className="scope-card group">
          <div className="scope-head">
            <b>So sánh</b>
            <span className="source-tag">Ca {shift === 3 ? '1-2' : shift} · cột «{data.systemSource}» của BC008</span>
          </div>
          <div className="scope-bar">
            <button className={`scope-btn scope-all ${scope === 'all' ? 'on' : ''}`} style={{ '--c': '#0a63c9' }}
              onClick={() => { setScope('all'); setFilter('all'); }}>
              So sánh tất cả <span className="scope-count">{data.rows.filter((r) => r.counted).length}/{data.rows.length}</span>
            </button>
            {bigs.map((b) => {
              const st = bigStats(b.id);
              return (
                <button key={b.id} className={`scope-btn ${scope === b.id ? 'on' : ''}`} style={{ '--c': colorOf(b.id) }}
                  onClick={() => { setScope(b.id); setFilter('all'); }}>
                  <span className="scope-dot" />{b.name}
                  <span className="scope-count">{st.counted}/{st.linked}</span>
                </button>
              );
            })}
          </div>
          <p className="muted small scope-help">Số bên cạnh: quầy PMV đã đếm / đã ghép. Ca 1 so với «Đầu ngày», Ca 2 và Giao ca 1-2 so với «Còn lại».</p>
        </div>
      )}

      {data && (
        <>
          <div className="stats">
            <div className="stat tone tone-blue"><span>Đếm thực tế</span><strong>{fmt(data.snapshot ? sub.actual : data.totals.actual)}</strong></div>
            <div className="stat tone tone-indigo"><span>Hệ thống{data.snapshot ? ` (${data.systemSource})` : ''}</span><strong>{data.snapshot ? fmt(sub.system) : '—'}</strong></div>
            <div className={`stat tone ${data.snapshot && counted.length ? `tone-${statusOf(sub.diff)}` : 'tone-gray'}`}><span>Chênh lệch</span>
              <strong className={data.snapshot && counted.length ? diffClass(sub.diff) : ''}>
                {data.snapshot && counted.length ? signed(sub.diff) : '—'}
              </strong>
            </div>
          </div>
          <p className="muted small cmp-note">
            {data.snapshot
              ? `${shiftLabel(shift)} · ${scope === 'all' ? '' : `${scopeName} · `}so trên ${counted.length}/${data.rows.filter(inScope).length} quầy PMV đã đếm. ${
                  scope === 'all' ? `Toàn bộ tồn PMV («${data.systemSource}»): ${fmt(data.totals.system)} món.` : ''}`
              : `${shiftLabel(shift)} · ${data.reportCount} báo cáo quầy nhỏ đã nộp. Tải file BC008 để so sánh.`}
          </p>

          {data.snapshot && (
            <>
              <h2 className="section section-dot dot-ok">Đã đếm · {counted.length} quầy{scope !== 'all' && ` · ${scopeName}`}</h2>
              {counted.length > 0 && (
                <div className="filter-chips">
                  <button className={`fchip f-all ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
                    Tất cả <b>{counted.length}</b>
                  </button>
                  {[['short', 'Thiếu'], ['over', 'Dư'], ['ok', 'Khớp']].map(([k, label]) => (
                    <button key={k} className={`fchip f-${k} ${filter === k ? 'on' : ''}`} disabled={!byStatus[k].n}
                      onClick={() => setFilter(filter === k ? 'all' : k)}>
                      {label} <b>{byStatus[k].n}</b>
                      {k !== 'ok' && byStatus[k].n > 0 && <span className="fchip-sum">{signed(byStatus[k].diff)}</span>}
                    </button>
                  ))}
                </div>
              )}
              {autoInTable > 0 && (
                <button className="cmp-hint" onClick={() => setShowLinks(true)}>
                  {autoInTable} quầy đang so theo <b>ghép tự động (gợi ý)</b> — kiểm tra và xác nhận ở mục “Ghép quầy” bên dưới ›
                </button>
              )}
              <div className="group cmp-list">
                {shown.map((r) => (
                  <div key={r.pmvName} className={`cmp-item s-${statusOf(r.diff)}`}>
                    <div className="cmp-main">
                      <b className="cmp-pmv">{r.pmvName}</b>
                      <span className="cmp-chips">{counterChips(r.counters)}</span>
                      {sharedWith(r).length > 0 && (
                        <span className="shared-note">Dùng chung với {sharedWith(r).join(', ')} — số đếm gồm cả quầy đó</span>
                      )}
                    </div>
                    <div className="cmp-side">
                      <span className={`diff-pill p-${statusOf(r.diff)}`}>
                        {signed(r.diff)} <span className="cmp-diff-word">{diffWord(r.diff)}</span>
                      </span>
                      <span className="cmp-nums"><b>{fmt(r.actual)}</b> / {fmt(r.system)}</span>
                    </div>
                    {/* counted vs system: the longer one fills the track */}
                    <div className="cmp-bar" title={`Thực tế ${fmt(r.actual)} / Hệ thống ${fmt(r.system)}`}>
                      <span className="bar-sys" style={{ width: `${(r.system / Math.max(r.actual, r.system, 1)) * 100}%` }} />
                      <span className={`bar-act b-${statusOf(r.diff)}`} style={{ width: `${(r.actual / Math.max(r.actual, r.system, 1)) * 100}%` }} />
                    </div>
                  </div>
                ))}
                {!counted.length && <p className="muted center pad">Chưa có quầy nào{scope !== 'all' ? ` của ${scopeName}` : ''} được đếm trong {shiftLabel(shift)} ngày này.</p>}
                {counted.length > 0 && !shown.length && <p className="muted center pad">Không có quầy nào trong nhóm này</p>}
                {counted.length > 0 && (
                  <p className="cmp-legend muted small">
                    <span className="lg lg-act" /> thực tế <span className="lg lg-sys" /> hệ thống · số bên phải: <b>thực tế</b> / hệ thống
                  </p>
                )}
              </div>

              {(uncounted.length > 0 || unlinkedInScope.length > 0) && (
                <div className="group spaced">
                  <button className="row list-item" onClick={() => setShowUncounted(!showUncounted)}>
                    <span className="list-left"><span className="icon-tile tile-gray">…</span>Chưa đếm · {uncounted.length + unlinkedInScope.length} quầy</span>
                    <span className="muted list-right">{fmt(uncountedQty)} món <Chevron open={showUncounted} /></span>
                  </button>
                  {showUncounted && uncounted.map((r) => (
                    <div key={r.pmvName} className="row cmp-uncounted s-none">
                      <span className="cmp-pmv">
                        {r.pmvName}
                        {!r.counters.length && <span className="tag tag-warn">chưa ghép</span>}
                      </span>
                      <span className="muted">{fmt(r.system)}</span>
                    </div>
                  ))}
                  {showUncounted && unlinkedInScope.map((c) => (
                    <div key={c.counterId} className="row cmp-uncounted s-none">
                      <span className="cmp-pmv">
                        {c.bigName} › {c.name}
                        <span className="tag tag-warn">quầy app chưa ghép PMV</span>
                      </span>
                      <span className="muted">—</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* linking app counters to PMV counters */}
          <div className="group spaced">
            <button className="row list-item" onClick={() => setShowLinks(!showLinks)}>
              <span className="list-left"><span className="icon-tile tile-blue">⇄</span>Ghép quầy app ↔ PMV</span>
              <span className="muted list-right">
                {data.unmatched.length
                  ? <span className="tag tag-warn">{data.unmatched.length} chưa ghép</span>
                  : <span className="tag tag-ok">Đã ghép đủ</span>} <Chevron open={showLinks} />
              </span>
            </button>
            {showLinks && (
              <>
                {autoCount > 0 && (
                  <button className="add-row" onClick={confirmSuggestions}>
                    <span className="plus">✓</span> Xác nhận {autoCount} gợi ý tự động
                  </button>
                )}
                {!data.pmvNames.length && <p className="muted pad small">Tải file BC008 để có danh sách quầy PMV.</p>}
                {links.map((c) => (
                  <Picker key={c.counterId} stacked
                    label={<>{counterChips([c], true)}</>}
                    sheetTitle={`${c.bigName} › ${c.name}`}
                    value={c.pmvName} placeholder="Chưa ghép" clearLabel="Không ghép"
                    disabled={!data.pmvNames.length}
                    onChange={(v) => link(c.counterId, v)}
                    options={data.pmvNames.map((n) => ({ value: n, label: n }))} />
                ))}
              </>
            )}
          </div>
          {data.unmatched.length > 0 && !showLinks && (
            <p className="muted small cmp-note">{data.unmatched.length} quầy nhỏ của app chưa ghép với PMV nên chưa được so sánh.</p>
          )}
        </>
      )}
    </>
  );
}
