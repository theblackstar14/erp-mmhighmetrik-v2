import { db, schema } from '@erp/db';
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { Router } from 'express';
import { calcularDetalleOficina } from '../lib/planillaOficinaCalc.js';
import { requireAuth } from '../middleware/auth.js';
import { cargarDerivarCtx } from '../lib/clasificacion.js';
import { crearAsiento, type LineaIn } from './contabilidad.js';
import { periodoCerrado } from '../lib/periodos.js';

const router = Router();
router.use(requireAuth);

// ─── Helper singleton ─────────────────────────────────────────
async function getConfig() {
  let [cfg] = await db.select().from(schema.configPlanilla).limit(1);
  if (!cfg) [cfg] = await db.insert(schema.configPlanilla).values({ id: 'singleton' }).returning();
  return cfg;
}

function cfgToDto(cfg: Awaited<ReturnType<typeof getConfig>>) {
  return {
    pctEssalud: Number(cfg.pctEsSalud),
    pctOnp: Number(cfg.pctOnp),
    pctAfpAporte: 0.10,
    rmv: Number(cfg.rmv),
    uit: Number(cfg.uit),
    topeSeguroAfp: Number(cfg.topeSeguroAfp),
    horasMesBase: Number(cfg.horasMesBase),
  };
}

// frac: AFP tasas stored as fractions (0.0137) already; pass through.
// If ever stored as percent (>1), convert ÷100.
const frac = (v: unknown) => { const n = Number(v); return n > 1 ? n / 100 : n; };

// Strip (F)/(M) comisión suffix from sistemaPension for afpTasas table lookup.
// e.g. 'AFP Profuturo(F)' → 'AFP Profuturo', 'AFP Integra(M)' → 'AFP Integra'
const afpKey = (s: string | null | undefined) => (s ? s.replace(/\s*\([FM]\)\s*$/i, '').trim() : '');

// AFP vs ONP decision from sistemaPension string
function sistemaPensionToTipo(sp: string | null): 'AFP' | 'ONP' {
  const up = (sp ?? '').toUpperCase().replace(/[.\s]/g, '');
  if (up.includes('ONP') || up.includes('SNP')) return 'ONP';
  return 'AFP';
}

// ─── GET /api/oficina/config-planilla ────────────────────────
router.get('/config-planilla', async (_req, res) => {
  const cfg = await getConfig();
  res.json(cfgToDto(cfg));
});

// ─── PUT /api/oficina/config-planilla ────────────────────────
router.put('/config-planilla', async (req, res) => {
  const b = req.body as Record<string, unknown>;
  const allowed = ['rmv', 'uit', 'topeSeguroAfp', 'horasMesBase', 'pctEssalud', 'pctOnp'] as const;

  // Validate: every supplied field must be a finite number
  for (const key of allowed) {
    if (b[key] !== undefined && !Number.isFinite(Number(b[key]))) {
      return res.status(400).json({ error: `Campo '${key}' debe ser un número finito` });
    }
  }

  // Map to DB columns (decimal columns → String, integer → Number)
  const set: Record<string, string | number> = {};
  if (b.rmv !== undefined)           set.rmv           = String(Number(b.rmv));
  if (b.uit !== undefined)           set.uit           = String(Number(b.uit));
  if (b.topeSeguroAfp !== undefined) set.topeSeguroAfp = String(Number(b.topeSeguroAfp));
  if (b.horasMesBase !== undefined)  set.horasMesBase  = Number(b.horasMesBase);
  if (b.pctEssalud !== undefined)    set.pctEsSalud    = String(Number(b.pctEssalud));
  if (b.pctOnp !== undefined)        set.pctOnp        = String(Number(b.pctOnp));

  // Ensure singleton exists, then update
  await db.insert(schema.configPlanilla).values({ id: 'singleton' }).onConflictDoNothing();
  const [cfg] = await db
    .update(schema.configPlanilla)
    .set(set)
    .where(eq(schema.configPlanilla.id, 'singleton'))
    .returning();

  res.json(cfgToDto(cfg));
});

// ─── POST /api/oficina/planilla ──────────────────────────────
// body: { mes: 'YYYY-MM' } → upsert planilla_oficina_mes for empresa_id=1
router.post('/planilla', async (req, res) => {
  const { mes } = req.body as { mes?: string };
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ error: 'mes debe tener formato YYYY-MM' });
  }

  // try find existing
  const [existing] = await db
    .select()
    .from(schema.planillaOficinaMes)
    .where(and(eq(schema.planillaOficinaMes.empresaId, 1), eq(schema.planillaOficinaMes.mes, mes)))
    .limit(1);
  if (existing) return res.json({ mes: existing });

  const [row] = await db
    .insert(schema.planillaOficinaMes)
    .values({ empresaId: 1, mes, estado: 'borrador', createdBy: req.user!.id })
    .returning();

  res.json({ mes: row });
});

