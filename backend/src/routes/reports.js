import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { adminOrAiKey, requireAuth } from '../middleware/auth.js';

const trayInput = z.object({
  no: z.string().trim().min(1).max(20),
  quantity: z.number().int().min(0).max(1_000_000),
  photos: z.array(z.string().regex(/^\/uploads\/[\w.-]+$/)).max(20).default([]),
});
const reportInput = z.object({
  storeId: z.string(),
  shift: z.union([z.literal(1), z.literal(2)]),
  bigCounterId: z.string(),
  smallCounterId: z.string(),
  trays: z.array(trayInput).min(1).max(200),
});

// Current date/time in the configured timezone.
function nowParts() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: config.timezone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

const filterFrom = (q) => {
  const f = {};
  if (q.from || q.to) f.date = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  if (q.storeId) f.storeId = q.storeId;
  if (q.shift === '1' || q.shift === '2') f.shift = Number(q.shift);
  return f;
};

export default function reportRoutes({ reports, stores, counters }) {
  const r = Router();

  // ---- staff ----
  r.post('/reports', requireAuth, async (req, res) => {
    const b = reportInput.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Dữ liệu báo cáo không hợp lệ' });
    const d = b.data;
    const [store, big, small] = await Promise.all([
      stores.get(d.storeId), counters.get(d.bigCounterId), counters.get(d.smallCounterId),
    ]);
    if (!store || !big || !small || big.storeId !== store.id || small.parentId !== big.id)
      return res.status(400).json({ error: 'Cửa hàng / quầy không hợp lệ' });

    const report = await reports.insert({
      userId: req.user.id,
      userName: req.user.name,
      ...nowParts(),
      shift: d.shift,
      storeId: store.id, storeName: store.name,
      bigCounterId: big.id, bigCounterName: big.name,
      smallCounterId: small.id, smallCounterName: small.name,
      trays: d.trays,
      total: d.trays.reduce((s, t) => s + t.quantity, 0),
    });
    res.status(201).json(report);
  });

  r.get('/reports/mine', requireAuth, async (req, res) =>
    res.json(await reports.find({ userId: req.user.id }, { sort: { createdAt: -1 }, limit: 20 })),
  );

  // ---- admin / AI agents (read-only) ----
  // GET /api/admin/reports?from=YYYY-MM-DD&to=YYYY-MM-DD&storeId=&shift=1|2
  r.get('/admin/reports', adminOrAiKey, async (req, res) =>
    res.json(await reports.find(filterFrom(req.query), { sort: { date: -1, createdAt: -1 }, limit: 2000 })),
  );

  // Totals per day, shift and store.
  r.get('/admin/reports/summary', adminOrAiKey, async (req, res) => {
    const list = await reports.find(filterFrom(req.query), { limit: 20000 });
    const map = new Map();
    for (const x of list) {
      const k = `${x.date}|${x.shift}|${x.storeId}`;
      const row = map.get(k) || { date: x.date, shift: x.shift, storeId: x.storeId, storeName: x.storeName, total: 0, reportCount: 0 };
      row.total += x.total;
      row.reportCount += 1;
      map.set(k, row);
    }
    const rows = [...map.values()].sort((a, b) => b.date.localeCompare(a.date) || a.shift - b.shift);
    res.json({ rows, grandTotal: rows.reduce((s, x) => s + x.total, 0) });
  });

  r.get('/admin/reports/:id', adminOrAiKey, async (req, res) => {
    const x = await reports.get(req.params.id);
    x ? res.json(x) : res.status(404).json({ error: 'Không tìm thấy' });
  });

  return r;
}
