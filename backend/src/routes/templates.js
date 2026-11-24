import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';

// The rows (mục) staff fill in for each small counter of the staff report come from a config file
// (config/position-templates.json), read on every request so edits apply without a restart.
export const OTHER_ITEM = 'Lí do khác'; // always last; staff type the reason
export const CABINET_ITEM = 'Trong tủ'; // "Trong tủ 1", "Trong tủ 2"… added by staff

// "CỔ TƯỜNG 2-TẦNG 1" -> "Cổ tường 2 - tầng 1": single spaces, spaced dashes, only the first letter capitalised.
export function sentenceCase(s) {
  const t = String(s).replace(/\s*-\s*/g, ' - ').replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi');
  return t.charAt(0).toLocaleUpperCase('vi') + t.slice(1);
}
export const key = (s) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();

export function loadTemplates(path = config.positionTemplatesPath) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const groups = raw.nhom || {};
  const items = (list) => {
    const out = [];
    for (const x of list || []) {
      if (String(x).startsWith('@')) {
        const g = groups[String(x).slice(1)];
        if (!g) throw new Error(`không có nhóm «${x}»`);
        out.push(...g);
      } else out.push(x);
    }
    // normalized, without duplicates or the automatic rows
    const seen = new Set([key(OTHER_ITEM)]);
    return out.map(sentenceCase).filter((x) => x && !seen.has(key(x)) && seen.add(key(x)) && !/^trong tu( \d+)?$/.test(key(x)));
  };
  // sai_so_trong_luong: allowed TL difference (± this still counts as Đủ); 0 = must match exactly
  const tolerance = (t) => Math.max(0, Number(t.sai_so_trong_luong) || 0);
  // sai_so_trong_luong_moi_sp: [from, to] per piece of the system quantity: counted TL must be heavier than the system
  // TL by qty × from … qty × to (e.g. tags weighed too); null when not set
  const perPiece = (t) => {
    const r = t.sai_so_trong_luong_moi_sp;
    if (!Array.isArray(r) || r.length !== 2) return null;
    const [a, b] = r.map(Number);
    return Number.isFinite(a) && Number.isFinite(b) ? [Math.min(a, b), Math.max(a, b)] : null;
  };
  const template = (t) => ({
    cabinet: !!t.trong_tu, weight: !!t.trong_luong, weightTolerance: tolerance(t), weightPerPiece: perPiece(t), items: items(t.muc),
  });
  return {
    rules: (raw.quy_tac || []).map((t) => ({
      bigs: [].concat(t.quay_lon).map(key), smalls: t.quay_nho?.length ? t.quay_nho.map(key) : null, ...template(t),
    })),
    fallback: template(raw.mac_dinh || { trong_tu: true, muc: [] }),
  };
}

// The template of one small counter: { cabinet, weight (staff enter the total TL), weightTolerance, weightPerPiece, items }
export function templateFor(tpl, bigName, smallName) {
  const r = tpl.rules.find((x) => x.bigs.includes(key(bigName)) && (!x.smalls || x.smalls.includes(key(smallName))));
  return r
    ? { cabinet: r.cabinet, weight: r.weight, weightTolerance: r.weightTolerance, weightPerPiece: r.weightPerPiece, items: r.items }
    : tpl.fallback;
}

export default function templateRoutes({ counters }) {
  const r = Router();

  // GET /api/position-templates?storeId= -> { other, cabinet, counters: { [smallCounterId]: { cabinet, weight, items } } }
  r.get('/position-templates', requireAuth, async (req, res) => {
    let tpl;
    try {
      tpl = loadTemplates();
    } catch (e) {
      return res.status(500).json({ error: `File cấu hình mục báo cáo bị lỗi: ${e.message}` });
    }
    const all = await counters.find(req.query.storeId ? { storeId: String(req.query.storeId) } : {});
    const bigs = new Map(all.filter((c) => !c.parentId).map((c) => [c.id, c]));
    const out = {};
    for (const c of all) {
      const big = c.parentId && bigs.get(c.parentId);
      if (big) out[c.id] = templateFor(tpl, big.name, c.name);
    }
    res.json({ other: OTHER_ITEM, cabinet: CABINET_ITEM, counters: out });
  });

  return r;
}
