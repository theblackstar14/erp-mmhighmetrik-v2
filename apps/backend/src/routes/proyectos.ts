import { db, parseCronogramaValorizado, parseValorizacionXlsx, schema } from '@erp/db';
import { proyectoCreateSchema } from '@erp/shared';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { Router } from 'express';
import multer from 'multer';
import { env } from '../env.js';
import { crossValidate, parseLlmTotalesFromXlsx } from '../lib/llmTotales.js';
import { parseMSProjectXML, tasksToPartidas } from '../lib/mppParser.js';
import { convertMppToXml } from '../lib/mppToXml.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max XML
});

// GET /api/proyectos · lista
router.get('/', async (req, res) => {
  const list = await db
    .select()
    .from(schema.proyectos)
    .where(isNull(schema.proyectos.deletedAt))
    .orderBy(desc(schema.proyectos.createdAt));
  res.json({ proyectos: list });
});

// GET /api/proyectos/_ius/catalogo · catálogo INEI completo (antes de /:id)
router.get('/_ius/catalogo', async (_req, res) => {
  const list = await db
    .select()
    .from(schema.indicesUnificados)
    .orderBy(asc(schema.indicesUnificados.codigo));
  res.json({ ius: list });
});

// POST /api/proyectos/_ius · crear IU custom (códigos > 80 o letras)
router.post('/_ius', async (req, res) => {
  const { codigo, descripcion, categoria } = req.body as {
    codigo?: string;
    descripcion?: string;
    categoria?: string;
  };
  if (!codigo || !descripcion) {
    return res.status(400).json({ error: 'codigo y descripcion son obligatorios' });
  }
  const cod = String(codigo).trim().toUpperCase().slice(0, 3);
  if (cod.length < 1) return res.status(400).json({ error: 'codigo inválido' });

  // Check existe
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

// GET /api/proyectos/:id
router.get('/:id', async (req, res) => {
  const [proyecto] = await db
    .select()
    .from(schema.proyectos)
    .where(and(eq(schema.proyectos.id, req.params.id), isNull(schema.proyectos.deletedAt)))
    .limit(1);
  if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });
  res.json({ proyecto });
});

// POST /api/proyectos · crear
router.post('/', async (req, res) => {
  const parse = proyectoCreateSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }

  // Cálculo automático contractual
  const data = parse.data;
  const cd = data.costoDirecto ?? 0;
  const igvEnXml = data.igvEnXml ?? true;
  const pctGg = data.pctGg ?? 0.1;
  const pctUtilidad = data.pctUtilidad ?? 0.1;
  const cdSinIgv = igvEnXml ? cd / 1.18 : cd;
  const subtotal = cdSinIgv * (1 + pctGg + pctUtilidad);
  const igv = subtotal * 0.18;
  const contractual = subtotal + igv;

  const [proyecto] = await db
    .insert(schema.proyectos)
    .values({
      ...data,
      costoDirecto: cd.toString(),
      costoDirectoSinIgv: cdSinIgv.toString(),
      pctGg: pctGg.toString(),
      pctUtilidad: pctUtilidad.toString(),
      montoSubtotal: subtotal.toString(),
      montoIgv: igv.toString(),
      montoContractual: contractual.toFixed(2),
      lat: data.lat?.toString(),
      lng: data.lng?.toString(),
      pctAdelantoDirecto: data.pctAdelantoDirecto?.toString(),
      pctAdelantoMateriales: data.pctAdelantoMateriales?.toString(),
      pctFielCumplimiento: data.pctFielCumplimiento?.toString(),
      pctPenalidadDia: data.pctPenalidadDia?.toString(),
      pctPenalidadTope: data.pctPenalidadTope?.toString(),
      managerId: req.user!.id,
    })
    .returning();
  res.status(201).json({ proyecto });
});