// ─── GET /api/oficina/planilla?mes= ─────────────────────────
router.get('/planilla', async (req, res) => {
  const mes = req.query.mes as string | undefined;
  if (!mes) return res.status(400).json({ error: 'Parámetro mes requerido' });

  const [mesRow] = await db
    .select()
    .from(schema.planillaOficinaMes)
    .where(and(eq(schema.planillaOficinaMes.empresaId, 1), eq(schema.planillaOficinaMes.mes, mes)))
    .limit(1);

  if (!mesRow) return res.json({ mes: null, detalle: [] });

  const detalle = await db
    .select()
    .from(schema.planillaOficinaDetalle)
    .where(eq(schema.planillaOficinaDetalle.planillaMesId, mesRow.id))
    .orderBy(asc(schema.planillaOficinaDetalle.boletaCorrelativo));

  res.json({ mes: mesRow, detalle });
});

// ─── POST /api/oficina/planilla/:mesId/calcular ──────────────
router.post('/planilla/:mesId/calcular', async (req, res) => {
  const { mesId } = req.params;

  const [mesRow] = await db
    .select()
    .from(schema.planillaOficinaMes)
    .where(eq(schema.planillaOficinaMes.id, mesId!))
    .limit(1);

  if (!mesRow) return res.status(404).json({ error: 'Planilla mes no encontrada' });
  if (!['borrador', 'calculada'].includes(mesRow.estado)) {
    return res.status(422).json({ error: `No se puede calcular en estado '${mesRow.estado}'` });
  }

  // Load active admin empleados
  const empleados = await db
    .select()
    .from(schema.empleados)
    .where(and(eq(schema.empleados.tipoPlanilla, 'admin'), eq(schema.empleados.activo, true)));

  // Load AFP tasas
  const afpTasasList = await db.select().from(schema.afpTasas);
  const afpTasasMap = new Map(afpTasasList.map((t) => [t.afp, t]));

  // Build base TasasOficina from config
  const cfg = await getConfig();
  const baseTasas = cfgToDto(cfg);

  // Build afp snapshot map (all AFPs as fractions), keyed by STRIPPED name (no (F)/(M) suffix)
  const afpSnapshotMap: Record<string, { pctSeguro: number; pctComision: number }> = {};
  for (const t of afpTasasList) {
    afpSnapshotMap[afpKey(t.afp)] = { pctSeguro: frac(t.pctSeguro), pctComision: frac(t.pctComision) };
  }

  // Snapshot: config + afp tasas
  const tasasSnapshot = { config: baseTasas, afp: afpSnapshotMap };

  // Load existing detalle to preserve manual inputs
  const existingDetalle = await db
    .select()
    .from(schema.planillaOficinaDetalle)
    .where(eq(schema.planillaOficinaDetalle.planillaMesId, mesId!));
  const existingByEmpleado = new Map(existingDetalle.map((d) => [d.empleadoId, d]));

  // Load active adelantos (vigente + saldo>0) for all empleados
  const adelantos = await db
    .select()
    .from(schema.adelantoOficina)
    .where(and(eq(schema.adelantoOficina.estado, 'vigente'), gt(schema.adelantoOficina.montoTotal, '0')));

  // For each adelanto, compute cuota: monto_total / num_cuotas.
  // Cuota already deducted = sum of adelanto_cuota_aplicada.monto for that adelanto.
  // Only include if saldo > 0.
  // Group by empleado.
  const adelantoCuotaByEmpleado = new Map<string, number>();
  for (const adel of adelantos) {
    const aplicadas = await db
      .select({ total: sql<string>`COALESCE(SUM(monto), 0)` })
      .from(schema.adelantoCuotaAplicada)
      .where(eq(schema.adelantoCuotaAplicada.adelantoId, adel.id));
    const aplicado = Number(aplicadas[0]?.total ?? 0);
    const montoTotal = Number(adel.montoTotal);
    const cuota = Math.round((montoTotal / adel.numCuotas) * 100) / 100;
    const saldo = Math.round((montoTotal - aplicado) * 100) / 100;
    if (saldo > 0) {
      const prev = adelantoCuotaByEmpleado.get(adel.empleadoId) ?? 0;
      adelantoCuotaByEmpleado.set(adel.empleadoId, Math.round((prev + cuota) * 100) / 100);
    }
  }

  // Determine next boleta correlativo (global max across all planilla_oficina_detalle)
  const [maxBoletaRow] = await db
    .select({ max: sql<string | null>`MAX(boleta_correlativo)` })
    .from(schema.planillaOficinaDetalle);
  const maxBoleta = maxBoletaRow?.max;
  let nextBolNum = 100000;
  if (maxBoleta && /^BOL-(\d+)$/.test(maxBoleta)) {
    nextBolNum = parseInt(maxBoleta.replace('BOL-', ''), 10);
  }

  // Delete existing detalle for this mes
  await db
    .delete(schema.planillaOficinaDetalle)
    .where(eq(schema.planillaOficinaDetalle.planillaMesId, mesId!));

  // Build new detalle rows
  const rows: (typeof schema.planillaOficinaDetalle.$inferInsert)[] = [];
  for (const emp of empleados) {
    const tipoSP = sistemaPensionToTipo(emp.sistemaPension);
    // Keep original sistemaPension (with suffix) for display on boleta; strip only for tasa lookup
    const afpName = tipoSP === 'AFP' ? (emp.sistemaPension ?? null) : null;
    const afpTasa = afpName ? afpTasasMap.get(afpKey(afpName)) : undefined;

    const afpForEngine = afpTasa
      ? { pctSeguro: frac(afpTasa.pctSeguro), pctComision: frac(afpTasa.pctComision) }
      : undefined;

    const tasas = { ...baseTasas, afp: afpForEngine };

    // Preserve manual inputs from existing detalle
    const prev = existingByEmpleado.get(emp.id);
    const manualInputs = prev
      ? {
          imptoRenta5ta: Number(prev.imptoRenta5ta ?? 0),
          retencionJudicial: Number(prev.retencionJudicial ?? 0),
          cantHe25: Number(prev.cantHe25 ?? 0),
          cantHe35: Number(prev.cantHe35 ?? 0),
          dominical: Number(prev.montoDominical ?? 0),
          feriado: Number(prev.montoFeriado ?? 0),
          gratificacion: Number(prev.gratificacion ?? 0),
          vacaciones: Number(prev.vacaciones ?? 0),
          comisiones: Number(prev.comisiones ?? 0),
          bonificacion: Number(prev.bonificacion ?? 0),
          otrosDescuentos: Number(prev.otrosDescuentos ?? 0),
          diasTrab: prev.diasTrab ?? 30,
          horasTrab: prev.horasTrab ?? 240,
        }
      : {
          imptoRenta5ta: 0,
          retencionJudicial: 0,
          cantHe25: 0,
          cantHe35: 0,
          dominical: 0,
          feriado: 0,
          gratificacion: 0,
          vacaciones: 0,
          comisiones: 0,
          bonificacion: 0,
          otrosDescuentos: 0,
          diasTrab: 30,
          horasTrab: 240,
        };

    const adelantoCuota = adelantoCuotaByEmpleado.get(emp.id) ?? 0;
    const sueldoMensual = Number(emp.sueldoBaseMensual ?? 0);

    const calc = calcularDetalleOficina(
      {
        sueldoMensual,
        sistemaPension: tipoSP,
        asignacionFamiliar: emp.asignacionFamiliar ?? false,
        cantHe25: manualInputs.cantHe25,
        cantHe35: manualInputs.cantHe35,
        dominical: manualInputs.dominical,
        feriado: manualInputs.feriado,
        gratificacion: manualInputs.gratificacion,
        vacaciones: manualInputs.vacaciones,
        comisiones: manualInputs.comisiones,
        bonificacion: manualInputs.bonificacion,
        imptoRenta5ta: manualInputs.imptoRenta5ta,
        retencionJudicial: manualInputs.retencionJudicial,
        adelantoCuota,
        otrosDescuentos: manualInputs.otrosDescuentos,
        diasTrab: manualInputs.diasTrab,
        horasTrab: manualInputs.horasTrab,
      },
      tasas,
    );

    nextBolNum += 1;
    const boletaCorrelativo = `BOL-${String(nextBolNum).padStart(6, '0')}`;

    rows.push({
      planillaMesId: mesId!,
      empleadoId: emp.id,
      boletaCorrelativo,
      nombre: emp.nombre,
      cargo: emp.cargo ?? null,
      dni: emp.numDoc ?? null,
      afp: afpName,
      cuspp: emp.cuspp ?? null,
      cuentaBancaria: emp.numCuenta ?? null,
      diasTrab: manualInputs.diasTrab,
      horasTrab: manualInputs.horasTrab,
      sueldoMensual: String(sueldoMensual),
      valorHora: String(calc.valorHora),
      cantHe25: String(manualInputs.cantHe25),
      montoHe25: String(calc.montoHe25),
      cantHe35: String(manualInputs.cantHe35),
      montoHe35: String(calc.montoHe35),
      totalHe: String(calc.totalHe),
      diasDominical: 0,
      montoDominical: String(manualInputs.dominical),
      diasFeriado: 0,
      montoFeriado: String(manualInputs.feriado),
      asigFamiliar: String(calc.asigFamiliar),
      gratificacion: String(manualInputs.gratificacion),
      vacaciones: String(manualInputs.vacaciones),
      comisiones: String(manualInputs.comisiones),
      bonificacion: String(manualInputs.bonificacion),
      totalBruto: String(calc.totalBruto),
      onp: String(calc.onp),
      afpAporte: String(calc.afpAporte),
      afpSeguro: String(calc.afpSeguro),
      afpComision: String(calc.afpComision),
      imptoRenta5ta: String(calc.imptoRenta5ta),
      retencionJudicial: String(calc.retencionJudicial),
      adelantoCuota: String(calc.adelantoCuota),
      otrosDescuentos: String(calc.otrosDescuentos),
      totalDescuento: String(calc.totalDescuento),
      essalud: String(calc.essalud),
      essaludVida: String(calc.essaludVida),
      totalAporte: String(calc.totalAporte),
      netoPago: String(calc.netoPago),
      costoTotal: String(calc.costoTotal),
      cuentaContable: null,
      cuentaContableOrigen: null,
    });
  }

  if (rows.length) await db.insert(schema.planillaOficinaDetalle).values(rows);

  // Update mes: estado=calculada + snapshot
  const [updatedMes] = await db
    .update(schema.planillaOficinaMes)
    .set({ estado: 'calculada', tasasSnapshot })
    .where(eq(schema.planillaOficinaMes.id, mesId!))
    .returning();

  const detalle = await db
    .select()
    .from(schema.planillaOficinaDetalle)
    .where(eq(schema.planillaOficinaDetalle.planillaMesId, mesId!))
    .orderBy(asc(schema.planillaOficinaDetalle.boletaCorrelativo));

  res.json({ mes: updatedMes, detalle });
});

