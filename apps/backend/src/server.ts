import path from 'node:path';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import pinoHttp from 'pino-http';
import { env } from './env.js';
import { authMiddleware } from './middleware/auth.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import activosRoutes from './routes/activos.js';
import avancesRoutes from './routes/avances.js';
import conciliacionRoutes from './routes/conciliacion.js';
import contabilidadRoutes from './routes/contabilidad.js';
import catalogosRoutes from './routes/catalogos.js';
import cpeRoutes from './routes/cpe.js';
import contractualRoutes from './routes/contractual.js';
import documentosRoutes from './routes/documentos.js';
import finanzasRoutes from './routes/finanzas.js';
import planillaRoutes from './routes/planilla.js';
import iaRoutes from './routes/ia.js';
import inversionesRoutes from './routes/inversiones.js';
import logisticaRoutes from './routes/logistica.js';
import notificacionesRoutes from './routes/notificaciones.js';
import oficinaRoutes from './routes/oficina.js';
import planillaOficinaRoutes from './routes/planillaOficina.js';
import profesionalesRoutes from './routes/profesionales.js';
import proyectosRoutes from './routes/proyectos.js';
import reportesRoutes from './routes/reportes.js';
import usuariosRoutes from './routes/usuarios.js';

// TLS self-signed (Synology HTTPS LAN)
if (env.NAS_TLS_INSECURE) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

// Guard · un error async no manejado en una ruta NO debe matar todo el backend
// (Express 4 no captura rejections de handlers async · el request queda colgado pero el server vive)
process.on('unhandledRejection', (err) => {
  console.error('⚠ UNHANDLED REJECTION (ruta async sin try/catch):', err);
});

const app = express();
// Deshabilitar ETag · evita 304 que rompe req helper en frontend (body vacío en res.json())
app.set('etag', false);

app.use(compression()); // gzip respuestas JSON (dashboard, listas) · ~60-80% menos transferencia
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
app.use('/api/admin', adminRoutes); // roles + matriz permisos + módulos + empresas (admin)
app.use('/api/proyectos', proyectosRoutes);
app.use('/api/inversiones', inversionesRoutes);
app.use('/api/logistica', logisticaRoutes);
app.use('/api', avancesRoutes); // POST /api/partidas/:id/avances + GET /api/proyectos/:id/avances
app.use('/api', contractualRoutes); // hitos · garantías · adelantos (por proyecto)
app.use('/api', documentosRoutes); // NAS Synology · documentos por proyecto
app.use('/api', finanzasRoutes); // gastos reales (Fact de Compras) · cuentas bancarias
app.use('/api', planillaRoutes); // FIN-4 · planilla construcción civil
app.use('/api', oficinaRoutes); // FIN-5 · oficina · rendiciones / viáticos
app.use('/api/oficina', planillaOficinaRoutes); // FIN-5B · planilla oficina (régimen general)
app.use('/api/contabilidad', contabilidadRoutes); // PCGE · asientos · diario/mayor · fiscal
app.use('/api/catalogos', catalogosRoutes); // Fase 0 · catálogos SUNAT · detracciones · tipo de cambio manual
app.use('/api/cpe', cpeRoutes); // lector XML CPE → borrador (no escribe)
app.use('/api/conciliacion', conciliacionRoutes); // H3 · conciliación bancaria (ERP ↔ extracto)
app.use('/api', activosRoutes); // activos · herramientas y equipos + traslados
app.use('/api', notificacionesRoutes); // alertas / campana
app.use('/api', usuariosRoutes); // usuarios para asignar responsables
app.use('/api', reportesRoutes); // reportes financieros (A2/A4/A5) + export Excel
app.use('/api', profesionalesRoutes); // padrón de profesionales (equipo de obra)
app.use('/api/ia', iaRoutes);

// Servir frontend compilado · solo en build Docker (SERVE_STATIC=1) · 1 contenedor = 1 URL.
// En dev queda inerte (el frontend lo sirve Vite).
if (process.env.SERVE_STATIC === '1') {
  const distDir = process.env.FRONTEND_DIST || path.resolve(process.cwd(), 'apps/frontend/dist');
  app.use(express.static(distDir));
  // SPA fallback · cualquier GET que no sea /api devuelve index.html (React Router)
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) return res.sendFile(path.join(distDir, 'index.html'));
    next();
  });
}

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