// POST /api/proyectos/preview-xlsx · parse + return preview (no DB write)
// Estrategia híbrida: deterministic + LLM totales en paralelo · cross-validation
router.post('/preview-xlsx', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const filename = req.file.originalname.toLowerCase();
    if (!filename.endsWith('.xlsx') && !filename.endsWith('.xls')) {
      return res.status(400).json({ error: 'Solo .xlsx/.xls soportados' });
    }

    // Correr deterministic + LLM en paralelo
    const buffer = req.file.buffer;
    const llmEnabled = !!env.ANTHROPIC_API_KEY;
    const [detResult, llmResult] = await Promise.allSettled([
      Promise.resolve(parseCronogramaValorizado(buffer)),
      llmEnabled
        ? parseLlmTotalesFromXlsx(buffer)
        : Promise.reject(new Error('ANTHROPIC_API_KEY no configurada')),
    ]);

    if (detResult.status === 'rejected') {
      return res.status(500).json({ error: 'Error parser deterministic: ' + detResult.reason });
    }
    const parsed = detResult.value;
    if (parsed.errors.length) {
      return res.status(400).json({ error: parsed.errors.join(' · '), parsed });
    }

    // Validación cruzada
    let validation: ReturnType<typeof crossValidate> | null = null;
    let llmMeta: { modelUsed: string; latencyMs: number; costUsd: number } | null = null;
    if (llmResult.status === 'fulfilled') {
      const llm = llmResult.value;
      validation = crossValidate(
        {
          costoDirecto: parsed.costoDirecto,
          pctGg: parsed.pctGg,
          montoGg: parsed.montoGg,
          pctUtilidad: parsed.pctUtilidad,
          montoUtilidad: parsed.montoUtilidad,
          subTotal: parsed.subTotal,
          mobiliario: parsed.mobiliario,
          pctIgv: parsed.pctIgv,
          montoIgv: parsed.montoIgv,
          presupuestoTotal: parsed.presupuestoTotal,
          supervision: parsed.supervision,
          valorReferencial: parsed.valorReferencial,
        },
        llm,
      );
      llmMeta = {
        modelUsed: llm.modelUsed,
        latencyMs: llm.latencyMs,
        costUsd: llm.costUsd,
      };
    }

    // Sugerir código PG####
    const list = await db
      .select({ codigo: schema.proyectos.codigo })
      .from(schema.proyectos)
      .where(isNull(schema.proyectos.deletedAt));
    const nums = list
      .map((p) => {
        const m = p.codigo.match(/^PG(\d+)$/i);
        return m ? Number.parseInt(m[1]!, 10) : 0;
      })
      .filter((n) => n > 0);
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    const sugCodigo = `PG${String(next).padStart(4, '0')}`;
    res.json({
      ok: true,
      sugerencia: { codigo: sugCodigo },
      header: {
        obra: parsed.obra,
        ubicacion: parsed.ubicacion,
        cliente: parsed.cliente,
        costoBase: parsed.costoBase,
        fechaBase: parsed.fechaBase,
        diasPlazo: parsed.diasPlazo,
      },
      meses: parsed.meses,
      totales: {
        costoDirecto: parsed.costoDirecto,
        pctGg: parsed.pctGg,
        montoGg: parsed.montoGg,
        pctUtilidad: parsed.pctUtilidad,
        montoUtilidad: parsed.montoUtilidad,
        subTotal: parsed.subTotal,
        mobiliario: parsed.mobiliario,
        pctIgv: parsed.pctIgv,
        montoIgv: parsed.montoIgv,
        presupuestoTotal: parsed.presupuestoTotal,
        supervision: parsed.supervision,
        valorReferencial: parsed.valorReferencial,
      },
      stats: {
        totalPartidas: parsed.partidas.length,
        totalHojas: parsed.totalPartidasHoja,
        totalTitulos: parsed.totalTitulos,
        sumaParcialesHoja: parsed.sumaParcialesHoja,
        cuadre: parsed.cuadre,
        diferenciaCuadre: parsed.diferenciaCuadre,
      },
      warnings: parsed.warnings,
      validation, // null si LLM no corrió · object si sí
      llmMeta, // modelo · latencia · costo
      llmError:
        llmResult.status === 'rejected'
          ? llmResult.reason instanceof Error
            ? llmResult.reason.message
            : String(llmResult.reason)
          : null,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Error parseando XLSX' });
  }
});

