import jwt from 'jsonwebtoken';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

export const signToken = (user) =>
  jwt.sign({ sub: user.id, name: user.name, role: user.role }, config.jwtSecret, { expiresIn: '12h' });

const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer /, '');

export function requireAuth(req, res, next) {
  try {
    const p = jwt.verify(bearer(req), config.jwtSecret);
    req.user = { id: p.sub, name: p.name, role: p.role };
    next();
  } catch {
    res.status(401).json({ error: 'Chưa đăng nhập hoặc phiên đã hết hạn' });
  }
}

export const requireRole = (role) => (req, res, next) =>
  req.user?.role === role ? next() : res.status(403).json({ error: 'Không có quyền' });

// Read-only access for AI agents: either an admin JWT or the X-API-Key header.
export function adminOrAiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key && config.aiApiKey && safeEqual(key, config.aiApiKey)) {
    req.user = { id: 'ai-agent', name: 'AI agent', role: 'ai' };
    return next();
  }
  requireAuth(req, res, () => requireRole('admin')(req, res, next));
}
