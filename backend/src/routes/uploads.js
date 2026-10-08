import { Router } from 'express';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic' };

export default function uploadRoutes() {
  mkdirSync(config.uploadDir, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: config.uploadDir,
      filename: (_req, file, cb) => cb(null, randomUUID() + EXT[file.mimetype]),
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, Boolean(EXT[file.mimetype])),
  });

  const r = Router();
  r.post('/uploads', requireAuth, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Chỉ chấp nhận ảnh (jpg, png, webp)' });
    res.status(201).json({ url: `/uploads/${req.file.filename}` });
  });
  return r;
}