// POST /api/proyectos/import-xlsx · crear proyecto + partidas desde Cronograma Valorizado
router.post('/import-xlsx', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const filename = req.file.originalname.toLowerCase();
    if (!filename.endsWith('.xlsx') && !filename.endsWith('.xls')) {
      return res.status(400).json({ error: 'Solo .xlsx/.xls soportados' });
    }
    const parsed = parseCronogramaValorizado(req.file.buffer);
    if (parsed.errors.length) {
      return res.status(400).json({ error: parsed.errors.join(' · '), parsed });
    }

    const body = req.body as Record<string, string | undefined>;
    const codigo = (body.codigo ?? '').trim();
    const nombreOverride = (body.nombre ?? '').trim();
    const tipoEntidad = (body.tipoEntidad ?? 'gobierno_regional').trim();
    if (!codigo) return res.status(400).json({ error: 'codigo es obligatorio (ej: PG0010)' });

    const existingCodigo = await db
      .select({ id: schema.proyectos.id })
      .from(schema.proyectos)
      .where(eq(schema.proyectos.codigo, codigo))
      .limit(1);
    if (existingCodigo.length) return res.status(409).json({ error: `Código ${codigo} ya existe` });

    // Auto-crear o reutilizar cliente por razón social
    let clienteId: string | null = null;
    if (parsed.cliente) {
      const razonClean = parsed.cliente.replace(/^:\s*/, '').trim().toUpperCase();
      const [foundCliente] = await db
        .select()
        .from(schema.clientes)
        .where(eq(schema.clientes.razonSocial, razonClean))
        .limit(1);
      if (foundCliente) {
        clienteId = foundCliente.id;
      } else {
        const [created] = await db
          .insert(schema.clientes)
          .values({
            razonSocial: razonClean,
            tipo: 'publico',
            tipoEntidad,
          })
          .returning();
        clienteId = created!.id;
      }
    }

    const lastMes = parsed.meses.at(-1);
    const fechaFin = lastMes?.fechaFin ?? null;
    const fechaInicio = parsed.fechaBase ?? parsed.meses[0]?.fechaInicio ?? null;

    const proyectoId = await db.transaction(async (tx) => {
      const [proyecto] = await tx
        .insert(schema.proyectos)
        .values({
          codigo,
          nombre: nombreOverride || parsed.obra || codigo,
          clienteId,
          ubicacion: parsed.ubicacion,
          tipo: 'Edificación',
          modalidad: 'suma_alzada',
          status: 'adjudicado',
          costoDirecto: parsed.costoDirecto?.toString() ?? '0',
          costoDirectoSinIgv: parsed.costoDirecto?.toString() ?? '0',
          igvEnXml: false,
          pctGg: (parsed.pctGg ?? 0.15).toString(),
          pctUtilidad: (parsed.pctUtilidad ?? 0.15).toString(),
          pctIgv: (parsed.pctIgv ?? 0.18).toString(),
          montoSubtotal: parsed.subTotal?.toString() ?? '0',
          montoIgv: parsed.montoIgv?.toString() ?? '0',
          montoReferencial: parsed.valorReferencial?.toString() ?? '0',
          montoContractual: parsed.presupuestoTotal?.toString() ?? '0',
          montoVigente: parsed.presupuestoTotal?.toString() ?? '0',
          fechaInicio,
          fechaFin,
          diasPlazo: parsed.diasPlazo,
          managerId: req.user!.id,
        })
        .returning();

      const proyId = proyecto!.id;

      const partidaRows = parsed.partidas.map((p) => ({
        proyectoId: proyId,
        codigo: p.codigo,
        parentCodigo: p.parentCodigo,
        nivel: p.nivel,
        nombre: p.descripcion,
        unidad: p.unidad,
        cantidad: p.metrado?.toString(),
        precioUnitario: p.precioUnitario?.toString(),
        precioUnitarioReferencial: p.precioUnitario?.toString(),
        precioUnitarioContractual: p.precioUnitario?.toString(),
        presupuesto: p.parcial.toString(),
        presupuestoContractual: p.parcial.toString(),
        fechaInicio: p.fechaInicio,
        fechaFin: p.fechaFin,
        duracionDias: p.duracionDias,
        isSummary: p.isSummary,
        isMilestone: p.isMilestone,
        predecessors: p.predecessors,
        orden: p.orden,
      }));

      const CHUNK = 100;
      for (let i = 0; i < partidaRows.length; i += CHUNK) {
        await tx.insert(schema.partidas).values(partidaRows.slice(i, i + CHUNK));
      }

      return proyId;
    });

    res.status(201).json({
      ok: true,
      proyectoId,
      stats: {
        partidas: parsed.partidas.length,
        hojas: parsed.totalPartidasHoja,
        titulos: parsed.totalTitulos,
        meses: parsed.meses.length,
        valorReferencial: parsed.valorReferencial,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Error importando XLSX' });
  }
});

// POST /api/proyectos/:id/rebuild-rollup · recalcula presupuesto + fechas para summaries
router.post('/:id/rebuild-rollup', async (req, res) => {
  try {
    const proyectoId = req.params.id!;
    const partidas = await db
      .select()
      .from(schema.partidas)
      .where(eq(schema.partidas.proyectoId, proyectoId));
    if (partidas.length === 0) return res.status(404).json({ error: 'Proyecto sin partidas' });

    const byCodigo = new Map(partidas.map((p) => [p.codigo, p]));
    const childrenByParent = new Map<string, typeof partidas>();
    for (const p of partidas) {
      if (p.parentCodigo) {
        const arr = childrenByParent.get(p.parentCodigo);
        if (arr) arr.push(p);
        else childrenByParent.set(p.parentCodigo, [p]);
      }
    }
    void byCodigo;

    // Helper · días entre fechas ISO (inclusivo)
    const diasEntre = (ini: string | null, fin: string | null): number | null => {
      if (!ini || !fin) return null;
      const a = new Date(`${ini}T00:00:00Z`).getTime();
      const b = new Date(`${fin}T00:00:00Z`).getTime();
      if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
      return Math.round((b - a) / 86_400_000) + 1;
    };

    // Bottom-up: nivel mayor → menor
    const niveles = [...new Set(partidas.map((p) => p.nivel))].sort((a, b) => b - a);
    let updates = 0;
    await db.transaction(async (tx) => {
      // Primero: hojas con fechas pero sin duracionDias · backfill
      for (const p of partidas) {
        if (!p.isSummary && p.fechaInicio && p.fechaFin && !p.duracionDias) {
          const d = diasEntre(p.fechaInicio, p.fechaFin);
          if (d != null) {
            p.duracionDias = d;
            await tx
              .update(schema.partidas)
              .set({ duracionDias: d })
              .where(eq(schema.partidas.id, p.id));
            updates++;
          }
        }
      }

      // Después: summaries bottom-up
      for (const lvl of niveles) {
        for (const p of partidas.filter((x) => x.nivel === lvl && x.isSummary)) {
          const hijos = childrenByParent.get(p.codigo);
          if (!hijos || hijos.length === 0) continue;

          let sumPresup = 0;
          let sumPresupCon = 0;
          let minIni: string | null = null;
          let maxFin: string | null = null;
          for (const h of hijos) {
            sumPresup += Number(h.presupuesto ?? 0);
            sumPresupCon += Number(h.presupuestoContractual ?? 0);
            if (h.fechaInicio && (!minIni || h.fechaInicio < minIni)) minIni = h.fechaInicio;
            if (h.fechaFin && (!maxFin || h.fechaFin > maxFin)) maxFin = h.fechaFin;
          }

          const newIni = minIni ?? p.fechaInicio;
          const newFin = maxFin ?? p.fechaFin;
          const newDur = diasEntre(newIni, newFin);

          // Mutar in-memory para que niveles más bajos vean valores nuevos
          p.presupuesto = sumPresup.toFixed(2);
          p.presupuestoContractual = sumPresupCon.toFixed(2);
          p.fechaInicio = newIni;
          p.fechaFin = newFin;
          p.duracionDias = newDur;

          await tx
            .update(schema.partidas)
            .set({
              presupuesto: sumPresup.toFixed(2),
              presupuestoContractual: sumPresupCon.toFixed(2),
              fechaInicio: newIni,
              fechaFin: newFin,
              duracionDias: newDur,
            })
            .where(eq(schema.partidas.id, p.id));
          updates++;
        }
      }
    });

    res.json({ ok: true, updates });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Error rebuild rollup' });
  }
});

// PATCH /api/proyectos/:id
router.patch('/:id', async (req, res) => {
  const parse = proyectoCreateSchema.partial().safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }
  const [proyecto] = await db
    .update(schema.proyectos)
    .set({ ...(parse.data as Record<string, unknown>), updatedAt: new Date() })
    .where(eq(schema.proyectos.id, req.params.id))
    .returning();
  if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });
  res.json({ proyecto });
});

