import cors from 'cors';
import express from 'express';
import pinoHttp from 'pino-http';
import { env } from './env.js';
import { authMiddleware } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import avancesRoutes from './routes/avances.js';
import iaRoutes from './routes/ia.js';
import logisticaRoutes from './routes/logistica.js';
import proyectosRoutes from './routes/proyectos.js';

// TLS self-signed (Synology HTTPS LAN)
if (env.NAS_TLS_INSECURE) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const app = express();
// Deshabilitar ETag · evita 304 que rompe req helper en frontend (body vacío en res.json())
app.set('etag', false);

app.use(
  pinoHttp({
    transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
  }),
);
app.use(
  cors({
    origin: env.CORS_ORIGIN.split(','),
    credentials: true,
  }),
);
app.use(express.json({ limit: '5mb' }));
app.use(authMiddleware);

// Health
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, env: env.NODE_ENV, ts: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/proyectos', proyectosRoutes);
app.use('/api/logistica', logisticaRoutes);
app.use('/api', avancesRoutes); // POST /api/partidas/:id/avances + GET /api/proyectos/:id/avances
app.use('/api/ia', iaRoutes);

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado' });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? 'Error interno' });
});

app.listen(env.PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ ERP Backend v2.0 · ${env.NODE_ENV}`);
  console.log(`   → http://localhost:${env.PORT}`);
  console.log(`   → CORS: ${env.CORS_ORIGIN}`);
  console.log(`   → DB:   ${env.DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`   → NAS:  ${env.NAS_URL}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
