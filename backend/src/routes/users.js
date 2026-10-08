import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';

const pub = ({ id, name, active, createdAt }) => ({ id, name, active, createdAt });

export default function userRoutes({ users }) {
  const r = Router();
  r.use(requireAuth, requireRole('admin'));

  r.get('/', async (_req, res) => res.json((await users.find({}, { sort: { name: 1 } })).map(pub)));

  r.post('/', async (req, res) => {
    const b = z
      .object({ name: z.string().trim().min(1).max(60), password: z.string().min(4).max(100) })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Tên hoặc mật khẩu không hợp lệ (mật khẩu tối thiểu 4 ký tự)' });
    const nameKey = b.data.name.toLowerCase();
    if (nameKey === 'admin') return res.status(409).json({ error: 'Tên này đã được dành riêng' });
    if ((await users.find({ nameKey })).length) return res.status(409).json({ error: 'Tên nhân viên đã tồn tại' });
    const u = await users.insert({
      name: b.data.name,
      nameKey,
      passwordHash: await bcrypt.hash(b.data.password, 10),
      role: 'staff',
      active: true,
    });
    res.status(201).json(pub(u));
  });

  r.patch('/:id', async (req, res) => {
    const b = z
      .object({ password: z.string().min(4).max(100).optional(), active: z.boolean().optional() })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
    const patch = {};
    if (b.data.password) patch.passwordHash = await bcrypt.hash(b.data.password, 10);
    if (b.data.active !== undefined) patch.active = b.data.active;
    if (!(await users.get(req.params.id))) return res.status(404).json({ error: 'Không tìm thấy' });
    res.json(pub(await users.update(req.params.id, patch)));
  });

  r.delete('/:id', async (req, res) => {
    await users.remove(req.params.id);
    res.status(204).end();
  });
  return r;
}
