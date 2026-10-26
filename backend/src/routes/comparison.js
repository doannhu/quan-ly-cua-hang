import { Router } from 'express';
import { z } from 'zod';
import { adminOrAiKey, requireAuth, requireRole } from '../middleware/auth.js';
import { parseBC008, suggestPmvName } from '../pmv.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Compare counted stock (staff reports) with system stock imported from PMV, per PMV quầy nhỏ.
export default function comparisonRoutes({ snapshots, reports, stores, counters }) {
  const r = Router();
  const adm = [requireAuth, requireRole('admin')];

  // Upload a PMV BC008 CSV for one store. Body: { storeId, fileName, csv }. Replaces that store's
  // snapshot for the file's date ("Đến ngày").
  r.post('/admin/system-stock', adm, async (req, res) => {
    const b = z.object({ storeId: z.string(), fileName: z.string().max(200).default(''), csv: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Thiếu cửa hàng hoặc nội dung file' });
    if (!(await stores.get(b.data.storeId))) return res.status(400).json({ error: 'Cửa hàng không hợp lệ' });
    let parsed;
    try {
      parsed = parseBC008(b.data.csv);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const date = parsed.toDate;
    for (const old of await snapshots.find({ storeId: b.data.storeId, date })) await snapshots.remove(old.id);
    const snap = await snapshots.insert({
      storeId: b.data.storeId, date, source: 'PMV BC008', fileName: b.data.fileName,
      pmvStoreName: parsed.storeName, fromDate: parsed.fromDate, toDate: parsed.toDate,
      uploadedBy: req.user.name, items: parsed.items,
    });
    res.status(201).json({ id: snap.id, date, items: snap.items.length, totalQty: snap.items.reduce((s, x) => s + x.qty, 0), pmvStoreName: parsed.storeName });
  });

  // GET /api/admin/comparison?storeId=&date=YYYY-MM-DD&shift=1|2|3
  r.get('/admin/comparison', adminOrAiKey, async (req, res) => {
    const { storeId, date } = req.query;
    const shift = Number(req.query.shift);
    if (!storeId || !DATE.test(date || '') || ![1, 2, 3].includes(shift))
      return res.status(400).json({ error: 'Cần storeId, date (YYYY-MM-DD) và shift (1, 2, 3)' });

    const [snap] = await snapshots.find({ storeId, date });
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

    // PMV lines grouped by quầy nhỏ (one quầy nhỏ may have several gold codes)
    const pmv = new Map();
    for (const it of snap?.items || []) {
      const g = pmv.get(it.smallName) || { pmvName: it.smallName, pmvBigName: it.bigName, goldCodes: [], system: 0 };
      g.system += Number(it[source.field]) || 0;
      if (it.goldCode && !g.goldCodes.includes(it.goldCode)) g.goldCodes.push(it.goldCode);
      pmv.set(it.smallName, g);
    }
    const pmvNames = [...pmv.keys()];

    const bigName = new Map(counterList.filter((c) => !c.parentId).map((c) => [c.id, c.name]));
    const rows = new Map(pmvNames.map((n) => [n, { ...pmv.get(n), actual: 0, counters: [] }]));
    const unmatched = [];
    for (const c of counterList.filter((x) => x.parentId)) {
      const entry = {
        counterId: c.id, name: c.name, bigId: c.parentId, bigName: bigName.get(c.parentId) || '',
        actual: counted.get(c.id) || 0, counted: counted.has(c.id),
      };
      const pmvName = c.pmvName || (snap ? suggestPmvName(entry.bigName, c.name, pmvNames) : null);
      if (!pmvName) { unmatched.push(entry); continue; }
      entry.auto = !c.pmvName; // suggested, not confirmed by admin
      // a saved link to a name that isn't in this file still shows up as its own row
      if (!rows.has(pmvName)) rows.set(pmvName, { pmvName, pmvBigName: '', goldCodes: [], system: 0, actual: 0, counters: [], missingInFile: !!snap });
      const row = rows.get(pmvName);
      row.counters.push(entry);
      row.actual += entry.actual;
    }

    const list = [...rows.values()].map((x) => ({
      ...x,
      counted: x.counters.some((c) => c.counted),
      diff: x.actual - x.system,
    }));
    list.sort((a, b) => a.pmvBigName.localeCompare(b.pmvBigName) || a.pmvName.localeCompare(b.pmvName));
    const totals = {
      system: list.reduce((s, x) => s + x.system, 0),
      actual: [...counted.values()].reduce((s, v) => s + v, 0),
    };
    totals.diff = totals.actual - totals.system;

    res.json({
      storeId, date, shift,
      systemSource: source.label, // BC008 column used as system stock: "Đầu ngày" (Ca 1) or "Còn lại" (Ca 2, Giao ca 1-2)
      snapshot: snap ? { id: snap.id, fileName: snap.fileName, pmvStoreName: snap.pmvStoreName, uploadedAt: snap.createdAt, uploadedBy: snap.uploadedBy, lines: snap.items.length } : null,
      rows: list,
      unmatched,
      pmvNames,
      totals,
      reportCount: reportList.length,
    });
  });

  // Dates that have an uploaded system stock for a store (newest first).
  r.get('/admin/system-stock', adminOrAiKey, async (req, res) => {
    if (!req.query.storeId) return res.status(400).json({ error: 'Cần storeId' });
    const list = await snapshots.find({ storeId: req.query.storeId }, { sort: { date: -1 }, limit: 60 });
    res.json(list.map(({ id, date, fileName, createdAt, uploadedBy, items }) => ({ id, date, fileName, uploadedAt: createdAt, uploadedBy, lines: items.length })));
  });

  return r;
}
