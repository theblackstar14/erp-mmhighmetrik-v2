import { db, schema } from '@erp/db';
import { asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
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

    // 3. Pre-filtrar IUs por tipo de recurso · reduce prompt + mejora precisión
    const iusFull = ius.map((iu) => ({
      codigo: iu.codigo,
      descripcion: iu.descripcion,
      categoria: iu.categoria,
    }));
    const filterIusByTipo = (tipo: string): typeof iusFull => {
      switch (tipo) {
        case 'mano_obra':
          return iusFull.filter((iu) =>
            ['47', '37', '38'].includes(iu.codigo) ||
            iu.categoria?.toLowerCase().includes('mano de obra'),
          );
        case 'equipo':
        case 'herramienta':
          return iusFull.filter((iu) =>
            ['35', '45', '46', '48', '49'].includes(iu.codigo) ||
            iu.categoria?.toLowerCase().includes('equipo') ||
            iu.categoria?.toLowerCase().includes('herramienta'),
          );
        case 'material':
        case 'subcontrato':
        default:
          // Excluir MO y financieros · materiales y misc
          return iusFull.filter(
            (iu) => !['47', '38', '30', '31'].includes(iu.codigo) &&
                    !iu.categoria?.toLowerCase().includes('mano de obra'),
          );
      }
    };

    // Agrupar recursos por tipo
    const porTipo = new Map<string, typeof recursos>();
    for (const r of recursos) {
      const arr = porTipo.get(r.tipo) ?? [];
      arr.push(r);
      porTipo.set(r.tipo, arr);
    }

    // Crear chunks por tipo (con su IU filtrado)
    const CHUNK = 25;
    const PARALLEL = 6;
    type Tarea = {
      recursos: typeof recursos;
      iusFiltrados: typeof iusFull;
      tipo: string;
    };
    const tareas: Tarea[] = [];
    for (const [tipo, lista] of porTipo) {
      const iusFiltrados = filterIusByTipo(tipo);
      for (let i = 0; i < lista.length; i += CHUNK) {
        tareas.push({
          recursos: lista.slice(i, i + CHUNK),
          iusFiltrados,
          tipo,
        });
      }
    }
    console.log(
      `[auto-clasificar] ${recursos.length} recursos · tipos: ${[...porTipo.keys()].map((t) => `${t}=${porTipo.get(t)?.length}`).join(' · ')} · ${tareas.length} chunks · ${PARALLEL} paralelos`,
    );

    const allSugerencias: Awaited<ReturnType<typeof classifyRecursosWithGemini>> = [];
    for (let i = 0; i < tareas.length; i += PARALLEL) {
      const batch = tareas.slice(i, i + PARALLEL);
      const t0 = Date.now();
      // eslint-disable-next-line no-await-in-loop
      const results = await Promise.all(
        batch.map((t) =>
          classifyRecursosWithGemini(
            t.recursos.map((r) => ({
              id: r.id,
              codigo: r.codigo,
              descripcion: r.descripcion,
              unidad: r.unidad,
              tipo: r.tipo,
            })),
            t.iusFiltrados,
          ).catch((err) => {
            console.error(`[auto-clasificar] chunk ${t.tipo} error:`, err);
            return [];
          }),
        ),
      );
      for (const r of results) allSugerencias.push(...r);
      console.log(
        `  ✓ batch ${i / PARALLEL + 1}/${Math.ceil(tareas.length / PARALLEL)} · ${Date.now() - t0}ms · tipos: ${batch.map((b) => `${b.tipo}(${b.recursos.length}, ${b.iusFiltrados.length}IU)`).join(', ')}`,
      );
    }
    console.log(`[auto-clasificar] completado · ${allSugerencias.length} sugerencias`);

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

// ═══════════════════════════════════════════════════════════════
// F3 · PROVEEDORES · CRUD
// ═══════════════════════════════════════════════════════════════

// GET /api/logistica/proveedores · lista + stats
router.get('/proveedores', async (_req, res) => {
  const list = await db
    .select()
    .from(schema.proveedores)
    .where(eq(schema.proveedores.activo, true))
    .orderBy(asc(schema.proveedores.razonSocial));

  // Stats: OCs por proveedor
  const ocsAll = await db.select().from(schema.ordenesCompra);
  const conteoOC = new Map<string, { count: number; volumen: number }>();
  for (const oc of ocsAll) {
    const cur = conteoOC.get(oc.proveedorId) ?? { count: 0, volumen: 0 };
    cur.count += 1;
    cur.volumen += Number(oc.total);
    conteoOC.set(oc.proveedorId, cur);
  }
  const enriched = list.map((p) => ({
    ...p,
    ocCount: conteoOC.get(p.id)?.count ?? 0,
    volumenAnual: conteoOC.get(p.id)?.volumen ?? 0,
  }));

  res.json({
    proveedores: enriched,
    stats: {
      total: list.length,
      conRating: list.filter((p) => Number(p.rating ?? 0) >= 4).length,
      categorias: [...new Set(list.map((p) => p.categoria).filter(Boolean))],
    },
  });
});

// GET /api/logistica/proveedores/:id
router.get('/proveedores/:id', async (req, res) => {
  const [p] = await db
    .select()
    .from(schema.proveedores)
    .where(eq(schema.proveedores.id, req.params.id!))
    .limit(1);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  // Histórico OCs
  const ocs = await db
    .select()
    .from(schema.ordenesCompra)
    .where(eq(schema.ordenesCompra.proveedorId, p.id))
    .orderBy(desc(schema.ordenesCompra.fechaEmision))
    .limit(50);
  res.json({ proveedor: p, ocs });
});

// POST /api/logistica/proveedores
router.post('/proveedores', async (req, res) => {
  const data = req.body as Record<string, unknown>;
  if (!data.ruc || !data.razonSocial) {
    return res.status(400).json({ error: 'ruc y razonSocial obligatorios' });
  }
  const ruc = String(data.ruc).trim();
  if (!/^\d{11}$/.test(ruc)) return res.status(400).json({ error: 'RUC debe ser 11 dígitos' });

  // Check existe
  const existing = await db
    .select()
    .from(schema.proveedores)
    .where(eq(schema.proveedores.ruc, ruc))
    .limit(1);
  if (existing.length) {
    return res.status(409).json({ error: `RUC ${ruc} ya existe`, proveedor: existing[0] });
  }

  const [created] = await db
    .insert(schema.proveedores)
    .values({
      ruc,
      razonSocial: String(data.razonSocial).trim(),
      nombreComercial: data.nombreComercial as string | undefined,
      categoria: data.categoria as string | undefined,
      domicilio: data.domicilio as string | undefined,
      distrito: data.distrito as string | undefined,
      departamento: data.departamento as string | undefined,
      email: data.email as string | undefined,
      telefono: data.telefono as string | undefined,
      contacto: data.contacto as string | undefined,
      contactoCargo: data.contactoCargo as string | undefined,
      estadoSunat: data.estadoSunat as string | undefined,
      condicionSunat: data.condicionSunat as string | undefined,
      tipoContribuyente: data.tipoContribuyente as string | undefined,
      rating: data.rating != null ? String(data.rating) : undefined,
      leadTimeDias: data.leadTimeDias as number | undefined,
      cuentaBancaria: data.cuentaBancaria as string | undefined,
      cuentaCci: data.cuentaCci as string | undefined,
      cuentaDetraccionesBn: data.cuentaDetraccionesBn as string | undefined,
      notas: data.notas as string | undefined,
    })
    .returning();
  res.status(201).json({ proveedor: created });
});

// PATCH /api/logistica/proveedores/:id
router.patch('/proveedores/:id', async (req, res) => {
  const data = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const allowed = [
    'razonSocial', 'nombreComercial', 'categoria', 'domicilio', 'distrito', 'departamento',
    'email', 'telefono', 'contacto', 'contactoCargo', 'estadoSunat', 'condicionSunat',
    'tipoContribuyente', 'leadTimeDias', 'cuentaBancaria', 'cuentaCci',
    'cuentaDetraccionesBn', 'notas', 'activo',
  ];
  for (const k of allowed) {
    if (data[k] !== undefined) updates[k] = data[k];
  }
  if (data.rating !== undefined) updates.rating = String(data.rating);
  if (Object.keys(updates).length === 1) return res.status(400).json({ error: 'Sin campos' });
  const [updated] = await db
    .update(schema.proveedores)
    .set(updates)
    .where(eq(schema.proveedores.id, req.params.id!))
    .returning();
  if (!updated) return res.status(404).json({ error: 'No encontrado' });
  res.json({ proveedor: updated });
});

// DELETE /api/logistica/proveedores/:id · soft delete (activo=false)
router.delete('/proveedores/:id', async (req, res) => {
  const ocs = await db
    .select()
    .from(schema.ordenesCompra)
    .where(eq(schema.ordenesCompra.proveedorId, req.params.id!))
    .limit(1);
  if (ocs.length) {
    // Soft delete · no hard delete si tiene OCs
    const [updated] = await db
      .update(schema.proveedores)
      .set({ activo: false, updatedAt: new Date() })
      .where(eq(schema.proveedores.id, req.params.id!))
      .returning();
    return res.json({ ok: true, soft: true, proveedor: updated });
  }
  await db.delete(schema.proveedores).where(eq(schema.proveedores.id, req.params.id!));
  res.json({ ok: true, soft: false });
});

// ═══════════════════════════════════════════════════════════════
// F3 · REQUERIMIENTOS · CRUD + workflow
// ═══════════════════════════════════════════════════════════════

async function nextCorrelativo(clave: string): Promise<number> {
  const [row] = await db
    .insert(schema.correlativos)
    .values({ clave, ultimoNumero: 1 })
    .onConflictDoUpdate({
      target: schema.correlativos.clave,
      set: {
        ultimoNumero: sql`${schema.correlativos.ultimoNumero} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!.ultimoNumero;
}

// GET /api/logistica/requerimientos
router.get('/requerimientos', async (req, res) => {
  const { proyectoId } = req.query;
  const conditions = [];
  if (proyectoId) conditions.push(eq(schema.requerimientos.proyectoId, String(proyectoId)));
  const list = conditions.length
    ? await db.select().from(schema.requerimientos).where(conditions[0]!).orderBy(desc(schema.requerimientos.fecha))
    : await db.select().from(schema.requerimientos).orderBy(desc(schema.requerimientos.fecha));
  res.json({ requerimientos: list });
});

// GET /api/logistica/requerimientos/:id (con líneas)
router.get('/requerimientos/:id', async (req, res) => {
  const [r] = await db
    .select()
    .from(schema.requerimientos)
    .where(eq(schema.requerimientos.id, req.params.id!))
    .limit(1);
  if (!r) return res.status(404).json({ error: 'No encontrado' });
  const lineas = await db
    .select()
    .from(schema.requerimientosLineas)
    .where(eq(schema.requerimientosLineas.requerimientoId, r.id))
    .orderBy(asc(schema.requerimientosLineas.numero));
  res.json({ requerimiento: r, lineas });
});

// POST /api/logistica/requerimientos
router.post('/requerimientos', async (req, res) => {
  const data = req.body as Record<string, unknown> & { lineas?: Record<string, unknown>[] };
  if (!data.proyectoId || !data.descripcion) {
    return res.status(400).json({ error: 'proyectoId y descripcion obligatorios' });
  }
  const anio = new Date().getFullYear();
  const correlativo = await nextCorrelativo(`REQ-${anio}`);
  const numero = `REQ-${anio}-${String(correlativo).padStart(4, '0')}`;
  const [created] = await db
    .insert(schema.requerimientos)
    .values({
      numero,
      correlativo,
      proyectoId: String(data.proyectoId),
      solicitanteId: data.solicitanteId as string | undefined,
      solicitanteNombre: data.solicitanteNombre as string | undefined,
      fecha: (data.fecha as string) ?? new Date().toISOString().slice(0, 10),
      fechaNecesaria: data.fechaNecesaria as string | undefined,
      urgencia: (data.urgencia as 'baja' | 'media' | 'alta' | 'urgente') ?? 'media',
      descripcion: String(data.descripcion),
      justificacion: data.justificacion as string | undefined,
      estado: 'pendiente_aprobacion',
      montoEstimado: data.montoEstimado != null ? String(data.montoEstimado) : undefined,
      notas: data.notas as string | undefined,
    })
    .returning();
  // Líneas
  if (Array.isArray(data.lineas)) {
    for (let i = 0; i < data.lineas.length; i++) {
      const l = data.lineas[i] as Record<string, unknown>;
      if (!l.descripcion) continue;
      await db.insert(schema.requerimientosLineas).values({
        requerimientoId: created!.id,
        numero: i + 1,
        recursoId: l.recursoId as string | undefined,
        descripcion: String(l.descripcion),
        unidad: String(l.unidad ?? 'UND'),
        cantidad: String(l.cantidad ?? 0),
        precioReferencial: l.precioReferencial != null ? String(l.precioReferencial) : undefined,
        notas: l.notas as string | undefined,
      });
    }
  }
  res.status(201).json({ requerimiento: created });
});

// PATCH /api/logistica/requerimientos/:id · cambiar estado/aprobar/rechazar
router.patch('/requerimientos/:id', async (req, res) => {
  const data = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (data.estado) {
    updates.estado = data.estado;
    if (data.estado === 'aprobado') {
      updates.aprobadoEn = new Date();
      updates.aprobadoPorId = (data.aprobadoPorId as string) ?? null;
    } else if (data.estado === 'rechazado') {
      updates.rechazadoMotivo = (data.rechazadoMotivo as string) ?? '';
    }
  }
  for (const k of ['descripcion', 'justificacion', 'urgencia', 'fechaNecesaria', 'notas', 'montoEstimado']) {
    if (data[k] !== undefined) updates[k] = data[k];
  }
  const [updated] = await db
    .update(schema.requerimientos)
    .set(updates)
    .where(eq(schema.requerimientos.id, req.params.id!))
    .returning();
  if (!updated) return res.status(404).json({ error: 'No encontrado' });
  res.json({ requerimiento: updated });
});

// ═══════════════════════════════════════════════════════════════
// F3 · ÓRDENES DE COMPRA · CRUD + workflow + cálculos
// ═══════════════════════════════════════════════════════════════

function calcOcMontos(params: {
  lineas: Array<{ cantidad: number; precioUnitario: number }>;
  pctIgv: number;
  incluyeIgv: boolean;
  aplicaDetraccion: boolean;
  pctDetraccion?: number;
}): {
  subtotalSinIgv: number;
  igv: number;
  total: number;
  montoDetraccion: number;
  montoNetoPagar: number;
} {
  const subtotalLineas = params.lineas.reduce(
    (s, l) => s + l.cantidad * l.precioUnitario,
    0,
  );
  let subtotalSinIgv: number;
  let total: number;
  let igv: number;
  if (params.incluyeIgv) {
    total = subtotalLineas;
    subtotalSinIgv = total / (1 + params.pctIgv / 100);
    igv = total - subtotalSinIgv;
  } else {
    subtotalSinIgv = subtotalLineas;
    igv = subtotalSinIgv * (params.pctIgv / 100);
    total = subtotalSinIgv + igv;
  }
  const montoDetraccion =
    params.aplicaDetraccion && params.pctDetraccion
      ? total * (params.pctDetraccion / 100)
      : 0;
  const montoNetoPagar = total - montoDetraccion;
  return {
    subtotalSinIgv: +subtotalSinIgv.toFixed(2),
    igv: +igv.toFixed(2),
    total: +total.toFixed(2),
    montoDetraccion: +montoDetraccion.toFixed(2),
    montoNetoPagar: +montoNetoPagar.toFixed(2),
  };
}

// GET /api/logistica/ordenes-compra
router.get('/ordenes-compra', async (req, res) => {
  const { proyectoId, proveedorId, estado } = req.query;
  let qb = db.select().from(schema.ordenesCompra).$dynamic();
  const conds = [];
  if (proyectoId) conds.push(eq(schema.ordenesCompra.proyectoId, String(proyectoId)));
  if (proveedorId) conds.push(eq(schema.ordenesCompra.proveedorId, String(proveedorId)));
  if (estado) {
    conds.push(
      eq(
        schema.ordenesCompra.estado,
        estado as 'borrador' | 'pendiente_aprobacion' | 'aprobada' | 'emitida' | 'en_transito' | 'entregada' | 'anulada' | 'rechazada',
      ),
    );
  }
  if (conds.length > 0) qb = qb.where(conds[0]!);
  const list = await qb.orderBy(desc(schema.ordenesCompra.fechaEmision));

  // Stats
  const stats = {
    total: list.length,
    porEstado: list.reduce(
      (acc, oc) => {
        acc[oc.estado] = (acc[oc.estado] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
    montoTotal: list.reduce((s, oc) => s + Number(oc.total), 0),
    montoEmitidas: list
      .filter((oc) => ['emitida', 'en_transito', 'entregada'].includes(oc.estado))
      .reduce((s, oc) => s + Number(oc.total), 0),
  };

  // Enriquecer con proveedor + proyecto info
  const proveedoresAll = await db.select().from(schema.proveedores);
  const proyectosAll = await db.select().from(schema.proyectos);
  const provMap = new Map(proveedoresAll.map((p) => [p.id, p]));
  const proyMap = new Map(proyectosAll.map((p) => [p.id, p]));
  const enriched = list.map((oc) => ({
    ...oc,
    proveedor: provMap.get(oc.proveedorId)
      ? {
          id: provMap.get(oc.proveedorId)!.id,
          razonSocial: provMap.get(oc.proveedorId)!.razonSocial,
          ruc: provMap.get(oc.proveedorId)!.ruc,
        }
      : null,
    proyecto: proyMap.get(oc.proyectoId)
      ? {
          id: proyMap.get(oc.proyectoId)!.id,
          codigo: proyMap.get(oc.proyectoId)!.codigo,
          nombre: proyMap.get(oc.proyectoId)!.nombre,
        }
      : null,
  }));

  res.json({ ordenes: enriched, stats });
});

// GET /api/logistica/ordenes-compra/:id (con líneas + aprobaciones)
router.get('/ordenes-compra/:id', async (req, res) => {
  const [oc] = await db
    .select()
    .from(schema.ordenesCompra)
    .where(eq(schema.ordenesCompra.id, req.params.id!))
    .limit(1);
  if (!oc) return res.status(404).json({ error: 'No encontrado' });
  const lineas = await db
    .select()
    .from(schema.ocLineas)
    .where(eq(schema.ocLineas.ordenCompraId, oc.id))
    .orderBy(asc(schema.ocLineas.numero));
  const aprobaciones = await db
    .select()
    .from(schema.ocAprobaciones)
    .where(eq(schema.ocAprobaciones.ordenCompraId, oc.id))
    .orderBy(asc(schema.ocAprobaciones.createdAt));
  const [proveedor] = await db
    .select()
    .from(schema.proveedores)
    .where(eq(schema.proveedores.id, oc.proveedorId))
    .limit(1);
  const [proyecto] = await db
    .select()
    .from(schema.proyectos)
    .where(eq(schema.proyectos.id, oc.proyectoId))
    .limit(1);
  res.json({ oc, lineas, aprobaciones, proveedor, proyecto });
});

// POST /api/logistica/ordenes-compra
router.post('/ordenes-compra', async (req, res) => {
  const data = req.body as Record<string, unknown> & {
    lineas?: Array<Record<string, unknown>>;
    // Auto-crear proveedor desde form
    proveedorRazonSocial?: string;
    proveedorDireccion?: string;
    ruc?: string;
    sinRuc?: boolean;
  };
  if (!data.proyectoId || !Array.isArray(data.lineas) || data.lineas.length === 0) {
    return res.status(400).json({ error: 'proyectoId y al menos 1 línea obligatorios' });
  }

  // ─── Auto-crear o resolver proveedor ───
  let proveedorId: string | null = (data.proveedorId as string) || null;
  if (!proveedorId) {
    // Buscar por RUC si trae
    const rucClean = data.ruc ? String(data.ruc).replace(/\D/g, '').slice(0, 11) : '';
    if (rucClean.length === 11 && !data.sinRuc) {
      const [existing] = await db
        .select()
        .from(schema.proveedores)
        .where(eq(schema.proveedores.ruc, rucClean))
        .limit(1);
      if (existing) {
        proveedorId = existing.id;
      } else {
        // Crear proveedor nuevo desde form
        if (!data.proveedorRazonSocial) {
          return res.status(400).json({ error: 'razón social obligatoria para crear proveedor' });
        }
        const [created] = await db
          .insert(schema.proveedores)
          .values({
            ruc: rucClean,
            razonSocial: String(data.proveedorRazonSocial).trim().toUpperCase(),
            domicilio: data.proveedorDireccion ? String(data.proveedorDireccion) : null,
            activo: true,
          })
          .returning();
        proveedorId = created!.id;
      }
    } else if (data.sinRuc && data.proveedorRazonSocial) {
      // Sin RUC · crear proveedor informal
      const [created] = await db
        .insert(schema.proveedores)
        .values({
          ruc: null,
          razonSocial: String(data.proveedorRazonSocial).trim().toUpperCase(),
          domicilio: data.proveedorDireccion ? String(data.proveedorDireccion) : null,
          categoria: 'Informal',
          activo: true,
        })
        .returning();
      proveedorId = created!.id;
    } else {
      return res.status(400).json({
        error: 'Necesita proveedorId, o RUC + razón social, o sinRuc=true + razón social',
      });
    }
  }
  if (!proveedorId) {
    return res.status(400).json({ error: 'No se pudo resolver el proveedor' });
  }
  const anio = new Date().getFullYear();
  const correlativo = await nextCorrelativo(`OC-${anio}`);
  const numero = `OC-${anio}-${String(correlativo).padStart(4, '0')}`;

  // Calcular totales
  const lineasParsed = data.lineas.map((l) => ({
    cantidad: Number(l.cantidad ?? 0),
    precioUnitario: Number(l.precioUnitario ?? 0),
    descripcion: String(l.descripcion ?? ''),
    unidad: String(l.unidad ?? 'UND'),
    partidaId: l.partidaId as string | undefined,
    recursoId: l.recursoId as string | undefined,
    notas: l.notas as string | undefined,
  }));
  const pctIgv = Number(data.pctIgv ?? 18);
  const incluyeIgv = data.incluyeIgv !== false;
  const aplicaDetraccion = Boolean(data.aplicaDetraccion);
  const pctDetraccion = Number(data.pctDetraccion ?? 0);

  const montos = calcOcMontos({
    lineas: lineasParsed,
    pctIgv,
    incluyeIgv,
    aplicaDetraccion,
    pctDetraccion,
  });

  const [created] = await db
    .insert(schema.ordenesCompra)
    .values({
      numero,
      correlativo,
      anio,
      proyectoId: String(data.proyectoId),
      proveedorId,
      requerimientoId: data.requerimientoId as string | undefined,
      fechaEmision: (data.fechaEmision as string) ?? new Date().toISOString().slice(0, 10),
      fechaEntrega: data.fechaEntrega as string | undefined,
      lugarEntrega: data.lugarEntrega as string | undefined,
      moneda: (data.moneda as 'PEN' | 'USD') ?? 'PEN',
      tipoCambio: data.tipoCambio != null ? String(data.tipoCambio) : undefined,
      concepto: (data.concepto as 'BIEN' | 'SERVICIO') ?? 'BIEN',
      medioPago: data.medioPago as string | undefined,
      formaPago: data.formaPago as string | undefined,
      cotizacion: data.cotizacion as string | undefined,
      pctIgv: String(pctIgv),
      incluyeIgv,
      subtotalSinIgv: String(montos.subtotalSinIgv),
      igv: String(montos.igv),
      total: String(montos.total),
      aplicaDetraccion,
      pctDetraccion: pctDetraccion > 0 ? String(pctDetraccion) : undefined,
      montoDetraccion: String(montos.montoDetraccion),
      montoNetoPagar: String(montos.montoNetoPagar),
      estado: (data.estado as 'borrador' | 'pendiente_aprobacion') ?? 'borrador',
      creadoPorId: data.creadoPorId as string | undefined,
      creadoPorEmail: data.creadoPorEmail as string | undefined,
      gestorEmail: data.gestorEmail as string | undefined,
      gestorNombre: data.gestorNombre as string | undefined,
      terminos: data.terminos as string | undefined,
      notas: data.notas as string | undefined,
    })
    .returning();

  // Insertar líneas
  for (let i = 0; i < lineasParsed.length; i++) {
    const l = lineasParsed[i]!;
    await db.insert(schema.ocLineas).values({
      ordenCompraId: created!.id,
      numero: i + 1,
      partidaId: l.partidaId,
      recursoId: l.recursoId,
      descripcion: l.descripcion,
      unidad: l.unidad,
      cantidad: String(l.cantidad),
      precioUnitario: String(l.precioUnitario),
      subtotal: String((l.cantidad * l.precioUnitario).toFixed(2)),
      notas: l.notas,
    });
  }

  res.status(201).json({ oc: created });
});

// POST /api/logistica/ordenes-compra/:id/aprobar
router.post('/ordenes-compra/:id/aprobar', async (req, res) => {
  const ocId = req.params.id!;
  const { userId, userNombre, comentario } = req.body as Record<string, unknown>;
  const [oc] = await db
    .select()
    .from(schema.ordenesCompra)
    .where(eq(schema.ordenesCompra.id, ocId))
    .limit(1);
  if (!oc) return res.status(404).json({ error: 'No encontrado' });
  if (!['borrador', 'pendiente_aprobacion'].includes(oc.estado)) {
    return res.status(400).json({ error: `No se puede aprobar desde estado ${oc.estado}` });
  }
  const estadoFrom = oc.estado;
  await db.insert(schema.ocAprobaciones).values({
    ordenCompraId: ocId,
    estadoFrom,
    estadoTo: 'aprobada',
    userId: userId as string | undefined,
    userNombre: userNombre as string | undefined,
    comentario: comentario as string | undefined,
  });
  const [updated] = await db
    .update(schema.ordenesCompra)
    .set({
      estado: 'aprobada',
      aprobadoPorId: userId as string | undefined,
      aprobadoEn: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.ordenesCompra.id, ocId))
    .returning();
  res.json({ oc: updated });
});

// POST /api/logistica/ordenes-compra/:id/emitir · marca emitida
router.post('/ordenes-compra/:id/emitir', async (req, res) => {
  const ocId = req.params.id!;
  const { userId, userNombre } = req.body as Record<string, unknown>;
  const [oc] = await db
    .select()
    .from(schema.ordenesCompra)
    .where(eq(schema.ordenesCompra.id, ocId))
    .limit(1);
  if (!oc) return res.status(404).json({ error: 'No encontrado' });
  if (oc.estado !== 'aprobada') {
    return res.status(400).json({ error: 'Solo OC aprobadas pueden emitirse' });
  }
  await db.insert(schema.ocAprobaciones).values({
    ordenCompraId: ocId,
    estadoFrom: 'aprobada',
    estadoTo: 'emitida',
    userId: userId as string | undefined,
    userNombre: userNombre as string | undefined,
    comentario: 'Emisión',
  });
  const [updated] = await db
    .update(schema.ordenesCompra)
    .set({ estado: 'emitida', emitidaEn: new Date(), updatedAt: new Date() })
    .where(eq(schema.ordenesCompra.id, ocId))
    .returning();
  res.json({ oc: updated });
});

// POST /api/logistica/ordenes-compra/:id/cambiar-estado
router.post('/ordenes-compra/:id/cambiar-estado', async (req, res) => {
  const ocId = req.params.id!;
  const { estado, comentario, userId, userNombre } = req.body as Record<string, unknown>;
  if (!estado) return res.status(400).json({ error: 'estado obligatorio' });
  const [oc] = await db
    .select()
    .from(schema.ordenesCompra)
    .where(eq(schema.ordenesCompra.id, ocId))
    .limit(1);
  if (!oc) return res.status(404).json({ error: 'No encontrado' });
  await db.insert(schema.ocAprobaciones).values({
    ordenCompraId: ocId,
    estadoFrom: oc.estado,
    estadoTo: String(estado),
    userId: userId as string | undefined,
    userNombre: userNombre as string | undefined,
    comentario: comentario as string | undefined,
  });
  const extra: Record<string, unknown> = {};
  if (estado === 'entregada') extra.entregadaEn = new Date();
  if (estado === 'anulada') extra.canceladaMotivo = (comentario as string) ?? '';
  const [updated] = await db
    .update(schema.ordenesCompra)
    .set({
      estado: String(estado) as 'borrador' | 'pendiente_aprobacion' | 'aprobada' | 'emitida' | 'en_transito' | 'entregada' | 'anulada' | 'rechazada',
      ...extra,
      updatedAt: new Date(),
    })
    .where(eq(schema.ordenesCompra.id, ocId))
    .returning();
  res.json({ oc: updated });
});

void isNull; // suppress unused
void inArray;
export default router;
