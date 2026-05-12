import { db, schema } from '@erp/db';
import { asc, eq, inArray, isNull } from 'drizzle-orm';
import { Router } from 'express';
import { classifyRecursosWithGemini } from '../lib/gemini.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// ─── RECURSOS · catálogo global ──────────────────────────────

// GET /api/logistica/recursos · lista global
router.get('/recursos', async (_req, res) => {
  const list = await db
    .select()
    .from(schema.recursos)
    .where(eq(schema.recursos.activo, true))
    .orderBy(asc(schema.recursos.codigo));

  // Stats agregados
  const stats = {
    total: list.length,
    porTipo: {
      mano_obra: list.filter((r) => r.tipo === 'mano_obra').length,
      material: list.filter((r) => r.tipo === 'material').length,
      equipo: list.filter((r) => r.tipo === 'equipo').length,
      herramienta: list.filter((r) => r.tipo === 'herramienta').length,
      subcontrato: list.filter((r) => r.tipo === 'subcontrato').length,
    },
    iuClasificados: list.filter((r) => r.iuCodigo !== null).length,
    sinIu: list.filter((r) => r.iuCodigo === null).length,
  };

  res.json({ recursos: list, stats });
});

// PATCH /api/logistica/recursos/:id · update IU/categoría sin proyecto
router.patch('/recursos/:id', async (req, res) => {
  const recursoId = req.params.id!;
  const { iuCodigo, categoria, descripcion, tipo } = req.body as {
    iuCodigo?: string | null;
    categoria?: string | null;
    descripcion?: string;
    tipo?: 'mano_obra' | 'material' | 'equipo' | 'herramienta' | 'subcontrato';
  };
  const updates: Record<string, unknown> = {};
  if (iuCodigo !== undefined) {
    updates.iuCodigo = iuCodigo;
    updates.iuClasificacionOrigen = iuCodigo ? 'manual' : null;
    updates.iuConfianza = iuCodigo ? '1.00' : null;
  }
  if (categoria !== undefined) updates.categoria = categoria;
  if (descripcion !== undefined) updates.descripcion = descripcion;
  if (tipo !== undefined) updates.tipo = tipo;
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Sin campos para actualizar' });
  }
  const [updated] = await db
    .update(schema.recursos)
    .set(updates)
    .where(eq(schema.recursos.id, recursoId))
    .returning();
  if (!updated) return res.status(404).json({ error: 'Recurso no encontrado' });
  res.json({ recurso: updated });
});

// POST /api/logistica/recursos · crear recurso manual
router.post('/recursos', async (req, res) => {
  const { codigo, descripcion, unidad, tipo, categoria, precioReferencial, iuCodigo } = req.body as {
    codigo?: string;
    descripcion?: string;
    unidad?: string;
    tipo?: 'mano_obra' | 'material' | 'equipo' | 'herramienta' | 'subcontrato';
    categoria?: string;
    precioReferencial?: number;
    iuCodigo?: string;
  };
  if (!codigo || !descripcion || !unidad || !tipo) {
    return res.status(400).json({ error: 'codigo, descripcion, unidad, tipo obligatorios' });
  }
  const [created] = await db
    .insert(schema.recursos)
    .values({
      codigo: String(codigo).trim(),
      descripcion: String(descripcion).trim(),
      unidad: String(unidad).trim(),
      tipo,
      categoria: categoria ?? null,
      precioReferencial: precioReferencial != null ? String(precioReferencial) : null,
      iuCodigo: iuCodigo ?? null,
      iuClasificacionOrigen: iuCodigo ? 'manual' : null,
      iuConfianza: iuCodigo ? '1.00' : null,
      activo: true,
    })
    .returning();
  res.status(201).json({ recurso: created });
});

// ─── ÍNDICES UNIFICADOS · CRUD catálogo ─────────────────────