// ─── PATCH /api/oficina/planilla-detalle/:id ─────────────────
// Update manual input fields + re-run engine for that one row.
router.patch('/planilla-detalle/:id', async (req, res) => {
  const { id } = req.params;

  // Load detalle row
  const [detRow] = await db
    .select()
    .from(schema.planillaOficinaDetalle)
    .where(eq(schema.planillaOficinaDetalle.id, id!))
    .limit(1);
  if (!detRow) return res.status(404).json({ error: 'Detalle no encontrado' });

  // Load parent mes and check estado
  const [mesRow] = await db
    .select()
    .from(schema.planillaOficinaMes)
    .where(eq(schema.planillaOficinaMes.id, detRow.planillaMesId))
    .limit(1);
  if (!mesRow) return res.status(404).json({ error: 'Planilla mes no encontrada' });
  if (!['borrador', 'calculada'].includes(mesRow.estado)) {
    return res.status(422).json({ error: `No se puede editar en estado '${mesRow.estado}'` });
  }

  const b = req.body as Record<string, unknown>;

  // Merge manual inputs (new overrides existing)
  const n = (field: unknown, existing: unknown) =>
    b[field as string] !== undefined ? Number(b[field as string]) : Number(existing ?? 0);

  const imptoRenta5ta = n('imptoRenta5ta', detRow.imptoRenta5ta);
  const retencionJudicial = n('retencionJudicial', detRow.retencionJudicial);
  const cantHe25 = n('cantHe25', detRow.cantHe25);
  const cantHe35 = n('cantHe35', detRow.cantHe35);
  const dominical = n('dominical', detRow.montoDominical);
  const feriado = n('feriado', detRow.montoFeriado);
  const gratificacion = n('gratificacion', detRow.gratificacion);
  const vacaciones = n('vacaciones', detRow.vacaciones);
  const comisiones = n('comisiones', detRow.comisiones);
  const bonificacion = n('bonificacion', detRow.bonificacion);
  const otrosDescuentos = n('otrosDescuentos', detRow.otrosDescuentos);

  // Re-derive pension type from snapshot (afp field null → ONP)
  const tipoSP: 'AFP' | 'ONP' = detRow.afp ? 'AFP' : 'ONP';
  const asignacionFamiliar = Number(detRow.asigFamiliar ?? 0) > 0;
  const sueldoMensual = Number(detRow.sueldoMensual ?? 0);
  const adelantoCuota = Number(detRow.adelantoCuota ?? 0);

  // Build tasas from mes snapshot
  const snapshot = (mesRow.tasasSnapshot ?? {}) as {
    config?: {
      pctEssalud: number; pctOnp: number; pctAfpAporte: number;
      rmv: number; topeSeguroAfp: number; horasMesBase: number;
    };
    afp?: Record<string, { pctSeguro: number; pctComision: number }>;
  };

  const cfgSnap = snapshot.config;
  const baseTasas = cfgSnap
    ? {
        pctEssalud: cfgSnap.pctEssalud,
        pctOnp: cfgSnap.pctOnp,
        pctAfpAporte: cfgSnap.pctAfpAporte,
        rmv: cfgSnap.rmv,
        topeSeguroAfp: cfgSnap.topeSeguroAfp,
        horasMesBase: cfgSnap.horasMesBase,
      }
    : cfgToDto(await getConfig());

  // Strip (F)/(M) suffix from stored afp name before looking up snapshot (keys are stripped)
  const afpRates = detRow.afp && snapshot.afp ? snapshot.afp[afpKey(detRow.afp)] : undefined;
  const afpForEngine = afpRates ? { pctSeguro: afpRates.pctSeguro, pctComision: afpRates.pctComision } : undefined;

  const calc = calcularDetalleOficina(
    {
      sueldoMensual,
      sistemaPension: tipoSP,
      asignacionFamiliar,
      cantHe25,
      cantHe35,
      dominical,
      feriado,
      gratificacion,
      vacaciones,
      comisiones,
      bonificacion,
      imptoRenta5ta,
      retencionJudicial,
      adelantoCuota,
      otrosDescuentos,
      diasTrab: detRow.diasTrab ?? 30,
      horasTrab: detRow.horasTrab ?? 240,
    },
    { ...baseTasas, afp: afpForEngine },
  );

  // Determine cuentaContable update
  const newCuentaContable = b.cuentaContable !== undefined ? (b.cuentaContable as string | null) : detRow.cuentaContable;
  const newCuentaContableOrigen =
    b.cuentaContable !== undefined
      ? (b.cuentaContable ? 'USUARIO' : null)
      : detRow.cuentaContableOrigen;

  const [updated] = await db
    .update(schema.planillaOficinaDetalle)
    .set({
      cantHe25: String(cantHe25),
      montoHe25: String(calc.montoHe25),
      cantHe35: String(cantHe35),
      montoHe35: String(calc.montoHe35),
      totalHe: String(calc.totalHe),
      montoDominical: String(dominical),
      montoFeriado: String(feriado),
      gratificacion: String(gratificacion),
      vacaciones: String(vacaciones),
      comisiones: String(comisiones),
      bonificacion: String(bonificacion),
      totalBruto: String(calc.totalBruto),
      onp: String(calc.onp),
      afpAporte: String(calc.afpAporte),
      afpSeguro: String(calc.afpSeguro),
      afpComision: String(calc.afpComision),
      imptoRenta5ta: String(calc.imptoRenta5ta),
      retencionJudicial: String(calc.retencionJudicial),
      otrosDescuentos: String(calc.otrosDescuentos),
      totalDescuento: String(calc.totalDescuento),
      essalud: String(calc.essalud),
      essaludVida: String(calc.essaludVida),
      totalAporte: String(calc.totalAporte),
      netoPago: String(calc.netoPago),
      costoTotal: String(calc.costoTotal),
      cuentaContable: newCuentaContable,
      cuentaContableOrigen: newCuentaContableOrigen,
    })
    .where(eq(schema.planillaOficinaDetalle.id, id!))
    .returning();

  res.json({ detalle: updated });
});

