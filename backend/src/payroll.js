import ExcelJS from 'exceljs';

// Payroll (tính lương): read the attendance export (bảng chấm công) and the shift schedule (lịch làm việc), then
// compute hours and pay per employee for one month. Times are minutes since midnight throughout.

export const DEFAULT_SETTINGS = {
  baseRate: 0, // lương giờ cơ bản (đ/giờ)
  allowancePerDay: 0, // phụ cấp mỗi ngày công
  insurance: 0, // tiền bảo hiểm trừ vào lương mỗi tháng (một số chung)
  seniorityPct: 10, // + % lương giờ cho mỗi năm làm việc đủ
  overtimePct: 150, // lương tăng ca = % lương giờ (không nhân đôi ngày 27+)
  doubleFromDay: 27, // từ ngày này trong tháng, giờ làm trong ca được tính gấp đôi
  shifts: { 1: { start: '07:00', end: '15:00' }, 2: { start: '13:30', end: '21:30' } },
};

// "Phượng", "PHU?NG" sheet "phượng", "MY LÊ" -> comparable keys ("phuong", "myle")
export const nameKey = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd')
  .toLowerCase().replace(/[^a-z0-9]/g, '');
const pad = (n) => String(n).padStart(2, '0');
export const hhmm = (m) => (m == null ? null : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const floor5 = (m) => m - (m % 5);

// Plain value of an exceljs cell: rich text joined, formula result, everything else as is.
function plain(v) {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return plain(v.result);
    if ('text' in v) return v.text;
  }
  return v;
}
// "07:13", "7:13:00", a time cell (Date on 1899-12-30, UTC) or a day fraction -> minutes, else null
function minutesOf(v) {
  v = plain(v);
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.getUTCHours() * 60 + v.getUTCMinutes();
  if (typeof v === 'number') return v >= 0 && v < 1 ? Math.round(v * 1440) % 1440 : null;
  const m = /^\s*(\d{1,2})[:hH.](\d{2})/.exec(String(v));
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
}
// date cell (Date at UTC midnight), "01/10/2026" or "2026-10-01" -> "2026-10-01", else null
function dateOf(v) {
  v = plain(v);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  return m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : null;
}

async function workbook(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw Object.assign(new Error('Không đọc được file Excel (.xlsx)'), { status: 400 });
  }
  return wb;
}
const rowValues = (ws, r) => { const out = []; ws.getRow(r).eachCell({ includeEmpty: true }, (c, i) => { out[i] = plain(c.value); }); return out; };

// Bảng chấm công: any number of sheets, each with a header row "Mã nhân viên | Tên nhân viên | Ngày | Giờ vào | Giờ ra | Ca".
// -> [{ code, name, sheet, date, in, out, machineShift }]
export async function parseTimesheet(buffer) {
  const wb = await workbook(buffer);
  const rows = [];
  for (const ws of wb.worksheets) {
    let cols = null;
    for (let r = 1; r <= ws.rowCount; r++) {
      const v = rowValues(ws, r);
      if (!cols) {
        const keys = v.map(nameKey);
        const at = (k) => keys.indexOf(k);
        if (at('manhanvien') > 0 && at('ngay') > 0) {
          cols = { code: at('manhanvien'), name: at('tennhanvien'), date: at('ngay'), in: at('giovao'), out: at('giora'), shift: at('ca') };
        }
        continue;
      }
      const date = dateOf(v[cols.date]);
      const code = String(v[cols.code] ?? '').trim();
      if (!date || !code) continue;
      rows.push({
        code, name: String(v[cols.name] ?? '').trim(), sheet: ws.name, date,
        in: minutesOf(v[cols.in]), out: minutesOf(v[cols.out]), machineShift: String(v[cols.shift] ?? '').trim(),
      });
    }
  }
  if (!rows.length) throw Object.assign(new Error('Không tìm thấy dòng chấm công (cần cột «Mã nhân viên», «Ngày», «Giờ vào», «Giờ ra»)'), { status: 400 });
  return rows;
}