// DELETE /api/proyectos/:id · soft delete
router.delete('/:id', async (req, res) => {
  await db
    .update(schema.proyectos)
    .set({ deletedAt: new Date() })
    .where(eq(schema.proyectos.id, req.params.id));
  res.json({ ok: true });
});

// ─── Cronograma · upload + extract partidas ────────────────
// POST /api/proyectos/:id/cronograma · acepta .xml o .mpp
router.post('/:id/cronograma', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const filename = req.file.originalname.toLowerCase();
    let xml: string;
    if (filename.endsWith('.mpp')) {
      // Convertir .mpp → .xml usando MPXJ Java
      xml = await convertMppToXml(req.file.buffer);
    } else if (filename.endsWith('.xml')) {
      xml = req.file.buffer.toString('utf8');
    } else {
      return res.status(400).json({ error: 'Solo .mpp o .xml son soportados' });
    }
    const parsed = parseMSProjectXML(xml);
    const tasksMpp = tasksToPartidas(parsed, req.params.id!);

    // Estrategia NO destructiva · UPDATE partidas existentes por nombre
    // (las partidas vienen del Excel S10 importado · NO sobrescribir códigos)
    const existing = await db
      .select()
      .from(schema.partidas)
      .where(eq(schema.partidas.proyectoId, req.params.id!));

    const normalize = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/[^\w\s.]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const byName = new Map<string, typeof existing[number][]>();
    for (const p of existing) {
      const k = normalize(p.nombre);
      const arr = byName.get(k);
      if (arr) arr.push(p);
      else byName.set(k, [p]);
    }

    let matched = 0;
    let notMatched = 0;

    await db.transaction(async (tx) => {
      // Update fechas + duración por nombre match
      for (const t of tasksMpp) {
        const k = normalize(t.nombre);
        const candidatos = byName.get(k);
        const partida = candidatos?.length === 1 ? candidatos[0] : null;
        if (!partida) {
          notMatched++;
          continue;
        }
        matched++;
        await tx
          .update(schema.partidas)
          .set({
            fechaInicio: t.fechaInicio,
            fechaFin: t.fechaFin,
            duracionDias: t.duracionDias,
            isMilestone: t.isMilestone,
            isCritical: t.isCritical,
          })
          .where(eq(schema.partidas.id, partida.id));
      }

      // Update proyecto fechas · NO costoDirecto (sigue referencial del expediente)
      await tx
        .update(schema.proyectos)
        .set({
          fechaInicio: parsed.startDate ? parsed.startDate.toISOString().slice(0, 10) : undefined,
          fechaFin: parsed.finishDate ? parsed.finishDate.toISOString().slice(0, 10) : undefined,
          ganttFile: req.file!.originalname,
          updatedAt: new Date(),
        })
        .where(eq(schema.proyectos.id, req.params.id!));
    });

    res.json({
      ok: true,
      stats: {
        totalTasks: parsed.totalTasks,
        partidasMatched: matched,
        partidasNoMatched: notMatched,
        totalCost: parsed.totalCost,
        startDate: parsed.startDate,
        finishDate: parsed.finishDate,
      },
    });
  } catch (e) {
    console.error('Cronograma upload error:', e);
    res.status(500).json({ error: (e as Error).message ?? 'Error parseando XML' });
  }
});

