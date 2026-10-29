import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { adminOrAiKey, requireAuth } from '../middleware/auth.js';

// A row (mục) of a small counter: its label ("Mâm 1", "Trong tủ 2", "Lí do khác"; older reports: a position number),
// note (the typed reason for "Lí do khác"), count (0 when nothing there) and photos.
const positionInput = z.object({
  no: z.string().trim().min(1).max(60),
  note: z.string().trim().max(60).default(''),
  quantity: z.number().int().min(0).max(1_000_000),
  photos: z.array(z.string().regex(/^\/uploads\/[\w.-]+$/)).max(20).default([]),
});
const sectionInput = z.object({
  bigCounterId: z.string(),
  smallCounterId: z.string(),
  // Optional free-text note for the whole small counter (quầy nhỏ).
  note: z.string().trim().max(300).default(''),
  positions: z.array(positionInput).min(1).max(200),
});
const reportInput = z.object({
  storeId: z.string(),
  // 1 = Ca 1, 2 = Ca 2, 3 = Giao ca 1-2 (handover between shifts)
  shift: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  // Staff member who counted together with the submitter — required for "Giao ca 1-2" (shift 3).
  partnerId: z.string().nullish(),
  sections: z.array(sectionInput).min(1).max(50),
});
const HANDOVER = 3;

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

// Older reports stored `trays` ({no, quantity, photos}) and had no counter note; expose the current shape.
export function normalizeReport(r) {
  if (!r) return r;
  const { trays, ...rest } = r;
  return {
    ...rest,
    note: r.note ?? '',
    positions: r.positions ?? (trays || []).map((t) => ({ note: '', ...t })),
  };
}

const filterFrom = (q) => {
  const f = {};
  if (q.from || q.to) f.date = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  if (q.storeId) f.storeId = q.storeId;
  if (['1', '2', '3'].includes(q.shift)) f.shift = Number(q.shift);
  if (q.smallCounterId) f.smallCounterId = q.smallCounterId;
  return f;
};

