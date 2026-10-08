import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';

const name = z.object({ name: z.string().trim().min(1).max(100) });

// stores -> big counters (Quầy lớn) -> small counters (Quầy nhỏ)
export async function loadCatalog({ stores, counters }) {
  const [s, c] = await Promise.all([
    stores.find({}, { sort: { name: 1 } }),
    counters.find({}, { sort: { name: 1 } }),
  ]);
  return s.map((st) => ({
    id: st.id,
    name: st.name,
    bigCounters: c
      .filter((x) => x.storeId === st.id && !x.parentId)
      .map((big) => ({
        id: big.id,
        name: big.name,
        smallCounters: c.filter((x) => x.parentId === big.id).map((x) => ({ id: x.id, name: x.name })),
      })),
  }));
}

export default function catalogRoutes(repos) {
  const { stores, counters } = repos;
  const r = Router();

  r.get('/stores', requireAuth, async (_req, res) => res.json(await loadCatalog(repos)));

  const adm = [requireAuth, requireRole('admin')];

  r.post('/admin/stores', adm, async (req, res) => {
    const b = name.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Tên cửa hàng không hợp lệ' });
    res.status(201).json(await stores.insert({ name: b.data.name }));
  });
  r.patch('/admin/stores/:id', adm, async (req, res) => {
    const b = name.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Tên không hợp lệ' });
    res.json(await stores.update(req.params.id, { name: b.data.name }));
  });
  r.delete('/admin/stores/:id', adm, async (req, res) => {
    await counters.removeMany({ storeId: req.params.id });
    await stores.remove(req.params.id);
    res.status(204).end();
  });

  // Big counter: POST body {name}; small counter: POST body {name, parentId}
  r.post('/admin/stores/:id/counters', adm, async (req, res) => {
    const b = name.extend({ parentId: z.string().optional() }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Tên quầy không hợp lệ' });
    if (!(await stores.get(req.params.id))) return res.status(404).json({ error: 'Không tìm thấy cửa hàng' });
    if (b.data.parentId) {
      const parent = await counters.get(b.data.parentId);
      if (!parent || parent.storeId !== req.params.id || parent.parentId)
        return res.status(400).json({ error: 'Quầy lớn không hợp lệ' });
    }
    res.status(201).json(
      await counters.insert({ storeId: req.params.id, parentId: b.data.parentId || null, name: b.data.name }),
    );
  });
  r.patch('/admin/counters/:id', adm, async (req, res) => {
    const b = name.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Tên quầy không hợp lệ' });
    if (!(await counters.get(req.params.id))) return res.status(404).json({ error: 'Không tìm thấy quầy' });
    res.json(await counters.update(req.params.id, { name: b.data.name }));
  });
  r.delete('/admin/counters/:id', adm, async (req, res) => {
    await counters.removeMany({ parentId: req.params.id });
    await counters.remove(req.params.id);
    res.status(204).end();
  });

  return r;
}