// GET /api/proyectos/:id/partidas
router.get('/:id/partidas', async (req, res) => {
  const proyectoId = req.params.id!;
  const list = await db
    .select()
    .from(schema.partidas)
    .where(eq(schema.partidas.proyectoId, proyectoId))
    .orderBy(asc(schema.partidas.orden));

  // Mergear acumulado de valorizaciones · última fila por partida (mayor val.numero)
  const vals = await db
    .select()
    .from(schema.valorizaciones)
    .where(eq(schema.valorizaciones.proyectoId, proyectoId));
  if (vals.length === 0) {
    return res.json({ partidas: list });
  }
  const valIds = vals.map((v) => v.id);
  const valNumMap = new Map(vals.map((v) => [v.id, v.numero]));
  const valpart = await db
    .select()
    .from(schema.valorizacionesPartidas)
    .where(inArray(schema.valorizacionesPartidas.valorizacionId, valIds));

  // Por partida_id · agarrar la fila con mayor número de valorización
  const ultPorPartida = new Map<string, typeof valpart[number]>();
  for (const vp of valpart) {
    const numActual = valNumMap.get(vp.valorizacionId) ?? 0;
    const prev = ultPorPartida.get(vp.partidaId);
    if (!prev) {
      ultPorPartida.set(vp.partidaId, vp);
    } else {
      const numPrev = valNumMap.get(prev.valorizacionId) ?? 0;
      if (numActual > numPrev) ultPorPartida.set(vp.partidaId, vp);
    }
  }

  const enriched = list.map((p) => {
    const vp = ultPorPartida.get(p.id);
    return {
      ...p,
      valorizado: vp
        ? {
            metradoAcumulado: vp.metradoAcumulado,
            montoAcumulado: vp.montoAcumulado,
            pctAvanceReal: vp.pctAvance,
            ultimaValNumero: valNumMap.get(vp.valorizacionId) ?? null,
          }
        : null,
    };
  });

  res.json({ partidas: enriched });
});

// PATCH /api/proyectos/:id/recursos/:recursoId · actualizar IU
router.patch('/:id/recursos/:recursoId', async (req, res) => {
  const recursoId = req.params.recursoId!;
  const { iuCodigo, categoria } = req.body as { iuCodigo?: string | null; categoria?: string | null };
  const updates: Record<string, unknown> = {};
  if (iuCodigo !== undefined) {
    updates.iuCodigo = iuCodigo;
    updates.iuClasificacionOrigen = iuCodigo ? 'manual' : null;
    updates.iuConfianza = iuCodigo ? '1.00' : null;
  }
  if (categoria !== undefined) updates.categoria = categoria;
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No hay campos para actualizar' });
  }
  const [updated] = await db
    .update(schema.recursos)
    .set(updates)
    .where(eq(schema.recursos.id, recursoId))
    .returning();
  if (!updated) return res.status(404).json({ error: 'Recurso no encontrado' });
  res.json({ recurso: updated });
});

