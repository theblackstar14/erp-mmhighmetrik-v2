import { db, schema } from '@erp/db';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import multer from 'multer';
import { generarOcPdf } from '../lib/ocPdf.js';
import { nasDownload, nasEnsureOcFolder, nasUpload } from '../lib/nas.js';
import { requireAuth } from '../middleware/auth.js';
import { periodoCerradoDeFecha } from '../lib/periodos.js';
import { audit } from '../lib/audit.js';
import { resolverClase } from '../lib/clasificacion.js';

const ocUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Helper · arma OC.pdf y lo sube al NAS · devuelve ruta
async function generarYSubirOcPdf(ocId: string): Promise<string | null> {
  const [oc] = await db.select().from(schema.ordenesCompra).where(eq(schema.ordenesCompra.id, ocId)).limit(1);
  if (!oc) return null;
  // líneas/proveedor/proyecto son independientes una vez conocido `oc` → en paralelo
  const [lineas, [proveedor], proyectoArr] = await Promise.all([
    db.select().from(schema.ocLineas).where(eq(schema.ocLineas.ordenCompraId, ocId)).orderBy(asc(schema.ocLineas.numero)),
    db.select().from(schema.proveedores).where(eq(schema.proveedores.id, oc.proveedorId)).limit(1),
    oc.proyectoId ? db.select().from(schema.proyectos).where(eq(schema.proyectos.id, oc.proyectoId)).limit(1) : Promise.resolve([]),
  ]);
  const proyecto = proyectoArr[0] ?? null;
  const buf = await generarOcPdf(
    oc as never,
    lineas as never,
    proveedor ? { razonSocial: proveedor.razonSocial, ruc: proveedor.ruc, domicilio: proveedor.domicilio } : null,
    proyecto ? { codigo: proyecto.codigo, nombre: proyecto.nombre } : null,
  );
  const folder = await nasEnsureOcFolder({ proyectoCodigo: proyecto?.codigo ?? null, anio: oc.anio, numero: oc.numero });
  const filename = `${oc.numero}.pdf`;
  await nasUpload(folder, filename, buf);
  const path = `${folder}/${filename}`;
  await db.update(schema.ordenesCompra).set({ pdfNasPath: path, updatedAt: new Date() }).where(eq(schema.ordenesCompra.id, ocId));
  return path;
}

const router = Router();
router.use(requireAuth);

// ═══════════════════════════════════════════════════════════════
// F3 · PROVEEDORES · CRUD
// ═══════════════════════════════════════════════════════════════

