import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { connectDb } from './db/index.js';
import { adminOrAiKey } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import catalogRoutes, { loadCatalog } from './routes/catalog.js';
import userRoutes from './routes/users.js';
import reportRoutes from './routes/reports.js';
import uploadRoutes from './routes/uploads.js';
import { openapi } from './openapi.js';

const repos = await connectDb(config);
const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', immutable: true }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/openapi.json', (_req, res) => res.json(openapi));

app.use('/api/auth', authRoutes(repos));
app.use('/api/users', userRoutes(repos));
app.use('/api', catalogRoutes(repos));
app.use('/api', uploadRoutes());
app.use('/api', reportRoutes(repos));

// AI-agent friendly read-only helpers
app.get('/api/ai/stores', adminOrAiKey, async (_req, res) => res.json(await loadCatalog(repos)));
app.get('/api/ai/staff', adminOrAiKey, async (_req, res) =>
  res.json((await repos.users.find({}, { sort: { name: 1 } })).map(({ id, name, active }) => ({ id, name, active }))),
);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Lỗi máy chủ' });
});

app.listen(config.port, config.host, () =>
  console.log(`API listening on ${config.host}:${config.port} (db: ${config.dbDriver})`),
);
