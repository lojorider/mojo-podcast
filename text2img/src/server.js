import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import express from 'express';
import cors from 'cors';
import generateRouter from './routes/generate.js';
import iconRouter from './routes/icon.js';
import optimizeRouter from './routes/optimize.js';
import bananaRouter from './routes/banana.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from project root
dotenv.config({ path: path.join(__dirname, '../.env.local') });
dotenv.config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3210;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Routes
app.get('/', (_req, res) => {
  const pkg = { name: 'text2img', version: '1.0.0' };
  res.json({
    name: pkg.name,
    version: pkg.version,
    description: 'Express API for AI image generation using Cloudflare Workers AI (FLUX-1-Schnell)',
    status: 'running',
    endpoints: {
      health: '/api/health',
      generate: 'POST /api/generate',
      generateIcon: 'POST /api/generate/icon',
      optimize: 'POST /api/optimize',
      banana: 'POST /api/banana',
      bananaIcon: 'POST /api/banana/generate/icon',
      bananaEdit: 'POST /api/banana/edit',
      bananaRemoveBg: 'POST /api/banana/remove-bg',
      docs: '/docs/openapi.yaml',
    },
    documentation: `/docs/openapi.yaml`,
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'text2img', uptime: process.uptime() });
});

// Serve OpenAPI spec
app.use('/docs', express.static(path.join(__dirname, '../docs')));

app.use('/api/generate/icon', iconRouter);
app.use('/api/generate', generateRouter);
app.use('/api/optimize', optimizeRouter);
app.use('/api/banana', bananaRouter);

// Error handling
app.use((err, _req, res, _next) => {
  console.error('[error]', err.message);
  const status = err.statusCode || 500;
  res.status(status).json({
    success: false,
    error: err.message,
    ...(err.code && { code: err.code }),
  });
});

app.listen(PORT, () => {
  console.log(`text2img server running on http://localhost:${PORT}`);
});
