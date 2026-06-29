import { db, schema } from '@erp/db';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { nasDownload, nasInitProyecto, nasList, nasProyectoPath, nasCreateFolder, nasUpload } from '../lib/nas.js';

const router = Router();
router.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

async function proyectoCodigo(id: string): Promise<string | null> {
  const [p] = await db.select({ codigo: schema.proyectos.codigo }).from(schema.proyectos).where(eq(schema.proyectos.id, id)).limit(1);
  return p?.codigo ?? null;
}

// Guard · el path debe estar dentro de la carpeta del proyecto
function dentroDeProyecto(codigo: string, path: string): boolean {
  const base = nasProyectoPath(codigo);
  return path === base || path.startsWith(`${base}/`);
}

// GET listar · ?path= (default = carpeta del proyecto)
router.get('/proyectos/:id/documentos', async (req, res) => {
  try {
    const codigo = await proyectoCodigo(req.params.id!);
    if (!codigo) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const base = nasProyectoPath(codigo);
    const path = (req.query.path as string) || base;
    if (!dentroDeProyecto(codigo, path)) return res.status(400).json({ error: 'Ruta fuera del proyecto' });
    const files = await nasList(path);
    res.json({ base, path, files });
  } catch (e) {
    res.status(502).json({ error: `NAS: ${(e as Error).message}` });
  }
});

// POST crear estructura 13 carpetas
router.post('/proyectos/:id/documentos/init', async (req, res) => {
  try {
    const codigo = await proyectoCodigo(req.params.id!);
    if (!codigo) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const creadas = await nasInitProyecto(codigo);
    res.json({ ok: true, base: nasProyectoPath(codigo), creadas });
  } catch (e) {
    res.status(502).json({ error: `NAS: ${(e as Error).message}` });
  }
});

// POST crear subcarpeta · { path (parent), name }
router.post('/proyectos/:id/documentos/folder', async (req, res) => {
  try {
    const codigo = await proyectoCodigo(req.params.id!);
    if (!codigo) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const { path, name } = req.body as { path?: string; name?: string };
    const parent = path || nasProyectoPath(codigo);
    if (!name?.trim()) return res.status(400).json({ error: 'nombre obligatorio' });
    if (!dentroDeProyecto(codigo, parent)) return res.status(400).json({ error: 'Ruta fuera del proyecto' });
    await nasCreateFolder(parent, name.trim());
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: `NAS: ${(e as Error).message}` });
  }
});

// POST subir · multipart file + body.path (carpeta destino)
router.post('/proyectos/:id/documentos/upload', upload.single('file'), async (req, res) => {
  try {
    const codigo = await proyectoCodigo(String(req.params.id));
    if (!codigo) return res.status(404).json({ error: 'Proyecto no encontrado' });
    if (!req.file) return res.status(400).json({ error: 'Sin archivo' });
    const dest = (req.body.path as string) || nasProyectoPath(codigo);
    if (!dentroDeProyecto(codigo, dest)) return res.status(400).json({ error: 'Ruta fuera del proyecto' });
    await nasUpload(dest, req.file.originalname, req.file.buffer);
    res.json({ ok: true, archivo: req.file.originalname });
  } catch (e) {
    res.status(502).json({ error: `NAS: ${(e as Error).message}` });
  }
});

// GET descargar · ?path= (stream)
router.get('/proyectos/:id/documentos/download', async (req, res) => {
  try {
    const codigo = await proyectoCodigo(req.params.id!);
    if (!codigo) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const path = req.query.path as string;
    if (!path || !dentroDeProyecto(codigo, path)) return res.status(400).json({ error: 'Ruta inválida' });
    const { stream, filename } = await nasDownload(path);
    if (!stream) return res.status(502).json({ error: 'NAS sin stream' });
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    stream.on('error', () => { if (!res.headersSent) res.status(502).json({ error: 'NAS download error' }); });
    stream.pipe(res);
  } catch (e) {
    res.status(502).json({ error: `NAS: ${(e as Error).message}` });
  }
});

// ─── NAS global (Documentos del ERP) · raíces curadas ────────
// Solo estas raíces son navegables desde la vista global (no exponer homes/sistema).
const RAICES_GLOBAL = ['/Drive', '/Proyectos', '/Administración', '/Logistica'];
const normPath = (p: string) => `/${p.replace(/^\/+|\/+$/g, '')}`;
function raizPermitida(path: string): boolean {
  const n = normPath(path);
  return RAICES_GLOBAL.some((r) => n === r || n.startsWith(`${r}/`));
}

// GET /nas?path= · listar dentro de una raíz permitida
router.get('/nas', async (req, res) => {
  try {
    const path = (req.query.path as string) || '';
    if (!path || !raizPermitida(path)) return res.status(400).json({ error: 'Ruta no permitida' });
    const files = await nasList(path);
    res.json({ path: normPath(path), files });
  } catch (e) {
    res.status(502).json({ error: `NAS: ${(e as Error).message}` });
  }
});

// POST /nas/upload · multipart file + body.path (carpeta destino · dentro de raíz permitida)
router.post('/nas/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Sin archivo' });
    const dest = (req.body.path as string) || '';
    if (!dest || !raizPermitida(dest)) return res.status(400).json({ error: 'Ruta no permitida' });
    await nasUpload(dest, req.file.originalname, req.file.buffer);
    res.json({ ok: true, archivo: req.file.originalname });
  } catch (e) {
    res.status(502).json({ error: `NAS: ${(e as Error).message}` });
  }
});

// GET /nas/download?path= (stream)
router.get('/nas/download', async (req, res) => {
  try {
    const path = req.query.path as string;
    if (!path || !raizPermitida(path)) return res.status(400).json({ error: 'Ruta no permitida' });
    const { stream, filename } = await nasDownload(path);
    if (!stream) return res.status(502).json({ error: 'NAS sin stream' });
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    stream.on('error', () => { if (!res.headersSent) res.status(502).json({ error: 'NAS download error' }); });
    stream.pipe(res);
  } catch (e) {
    res.status(502).json({ error: `NAS: ${(e as Error).message}` });
  }
});

export default router;
