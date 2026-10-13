/**
 * Proxy al scraper SEACE (servicio aparte · Desktop/SEACE · HANDOFF.md §4).
 * El navegador NUNCA habla directo con el scraper: este proxy agrega el x-api-key
 * (que no debe llegar al cliente) y limita las rutas a las del contrato v2.
 * Sin SEACE_API_URL/KEY configurados responde 503 con mensaje claro.
 */
import { Router } from 'express';
import { env } from '../env.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Rutas permitidas del contrato (GET). Descarga va aparte (stream binario).
const GET_OK = /^\/(alertas|procesos(\/[^/]+)?|ubicaciones|empresa|runs|last-run)$/;

function upstream() {
  if (!env.SEACE_API_URL || !env.SEACE_API_KEY) return null;
  return { base: env.SEACE_API_URL.replace(/\/$/, ''), key: env.SEACE_API_KEY };
}

router.all('/seace/*', async (req, res) => {
  const up = upstream();
  if (!up) return res.status(503).json({ error: 'SEACE no configurado · define SEACE_API_URL y SEACE_API_KEY en el .env del backend' });

  const sub = req.path.replace(/^\/seace/, ''); // ej. /alertas · /procesos/123 · /procesos/123/documentos/abc/download
  const esDownload = /^\/procesos\/[^/]+\/documentos\/[^/]+\/download$/.test(sub);
  const esPin = /^\/procesos\/[^/]+\/pin$/.test(sub);
  const esEmpresa = sub === '/empresa';

  const permitido =
    (req.method === 'GET' && (GET_OK.test(sub) || esDownload)) ||
    (esPin && (req.method === 'PUT' || req.method === 'DELETE')) ||
    (esEmpresa && req.method === 'PUT');
  if (!permitido) return res.status(404).json({ error: 'ruta SEACE no permitida' });

  const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  const url = `${up.base}/api/v2${sub}${qs}`;
  try {
    const r = await fetch(url, {
      method: req.method,
      headers: {
        'x-api-key': up.key,
        ...(req.method === 'PUT' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: req.method === 'PUT' ? JSON.stringify(req.body ?? {}) : undefined,
    });

    if (esDownload) {
      // stream binario: content-type/disposition tal cual, cuerpo en streaming
      res.status(r.status);
      for (const h of ['content-type', 'content-disposition', 'content-length']) {
        const v = r.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      if (!r.body) return res.end();
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      return res.end();
    }

    const body = await r.text();
    res.status(r.status).type(r.headers.get('content-type') ?? 'application/json').send(body);
  } catch {
    res.status(502).json({ error: 'Scraper SEACE no alcanzable · ¿servicio arriba?' });
  }
});

export default router;