// Lịch làm việc: a header row with "NGÀY" and the shift titles ("CA 1 (7h-15h)", "CA 2 (13h30-21h30)"); every later row
// is a day with the names working each shift. Names from the "CA 2" column onwards (also past the title) are Ca 2.
// -> [{ date, shifts: { 1: [names], 2: [names] } }]
// A sheet may hold several blocks (one per week or two), each with its own header row whose columns can differ: every
// header row resets the columns. Dates may be written without the year ("12/10"): the year comes from the full dates
// around them (the last one before, else the first in the file), moving on a year when the month wraps (12 -> 1).
export async function parseSchedule(buffer) {
  const wb = await workbook(buffer);
  const days = [];
  const sheets = wb.worksheets.map((ws) => Array.from({ length: ws.rowCount }, (_, i) => rowValues(ws, i + 1)));
  const fullDates = sheets.flat().flatMap((v) => v.slice(0, 3).map(dateOf).filter(Boolean));
  let year = fullDates.length ? Number(fullDates[0].slice(0, 4)) : new Date().getFullYear();
  let lastMonth = 0;
  for (const rows of sheets) {
    let head = null;
    for (const v of rows) {
      const keys = v.map(nameKey);
      const dateCol = keys.indexOf('ngay');
      const c1 = keys.findIndex((k) => k?.startsWith('ca1'));
      const c2 = keys.findIndex((k) => k?.startsWith('ca2'));
      if (dateCol > 0 && c1 > 0 && c2 > c1) { head = { dateCol, c1, c2 }; continue; }
      if (!head) continue;
      let date = dateOf(v[head.dateCol]);
      const short = !date && /^\s*(\d{1,2})[/.-](\d{1,2})\s*$/.exec(String(plain(v[head.dateCol]) ?? ''));
      if (short && +short[2] >= 1 && +short[2] <= 12 && +short[1] >= 1 && +short[1] <= 31) {
        if (+short[2] < lastMonth - 6) year += 1; // Dec -> Jan
        date = `${year}-${pad(short[2])}-${pad(short[1])}`;
      }
      if (!date) continue;
      year = Number(date.slice(0, 4));
      lastMonth = Number(date.slice(5, 7));
      const shifts = { 1: [], 2: [] };
      v.forEach((x, i) => {
        const name = typeof x === 'string' ? x.trim() : '';
        if (name && i >= head.c1) shifts[i >= head.c2 ? 2 : 1].push(name);
      });
      days.push({ date, shifts });
    }
  }
  if (!days.length) throw Object.assign(new Error('Không tìm thấy lịch (cần dòng tiêu đề «NGÀY», «CA 1», «CA 2» và các dòng ngày bên dưới)'), { status: 400 });
  return days;
}

// A schedule that is a repeating rotation (e.g. two weeks: Ca 1 one week, Ca 2 the next) laid over another month:
// day D of the month takes the file day at the same position in the cycle, counted from the file's first day, so
// weekdays and the alternating weeks stay aligned. The file must be consecutive days.
const dayNum = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5);
export function repeatSchedule(days, month) {
  const list = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const first = dayNum(list[0].date);
  const n = list.length;
  if (list.some((d, i) => dayNum(d.date) !== first + i)) {
    throw Object.assign(new Error('Lịch trong file không liên tục từng ngày — không lặp được cho tháng khác'), { status: 400 });
  }
  const out = [];
  const last = Number(lastDay(month).slice(8));
  for (let i = 1; i <= last; i++) {
    const date = `${month}-${pad(i)}`;
    const src = list[(((dayNum(date) - first) % n) + n) % n];
    out.push({ date, shifts: src.shifts, repeatedFrom: src.date });
  }
  return out;
}

// Full years from the start date to `on` (both YYYY-MM-DD).
export function yearsWorked(startDate, on) {
  if (!startDate) return 0;
  let y = Number(on.slice(0, 4)) - Number(startDate.slice(0, 4));
  if (on.slice(5) < startDate.slice(5)) y -= 1;
  return Math.max(0, y);
}
const lastDay = (month) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
};

