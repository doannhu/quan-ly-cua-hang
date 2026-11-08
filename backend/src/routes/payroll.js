import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { DEFAULT_SETTINGS, computeEmployee, nameKey, parseSchedule, parseTimesheet, repeatSchedule } from '../payroll.js';

const MONTH = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const money = z.number().int().min(0).max(1e9);
// Excel files are posted as base64 JSON: { fileName, data }
const fileBody = z.object({ fileName: z.string().max(200).default(''), data: z.string().min(1) });
// Express 4 does not catch errors of async handlers (a bad Excel file): pass them on to the error handler
const h = (fn) => (req, res, next) => fn(req, res).catch(next);

// Tính lương (admin only): upload the attendance export and the shift schedule, set rates, add notes, read the result.
export default function payrollRoutes({ paySettings, payEmployees, payTimesheets, paySchedules, payNotes }) {
  const r = Router();
  const adm = [requireAuth, requireRole('admin')];

  async function loadSettings() {
    const [doc] = await paySettings.find({});
    return { doc, settings: { ...DEFAULT_SETTINGS, ...(doc || {}), shifts: { ...DEFAULT_SETTINGS.shifts, ...(doc?.shifts || {}) } } };
  }
  const readFile = (req) => {
    const b = fileBody.safeParse(req.body);
    if (!b.success) throw Object.assign(new Error('Thiếu file'), { status: 400 });
    return { fileName: b.data.fileName, buffer: Buffer.from(b.data.data, 'base64') };
  };

  r.get('/admin/payroll/settings', adm, h(async (req, res) => res.json((await loadSettings()).settings)));
  r.put('/admin/payroll/settings', adm, h(async (req, res) => {
    const shift = z.object({ start: z.string().regex(TIME), end: z.string().regex(TIME) });
    const b = z.object({
      baseRate: money, allowancePerDay: money, insurance: money,
      seniorityPct: z.number().min(0).max(100), overtimePct: z.number().min(100).max(500),
      doubleFromDay: z.number().int().min(1).max(32),
      shifts: z.object({ 1: shift, 2: shift }),
    }).partial().safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Cấu hình không hợp lệ' });
    const { doc, settings } = await loadSettings();
    const next = { ...settings, ...b.data, shifts: { ...settings.shifts, ...(b.data.shifts || {}) } };
    const { id: _id, createdAt: _c, ...data } = next;
    if (doc) await paySettings.update(doc.id, data);
    else await paySettings.insert(data);
    res.json(next);
  }));

  // Bảng chấm công: replaces the stored rows of every month in the file; employees are created / renamed by code.
  r.post('/admin/payroll/timesheet', adm, h(async (req, res) => {
    const { fileName, buffer } = readFile(req);
    const rows = await parseTimesheet(buffer);
    const byMonth = new Map();
    for (const x of rows) byMonth.set(x.date.slice(0, 7), [...(byMonth.get(x.date.slice(0, 7)) || []), x]);
    for (const [month, list] of byMonth) {
      for (const old of await payTimesheets.find({ month })) await payTimesheets.remove(old.id);
      await payTimesheets.insert({ month, fileName, rows: list, uploadedBy: req.user.name });
    }
    // employees: one per code; the sheet name keeps the accents a garbled export name may have lost ("PHU?NG" / "phượng")
    const known = new Map((await payEmployees.find({})).map((e) => [e.code, e]));
    let added = 0;
    for (const x of rows) {
      const e = known.get(x.code);
      const alt = [...new Set([...(e?.altNames || []), x.name, x.sheet].filter(Boolean))];
      if (!e) {
        known.set(x.code, await payEmployees.insert({ code: x.code, name: x.sheet.toUpperCase(), altNames: alt, startDate: null, scheduleName: '' }));
        added++;
      } else if (alt.length !== (e.altNames || []).length) {
        known.set(x.code, await payEmployees.update(e.id, { altNames: alt }));
      }
    }
    // the same employee on the same day more than once
    const seen = new Map();
    for (const x of rows) seen.set(`${x.code}|${x.date}`, (seen.get(`${x.code}|${x.date}`) || 0) + 1);
    const duplicates = [...seen].filter(([, n]) => n > 1).map(([k, n]) => {
      const [code, date] = k.split('|');
      return { code, name: known.get(code)?.name, date, rows: n };
    });
    res.status(201).json({ months: [...byMonth.keys()], rows: rows.length, employees: new Set(rows.map((x) => x.code)).size, added, duplicates });
  }));

  // Lịch làm việc: replaces the schedule of each day in the file. With `month` (YYYY-MM) the file is a rotation that is
  // repeated over that month instead (its own dates are not stored).
  r.post('/admin/payroll/schedule', adm, h(async (req, res) => {
    const { fileName, buffer } = readFile(req);
    const month = req.body.month == null ? null : String(req.body.month);
    if (month && !MONTH.test(month)) return res.status(400).json({ error: 'Tháng không hợp lệ' });
    const parsed = await parseSchedule(buffer);
    const days = month ? repeatSchedule(parsed, month) : parsed;
    for (const d of days) {
      for (const old of await paySchedules.find({ date: d.date })) await paySchedules.remove(old.id);
      await paySchedules.insert({ ...d, fileName });
    }
    // names in the schedule that match no employee yet (set "Tên trong lịch" on the employee)
    const emps = await payEmployees.find({});
    const keys = new Set(emps.flatMap((e) => [e.scheduleName, e.name, ...(e.altNames || [])]).filter(Boolean).map(nameKey));
    const unmatched = [...new Set(days.flatMap((d) => [...d.shifts[1], ...d.shifts[2]]))].filter((n) => !keys.has(nameKey(n)));
    const dates = days.map((d) => d.date).sort();
    const src = parsed.map((d) => d.date).sort();
    res.status(201).json({
      days: days.length, from: dates[0], to: dates.at(-1), unmatched,
      ...(month && { repeated: { from: src[0], to: src.at(-1), cycle: src.length } }),
    });
  }));

  r.put('/admin/payroll/employees/:code', adm, h(async (req, res) => {
    const b = z.object({
      name: z.string().trim().min(1).max(60), startDate: z.string().regex(DATE).nullable(), scheduleName: z.string().trim().max(60),
    }).partial().safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Thông tin nhân viên không hợp lệ' });
    const [e] = await payEmployees.find({ code: req.params.code });
    if (!e) return res.status(404).json({ error: 'Không có nhân viên này' });
    res.json(await payEmployees.update(e.id, b.data));
  }));

  // Admin note for one employee and day: leave (xin phép, counted as the full shift), overtime (tăng ca), free text.
  r.put('/admin/payroll/notes', adm, h(async (req, res) => {
    const b = z.object({
      code: z.string().min(1), date: z.string().regex(DATE),
      leave: z.boolean().default(false), overtime: z.boolean().default(false), text: z.string().trim().max(300).default(''),
    }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Ghi chú không hợp lệ' });
    const { code, date, ...note } = b.data;
    for (const old of await payNotes.find({ code, date })) await payNotes.remove(old.id);
    if (note.leave || note.overtime || note.text) await payNotes.insert({ code, date, ...note, by: req.user.name });
    res.json({ ok: true });
  }));

  // Months that have a timesheet, newest first.
  r.get('/admin/payroll/months', adm, h(async (req, res) => {
    const list = await payTimesheets.find({}, { sort: { month: -1 } });
    res.json(list.map(({ month, fileName, createdAt, uploadedBy, rows }) => ({ month, fileName, uploadedAt: createdAt, uploadedBy, rows: rows.length })));
  }));

  // The payroll of one month: per employee hours, pay and the day-by-day detail.
  r.get('/admin/payroll', adm, h(async (req, res) => {
    const month = String(req.query.month || '');
    if (!MONTH.test(month)) return res.status(400).json({ error: 'Tháng không hợp lệ' });
    const { settings } = await loadSettings();
    const [sheet] = await payTimesheets.find({ month });
    if (!sheet) return res.json({ month, settings, timesheet: null, employees: [] });
    const range = { $gte: `${month}-01`, $lte: `${month}-31` };
    const schedule = Object.fromEntries((await paySchedules.find({ date: range })).map((d) => [d.date, d.shifts]));
    const notes = {};
    for (const n of await payNotes.find({ date: range })) (notes[n.code] ||= {})[n.date] = n;
    const emps = new Map((await payEmployees.find({})).map((e) => [e.code, e]));
    const byCode = new Map();
    for (const x of sheet.rows) byCode.set(x.code, [...(byCode.get(x.code) || []), x]);
    const employees = [...byCode]
      .map(([code, rows]) => computeEmployee(emps.get(code) || { code, name: rows[0].name }, rows, schedule, notes[code] || {}, settings, month))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    res.json({
      month, settings,
      timesheet: { fileName: sheet.fileName, uploadedAt: sheet.createdAt, uploadedBy: sheet.uploadedBy, rows: sheet.rows.length },
      scheduleDays: Object.keys(schedule).length,
      employees,
    });
  }));

  return r;
}