// GET /api/logistica/ius · catálogo completo
router.get('/ius', async (_req, res) => {
  const list = await db
    .select()
    .from(schema.indicesUnificados)
    .orderBy(asc(schema.indicesUnificados.codigo));

  // Stats uso: cuántos recursos usan cada IU
  const recursos = await db.select().from(schema.recursos);
  const uso = new Map<string, number>();
  for (const r of recursos) {
    if (r.iuCodigo) uso.set(r.iuCodigo, (uso.get(r.iuCodigo) ?? 0) + 1);
  }
  const enriched = list.map((iu) => ({
    ...iu,
    recursosCount: uso.get(iu.codigo) ?? 0,
  }));

  res.json({
    ius: enriched,
    stats: {
      total: list.length,
      enUso: enriched.filter((iu) => iu.recursosCount > 0).length,
      sinUso: enriched.filter((iu) => iu.recursosCount === 0).length,
      totalRecursosClasificados: recursos.filter((r) => r.iuCodigo !== null).length,
      totalRecursosSinClasificar: recursos.filter((r) => r.iuCodigo === null).length,
    },
  });
});

// POST /api/logistica/ius · crear IU custom
router.post('/ius', async (req, res) => {
  const { codigo, descripcion, categoria } = req.body as {
    codigo?: string;
    descripcion?: string;
    categoria?: string;
  };
  if (!codigo || !descripcion) {
    return res.status(400).json({ error: 'codigo y descripcion obligatorios' });
  }
  const cod = String(codigo).trim().toUpperCase().slice(0, 3);
  const existing = await db
    .select()
    .from(schema.indicesUnificados)
    .where(eq(schema.indicesUnificados.codigo, cod))
    .limit(1);
  if (existing.length) {
    return res.status(409).json({ error: `IU ${cod} ya existe`, iu: existing[0] });
  }
  const [created] = await db
    .insert(schema.indicesUnificados)
    .values({
      codigo: cod,
      descripcion: String(descripcion).trim().toUpperCase().slice(0, 255),
      categoria: categoria ?? 'Custom',
      vigente: true,
    })
    .returning();
  res.status(201).json({ iu: created });
});

// PATCH /api/logistica/ius/:codigo · editar IU
router.patch('/ius/:codigo', async (req, res) => {
  const codigo = req.params.codigo!;
  const { descripcion, categoria, vigente } = req.body as {
    descripcion?: string;
    categoria?: string;
    vigente?: boolean;
  };
  const updates: Record<string, unknown> = {};
  if (descripcion !== undefined) updates.descripcion = String(descripcion).trim();
  if (categoria !== undefined) updates.categoria = categoria;
  if (vigente !== undefined) updates.vigente = vigente;
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Sin campos' });
  }
  const [updated] = await db
    .update(schema.indicesUnificados)
    .set(updates)
    .where(eq(schema.indicesUnificados.codigo, codigo))
    .returning();
  if (!updated) return res.status(404).json({ error: 'IU no encontrado' });
  res.json({ iu: updated });
});

// DELETE /api/logistica/ius/:codigo · solo si no está en uso
router.delete('/ius/:codigo', async (req, res) => {
  const codigo = req.params.codigo!;
  const enUso = await db.select().from(schema.recursos).where(eq(schema.recursos.iuCodigo, codigo)).limit(1);
  if (enUso.length) {
    return res.status(409).json({ error: 'IU en uso · no puede eliminarse' });
  }
  await db.delete(schema.indicesUnificados).where(eq(schema.indicesUnificados.codigo, codigo));
  res.json({ ok: true });
});

// ─── AUTO-CLASIFICAR con IA ─────────────────────────────────

