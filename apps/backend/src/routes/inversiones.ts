import { db, schema } from '@erp/db';
import { inversionCreateSchema, inversionLinkProyectoSchema } from '@erp/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// decimal → string (postgres numeric) · null-safe
const dec = (n?: number) => (n === undefined ? undefined : n.toString());

// GET /api/inversiones · lista (con conteo de proyectos-colegio)
router.get('/', async (_req, res) => {
  const list = await db
    .select()
    .from(schema.inversiones)
    .where(isNull(schema.inversiones.deletedAt))
    .orderBy(desc(schema.inversiones.createdAt));
  res.json({ inversiones: list });
});

// GET /api/inversiones/:id · detalle + proyectos-colegio vinculados
router.get('/:id', async (req, res) => {
  const [inversion] = await db
    .select()
    .from(schema.inversiones)
    .where(and(eq(schema.inversiones.id, req.params.id), isNull(schema.inversiones.deletedAt)))
    .limit(1);
  if (!inversion) return res.status(404).json({ error: 'Inversión no encontrada' });

  const proyectos = await db
    .select()
    .from(schema.proyectos)
    .where(and(eq(schema.proyectos.inversionId, req.params.id), isNull(schema.proyectos.deletedAt)));

  res.json({ inversion, proyectos });
});

// GET /api/inversiones/:id/rollup · suma montos de colegios → totales inversión
//   Compara contra montoComponentes (obra) y montoInversionMef (total MEF).
//   Epsilon S/ 1.00 · % (GG/UT) NO se agregan a nivel inversión (mezcla de ggUtModo · sin sentido).
const EPSILON = 1.0;
router.get('/:id/rollup', async (req, res) => {
  const [inversion] = await db
    .select()
    .from(schema.inversiones)
    .where(and(eq(schema.inversiones.id, req.params.id), isNull(schema.inversiones.deletedAt)))
    .limit(1);
  if (!inversion) return res.status(404).json({ error: 'Inversión no encontrada' });

  const proyectos = await db
    .select()
    .from(schema.proyectos)
    .where(and(eq(schema.proyectos.inversionId, req.params.id), isNull(schema.proyectos.deletedAt)));

  const num = (v: string | null) => (v == null ? 0 : Number(v));
  const colegios = proyectos.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    codigoIe: p.codigoIe,
    ggUtModo: p.ggUtModo,
    costoDirecto: num(p.costoDirecto),
    montoContractual: num(p.montoContractual),
    montoReferencial: p.montoReferencial == null ? null : Number(p.montoReferencial),
  }));

  const totales = {
    costoDirecto: colegios.reduce((s, c) => s + c.costoDirecto, 0),
    montoContractual: colegios.reduce((s, c) => s + c.montoContractual, 0),
    montoReferencial: colegios.reduce((s, c) => s + (c.montoReferencial ?? 0), 0),
    colegios: colegios.length,
  };

  // Comparaciones contra montos declarados de la inversión (08-A / MEF)
  const montoComponentes = inversion.montoComponentes == null ? null : Number(inversion.montoComponentes);
  const montoInversionMef = inversion.montoInversionMef == null ? null : Number(inversion.montoInversionMef);

  type Comparacion = {
    nombre: string;
    descripcion: string;
    rollup: number;
    declarado: number | null;
    diff: number | null;
    ok: boolean | null; // null = no evaluable (monto declarado ausente)
    severidad: 'ok' | 'warn' | 'error' | 'na';
  };
  const comparaciones: Comparacion[] = [
    (() => {
      const ok = montoComponentes == null ? null : Math.abs(totales.montoContractual - montoComponentes) <= EPSILON;
      return {
        nombre: 'componentes_obra',
        descripcion: 'Σ presupuesto contractual de colegios vs monto de componentes (obra) del 08-A',
        rollup: totales.montoContractual,
        declarado: montoComponentes,
        diff: montoComponentes == null ? null : totales.montoContractual - montoComponentes,
        ok,
        severidad: ok === null ? 'na' : ok ? 'ok' : 'error',
      };
    })(),
    (() => {
      // El MEF total incluye ET + supervisión + gestión + liquidación → rollup obra debe ser MENOR
      const ok = montoInversionMef == null ? null : totales.montoContractual <= montoInversionMef + EPSILON;
      return {
        nombre: 'dentro_de_inversion_mef',
        descripcion: 'Σ obra de colegios no debe superar el monto total de inversión MEF',
        rollup: totales.montoContractual,
        declarado: montoInversionMef,
        diff: montoInversionMef == null ? null : totales.montoContractual - montoInversionMef,
        ok,
        severidad: ok === null ? 'na' : ok ? 'ok' : 'error',
      };
    })(),
  ];

  const discrepancias = comparaciones.filter((c) => c.ok === false).map((c) => c.nombre);
  res.json({
    ok: discrepancias.length === 0,
    epsilon: EPSILON,
    inversion: {
      id: inversion.id,
      cui: inversion.cui,
      nombre: inversion.nombre,
      modalidad: inversion.modalidad,
      montoInversionMef,
      montoComponentes,
    },
    // % NO se reportan a nivel inversión · cada colegio tiene su propio ggUtModo
    pctNivelInversion: null,
    colegios,
    totales,
    comparaciones,
    discrepancias,
  });
});