// GET /api/logistica/proveedores · lista + stats
router.get('/proveedores', async (_req, res) => {
  // conteo/volumen OC por proveedor en SQL (GROUP BY) · antes traía TODA la tabla ordenesCompra
  const [list, ocRows] = await Promise.all([
    db.select().from(schema.proveedores).where(eq(schema.proveedores.activo, true)).orderBy(asc(schema.proveedores.razonSocial)),
    db.select({ proveedorId: schema.ordenesCompra.proveedorId, count: sql<number>`count(*)::int`, volumen: sql<number>`coalesce(sum(${schema.ordenesCompra.total}),0)::float8` }).from(schema.ordenesCompra).groupBy(schema.ordenesCompra.proveedorId),
  ]);
  const conteoOC = new Map(ocRows.map((r) => [r.proveedorId, { count: r.count, volumen: r.volumen }]));
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
  const { proyectoId, proveedorId, estado, tipo } = req.query;
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
  if (tipo === 'BIEN' || tipo === 'SERVICIO') conds.push(eq(schema.ordenesCompra.concepto, tipo));
  if (conds.length > 0) qb = qb.where(and(...conds)); // combina TODOS los filtros (antes solo aplicaba el 1º)
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
    porTipo: list.reduce(
      (acc, oc) => { acc[oc.concepto] = (acc[oc.concepto] ?? 0) + 1; return acc; },
      {} as Record<string, number>,
    ),
    pendientesAprobar: list.filter((oc) => oc.estado === 'pendiente_aprobacion').length,
    pendientesPago: list.filter((oc) => ['aprobada', 'emitida', 'en_transito', 'entregada'].includes(oc.estado) && oc.estadoPago !== 'pagada').length,
    montoTotal: list.reduce((s, oc) => s + Number(oc.total), 0),
    montoEmitidas: list
      .filter((oc) => ['emitida', 'en_transito', 'entregada'].includes(oc.estado))
      .reduce((s, oc) => s + Number(oc.total), 0),
  };

  // Enriquecer · solo proveedores/proyectos referenciados (inArray) + líneas · todo en paralelo
  // (antes traía las tablas proveedores+proyectos COMPLETAS para una página ya filtrada)
  const provIds = [...new Set(list.map((o) => o.proveedorId))];
  const proyIds = [...new Set(list.map((o) => o.proyectoId).filter(Boolean) as string[])];
  const ids = list.map((o) => o.id);
  const [proveedoresRef, proyectosRef, lineas1] = await Promise.all([
    provIds.length ? db.select({ id: schema.proveedores.id, razonSocial: schema.proveedores.razonSocial, ruc: schema.proveedores.ruc }).from(schema.proveedores).where(inArray(schema.proveedores.id, provIds)) : Promise.resolve([] as { id: string; razonSocial: string; ruc: string | null }[]),
    proyIds.length ? db.select({ id: schema.proyectos.id, codigo: schema.proyectos.codigo, nombre: schema.proyectos.nombre }).from(schema.proyectos).where(inArray(schema.proyectos.id, proyIds)) : Promise.resolve([] as { id: string; codigo: string; nombre: string }[]),
    ids.length ? db.select({ ocId: schema.ocLineas.ordenCompraId, numero: schema.ocLineas.numero, desc: schema.ocLineas.descripcion }).from(schema.ocLineas).where(inArray(schema.ocLineas.ordenCompraId, ids)) : Promise.resolve([] as { ocId: string; numero: number; desc: string }[]),
  ]);
  const provMap = new Map(proveedoresRef.map((p) => [p.id, p]));
  const proyMap = new Map(proyectosRef.map((p) => [p.id, p]));
  const itemMap = new Map<string, string>();
  for (const l of lineas1) {
    if (l.numero === 1 || !itemMap.has(l.ocId)) itemMap.set(l.ocId, l.desc);
  }
  const enriched = list.map((oc) => ({
    ...oc,
    itemPrincipal: itemMap.get(oc.id) ?? null,
    proveedor: provMap.get(oc.proveedorId)
      ? {
          id: provMap.get(oc.proveedorId)!.id,
          razonSocial: provMap.get(oc.proveedorId)!.razonSocial,
          ruc: provMap.get(oc.proveedorId)!.ruc,
        }
      : null,
    proyecto: oc.proyectoId && proyMap.get(oc.proyectoId)
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
  // 4 lecturas independientes una vez conocido `oc` → en paralelo
  const [lineas, aprobaciones, [proveedor], proyectoArr] = await Promise.all([
    db.select().from(schema.ocLineas).where(eq(schema.ocLineas.ordenCompraId, oc.id)).orderBy(asc(schema.ocLineas.numero)),
    db.select().from(schema.ocAprobaciones).where(eq(schema.ocAprobaciones.ordenCompraId, oc.id)).orderBy(asc(schema.ocAprobaciones.createdAt)),
    db.select().from(schema.proveedores).where(eq(schema.proveedores.id, oc.proveedorId)).limit(1),
    oc.proyectoId ? db.select().from(schema.proyectos).where(eq(schema.proyectos.id, oc.proyectoId)).limit(1) : Promise.resolve([]),
  ]);
  const proyecto = proyectoArr[0] ?? null;
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
  if (!Array.isArray(data.lineas) || data.lineas.length === 0) {
    return res.status(400).json({ error: 'al menos 1 línea obligatoria' });
  }
  // proyectoId opcional · null = oficina/empresa (MM)

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
  const prefijo = data.concepto === 'SERVICIO' ? 'OS' : 'OC';
  const correlativo = await nextCorrelativo(`${prefijo}-${anio}`);
  const numero = `${prefijo}-${anio}-${String(correlativo).padStart(4, '0')}`;

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
      proyectoId: data.proyectoId ? String(data.proyectoId) : null,
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

  // Insertar líneas · 1 INSERT batch (antes: 1 round-trip por línea)
  if (lineasParsed.length > 0) {
    await db.insert(schema.ocLineas).values(
      lineasParsed.map((l, i) => ({
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
      })),
    );
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

  // Generar OC.pdf → NAS (no bloquea la aprobación si el NAS falla)
  let pdfNasPath: string | null = null;
  try {
    pdfNasPath = await generarYSubirOcPdf(ocId);
  } catch (e) {
    console.error('OC.pdf no se pudo generar/subir:', (e as Error)?.message);
  }
  res.json({ oc: updated ? { ...updated, pdfNasPath: pdfNasPath ?? updated.pdfNasPath } : updated, pdfGenerado: !!pdfNasPath });
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

// Helper · resuelve carpeta NAS de una OC (con código de proyecto)
async function folderDeOc(oc: { id: string; proyectoId: string | null; anio: number; numero: string }): Promise<string> {
  const codigo = oc.proyectoId
    ? (await db.select({ codigo: schema.proyectos.codigo }).from(schema.proyectos).where(eq(schema.proyectos.id, oc.proyectoId)).limit(1))[0]?.codigo ?? null
    : null;
  return nasEnsureOcFolder({ proyectoCodigo: codigo, anio: oc.anio, numero: oc.numero });
}
const extDe = (name: string) => { const m = /\.([a-z0-9]+)$/i.exec(name); return m ? `.${m[1]!.toLowerCase()}` : ''; };

// POST /api/logistica/ordenes-compra/:id/cotizacion · sube cotización (obligatoria) al NAS
router.post('/ordenes-compra/:id/cotizacion', ocUpload.single('file'), async (req, res) => {
  const ocId = String(req.params.id);
  if (!req.file) return res.status(400).json({ error: 'archivo de cotización requerido' });
  const [oc] = await db.select().from(schema.ordenesCompra).where(eq(schema.ordenesCompra.id, ocId)).limit(1);
  if (!oc) return res.status(404).json({ error: 'OC no encontrada' });
  try {
    const folder = await folderDeOc(oc);
    const filename = `cotizacion${extDe(req.file.originalname)}`;
    await nasUpload(folder, filename, req.file.buffer);
    const path = `${folder}/${filename}`;
    const [updated] = await db.update(schema.ordenesCompra).set({ cotizacionNasPath: path, updatedAt: new Date() }).where(eq(schema.ordenesCompra.id, ocId)).returning();
    res.json({ oc: updated, path });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

// POST /api/logistica/ordenes-compra/:id/enviar-aprobacion · valida cotización → pendiente_aprobacion
router.post('/ordenes-compra/:id/enviar-aprobacion', async (req, res) => {
  const ocId = String(req.params.id);
  const [oc] = await db.select().from(schema.ordenesCompra).where(eq(schema.ordenesCompra.id, ocId)).limit(1);
  if (!oc) return res.status(404).json({ error: 'OC no encontrada' });
  if (!oc.cotizacionNasPath) return res.status(400).json({ error: 'Cotización obligatoria · adjúntala antes de enviar a aprobación' });
  if (!['borrador', 'rechazada'].includes(oc.estado)) return res.status(400).json({ error: `No se puede enviar desde estado ${oc.estado}` });
  const [updated] = await db.update(schema.ordenesCompra).set({ estado: 'pendiente_aprobacion', updatedAt: new Date() }).where(eq(schema.ordenesCompra.id, ocId)).returning();
  res.json({ oc: updated });
});

// POST /api/logistica/ordenes-compra/:id/pagar · Finanzas sube comprobante → pagada + auto-gasto
router.post('/ordenes-compra/:id/pagar', ocUpload.single('file'), async (req, res) => {
  const ocId = String(req.params.id);
  const { pagadoPorEmail, fechaPago, cuentaId } = req.body as Record<string, string>;
  if (!req.file) return res.status(400).json({ error: 'comprobante de pago (captura/PDF) requerido' });
  if (!cuentaId) return res.status(400).json({ error: 'cuenta bancaria de origen requerida' });
  const [oc] = await db.select().from(schema.ordenesCompra).where(eq(schema.ordenesCompra.id, ocId)).limit(1);
  if (!oc) return res.status(404).json({ error: 'OC no encontrada' });
  if (!['aprobada', 'emitida', 'en_transito', 'entregada'].includes(oc.estado)) {
    return res.status(400).json({ error: 'Solo se paga una OC aprobada/emitida' });
  }
  if (oc.estadoPago === 'pagada') return res.status(400).json({ error: 'OC ya pagada' });
  const ocTc = oc.moneda === 'PEN' || !oc.moneda ? 1 : Number((req.body as Record<string, string>).tipoCambio ?? 0); // H3.1
  if (oc.moneda && oc.moneda !== 'PEN' && !(ocTc > 0)) return res.status(400).json({ error: `OC en ${oc.moneda} requiere tipoCambio > 0` });
  const fechaPagoEff = fechaPago || new Date().toISOString().slice(0, 10);
  const cerrado = await periodoCerradoDeFecha(fechaPagoEff); // H1.1 · no pagar en periodo cerrado
  if (cerrado) return res.status(423).json({ error: `Periodo ${cerrado} cerrado · no se permite pagar con fecha retroactiva` });

  try {
    const folder = await folderDeOc(oc);
    const filename = `comprobante_pago${extDe(req.file.originalname)}`;
    await nasUpload(folder, filename, req.file.buffer);
    const comprobantePath = `${folder}/${filename}`;

    const [proveedor] = await db.select().from(schema.proveedores).where(eq(schema.proveedores.id, oc.proveedorId)).limit(1);
    const fecha = fechaPago || new Date().toISOString().slice(0, 10);

    // Transacción · gasto + movimiento de caja + marcar pagada · si falla algo → rollback total
    // (la OC NO queda pagada si no se pudo crear el movimiento). F2: el movimiento ya nace aquí,
    // pero /generar todavía NO lo lee (sigue asentando por flags) → cero doble-conteo hasta F3.
    const result = await db.transaction(async (tx) => {
      // Auto-crear gasto (Fact de Compras) ligado a la OC
      const ocTipoGasto = oc.concepto === 'SERVICIO' ? 'Servicio Terceros' : 'Compra Materiales';
      const cls = await resolverClase({ proyectoId: oc.proyectoId, tipoGasto: ocTipoGasto });
      const [gasto] = await tx.insert(schema.gastos).values({
        proyectoId: oc.proyectoId,
        ...cls,
        fecha,
        tipoRegistro: 'Gasto Directo',
        tipoIgv: Number(oc.igv) > 0 ? 'IGV' : 'Exonerado',
        ordenCompraId: oc.id,
        proveedorId: oc.proveedorId,
        proveedorRuc: proveedor?.ruc ?? null,
        proveedorRazon: proveedor?.razonSocial ?? null,
        moneda: oc.moneda,
        descripcionItem: `Pago ${oc.numero}`,
        subtotal: oc.subtotalSinIgv,
        igv: oc.igv,
        total: oc.total,
        tipoGasto: ocTipoGasto,
        observaciones: `Auto-generado al pagar ${oc.numero}`,
      }).returning();

      // Movimiento Egreso de caja · idempotente (no recrear si la OC ya tiene movimiento)
      const [movPrev] = await tx.select({ id: schema.movimientos.id }).from(schema.movimientos).where(eq(schema.movimientos.ordenCompraId, oc.id)).limit(1);
      if (!movPrev) {
        await tx.insert(schema.movimientos).values({
          fecha,
          proyectoId: oc.proyectoId,
          tipoMovimiento: 'Egreso',
          cuentaId,
          fuenteMovimiento: 'Proveedor',
          clienteNombre: proveedor?.razonSocial ?? null,
          moneda: oc.moneda,
          monto: oc.total,
          descripcion: `Pago ${oc.numero}`,
          gastoId: gasto?.id ?? null,
          subtipo: 'Pago OC',
          naturalezaContable: 'PAGO_PROVEEDOR',
          ordenCompraId: oc.id,
          estado: 'Pagada',
          subtotal: oc.subtotalSinIgv,
          igv: oc.igv,
          userId: req.user!.id, // H1.2 · trazabilidad
          tipoCambio: ocTc.toFixed(4), montoBase: (Number(oc.total) * ocTc).toFixed(2), // H3.1
        });
      }

      const [updated] = await tx.update(schema.ordenesCompra).set({
        estadoPago: 'pagada',
        pagadoEn: new Date(),
        pagadoPorEmail: pagadoPorEmail ?? null,
        comprobantePagoNasPath: comprobantePath,
        gastoId: gasto?.id ?? null,
        updatedAt: new Date(),
      }).where(eq(schema.ordenesCompra.id, ocId)).returning();
      return { updated, gastoId: gasto?.id ?? null };
    });

    await audit(req, { action: 'pago_oc', entityType: 'orden_compra', entityId: oc.id, after: { numero: oc.numero, total: oc.total, cuentaId, fechaPago: fechaPagoEff } });
    res.json({ oc: result.updated, gastoId: result.gastoId, comprobantePath });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

// GET /api/logistica/ordenes-compra/:id/doc/:tipo · stream doc del NAS (oc|cotizacion|comprobante)
router.get('/ordenes-compra/:id/doc/:tipo', async (req, res) => {
  const ocId = String(req.params.id);
  const tipo = String(req.params.tipo);
  const [oc] = await db.select().from(schema.ordenesCompra).where(eq(schema.ordenesCompra.id, ocId)).limit(1);
  if (!oc) return res.status(404).json({ error: 'OC no encontrada' });
  const pathMap: Record<string, string | null> = {
    oc: oc.pdfNasPath,
    cotizacion: oc.cotizacionNasPath,
    comprobante: oc.comprobantePagoNasPath,
  };
  const nasPath = pathMap[tipo];
  if (!nasPath) return res.status(404).json({ error: `Sin documento "${tipo}"` });
  const disposition = (req.query.download === '1' || req.query.download === 'true') ? 'attachment' : 'inline';
  try {
    const { stream, filename } = await nasDownload(nasPath);
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    stream.on('error', () => { if (!res.headersSent) res.status(502).end(); });
    stream.pipe(res);
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
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