// GET /api/proyectos/:id/recursos · catálogo + cronograma adquisiciones
router.get('/:id/recursos', async (req, res) => {
  // Recursos del proyecto (todos · catálogo es global pero mostramos los del cronograma)
  const cronog = await db
    .select()
    .from(schema.cronogramaAdquisiciones)
    .where(eq(schema.cronogramaAdquisiciones.proyectoId, req.params.id!))
    .orderBy(asc(schema.cronogramaAdquisiciones.mesIndex));

  // Recursos únicos del cronograma
  const recursoIds = [...new Set(cronog.map((c) => c.recursoId).filter(Boolean) as string[])];
  if (recursoIds.length === 0) {
    return res.json({ recursos: [], cronograma: [], stats: null });
  }

  const recursosList = await db.select().from(schema.recursos);
  const recursosFiltered = recursosList.filter((r) => recursoIds.includes(r.id));

  // Stats
  const stats = {
    total: recursosFiltered.length,
    porTipo: {
      mano_obra: recursosFiltered.filter((r) => r.tipo === 'mano_obra').length,
      material: recursosFiltered.filter((r) => r.tipo === 'material').length,
      equipo: recursosFiltered.filter((r) => r.tipo === 'equipo').length,
      herramienta: recursosFiltered.filter((r) => r.tipo === 'herramienta').length,
      subcontrato: recursosFiltered.filter((r) => r.tipo === 'subcontrato').length,
    },
    montosPorTipo: {
      mano_obra: 0,
      material: 0,
      equipo: 0,
      herramienta: 0,
      subcontrato: 0,
    },
    montoPorMes: [0, 0, 0, 0],
    montoTotal: 0,
    iuClasificados: recursosFiltered.filter((r) => r.iuCodigo !== null).length,
  };

  const recursoTipoMap = new Map(recursosFiltered.map((r) => [r.id, r.tipo]));
  for (const c of cronog) {
    const tipo = recursoTipoMap.get(c.recursoId ?? '') ?? 'material';
    const monto = Number(c.monto ?? 0);
    stats.montosPorTipo[tipo as keyof typeof stats.montosPorTipo] += monto;
    const mIdx = (c.mesIndex ?? 1) - 1;
    if (stats.montoPorMes[mIdx] !== undefined) stats.montoPorMes[mIdx] += monto;
    stats.montoTotal += monto;
  }

  res.json({
    recursos: recursosFiltered,
    cronograma: cronog,
    stats,
  });
});

