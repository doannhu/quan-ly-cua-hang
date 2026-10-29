import { Router } from 'express';
import { z } from 'zod';
import { adminOrAiKey, requireAuth, requireRole } from '../middleware/auth.js';
import { config } from '../config.js';
import { isSilver, nameCode, numbersIn, parseBC008, suggestPmvNames } from '../pmv.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHIFT_NAME = { 1: 'Ca 1', 2: 'Ca 2', 3: 'Giao ca 1-2' };
const SHIFT_CODE = { 1: 'Ca1', 2: 'Ca2', 3: 'GiaoCa1-2' };
const dmy = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`; // 27-10-2026
const dmySlash = (iso) => dmy(iso).replaceAll('-', '/'); // 27/10/2026
// now in the shop's timezone: { date: 'YYYY-MM-DD', hh, mm }
function nowLocal(at = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hh: p.hour, mm: p.minute };
}
// Standard name of an uploaded BC008: BC008_<store>_<dd-mm-yyyy of the stock>_<shift>_<HHhMM of the upload>
const standardName = (storeName, date, shift, hh, mm) =>
  `BC008_${nameCode(storeName)}_${dmy(date)}_${SHIFT_CODE[shift] || 'KhongRoCa'}_${hh}h${mm}`;
// Public view of a stored snapshot (uploads from before shifts were recorded have no shift / standard name)
function snapInfo(s, storeName) {
  const t = nowLocal(new Date(s.createdAt));
  return {
    id: s.id, date: s.date, shift: s.shift ?? null, shiftName: SHIFT_NAME[s.shift] || 'Không rõ ca',
    name: s.name || standardName(storeName, s.date, s.shift, t.hh, t.mm),
    originalFileName: s.originalFileName || s.fileName || '',
    uploadedAt: s.createdAt, uploadedBy: s.uploadedBy, lines: s.items.length,
    pmvStoreName: s.pmvStoreName, pmvAddress: s.pmvAddress || '',
  };
}

// Compare counted stock (staff reports) with system stock imported from PMV, per PMV quầy nhỏ.
export default function comparisonRoutes({ snapshots, reports, stores, counters }) {
  const r = Router();
  const adm = [requireAuth, requireRole('admin')];

  // Upload a PMV BC008 CSV for one store and shift. Body: { storeId, shift, fileName, csv, dryRun? }.
  // dryRun=true only parses and returns the standard name + warnings (nothing saved), so the admin can confirm.
  // Saving replaces the file of the same store + date ("Đến ngày" in the file) + shift.
  r.post('/admin/system-stock', adm, async (req, res) => {
    const b = z.object({
      storeId: z.string(), shift: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      fileName: z.string().max(200).default(''), csv: z.string().min(1), dryRun: z.boolean().default(false),
    }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Thiếu cửa hàng, ca hoặc nội dung file' });
    const store = await stores.get(b.data.storeId);
    if (!store) return res.status(400).json({ error: 'Cửa hàng không hợp lệ' });
    let parsed;
    try {
      parsed = parseBC008(b.data.csv);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const { shift, fileName } = b.data;
    const date = parsed.toDate;
    const now = nowLocal();
    const name = standardName(store.name, date, shift, now.hh, now.mm);

    const warnings = [];
    const fileNum = numbersIn(parsed.address)[0]; // house number in the file's address, e.g. 209
    const storeNums = numbersIn(store.name);
    if (fileNum && storeNums.length && !storeNums.includes(fileNum))
      warnings.push(`File là của cửa hàng địa chỉ «${parsed.address}» nhưng bạn đang chọn «${store.name}».`);
    const m = /(\d{2})(\d{2})(\d{4})/.exec(fileName) || /(\d{1,2})[-_.](\d{1,2})[-_.](\d{4})/.exec(fileName);
    if (m) {
      const fromName = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      if (fromName !== date)
        warnings.push(`Tên file ghi ngày ${dmySlash(fromName)} nhưng nội dung BC008 là ngày ${dmySlash(date)} — sẽ lưu theo ngày ${dmySlash(date)}.`);
    }
    if (parsed.fromDate && parsed.fromDate !== date)
      warnings.push(`File gồm nhiều ngày (từ ${dmySlash(parsed.fromDate)} đến ${dmySlash(date)}).`);
    if (date > now.date) warnings.push(`Ngày trong file (${dmySlash(date)}) ở tương lai.`);
    const existing = (await snapshots.find({ storeId: store.id, date })).filter((s) => (s.shift ?? null) === shift);
    if (existing.length) warnings.push(`Sẽ thay file đã tải trước đó: ${snapInfo(existing[0], store.name).name}.`);

    const summary = {
      name, date, shift, shiftName: SHIFT_NAME[shift], storeName: store.name, pmvStoreName: parsed.storeName,
      pmvAddress: parsed.address, lines: parsed.items.length, totalQty: parsed.items.reduce((t, x) => t + x.qty, 0), warnings,
    };
    if (b.data.dryRun) return res.json({ dryRun: true, ...summary });

    for (const old of existing) await snapshots.remove(old.id);
    const snap = await snapshots.insert({
      storeId: store.id, date, shift, name, source: 'PMV BC008', originalFileName: fileName, fileName: name,
      pmvStoreName: parsed.storeName, pmvAddress: parsed.address, fromDate: parsed.fromDate, toDate: parsed.toDate,
      uploadedBy: req.user.name, items: parsed.items,
    });
    res.status(201).json({ id: snap.id, ...summary, items: summary.lines });
  });

  // Uploaded BC008 files of a store, newest stock date first. GET /api/admin/system-stock?storeId=
  r.get('/admin/system-stock', adminOrAiKey, async (req, res) => {
    const store = req.query.storeId && (await stores.get(req.query.storeId));
    if (!store) return res.status(400).json({ error: 'Cần storeId hợp lệ' });
    const list = await snapshots.find({ storeId: store.id }, { sort: { date: -1, createdAt: -1 } });
    res.json(list.map((s) => snapInfo(s, store.name)));
  });

  // Delete one uploaded file. DELETE /api/admin/system-stock/:id
  r.delete('/admin/system-stock/:id', adm, async (req, res) => {
    const ok = await snapshots.remove(req.params.id);
    ok ? res.status(204).end() : res.status(404).json({ error: 'Không tìm thấy file' });
  });

  // Delete a store's files whose stock date is more than N days before today.
  // POST /api/admin/system-stock/cleanup { storeId, olderThanDays: 7 | 14, dryRun? } -> { count, cutoff, deleted }
  r.post('/admin/system-stock/cleanup', adm, async (req, res) => {
    const b = z.object({ storeId: z.string(), olderThanDays: z.number().int().min(1).max(365), dryRun: z.boolean().default(false) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
    const today = new Date(`${nowLocal().date}T00:00:00Z`);
    const cutoff = new Date(today.getTime() - b.data.olderThanDays * 864e5).toISOString().slice(0, 10);
    const old = (await snapshots.find({ storeId: b.data.storeId })).filter((s) => s.date < cutoff);
    if (!b.data.dryRun) for (const s of old) await snapshots.remove(s.id);
    res.json({ count: old.length, cutoff, deleted: !b.data.dryRun });
  });

  // The comparison of one store/day/shift (shared by the admin screen and the staff result check).
  async function buildComparison(storeId, date, shift) {
    // the file uploaded for this shift; older uploads (before shifts were recorded) apply to every shift of the day
    const sameDay = await snapshots.find({ storeId, date }, { sort: { createdAt: -1 } });
    const snap = sameDay.find((s) => s.shift === shift) || sameDay.find((s) => s.shift == null);
    const storeName = (await stores.get(storeId))?.name || '';
    // Which BC008 column is the system stock for this shift: Ca 1 is counted at the start of the day, so it is
    // compared with "Đầu ngày"; Ca 2 and Giao ca 1-2 are compared with "Còn lại".
    const source = shift === 1 ? { field: 'openingQty', label: 'Đầu ngày' } : { field: 'qty', label: 'Còn lại' };
    const [counterList, reportList] = await Promise.all([
      counters.find({ storeId }),
      reports.find({ storeId, date, shift }),
    ]);

    // counted quantity per small counter (all submissions of that shift)
    const counted = new Map();
    for (const x of reportList) counted.set(x.smallCounterId, (counted.get(x.smallCounterId) || 0) + x.total);

    // Silver products in a store without silver counters (e.g. Bạc món lines in the gold store's BC008) are not
    // part of that store's count, so they are left out of the comparison.
    const storeHasSilver = counterList.some((c) => isSilver(c.name));
    const items = (snap?.items || []).filter((it) => storeHasSilver || !isSilver(it.smallName));
    const excludedSilver = (snap?.items || []).filter((it) => !items.includes(it));

    // PMV lines grouped by quầy nhỏ (one quầy nhỏ may have several gold codes)
    const pmv = new Map();
    for (const it of items) {
      const g = pmv.get(it.smallName) || { pmvName: it.smallName, pmvBigName: it.bigName, goldCodes: [], system: 0 };
      g.system += Number(it[source.field]) || 0;
      if (it.goldCode && !g.goldCodes.includes(it.goldCode)) g.goldCodes.push(it.goldCode);
      pmv.set(it.smallName, g);
    }
    const pmvNames = [...pmv.keys()];

    const bigName = new Map(counterList.filter((c) => !c.parentId).map((c) => [c.id, c.name]));

    // Links of an app small counter: the PMV products saved by admin (pmvNames; older data: pmvName), else one
    // name-based suggestion. A counter may link to several products (e.g. Quầy vàng y › Bông = Bông 980 + Bông 995).
    const linksOf = (c, big) => {
      const saved = Array.isArray(c.pmvNames) ? c.pmvNames : c.pmvName ? [c.pmvName] : [];
      if (saved.length) return { names: saved, auto: false };
      const s = snap ? suggestPmvNames(big, c.name, pmvNames) : [];
      return { names: s, auto: s.length > 0 };
    };

    // Comparison groups = connected PMV products: products linked to the same counter are compared together, and
    // all counters linked into a group are summed (e.g. 6 "Quầy nhẫn tròn" counters -> Nhẫn Tròn 9999).
    const parent = new Map();
    const find = (x) => {
      if (!parent.has(x)) parent.set(x, x);
      while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
      return x;
    };
    pmvNames.forEach(find);
    const linked = [];
    const unmatched = [];
    for (const c of counterList.filter((x) => x.parentId)) {
      const entry = {
        counterId: c.id, name: c.name, bigId: c.parentId, bigName: bigName.get(c.parentId) || '',
        actual: counted.get(c.id) || 0, counted: counted.has(c.id),
      };
      const l = linksOf(c, entry.bigName);
      entry.pmvNames = l.names;
      entry.auto = l.auto; // suggested, not confirmed by admin
      if (!l.names.length) { unmatched.push(entry); continue; }
      for (const n of l.names.slice(1)) parent.set(find(n), find(l.names[0]));
      linked.push(entry);
    }
    const groups = new Map();
    const groupOf = (root) => groups.get(root) || groups.set(root, { names: [], counters: [] }).get(root);
    for (const n of parent.keys()) groupOf(find(n)).names.push(n);
    for (const e of linked) groupOf(find(e.pmvNames[0])).counters.push(e);

    const order = new Map(pmvNames.map((n, i) => [n, i])); // keep the file's order inside a group
    const list = [...groups.values()].map((g) => {
      const names = g.names.sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9) || a.localeCompare(b));
      const info = names.map((n) => pmv.get(n)).filter(Boolean);
      const system = info.reduce((s, x) => s + x.system, 0);
      const actual = g.counters.reduce((s, c) => s + c.actual, 0);
      return {
        pmvName: names.join(' + '), // display label of the group
        pmvNames: names,
        pmvBigName: [...new Set(info.map((x) => x.pmvBigName))].join(', '),
        goldCodes: [...new Set(info.flatMap((x) => x.goldCodes))],
        system,
        actual,
        counters: g.counters,
        // a saved link to a product that isn't in this file
        missingInFile: !!snap && names.some((n) => !pmv.has(n)),
        counted: g.counters.some((c) => c.counted),
        diff: actual - system,
      };
    });
    list.sort((a, b) => a.pmvBigName.localeCompare(b.pmvBigName) || a.pmvName.localeCompare(b.pmvName));
    const totals = {
      system: list.reduce((s, x) => s + x.system, 0),
      actual: [...counted.values()].reduce((s, v) => s + v, 0),
    };
    totals.diff = totals.actual - totals.system;

    return {
      storeId, date, shift,
      systemSource: source.label, // BC008 column used as system stock: "Đầu ngày" (Ca 1) or "Còn lại" (Ca 2, Giao ca 1-2)
      snapshot: snap ? (({ name, ...info }) => ({ ...info, name, fileName: name }))(snapInfo(snap, storeName)) : null,
      rows: list,
      unmatched,
      pmvNames,
      // silver lines left out (store has no silver counters): how many lines / items
      excludedSilver: { lines: excludedSilver.length, qty: excludedSilver.reduce((t, it) => t + (Number(it[source.field]) || 0), 0) },
      totals,
      reportCount: reportList.length,
    };
  }

  // GET /api/admin/comparison?storeId=&date=YYYY-MM-DD&shift=1|2|3
  r.get('/admin/comparison', adminOrAiKey, async (req, res) => {
    const { storeId, date } = req.query;
    const shift = Number(req.query.shift);
    if (!storeId || !DATE.test(date || '') || ![1, 2, 3].includes(shift))
      return res.status(400).json({ error: 'Cần storeId, date (YYYY-MM-DD) và shift (1, 2, 3)' });
    res.json(await buildComparison(storeId, date, shift));
  });

  // Staff: result of their own submission against the admin's BC008 upload — status only, never quantities.
  // GET /api/reports/submissions/:submissionId/check
  //  -> { status: 'pending' }                         no BC008 for that store/day yet ("Chưa có kết quả từ admin")
  //  -> { status: 'ready', allOk, counters: [{ reportId, bigCounterName, smallCounterName,
  //        result: 'khop' | 'lech' | 'cho' | 'chua_ghep', waitingFor?: [counter names] }] }
  //     khop/lech: the counter's comparison group matches / doesn't; cho: other counters in the same group are
  //     not counted yet; chua_ghep: the counter isn't linked to a PMV product.
  r.get('/reports/submissions/:submissionId/check', requireAuth, async (req, res) => {
    const mine = await reports.find({ submissionId: req.params.submissionId });
    if (!mine.length) return res.status(404).json({ error: 'Không tìm thấy báo cáo' });
    const first = mine[0];
    if (first.userId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Không có quyền' });
    const c = await buildComparison(first.storeId, first.date, first.shift);
    if (!c.snapshot) return res.json({ status: 'pending', date: first.date, shift: first.shift });

    const groupOf = new Map();
    for (const row of c.rows) for (const x of row.counters) groupOf.set(x.counterId, row);
    const result = mine
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((r) => {
        const base = { reportId: r.id, bigCounterName: r.bigCounterName, smallCounterName: r.smallCounterName };
        const row = groupOf.get(r.smallCounterId);
        if (!row) return { ...base, result: 'chua_ghep' };
        const waiting = row.counters.filter((x) => !x.counted);
        if (waiting.length) return { ...base, result: 'cho', waitingFor: waiting.map((x) => `${x.bigName} › ${x.name}`) };
        return { ...base, result: row.diff === 0 ? 'khop' : 'lech' };
      });
    res.json({ status: 'ready', date: first.date, shift: first.shift, allOk: result.every((x) => x.result === 'khop'), counters: result });
  });


  return r;
}
