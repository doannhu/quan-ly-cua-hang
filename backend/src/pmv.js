// Parsing PMV "BC008 – Báo cáo xuất nhập tồn theo quầy" CSV exports, and matching PMV counter
// names (quầy nhỏ) to the app's small counters.

// Minimal RFC 4180 CSV parser: quoted fields may contain commas, quotes ("") and line breaks.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// PMV numbers use "," for thousands and "." for decimals: "1,314" -> 1314, "1,123.893" -> 1123.893
const num = (s) => {
  const n = Number(String(s ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const ddmmyyyy = (s) => {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s || '');
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};

/**
 * Parse a BC008 export. Every CSV record repeats the report header, then holds one line:
 * store, quầy lớn, quầy nhỏ, mã vàng, and 6 groups of [SL, TL vàng, TLV+H, Vàng quy 10]:
 * Đầu ngày, Nhập, Bán lẻ, Bán sỉ, Xuất hàng, Còn lại. "Còn lại" is the system stock we compare with.
 * Returns { reportCode, storeName, fromDate, toDate, items: [{bigName, smallName, goldCode, ...}] }.
 */
export function parseBC008(text) {
  const rows = parseCsv(String(text || '').replace(/^﻿/, ''));
  if (!rows.length) throw new Error('File trống');
  const first = rows[0];
  const headerIdx = first.findIndex((v) => /^Qu[ầa]y$/i.test(clean(v)));
  if (!first.some((v) => /BC008/.test(v)) || headerIdx < 0)
    throw new Error('Không phải file BC008 (Báo cáo xuất nhập tồn theo quầy) của PMV');

  // group labels in header order, e.g. ["Đầu ngày","Nhập","Bán lẻ","Bán sỉ","Xuất hàng","Còn lại"]
  const groups = ['Đầu ngày', 'Nhập', 'Bán lẻ', 'Bán sỉ', 'Xuất hàng', 'Còn lại'];
  const labels = first.map(clean);
  const order = groups.map((g) => labels.indexOf(g));
  if (order.some((i) => i < 0)) throw new Error('Thiếu cột trong file BC008 (cần: ' + groups.join(', ') + ')');
  // data starts right after the last header cell ("Vàng quy 10" of "Còn lại")
  const dataStart = labels.indexOf('Còn lại') + 5;
  const rank = (label) => groups.indexOf(label); // 0..5
  const at = (r, label, k) => r[dataStart + 4 + rank(label) * 4 + k]; // k: 0 SL, 1 TL vàng, 2 TLV+H, 3 VQ10

  const period = first.find((v) => /Đến ngày/i.test(v)) || '';
  const fromDate = ddmmyyyy(/Từ ngày:?\s*([\d/]+)/i.exec(period)?.[1]);
  const toDate = ddmmyyyy(/Đến ngày:?\s*([\d/]+)/i.exec(period)?.[1]);
  if (!toDate) throw new Error('Không đọc được ngày của báo cáo trong file');
  const storeName = clean(first[dataStart] || '').replace(/^[^:]*:\s*/, '') || clean(first[0]).replace(/^Cửa hàng:\s*/i, '');

  const items = rows
    .filter((r) => r.length > dataStart + 4 + 24 && clean(r[dataStart + 2]))
    .map((r) => ({
      bigName: clean(r[dataStart + 1]),
      smallName: clean(r[dataStart + 2]),
      goldCode: clean(r[dataStart + 3]),
      openingQty: num(at(r, 'Đầu ngày', 0)),
      inQty: num(at(r, 'Nhập', 0)),
      retailQty: num(at(r, 'Bán lẻ', 0)),
      wholesaleQty: num(at(r, 'Bán sỉ', 0)),
      outQty: num(at(r, 'Xuất hàng', 0)),
      qty: num(at(r, 'Còn lại', 0)),
      weight: num(at(r, 'Còn lại', 1)),
    }));
  if (!items.length) throw new Error('File BC008 không có dòng hàng nào');
  return { reportCode: 'BC008', storeName, fromDate, toDate, items };
}

// ---------- matching app counters to PMV quầy nhỏ ----------
const norm = (s) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
const tokens = (s) => new Set(norm(s).split(/[^a-z0-9]+/).filter(Boolean));

/**
 * Suggest the PMV quầy nhỏ for an app small counter, or null if there's no clear single match.
 * Every word of the app small counter's name must appear in the PMV name; among those, prefer the one
 * sharing the most words with the big counter's name (e.g. "610", "trắng 10k"), then the fewest extra words.
 */
export function suggestPmvName(bigName, smallName, pmvNames) {
  const small = tokens(smallName);
  if (!small.size) return null;
  const all = new Set([...small, ...tokens(bigName)]);
  let best = null;
  let bestScore = -Infinity;
  let tie = false;
  for (const name of pmvNames) {
    const t = tokens(name);
    if (![...small].every((w) => t.has(w))) continue;
    const overlap = [...t].filter((w) => all.has(w)).length;
    const extra = [...t].filter((w) => !all.has(w)).length;
    const score = overlap * 10 - extra;
    if (score > bestScore) { best = name; bestScore = score; tie = false; }
    else if (score === bestScore) tie = true;
  }
  return tie ? null : best;
}

// Silver products («bạc») — e.g. Bạc món Dây, Kiềng cổ bạc.
export const isSilver = (name) => tokens(name).has('bac');

// Big counters whose small counters map to one product per purity grade, e.g. «Quầy vàng y › Bông» =
// «Bông 980» + «Bông 995». Each grade lists accepted name suffixes in order of preference: the BC008 file only has
// «… 995» for Bông and «… 999» (same gold code V999) for Dây/Lắc/Mặt/Nhẫn/Vòng.
export const PURITY_COUNTERS = [{ bigWords: ['vang', 'y'], grades: [['980'], ['995', '999']] }];
const GENERIC = new Set(['quay', 'vang']); // words in big-counter names that say nothing about the product

/**
 * Suggested PMV products for an app small counter (an array; [] = no confident suggestion):
 *  1. purity counters (Quầy vàng y): «<small> 980» + «<small> 995|999», whichever exist in the file;
 *  2. the single name-based match (suggestPmvName);
 *  3. fallback when no PMV name contains the small counter's words (e.g. «5 chỉ» in Quầy nhẫn tròn):
 *     the one PMV product containing all meaningful words of the big counter («Nhẫn Tròn 9999»).
 */
export function suggestPmvNames(bigName, smallName, pmvNames) {
  const big = tokens(bigName);
  const byNorm = new Map(pmvNames.map((n) => [norm(n).replace(/\s+/g, ' ').trim(), n]));
  const rule = PURITY_COUNTERS.find((r) => r.bigWords.every((w) => big.has(w)));
  if (rule) {
    const found = rule.grades
      .map((suffixes) => suffixes.map((s) => byNorm.get(norm(`${smallName} ${s}`))).find(Boolean))
      .filter(Boolean);
    if (found.length) return found;
  }
  const one = suggestPmvName(bigName, smallName, pmvNames);
  if (one) return [one];
  const small = tokens(smallName);
  if (!pmvNames.some((n) => [...small].every((w) => tokens(n).has(w)))) {
    const words = [...big].filter((w) => !GENERIC.has(w));
    const hits = words.length ? pmvNames.filter((n) => words.every((w) => tokens(n).has(w))) : [];
    if (hits.length === 1) return hits;
  }
  return [];
}