export default function reportRoutes({ reports, stores, counters, users }) {
  const r = Router();

  // Validate a submission body and resolve store/counters/partner.
  // Returns { error } or { d, store, resolved, partner }. `submitterId` is who the report belongs to.
  async function validateSubmission(body, submitterId) {
    const b = reportInput.safeParse(body);
    if (!b.success) return { error: 'Dữ liệu báo cáo không hợp lệ' };
    const d = b.data;
    let partner = null;
    if (d.shift === HANDOVER) {
      if (!d.partnerId) return { error: 'Giao ca 1-2: vui lòng chọn nhân viên đếm hàng cùng' };
      const u = await users.get(d.partnerId);
      if (!u || !u.active || u.role !== 'staff') return { error: 'Nhân viên đếm cùng không hợp lệ' };
      if (u.id === submitterId) return { error: 'Nhân viên đếm cùng phải là người khác' };
      partner = { id: u.id, name: u.name };
    }
    const smallIds = d.sections.map((s) => s.smallCounterId);
    if (new Set(smallIds).size !== smallIds.length) return { error: 'Mỗi quầy nhỏ chỉ được chọn một lần trong một báo cáo' };
    const store = await stores.get(d.storeId);
    if (!store) return { error: 'Cửa hàng không hợp lệ' };
    const resolved = [];
    for (const s of d.sections) {
      const [big, small] = await Promise.all([counters.get(s.bigCounterId), counters.get(s.smallCounterId)]);
      if (!big || !small || big.storeId !== store.id || big.parentId || small.parentId !== big.id)
        return { error: 'Quầy lớn / quầy nhỏ không hợp lệ' };
      resolved.push({ big, small, note: s.note, positions: s.positions });
    }
    return { d, store, resolved, partner };
  }

  // Save one report per small counter, all sharing submissionId.
  async function saveSubmission({ d, store, resolved, partner }, base) {
    const saved = [];
    for (const { big, small, note, positions } of resolved) {
      saved.push(
        await reports.insert({
          ...base,
          shift: d.shift,
          partnerId: partner?.id || null,
          partnerName: partner?.name || null,
          storeId: store.id, storeName: store.name,
          bigCounterId: big.id, bigCounterName: big.name,
          smallCounterId: small.id, smallCounterName: small.name,
          note,
          positions,
          total: positions.reduce((sum, p) => sum + p.quantity, 0),
        }),
      );
    }
    return {
      submissionId: base.submissionId,
      date: base.date, time: base.time,
      shift: d.shift,
      partnerId: partner?.id || null, partnerName: partner?.name || null,
      storeId: store.id, storeName: store.name,
      editedAt: base.editedAt, editCount: base.editCount || 0,
      reports: saved,
      total: saved.reduce((sum, x) => sum + x.total, 0),
    };
  }

  // ---- staff (and admin) submit ----
  // One submission may cover several counters; each small counter is stored as its own report,
  // linked by submissionId, so totals per small counter fall out of the existing queries.
  r.post('/reports', requireAuth, async (req, res) => {
    const v = await validateSubmission(req.body, req.user.id);
    if (v.error) return res.status(400).json({ error: v.error });
    const base = { submissionId: randomUUID(), userId: req.user.id, userName: req.user.name, ...nowParts() };
    res.status(201).json(await saveSubmission(v, base));
  });

  // Staff edit + resubmit one of their own submissions from today. The new content replaces the old
  // reports; the original submission date/time is kept and the edit is recorded.
  r.put('/reports/submissions/:submissionId', requireAuth, async (req, res) => {
    const old = await reports.find({ submissionId: req.params.submissionId });
    if (!old.length) return res.status(404).json({ error: 'Không tìm thấy báo cáo' });
    const first = old[0];
    if (first.userId !== req.user.id) return res.status(403).json({ error: 'Bạn chỉ được sửa báo cáo của mình' });
    if (first.date !== nowParts().date) return res.status(403).json({ error: 'Chỉ được sửa báo cáo đã nộp trong ngày hôm nay' });

    const v = await validateSubmission(req.body, first.userId);
    if (v.error) return res.status(400).json({ error: v.error });

    for (const x of old) await reports.remove(x.id);
    const base = {
      submissionId: first.submissionId,
      userId: first.userId, userName: first.userName,
      date: first.date, time: first.time,
      editedAt: new Date().toISOString(),
      editCount: (first.editCount || 0) + 1,
    };
    res.json(await saveSubmission(v, base));
  });

  // GET /api/reports/mine?date=today|YYYY-MM-DD — the signed-in user's own reports.
  r.get('/reports/mine', requireAuth, async (req, res) => {
    const f = { userId: req.user.id };
    const today = nowParts().date;
    if (req.query.date === 'today') f.date = today;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '')) f.date = req.query.date;
    const list = await reports.find(f, { sort: { createdAt: -1 }, limit: 300 });
    res.json({ today, reports: list.map(normalizeReport) });
  });

  // ---- admin / AI agents (read-only) ----
  // GET /api/admin/reports?from=YYYY-MM-DD&to=YYYY-MM-DD&storeId=&shift=1|2|3&smallCounterId=
  r.get('/admin/reports', adminOrAiKey, async (req, res) =>
    res.json(
      (await reports.find(filterFrom(req.query), { sort: { date: -1, createdAt: -1 }, limit: 2000 })).map(normalizeReport),
    ),
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

  // Totals per day, shift and small counter (quầy nhỏ).
  r.get('/admin/reports/by-counter', adminOrAiKey, async (req, res) => {
    const list = await reports.find(filterFrom(req.query), { limit: 20000 });
    const map = new Map();
    for (const x of list) {
      const k = `${x.date}|${x.shift}|${x.smallCounterId}`;
      const row = map.get(k) || {
        date: x.date, shift: x.shift, storeId: x.storeId, storeName: x.storeName,
        bigCounterId: x.bigCounterId, bigCounterName: x.bigCounterName,
        smallCounterId: x.smallCounterId, smallCounterName: x.smallCounterName,
        total: 0, reportCount: 0,
      };
      row.total += x.total;
      row.reportCount += 1;
      map.set(k, row);
    }
    const rows = [...map.values()].sort(
      (a, b) => b.date.localeCompare(a.date) || a.shift - b.shift ||
        a.storeName.localeCompare(b.storeName) || a.bigCounterName.localeCompare(b.bigCounterName) ||
        a.smallCounterName.localeCompare(b.smallCounterName),
    );
    res.json({ rows, grandTotal: rows.reduce((s, x) => s + x.total, 0) });
  });

  r.get('/admin/reports/:id', adminOrAiKey, async (req, res) => {
    const x = await reports.get(req.params.id);
    x ? res.json(normalizeReport(x)) : res.status(404).json({ error: 'Không tìm thấy' });
  });

  return r;
}
