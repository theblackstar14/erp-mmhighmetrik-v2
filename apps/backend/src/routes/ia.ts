import { Router } from 'express';
import multer from 'multer';
import { parseContractWithGemini } from '../lib/gemini.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max PDF (Gemini límite)
});

// POST /api/ia/parse-contract · sube PDF, retorna JSON estructurado
router.post('/parse-contract', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!req.file.mimetype.includes('pdf')) {
      return res.status(400).json({ error: 'Solo se aceptan PDFs' });
    }
    const data = await parseContractWithGemini(req.file.buffer);
    res.json({ ok: true, data });
  } catch (e) {
    console.error('Gemini parse-contract error:', e);
    res.status(500).json({ error: (e as Error).message ?? 'Error parseando contrato' });
  }
});

export default router;
