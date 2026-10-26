import { Router } from 'express';
import { z } from 'zod';
import { adminOrAiKey, requireAuth, requireRole } from '../middleware/auth.js';
import { isSilver, parseBC008, suggestPmvNames } from '../pmv.js';

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

    res.json({
      storeId, date, shift,
      systemSource: source.label, // BC008 column used as system stock: "Đầu ngày" (Ca 1) or "Còn lại" (Ca 2, Giao ca 1-2)
      snapshot: snap ? { id: snap.id, fileName: snap.fileName, pmvStoreName: snap.pmvStoreName, uploadedAt: snap.createdAt, uploadedBy: snap.uploadedBy, lines: snap.items.length } : null,
      rows: list,
      unmatched,
      pmvNames,
      // silver lines left out (store has no silver counters): how many lines / items
      excludedSilver: { lines: excludedSilver.length, qty: excludedSilver.reduce((t, it) => t + (Number(it[source.field]) || 0), 0) },
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