// ─── POST /api/proyectos/:id/valorizaciones · upload Excel S10 ────
// Idempotente: si ya existe valorización con mismo número, se reemplaza.
router.post('/:id/valorizaciones', upload.single('file'), async (req, res) => {
  try {
    const proyectoId = req.params.id!;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const filename = req.file.originalname.toLowerCase();
    if (!filename.endsWith('.xlsx') && !filename.endsWith('.xls'))
      return res.status(400).json({ error: 'Solo .xlsx/.xls soportados' });

    const parsed = parseValorizacionXlsx(req.file.buffer);
    if (parsed.errors.length) {
      return res.status(400).json({ error: 'Parse errors', detalles: parsed.errors, warnings: parsed.warnings });
    }

    // Verificar proyecto existe
    const [proy] = await db
      .select()
      .from(schema.proyectos)
      .where(eq(schema.proyectos.id, proyectoId))
      .limit(1);
    if (!proy) return res.status(404).json({ error: 'Proyecto no encontrado' });

    // Buscar FP global
    const fps = await db
      .select()
      .from(schema.formulasPolinomicas)
      .where(eq(schema.formulasPolinomicas.proyectoId, proyectoId));
    const fpGlobal = fps.find((f) => f.subpresupuestoCodigo === 'GLOBAL') ?? fps[0];

    // Mapear partidas Excel ↔ partidas DB por código
    const dbPartidas = await db
      .select()
      .from(schema.partidas)
      .where(eq(schema.partidas.proyectoId, proyectoId));
    const partidasMap = new Map(dbPartidas.map((p) => [p.codigo, p]));

    // Idempotencia · borrar valorización previa con mismo número (cascade limpia detalle)
    const existentes = await db
      .select()
      .from(schema.valorizaciones)
      .where(eq(schema.valorizaciones.proyectoId, proyectoId));
    const prev = existentes.find((v) => v.numero === parsed.numero);
    if (prev) {
      await db.delete(schema.valorizaciones).where(eq(schema.valorizaciones.id, prev.id));
    }

    // Insertar cabecera
    const [valRow] = await db
      .insert(schema.valorizaciones)
      .values({
        proyectoId,
        numero: parsed.numero,
        fechaDesde: parsed.fechaDesde ?? `${parsed.mesPeriodo}-01`,
        fechaHasta: parsed.fechaHasta ?? `${parsed.mesPeriodo}-28`,
        fechaEmision: parsed.fechaDesde ?? `${parsed.mesPeriodo}-01`,
        montoCd: String(parsed.valorizacion),
        montoIgv: String(parsed.igv),
        montoTotal: String(parsed.montoTotalConIgv),
        pctAvance: String(
          (() => {
            const sub = Number(proy.montoSubtotal ?? 0);
            if (!Number.isFinite(sub) || sub <= 0) return '0';
            const pct = (parsed.valorizacion / sub) * 100;
            return Math.min(999.99, Math.max(0, pct)).toFixed(2);
          })(),
        ),
        factorReajusteK: parsed.kCalculado != null ? String(parsed.kCalculado) : null,
        montoReajuste: String(parsed.reajustePresente ?? 0),
        vProgramado: parsed.vProgramado != null ? String(parsed.vProgramado) : null,
        reajusteReal: parsed.reajusteReal != null ? String(parsed.reajusteReal) : null,
        reajusteProgramado: parsed.reajusteProgramado != null ? String(parsed.reajusteProgramado) : null,
        reajusteReconocido: parsed.reajusteReconocido != null ? String(parsed.reajusteReconocido) : null,
        reajustePagado: parsed.reajustePagado != null ? String(parsed.reajustePagado) : null,
        vrConReajuste: parsed.vrConReajuste != null ? String(parsed.vrConReajuste) : null,
        reajusteAcumAnterior: String(parsed.reajusteAcumAnterior),
        reajusteAcumActual: String(parsed.reajusteAcumActual),
        reajustePresente: String(parsed.reajustePresente),
        condicion: parsed.condicion,
        mesPeriodo: parsed.mesPeriodo,
        montoDeducciones: String(parsed.deducciones),
        montoValorizacionBruta: String(parsed.valorizacionBruta),
        montoAmortizaciones: String(parsed.amortizaciones),
        montoValorizacionNeta: String(parsed.valorizacionNeta),
        multa: String(parsed.multa),
        montoTotalConIgv: String(parsed.montoTotalConIgv),
        montoRetencion: String(parsed.retencion),
        totalContratista: String(parsed.totalContratista),
        archivoXlsx: req.file.originalname,
        status: 'aprobada',
        snapshot: {
          obra: parsed.obra,
          contratista: parsed.contratista,
          asNumero: parsed.asNumero,
          entidad: parsed.entidad,
          pptoBase: parsed.pptoBase,
          pptoContratado: parsed.pptoContratado,
          fechaPresupuestoBase: parsed.fechaPresupuestoBase,
          monomios: parsed.monomios,
          curvaS: parsed.curvaS,
          warnings: parsed.warnings,
        },
        observaciones: `Importado desde ${req.file.originalname}`,
      })
      .returning();

    // Insertar valorizaciones_partidas (solo las que matchean con DB)
    // Además sincronizar partida.precio_unitario_contractual y presupuesto_contractual
    // con valores Excel S10 (source of truth · evita drift de rounding)
    let partidasInsertadas = 0;
    let partidasSinMatch = 0;
    let partidasSincronizadas = 0;
    for (const p of parsed.partidas) {
      const dbP = partidasMap.get(p.codigo);
      if (!dbP) {
        partidasSinMatch++;
        continue;
      }
      const subp = p.codigo.split('.')[0] ?? '';
      await db.insert(schema.valorizacionesPartidas).values({
        valorizacionId: valRow!.id,
        partidaId: dbP.id,
        subpresupuestoCodigo: subp,
        metradoContractual: String(p.metradoContractual),
        metradoAnterior: String(p.metradoAnterior),
        metradoPeriodo: String(p.metradoActual),
        metradoAcumulado: String(p.metradoAcumulado),
        precioUnitario: String(p.precioUnitario),
        montoPeriodo: String(p.valorActual),
        montoAcumulado: String(p.valorAcumulado),
        pctAvance: String((p.pctAcumulado * 100).toFixed(2)),
      });
      partidasInsertadas++;

      // Sync partida con valores S10 si difieren
      const dbPu = Number(dbP.precioUnitarioContractual ?? 0);
      const dbBudget = Number(dbP.presupuestoContractual ?? 0);
      const excelSubTotal = p.subTotal > 0 ? p.subTotal : p.precioUnitario * p.metradoContractual;
      if (
        Math.abs(dbPu - p.precioUnitario) > 0.0001 ||
        Math.abs(dbBudget - excelSubTotal) > 0.01
      ) {
        await db
          .update(schema.partidas)
          .set({
            precioUnitarioContractual: String(p.precioUnitario),
            presupuestoContractual: String(excelSubTotal.toFixed(2)),
          })
          .where(eq(schema.partidas.id, dbP.id));
        partidasSincronizadas++;
      }
    }

    // Insertar reajuste · 1 fila (FP global)
    if (fpGlobal && parsed.kCalculado != null) {
      await db.insert(schema.valorizacionesReajustes).values({
        valorizacionId: valRow!.id,
        formulaId: fpGlobal.id,
        subpresupuestoCodigo: fpGlobal.subpresupuestoCodigo,
        anioMesIndice: parsed.mesPeriodo,
        kCalculado: String(parsed.kCalculado),
        montoSubpresupuesto: String(parsed.valorizacion),
        montoReajuste: String(parsed.reajustePresente),
        detalleK: parsed.monomios.flatMap((m) =>
          m.ius.map((iu) => ({
            monomio: m.numero,
            simbolo: m.simbolo,
            coef: m.coeficiente,
            ir: iu.ir,
            io: iu.io,
            relacion: iu.io > 0 ? iu.ir / iu.io : 0,
          })),
        ),
      });
    }

    return res.json({
      ok: true,
      valorizacion: valRow,
      partidasInsertadas,
      partidasSinMatch,
      partidasSincronizadas,
      warnings: parsed.warnings,
    });
  } catch (err) {
    console.error('Error upload val:', err);
    return res.status(500).json({ error: String(err) });
  }
});