// ─── Helper: saldo pendiente de un adelanto ──────────────────
async function saldoAdelanto(adelantoId: string, montoTotal: number): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(monto), 0)` })
    .from(schema.adelantoCuotaAplicada)
    .where(eq(schema.adelantoCuotaAplicada.adelantoId, adelantoId));
  const aplicado = Number(row?.total ?? 0);
  return Math.round((montoTotal - aplicado) * 100) / 100;
}

// ─── POST /api/oficina/adelantos ─────────────────────────────
router.post('/adelantos', async (req, res) => {
  const { empleadoId, fecha, montoTotal, numCuotas, motivo } = req.body as Record<string, unknown>;

  // Validate
  if (!empleadoId || typeof empleadoId !== 'string') {
    return res.status(400).json({ error: 'empleadoId es requerido' });
  }
  if (!Number.isFinite(Number(montoTotal)) || Number(montoTotal) <= 0) {
    return res.status(400).json({ error: 'montoTotal debe ser un número positivo' });
  }
  const numCuotasInt = Math.floor(Number(numCuotas));
  if (!Number.isFinite(numCuotasInt) || numCuotasInt < 1) {
    return res.status(400).json({ error: 'numCuotas debe ser un entero >= 1' });
  }
  if (!fecha || typeof fecha !== 'string') {
    return res.status(400).json({ error: 'fecha es requerida (YYYY-MM-DD)' });
  }

  // Verify empleado exists
  const [emp] = await db
    .select({ id: schema.empleados.id })
    .from(schema.empleados)
    .where(eq(schema.empleados.id, empleadoId))
    .limit(1);
  if (!emp) return res.status(400).json({ error: `Empleado '${empleadoId}' no encontrado` });

  const montoTotalNum = Math.round(Number(montoTotal) * 100) / 100;

  const [row] = await db
    .insert(schema.adelantoOficina)
    .values({
      empleadoId,
      fecha,
      montoTotal: String(montoTotalNum),
      numCuotas: numCuotasInt,
      motivo: motivo ? String(motivo) : null,
      estado: 'vigente',
      createdBy: req.user!.id,
    })
    .returning();

  const montoCuota = Math.round((montoTotalNum / numCuotasInt) * 100) / 100;

  res.json({
    adelanto: {
      ...row,
      montoCuota,
      saldoPendiente: montoTotalNum,
    },
  });
});

// ─── GET /api/oficina/adelantos?empleadoId= ──────────────────
router.get('/adelantos', async (req, res) => {
  const empleadoId = req.query.empleadoId as string | undefined;
  if (!empleadoId) return res.status(400).json({ error: 'Parámetro empleadoId requerido' });

  const rows = await db
    .select()
    .from(schema.adelantoOficina)
    .where(eq(schema.adelantoOficina.empleadoId, empleadoId))
    .orderBy(desc(schema.adelantoOficina.fecha));

  const adelantos = await Promise.all(
    rows.map(async (a) => {
      const montoTotalNum = Number(a.montoTotal);
      const montoCuota = Math.round((montoTotalNum / a.numCuotas) * 100) / 100;
      const saldoPendiente = await saldoAdelanto(a.id, montoTotalNum);
      return { ...a, montoCuota, saldoPendiente };
    }),
  );

  res.json({ adelantos });
});

// ─── POST /api/oficina/planilla/:mesId/cerrar ────────────────
router.post('/planilla/:mesId/cerrar', async (req, res) => {
  const { mesId } = req.params;

  const [mesRow] = await db
    .select()
    .from(schema.planillaOficinaMes)
    .where(eq(schema.planillaOficinaMes.id, mesId!))
    .limit(1);

  if (!mesRow) return res.status(404).json({ error: 'Planilla mes no encontrada' });
  if (mesRow.estado !== 'calculada') {
    return res.status(400).json({ error: `Solo se puede cerrar en estado 'calculada'; estado actual: '${mesRow.estado}'` });
  }

  // Load detalle rows
  const detalleRows = await db
    .select()
    .from(schema.planillaOficinaDetalle)
    .where(eq(schema.planillaOficinaDetalle.planillaMesId, mesId!));

  // Compute last day of mes
  const [y, m] = mesRow.mes.split('-').map(Number) as [number, number];
  const lastDay = new Date(y, m, 0).getDate();
  const fecha = mesRow.mes + '-' + String(lastDay).padStart(2, '0');

  // Pre-load derivar context (single load for the whole transaction)
  const derivarCtx = await cargarDerivarCtx();

  // ── Step 2: Apply advance installments (in a transaction) ──
  await db.transaction(async (tx) => {
    for (const det of detalleRows) {
      const cuotaTotal = Math.round(Number(det.adelantoCuota ?? 0) * 100) / 100;
      if (cuotaTotal <= 0) continue;

      // Load vigente adelantos for this employee, ordered oldest first
      const adelantos = await tx
        .select()
        .from(schema.adelantoOficina)
        .where(and(
          eq(schema.adelantoOficina.empleadoId, det.empleadoId),
          eq(schema.adelantoOficina.estado, 'vigente'),
        ))
        .orderBy(asc(schema.adelantoOficina.fecha));

      let remaining = cuotaTotal;
      for (const adel of adelantos) {
        if (remaining <= 0) break;

        // Compute saldo for this adelanto
        const [saldoRow] = await tx
          .select({ total: sql<string>`COALESCE(SUM(monto), 0)` })
          .from(schema.adelantoCuotaAplicada)
          .where(eq(schema.adelantoCuotaAplicada.adelantoId, adel.id));
        const aplicado = Number(saldoRow?.total ?? 0);
        const montoTotal = Number(adel.montoTotal);
        const saldo = Math.round((montoTotal - aplicado) * 100) / 100;

        if (saldo <= 0) continue;

        const montoCuota = Math.round((montoTotal / adel.numCuotas) * 100) / 100;
        const applied = Math.round(Math.min(montoCuota, saldo, remaining) * 100) / 100;

        // Insert cuota aplicada (idempotent: on conflict do nothing)
        await tx
          .insert(schema.adelantoCuotaAplicada)
          .values({
            adelantoId: adel.id,
            planillaDetalleId: det.id,
            monto: String(applied),
            fecha,
          })
          .onConflictDoNothing();

        remaining = Math.round((remaining - applied) * 100) / 100;

        // If adelanto is now fully paid, mark cancelled
        const newSaldo = Math.round((saldo - applied) * 100) / 100;
        if (newSaldo <= 0) {
          await tx
            .update(schema.adelantoOficina)
            .set({ estado: 'cancelado' })
            .where(eq(schema.adelantoOficina.id, adel.id));
        }
      }
    }
  });

  // ── Step 3: Build accounting lines ──
  // Debit sueldos grouped by cuentaContable (default '621')
  const suelDoGroupMap = new Map<string, { total: number; hasManual: boolean }>();
  let totalEssalud = 0;
  let totalAfp = 0;
  let totalOnp = 0;
  let totalRenta5ta = 0;
  let totalOtros = 0;
  let totalNeto = 0;

  for (const det of detalleRows) {
    const cuenta = det.cuentaContable ?? '621';
    const hasManual = !!det.cuentaContable;
    const bruto = Math.round(Number(det.totalBruto ?? 0) * 100) / 100;
    const prev = suelDoGroupMap.get(cuenta);
    if (prev) {
      prev.total = Math.round((prev.total + bruto) * 100) / 100;
      if (hasManual) prev.hasManual = true;
    } else {
      suelDoGroupMap.set(cuenta, { total: bruto, hasManual });
    }

    totalEssalud = Math.round((totalEssalud + Number(det.essalud ?? 0)) * 100) / 100;
    totalAfp = Math.round((totalAfp + Number(det.afpAporte ?? 0) + Number(det.afpSeguro ?? 0) + Number(det.afpComision ?? 0)) * 100) / 100;
    totalOnp = Math.round((totalOnp + Number(det.onp ?? 0)) * 100) / 100;
    totalRenta5ta = Math.round((totalRenta5ta + Number(det.imptoRenta5ta ?? 0)) * 100) / 100;
    totalOtros = Math.round((totalOtros + Number(det.retencionJudicial ?? 0) + Number(det.otrosDescuentos ?? 0) + Number(det.adelantoCuota ?? 0)) * 100) / 100;
    totalNeto = Math.round((totalNeto + Number(det.netoPago ?? 0)) * 100) / 100;
  }

  const lineas: LineaIn[] = [];

  // Debits: sueldos per account group
  for (const [cuenta, grp] of suelDoGroupMap) {
    if (grp.total < 0.005) continue;
    lineas.push({
      cuenta,
      descripcion: 'Sueldos y salarios',
      debe: grp.total,
      haber: 0,
      cuentaContable: cuenta,
      obraId: null,
      cuentaOrigen: grp.hasManual ? 'USUARIO' : 'AUTOMATICO',
    });
  }

  // Debit EsSalud empleador
  if (totalEssalud >= 0.005) {
    lineas.push({
      cuenta: '6271',
      descripcion: 'EsSalud empleador',
      debe: totalEssalud,
      haber: 0,
      cuentaContable: '6271',
      obraId: null,
      cuentaOrigen: 'AUTOMATICO',
    });
  }

  // Credits
  if (totalEssalud >= 0.005) {
    lineas.push({
      cuenta: '4031',
      descripcion: 'EsSalud por pagar',
      debe: 0,
      haber: totalEssalud,
      cuentaContable: '4031',
      obraId: null,
      cuentaOrigen: 'AUTOMATICO',
    });
  }
  if (totalAfp >= 0.005) {
    lineas.push({
      cuenta: '407',
      descripcion: 'AFP por pagar',
      debe: 0,
      haber: totalAfp,
      cuentaContable: '407',
      obraId: null,
      cuentaOrigen: 'AUTOMATICO',
    });
  }
  if (totalOnp >= 0.005) {
    lineas.push({
      cuenta: '4032',
      descripcion: 'ONP por pagar',
      debe: 0,
      haber: totalOnp,
      cuentaContable: '4032',
      obraId: null,
      cuentaOrigen: 'AUTOMATICO',
    });
  }
  if (totalRenta5ta >= 0.005) {
    lineas.push({
      cuenta: '40173',
      descripcion: 'Renta 5ta por pagar',
      debe: 0,
      haber: totalRenta5ta,
      cuentaContable: '40173',
      obraId: null,
      cuentaOrigen: 'AUTOMATICO',
    });
  }
  if (totalOtros >= 0.005) {
    lineas.push({
      cuenta: '469',
      descripcion: 'Otros por pagar (judicial + descuentos + adelanto)',
      debe: 0,
      haber: totalOtros,
      cuentaContable: '469',
      obraId: null,
      cuentaOrigen: 'AUTOMATICO',
    });
  }
  if (totalNeto >= 0.005) {
    lineas.push({
      cuenta: '411',
      descripcion: 'Neto por pagar',
      debe: 0,
      haber: totalNeto,
      cuentaContable: '411',
      obraId: null,
      cuentaOrigen: 'AUTOMATICO',
    });
  }

  // ── Step 4: Create accounting entry via WS1 engine ──
  const asiento = await crearAsiento({
    fecha,
    glosa: 'Planilla oficina ' + mesRow.mes,
    lineas,
    origen: 'planilla_oficina',
    origenId: mesId!,
    empresaId: mesRow.empresaId,
    derivarCtx,
    userId: req.user!.id,
  });

  // ── Step 5: Update mes row ──
  const [updatedMes] = await db
    .update(schema.planillaOficinaMes)
    .set({
      estado: 'cerrada',
      asientoId: asiento.id,
      cerradoPor: req.user!.id,
      cerradoEn: new Date(),
    })
    .where(eq(schema.planillaOficinaMes.id, mesId!))
    .returning();

  res.json({ mes: updatedMes, asientoId: asiento.id });
});

// ─── POST /api/oficina/planilla/:mesId/reabrir ───────────────
router.post('/planilla/:mesId/reabrir', async (req, res) => {
  const { mesId } = req.params;

  const [mesRow] = await db
    .select()
    .from(schema.planillaOficinaMes)
    .where(eq(schema.planillaOficinaMes.id, mesId!))
    .limit(1);

  if (!mesRow) return res.status(404).json({ error: 'Planilla mes no encontrada' });
  if (mesRow.estado !== 'cerrada') {
    return res.status(400).json({ error: `Solo se puede reabrir en estado 'cerrada'; estado actual: '${mesRow.estado}'` });
  }

  // Compute the periodo of the cierre fecha (last day of mes)
  const [y, m] = mesRow.mes.split('-').map(Number) as [number, number];
  const lastDay = new Date(y, m, 0).getDate();
  const cierreFecha = mesRow.mes + '-' + String(lastDay).padStart(2, '0');
  const periodo = cierreFecha.slice(0, 7);

  if (await periodoCerrado(periodo)) {
    return res.status(423).json({ error: `Periodo contable ${periodo} cerrado; reabrelo primero` });
  }

  const result = await db.transaction(async (tx) => {
    // Load detalle ids for this mes
    const detalles = await tx
      .select({ id: schema.planillaOficinaDetalle.id })
      .from(schema.planillaOficinaDetalle)
      .where(eq(schema.planillaOficinaDetalle.planillaMesId, mesId!));

    if (detalles.length > 0) {
      const detalleIds = detalles.map((d) => d.id);

      // Find adelantos that were cancelled due to this planilla's cuotas
      // (adelantos where cuota_aplicada rows exist for these detalle_ids)
      const cuotasRows = await tx
        .select({ adelantoId: schema.adelantoCuotaAplicada.adelantoId })
        .from(schema.adelantoCuotaAplicada)
        .where(inArray(schema.adelantoCuotaAplicada.planillaDetalleId, detalleIds));

      // Delete cuota_aplicada rows for this mes's detalle
      await tx
        .delete(schema.adelantoCuotaAplicada)
        .where(inArray(schema.adelantoCuotaAplicada.planillaDetalleId, detalleIds));

      // Restore cancelled adelantos that now have saldo > 0
      const uniqueAdelantoIds = [...new Set(cuotasRows.map((r) => r.adelantoId))];
      for (const adelantoId of uniqueAdelantoIds) {
        const [adelRow] = await tx
          .select()
          .from(schema.adelantoOficina)
          .where(eq(schema.adelantoOficina.id, adelantoId))
          .limit(1);
        if (!adelRow || adelRow.estado !== 'cancelado') continue;

        const [saldoRow] = await tx
          .select({ total: sql<string>`COALESCE(SUM(monto), 0)` })
          .from(schema.adelantoCuotaAplicada)
          .where(eq(schema.adelantoCuotaAplicada.adelantoId, adelantoId));
        const aplicado = Number(saldoRow?.total ?? 0);
        const saldo = Math.round((Number(adelRow.montoTotal) - aplicado) * 100) / 100;

        if (saldo > 0) {
          await tx
            .update(schema.adelantoOficina)
            .set({ estado: 'vigente' })
            .where(eq(schema.adelantoOficina.id, adelantoId));
        }
      }
    }

    // Delete asiento (cascade deletes asientos_lineas)
    if (mesRow.asientoId) {
      await tx
        .delete(schema.asientos)
        .where(eq(schema.asientos.id, mesRow.asientoId));
    }

    // Reset mes to calculada
    const [updatedMes] = await tx
      .update(schema.planillaOficinaMes)
      .set({
        estado: 'calculada',
        asientoId: null,
        cerradoPor: null,
        cerradoEn: null,
      })
      .where(eq(schema.planillaOficinaMes.id, mesId!))
      .returning();

    return { mes: updatedMes };
  });

  res.json(result);
});

export default router;
