import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config.js';
import { requireAuth, safeEqual, signToken } from '../middleware/auth.js';

export default function authRoutes({ users }) {
  const r = Router();

  r.post('/login', async (req, res) => {
    const body = z.object({ name: z.string().min(1), password: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Thiếu tên hoặc mật khẩu' });
    const { name, password } = body.data;
    const bad = () => res.status(401).json({ error: 'Sai tên hoặc mật khẩu' });

    if (name.trim().toLowerCase() === 'admin') {
      if (!safeEqual(password, config.adminPassword)) return bad();
      const user = { id: 'admin', name: 'Admin', role: 'admin' };
      return res.json({ token: signToken(user), user });
    }
    const [u] = await users.find({ nameKey: name.trim().toLowerCase() });
    if (!u || !u.active || !(await bcrypt.compare(password, u.passwordHash))) return bad();
    const user = { id: u.id, name: u.name, role: 'staff' };
    res.json({ token: signToken(user), user });
  });

  r.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));
  return r;
}