// POST /api/inversiones · crear (CUI manual · montos 08-A opcionales)
router.post('/', async (req, res) => {
  const parse = inversionCreateSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }
  const d = parse.data;

  // CUI único
  const existing = await db
    .select({ id: schema.inversiones.id })
    .from(schema.inversiones)
    .where(eq(schema.inversiones.cui, d.cui))
    .limit(1);
  if (existing.length) {
    return res.status(409).json({ error: `Inversión con CUI ${d.cui} ya existe` });
  }

  const [inversion] = await db
    .insert(schema.inversiones)
    .values({
      cui: d.cui,
      nombre: d.nombre,
      modalidad: d.modalidad,
      clienteId: d.clienteId,
      ubicacion: d.ubicacion,
      montoInversionMef: dec(d.montoInversionMef),
      montoComponentes: dec(d.montoComponentes),
      montoExpedienteTecnico: dec(d.montoExpedienteTecnico),
      montoSupervision: dec(d.montoSupervision),
      montoGestion: dec(d.montoGestion),
      montoLiquidacion: dec(d.montoLiquidacion),
      fechaInicioEjecucion: d.fechaInicioEjecucion,
      fechaFinEjecucion: d.fechaFinEjecucion,
      fechaEntregaOym: d.fechaEntregaOym,
      ueiNombre: d.ueiNombre,
      ufNombre: d.ufNombre,
      uepNombre: d.uepNombre,
      proveidoAprobacion: d.proveidoAprobacion,
      empresaFinancista: d.empresaFinancista,
      nasFolder: d.nasFolder,
      pendienteContrato: true,
    })
    .returning();
  res.status(201).json({ inversion });
});

// PATCH /api/inversiones/:id · editar campos (parcial)
router.patch('/:id', async (req, res) => {
  const parse = inversionCreateSchema.partial().safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }
  const d = parse.data;

  const [updated] = await db
    .update(schema.inversiones)
    .set({
      ...(d.cui !== undefined && { cui: d.cui }),
      ...(d.nombre !== undefined && { nombre: d.nombre }),
      ...(d.modalidad !== undefined && { modalidad: d.modalidad }),
      ...(d.clienteId !== undefined && { clienteId: d.clienteId }),
      ...(d.ubicacion !== undefined && { ubicacion: d.ubicacion }),
      ...(d.montoInversionMef !== undefined && { montoInversionMef: dec(d.montoInversionMef) }),
      ...(d.montoComponentes !== undefined && { montoComponentes: dec(d.montoComponentes) }),
      ...(d.montoExpedienteTecnico !== undefined && {
        montoExpedienteTecnico: dec(d.montoExpedienteTecnico),
      }),
      ...(d.montoSupervision !== undefined && { montoSupervision: dec(d.montoSupervision) }),
      ...(d.montoGestion !== undefined && { montoGestion: dec(d.montoGestion) }),
      ...(d.montoLiquidacion !== undefined && { montoLiquidacion: dec(d.montoLiquidacion) }),
      ...(d.fechaInicioEjecucion !== undefined && { fechaInicioEjecucion: d.fechaInicioEjecucion }),
      ...(d.fechaFinEjecucion !== undefined && { fechaFinEjecucion: d.fechaFinEjecucion }),
      ...(d.fechaEntregaOym !== undefined && { fechaEntregaOym: d.fechaEntregaOym }),
      ...(d.ueiNombre !== undefined && { ueiNombre: d.ueiNombre }),
      ...(d.ufNombre !== undefined && { ufNombre: d.ufNombre }),
      ...(d.uepNombre !== undefined && { uepNombre: d.uepNombre }),
      ...(d.proveidoAprobacion !== undefined && { proveidoAprobacion: d.proveidoAprobacion }),
      ...(d.empresaFinancista !== undefined && { empresaFinancista: d.empresaFinancista }),
      ...(d.nasFolder !== undefined && { nasFolder: d.nasFolder }),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.inversiones.id, req.params.id), isNull(schema.inversiones.deletedAt)))
    .returning();
  if (!updated) return res.status(404).json({ error: 'Inversión no encontrada' });
  res.json({ inversion: updated });
});

// POST /api/inversiones/:id/link · vincular proyecto-colegio existente (NO destructivo)
router.post('/:id/link', async (req, res) => {
  const parse = inversionLinkProyectoSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }
  const d = parse.data;

  const [inversion] = await db
    .select({ id: schema.inversiones.id })
    .from(schema.inversiones)
    .where(and(eq(schema.inversiones.id, req.params.id), isNull(schema.inversiones.deletedAt)))
    .limit(1);
  if (!inversion) return res.status(404).json({ error: 'Inversión no encontrada' });

  const [proyecto] = await db
    .update(schema.proyectos)
    .set({
      inversionId: req.params.id,
      ...(d.cui !== undefined && { cui: d.cui }),
      ...(d.codigoIe !== undefined && { codigoIe: d.codigoIe }),
      ...(d.ggUtModo !== undefined && { ggUtModo: d.ggUtModo }),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.proyectos.id, d.proyectoId), isNull(schema.proyectos.deletedAt)))
    .returning();
  if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });
  res.json({ proyecto });
});

// POST /api/inversiones/:id/unlink/:proyectoId · desvincular (no borra proyecto)
router.post('/:id/unlink/:proyectoId', async (req, res) => {
  const [proyecto] = await db
    .update(schema.proyectos)
    .set({ inversionId: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.proyectos.id, req.params.proyectoId),
        eq(schema.proyectos.inversionId, req.params.id),
        isNull(schema.proyectos.deletedAt),
      ),
    )
    .returning();
  if (!proyecto) return res.status(404).json({ error: 'Proyecto no vinculado a esta inversión' });
  res.json({ proyecto });
});

export default router;