// GET /api/proyectos/:id/valorizaciones · cabeceras + reajustes + partidas resumen
router.get('/:id/valorizaciones', async (req, res) => {
  const proyectoId = req.params.id!;

  const cabeceras = await db
    .select()
    .from(schema.valorizaciones)
    .where(eq(schema.valorizaciones.proyectoId, proyectoId))
    .orderBy(asc(schema.valorizaciones.numero));

  if (cabeceras.length === 0) {
    return res.json({ valorizaciones: [], reajustes: [], stats: null });
  }

  const ids = cabeceras.map((v) => v.id);

  // Reajustes por valorización × FP
  const reajustesFiltered = await db
    .select()
    .from(schema.valorizacionesReajustes)
    .where(inArray(schema.valorizacionesReajustes.valorizacionId, ids));

  // Resumen partidas valorizadas
  const valpartFiltered = await db
    .select()
    .from(schema.valorizacionesPartidas)
    .where(inArray(schema.valorizacionesPartidas.valorizacionId, ids));

  const porSubp: Record<string, { monto: number; reajuste: number }> = {};
  for (const r of reajustesFiltered) {
    const k = r.subpresupuestoCodigo;
    if (!porSubp[k]) porSubp[k] = { monto: 0, reajuste: 0 };
    porSubp[k].monto += Number(r.montoSubpresupuesto);
    porSubp[k].reajuste += Number(r.montoReajuste);
  }

  // Stats
  const sumCd = cabeceras.reduce((s, v) => s + Number(v.montoCd), 0);
  const sumIgv = cabeceras.reduce((s, v) => s + Number(v.montoIgv), 0);
  const sumReajuste = cabeceras.reduce((s, v) => s + Number(v.montoReajuste ?? 0), 0);
  const sumTotal = cabeceras.reduce((s, v) => s + Number(v.montoTotal), 0);
  const ultima = cabeceras[cabeceras.length - 1];

  res.json({
    valorizaciones: cabeceras,
    reajustes: reajustesFiltered,
    partidasResumen: valpartFiltered.length,
    stats: {
      cantidad: cabeceras.length,
      sumCd,
      sumIgv,
      sumReajuste,
      sumTotal,
      pctAvanceUltima: ultima ? Number(ultima.pctAvance) : 0,
      kPromedio: ultima ? Number(ultima.factorReajusteK ?? 1) : 1,
      porSubpresupuesto: porSubp,
    },
  });
});

export default router;