// One employee's pay for a month.
//   rows: their timesheet rows of the month; schedule: { [date]: { 1: [names], 2: [names] } } (all days known);
//   notes: { [date]: { leave, overtime, text } } — leave (xin phép): late arrival / early leave counted as the full shift;
//   overtime (tăng ca): time after the end of the shift counts as overtime.
export function computeEmployee(emp, rows, schedule, notes, s, month) {
  const sh = Object.fromEntries(Object.entries(s.shifts).map(([k, x]) => [k, { start: toMin(x.start), end: toMin(x.end) }]));
  const split = (sh[1].start + sh[2].start) / 2; // checked in before this -> working Ca 1, else Ca 2
  const keys = new Set([emp.scheduleName, emp.name, ...(emp.altNames || [])].filter(Boolean).map(nameKey));
  const years = yearsWorked(emp.startDate, lastDay(month));
  const rate = s.baseRate * (1 + (s.seniorityPct / 100) * years);

  const byDate = new Map();
  for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) || []), r]);
  const days = [];
  for (const [date, list] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
    const note = notes[date] || {};
    const ins = list.map((r) => r.in).filter((x) => x != null);
    const outs = list.map((r) => r.out).filter((x) => x != null);
    const inAt = ins.length ? Math.min(...ins) : null;
    const outAt = outs.length ? Math.max(...outs) : null;
    if (inAt == null && outAt == null && !note.leave) continue; // absent (row "V" with no punches)
    const day = { date, in: hhmm(inAt), out: hhmm(outAt), rows: list.length, note, flags: [], info: [], minutes: 0, otMinutes: 0 };
    days.push(day);
    if (list.length > 1) day.flags.push(`Trùng ngày: ${list.length} dòng chấm công`);
    const sched = schedule[date];
    if (!sched) {
      day.flags.push('Không có lịch làm việc ngày này — chưa tính');
      continue;
    }
    day.scheduledShift = [1, 2].find((k) => sched[k].some((n) => keys.has(nameKey(n)))) || null;
    day.shift = inAt != null ? (inAt < split ? 1 : 2) : day.scheduledShift || 1;
    day.offShift = day.shift !== day.scheduledShift;
    if (day.offShift) day.flags.push(day.scheduledShift ? `Trái ca: lịch Ca ${day.scheduledShift}, làm Ca ${day.shift}` : `Không có trong lịch, làm Ca ${day.shift}`);
    const { start, end } = sh[day.shift];
    if (inAt == null && !note.leave) { day.flags.push('Thiếu giờ vào — chưa tính'); continue; }
    if (outAt == null && !note.leave) { day.flags.push('Thiếu giờ ra — chưa tính'); continue; }
    const from = note.leave ? start : Math.max(start, floor5(inAt));
    let to;
    if (outAt != null && outAt >= end) {
      to = end;
      if (note.overtime) day.otMinutes = Math.max(0, floor5(outAt) - end);
      else if (outAt - end >= 15) day.info.push(`Ra lúc ${hhmm(outAt)}, chưa ghi tăng ca — tính đến ${hhmm(end)}`);
    } else {
      to = note.leave ? end : floor5(outAt);
    }
    day.from = hhmm(from);
    day.to = hhmm(to);
    day.minutes = Math.max(0, to - from);
    day.double = Number(date.slice(8)) >= s.doubleFromDay;
    day.pay = Math.round((day.minutes / 60) * rate * (day.double ? 2 : 1));
    day.otPay = Math.round((day.otMinutes / 60) * rate * (s.overtimePct / 100));
  }

  const sum = (f) => days.reduce((t, d) => t + (f(d) || 0), 0);
  const workDays = days.filter((d) => d.minutes > 0 || d.otMinutes > 0).length;
  const regularPay = sum((d) => d.pay);
  const overtimePay = sum((d) => d.otPay);
  const allowance = workDays * s.allowancePerDay;
  const gross = regularPay + overtimePay + allowance;
  return {
    code: emp.code, name: emp.name, scheduleName: emp.scheduleName || '', startDate: emp.startDate || null, years, rate: Math.round(rate),
    days,
    totals: {
      workDays,
      hours: sum((d) => d.minutes) / 60,
      doubleHours: sum((d) => (d.double ? d.minutes : 0)) / 60,
      overtimeHours: sum((d) => d.otMinutes) / 60,
      offShiftHours: sum((d) => (d.offShift ? d.minutes + d.otMinutes : 0)) / 60,
      regularPay, overtimePay, allowance, gross,
      insurance: s.insurance,
      net: gross - s.insurance,
      flags: sum((d) => d.flags.length),
    },
  };
}