// POST /api/logistica/recursos/auto-clasificar · preview (no aplica aún)
// Body: { dryRun?: boolean, recursoIds?: string[] }
router.post('/recursos/auto-clasificar', async (req, res) => {
  try {
    const { dryRun, recursoIds } = req.body as {
      dryRun?: boolean;
      recursoIds?: string[];
    };

    // 1. Get recursos sin IU (o subset si se pasa)
    let recursos = await db
      .select()
      .from(schema.recursos)
      .where(eq(schema.recursos.activo, true));

    if (recursoIds && recursoIds.length > 0) {
      recursos = recursos.filter((r) => recursoIds.includes(r.id));
    } else {
      recursos = recursos.filter((r) => !r.iuCodigo);
    }

    if (recursos.length === 0) {
      return res.json({ ok: true, sugerencias: [], aplicados: 0, mensaje: 'No hay recursos sin IU' });
    }

    // 2. Get catálogo IUs vigentes
    const ius = await db
      .select()
      .from(schema.indicesUnificados)
      .where(eq(schema.indicesUnificados.vigente, true))
      .orderBy(asc(schema.indicesUnificados.codigo));

    // 3. Llamar Gemini batch (split en chunks de 80 para evitar timeouts)
    const CHUNK = 80;
    const allSugerencias: Awaited<ReturnType<typeof classifyRecursosWithGemini>> = [];
    for (let i = 0; i < recursos.length; i += CHUNK) {
      const chunk = recursos.slice(i, i + CHUNK);
      const chunkSimple = chunk.map((r) => ({
        id: r.id,
        codigo: r.codigo,
        descripcion: r.descripcion,
        unidad: r.unidad,
        tipo: r.tipo,
      }));
      const iusSimple = ius.map((iu) => ({
        codigo: iu.codigo,
        descripcion: iu.descripcion,
        categoria: iu.categoria,
      }));
      // eslint-disable-next-line no-await-in-loop
      const result = await classifyRecursosWithGemini(chunkSimple, iusSimple);
      allSugerencias.push(...result);
    }

    // 4. Si dryRun, devolver sin aplicar
    if (dryRun) {
      const recursoMap = new Map(recursos.map((r) => [r.id, r]));
      const enriched = allSugerencias.map((s) => ({
        ...s,
        recursoCodigo: recursoMap.get(s.recursoId)?.codigo ?? '',
        recursoDescripcion: recursoMap.get(s.recursoId)?.descripcion ?? '',
        recursoTipo: recursoMap.get(s.recursoId)?.tipo ?? '',
      }));
      return res.json({
        ok: true,
        sugerencias: enriched,
        total: enriched.length,
        sinMatch: enriched.filter((s) => !s.iuCodigo).length,
        altaConfianza: enriched.filter((s) => (s.confianza ?? 0) >= 0.85).length,
        mediaConfianza: enriched.filter((s) => (s.confianza ?? 0) >= 0.6 && (s.confianza ?? 0) < 0.85).length,
        bajaConfianza: enriched.filter((s) => (s.confianza ?? 0) < 0.6).length,
      });
    }

    // 5. Aplicar sugerencias (solo las con iuCodigo)
    let aplicados = 0;
    let descartados = 0;
    for (const s of allSugerencias) {
      if (!s.iuCodigo) {
        descartados++;
        continue;
      }
      // Validar IU existe
      const iuExists = ius.find((iu) => iu.codigo === s.iuCodigo);
      if (!iuExists) {
        descartados++;
        continue;
      }
      await db
        .update(schema.recursos)
        .set({
          iuCodigo: s.iuCodigo,
          iuClasificacionOrigen: 'auto_ia',
          iuConfianza: String(s.confianza),
        })
        .where(eq(schema.recursos.id, s.recursoId));
      aplicados++;
    }

    res.json({
      ok: true,
      aplicados,
      descartados,
      total: allSugerencias.length,
    });
  } catch (err) {
    console.error('auto-clasificar error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/logistica/recursos/aplicar-sugerencias · aplica sugerencias específicas
// Body: { sugerencias: [{recursoId, iuCodigo, confianza}] }
router.post('/recursos/aplicar-sugerencias', async (req, res) => {
  try {
    const { sugerencias } = req.body as {
      sugerencias: Array<{ recursoId: string; iuCodigo: string | null; confianza: number }>;
    };
    if (!Array.isArray(sugerencias)) {
      return res.status(400).json({ error: 'sugerencias debe ser array' });
    }

    let aplicados = 0;
    for (const s of sugerencias) {
      if (!s.iuCodigo) continue;
      await db
        .update(schema.recursos)
        .set({
          iuCodigo: s.iuCodigo,
          iuClasificacionOrigen: 'auto_ia',
          iuConfianza: String(s.confianza),
        })
        .where(eq(schema.recursos.id, s.recursoId));
      aplicados++;
    }

    res.json({ ok: true, aplicados });
  } catch (err) {
    console.error('aplicar-sugerencias error:', err);
    res.status(500).json({ error: String(err) });
  }
});

void isNull; // suppress unused
void inArray;
export default router;
