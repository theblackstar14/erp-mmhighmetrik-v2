import { db, schema } from '@erp/db';
import { and, asc, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import multer from 'multer';
import { calcularDetalleOficina } from '../lib/planillaOficinaCalc.js';
import { calcularRta5ta } from '../lib/rta5taCalc.js';
import { resolverParamLegal, cargarTasasAfp } from '../lib/paramLegalOficina.js';
import { getYtd, upsertLedgerMes } from '../lib/renta5taYtd.js';
import { requireAuth } from '../middleware/auth.js';
import { resolverEmpresa } from '../lib/permisos.js';
import { cargarDerivarCtx } from '../lib/clasificacion.js';
import { crearAsiento, type LineaIn } from './contabilidad.js';
import { periodoCerrado } from '../lib/periodos.js';
import { registrarDocumento, docsDetalle } from '../lib/documentoAdjunto.js';
import { generarBoletaPdf } from '../lib/boletaOficinaPdf.js';

const router = Router();
router.use(requireAuth);

// ─── requireOficinaEdit ───────────────────────────────────────
// Allows only users whose RBAC role (via usuario_empresa) is 'admin' or
// 'contabilidad' in ANY empresa. This gates all mutating planilla endpoints.
async function requireOficinaEdit(req: Request, res: Response, next: NextFunction) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'No autenticado' });

  const rows = await db
    .select({ rolNombre: schema.roles.nombre })
    .from(schema.usuarioEmpresa)
    .innerJoin(schema.roles, eq(schema.usuarioEmpresa.roleId, schema.roles.id))
    .where(eq(schema.usuarioEmpresa.userId, userId));

  const allowed = new Set(['admin', 'contabilidad']);
  const hasAccess = rows.some((r) => allowed.has(r.rolNombre));
  if (!hasAccess) {
    return res.status(403).json({ error: 'Permisos insuficientes: se requiere rol admin o contabilidad' });
  }
  next();
}

// Empresa activa del request (header x-empresa-id validado contra membresías).
// Fallback a 1 solo si el usuario no tiene empresa resuelta (compat legacy).
async function empresaIdDe(req: Request): Promise<number> {
  const emp = await resolverEmpresa(req);
  return emp?.empresaId ?? 1;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const DOC_TIPOS_PERMITIDOS = new Set([
  'boleta_pago', 'comprobante_pago', 'factura', 'rh', 'boleta', 'voucher', 'otro',
]);

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
router.put('/config-planilla', requireOficinaEdit, async (req, res) => {
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
// body: { mes: 'YYYY-MM' } → upsert planilla_oficina_mes de la empresa activa
router.post('/planilla', requireOficinaEdit, async (req, res) => {
  const { mes } = req.body as { mes?: string };
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ error: 'mes debe tener formato YYYY-MM' });
  }
  const empresaId = await empresaIdDe(req);

  // try find existing
  const [existing] = await db
    .select()
    .from(schema.planillaOficinaMes)
    .where(and(eq(schema.planillaOficinaMes.empresaId, empresaId), eq(schema.planillaOficinaMes.mes, mes)))
    .limit(1);
  if (existing) return res.json({ mes: existing });

  const [row] = await db
    .insert(schema.planillaOficinaMes)
    .values({ empresaId, mes, estado: 'borrador', createdBy: req.user!.id })
    .returning();

  res.json({ mes: row });
});

// ─── GET /api/oficina/planilla?mes= ─────────────────────────
router.get('/planilla', async (req, res) => {
  const mes = req.query.mes as string | undefined;
  if (!mes) return res.status(400).json({ error: 'Parámetro mes requerido' });
  const empresaId = await empresaIdDe(req);

  const [mesRow] = await db
    .select()
    .from(schema.planillaOficinaMes)
    .where(and(eq(schema.planillaOficinaMes.empresaId, empresaId), eq(schema.planillaOficinaMes.mes, mes)))
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
router.post('/planilla/:mesId/calcular', requireOficinaEdit, async (req, res) => {
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

  // ── v2: resolve versioned legal params + AFP rates once per run ──
  const param = await resolverParamLegal(mesRow.mes + '-01');
  const afps = await cargarTasasAfp();

  // Normalization helper matching cargarTasasAfp key format (strip (F)/(M), trim, UPPERCASE)
  const normAfpKey = (s: string | null | undefined) =>
    (s ?? '').replace(/\s*\([FM]\)\s*$/i, '').trim().toUpperCase();

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

  // Dias calendario del periodo: base del prorrateo y de las horas-mes (dias * 8).
  const mesNum = Number(mesRow.mes.slice(5, 7));
  const anioNum = Number(mesRow.mes.slice(0, 4));
  const diasMes = new Date(Date.UTC(anioNum, mesNum, 0)).getUTCDate();

  // Snapshot per-worker data collected during the loop
  const porTrabajador: Record<string, {
    sistemaPension: string | null;
    afpComisionTipo: string;
    asignacionFamiliar: boolean;
    modalidadFormativa: boolean;
    acumuladoPercibido: number;
    retencionesPrevias: number;
  }> = {};

  // Build new detalle rows
  const rows: (typeof schema.planillaOficinaDetalle.$inferInsert)[] = [];
  for (const emp of empleados) {
    const tipoSP = sistemaPensionToTipo(emp.sistemaPension);
    // Keep original sistemaPension (with suffix) for display on boleta; strip only for tasa lookup
    const afpName = tipoSP === 'AFP' ? (emp.sistemaPension ?? null) : null;

    // ── v2: build TasasOficina from versioned params ──
    const afpRates = afpName ? afps[normAfpKey(afpName)] : undefined;
    const tasas = {
      rmv: param.rmv,
      uit: param.uit,
      topeRma: param.topeRma,
      pctEssalud: param.pctEssalud,
      pctOnp: param.pctOnp,
      pctAfpAporte: param.pctAfpAporte,
      pctAsigFamiliar: param.pctAsigFamiliar,
      afp: afpRates,
    };

    // Preserve manual inputs from existing detalle
    const prev = existingByEmpleado.get(emp.id);
    const manualInputs = prev
      ? {
          // imptoRenta5ta is governed by renta5taManual flag — NOT blanket-preserved here
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
          diasTrab: prev.diasTrab ?? diasMes,
        }
      : {
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
          diasTrab: diasMes,
        };

    const adelantoCuota = adelantoCuotaByEmpleado.get(emp.id) ?? 0;
    const sueldoMensual = Number(emp.sueldoBaseMensual ?? 0);

    // ── v2: mesIngreso — if same year as the planilla, use the actual ingreso month; else 1 ──
    const fechaIngresoAnio = emp.fechaIngreso ? Number(emp.fechaIngreso.slice(0, 4)) : null;
    const mesIngreso = (fechaIngresoAnio && fechaIngresoAnio === anioNum)
      ? Number(emp.fechaIngreso!.slice(5, 7))
      : 1;

    // ── v2: YTD renta 5ta suggestion via getYtd ──
    const useManualRenta5ta = !!(prev && prev.renta5taManual);
    let imptoRenta5taFinal: number;
    let ytdAcumulado = 0;
    let ytdRetenciones = 0;
    if (useManualRenta5ta) {
      imptoRenta5taFinal = Number(prev!.imptoRenta5ta ?? 0);
    } else {
      const ytd = await getYtd(emp.id, anioNum, mesNum);
      ytdAcumulado = ytd.acumuladoPercibido;
      ytdRetenciones = ytd.retencionesPrevias;
      imptoRenta5taFinal = calcularRta5ta({
        sueldoMensual,
        mesNumero: mesNum,
        mesIngreso,
        acumuladoPercibidoAntes: ytd.acumuladoPercibido,
        retencionesPrevias: ytd.retencionesPrevias,
        uit: param.uit,
      }).retencionMes;
    }

    const calc = calcularDetalleOficina(
      {
        sueldoMensual,
        sistemaPension: tipoSP,
        afpComisionTipo: (emp.afpComisionTipo as 'flujo' | 'mixta' | 'saldo') ?? 'saldo',
        modalidadFormativa: emp.modalidadFormativa ?? false,
        asignacionFamiliar: emp.asignacionFamiliar ?? false,
        cantHe25: manualInputs.cantHe25,
        cantHe35: manualInputs.cantHe35,
        dominical: manualInputs.dominical,
        feriado: manualInputs.feriado,
        gratificacion: manualInputs.gratificacion,
        vacaciones: manualInputs.vacaciones,
        comisiones: manualInputs.comisiones,
        bonificacion: manualInputs.bonificacion,
        imptoRenta5ta: imptoRenta5taFinal,
        retencionJudicial: manualInputs.retencionJudicial,
        adelantoCuota,
        otrosDescuentos: manualInputs.otrosDescuentos,
        diasTrab: manualInputs.diasTrab,
        diasMes,
      },
      tasas,
    );

    // Collect per-worker snapshot data
    porTrabajador[emp.id] = {
      sistemaPension: emp.sistemaPension ?? null,
      afpComisionTipo: emp.afpComisionTipo ?? 'saldo',
      asignacionFamiliar: emp.asignacionFamiliar ?? false,
      modalidadFormativa: emp.modalidadFormativa ?? false,
      acumuladoPercibido: ytdAcumulado,
      retencionesPrevias: ytdRetenciones,
    };

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
      diasTrab: calc.diasTrab,
      horasTrab: calc.horasTrab,
      // Base efectivamente devengada del mes (sueldo contractual prorrateado por dias).
      // El sueldo contractual vive en empleados.sueldo_base_mensual.
      sueldoMensual: String(calc.sueldoBase),
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
      retencionJudicial: String(manualInputs.retencionJudicial),
      adelantoCuota: String(adelantoCuota),
      otrosDescuentos: String(manualInputs.otrosDescuentos),
      totalDescuento: String(calc.totalDescuento),
      essalud: String(calc.essalud),
      essaludVida: '0',
      totalAporte: String(calc.essalud),
      netoPago: String(calc.netoPago),
      costoTotal: String(calc.costoTotal),
      cuentaContable: null,
      cuentaContableOrigen: null,
      fechaIngreso: emp.fechaIngreso ?? null,
      fechaCese: emp.fechaCese ?? null,
      renta5taManual: useManualRenta5ta,
    });
  }

  if (rows.length) await db.insert(schema.planillaOficinaDetalle).values(rows);

  // ── v2: calculoSnapshot (param + afps + porTrabajador) ──
  const calculoSnapshot = { param, afps, porTrabajador };

  // Update mes: estado=calculada + snapshot (keep tasasSnapshot for PATCH backward-compat)
  const [updatedMes] = await db
    .update(schema.planillaOficinaMes)
    .set({ estado: 'calculada', calculoSnapshot })
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
router.patch('/planilla-detalle/:id', requireOficinaEdit, async (req, res) => {
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
  const adelantoCuota = Number(detRow.adelantoCuota ?? 0);

  // detRow.sueldoMensual es la base YA prorrateada. El motor prorratea, asi que
  // hay que alimentarlo con el sueldo contractual del empleado, no con la base.
  const [empRow] = await db
    .select({ sueldo: schema.empleados.sueldoBaseMensual, tipoTrabajador: schema.empleados.tipoTrabajador })
    .from(schema.empleados)
    .where(eq(schema.empleados.id, detRow.empleadoId))
    .limit(1);
  const sueldoMensual = Number(empRow?.sueldo ?? detRow.sueldoMensual ?? 0);

  const diasMes = new Date(Date.UTC(Number(mesRow.mes.slice(0, 4)), Number(mesRow.mes.slice(5, 7)), 0)).getUTCDate();
  const diasTrab = b.diasTrab !== undefined ? Number(b.diasTrab) : (detRow.diasTrab ?? diasMes);

  // Build tasas from mes calculoSnapshot (v2) or legacy tasasSnapshot
  const calcSnap = (mesRow.calculoSnapshot ?? {}) as {
    param?: { rmv: number; uit: number; topeRma: number; pctEssalud: number; pctOnp: number; pctAfpAporte: number; pctAsigFamiliar: number };
    afps?: Record<string, { pctAporte: number; pctSeguro: number; pctComisionFlujo: number; pctComisionMixta: number }>;
    porTrabajador?: Record<string, { afpComisionTipo?: string; modalidadFormativa?: boolean }>;
  };
  const legacySnap = (mesRow.tasasSnapshot ?? {}) as {
    config?: { pctEssalud: number; pctOnp: number; pctAfpAporte: number; rmv: number; topeSeguroAfp: number; horasMesBase: number };
    afp?: Record<string, { pctSeguro: number; pctComision: number }>;
  };

  // Determine normalization helper (UPPERCASE key for v2 afps map)
  const normAfpKeyPatch = (s: string | null | undefined) =>
    (s ?? '').replace(/\s*\([FM]\)\s*$/i, '').trim().toUpperCase();

  let patchTasas: Parameters<typeof calcularDetalleOficina>[1];
  if (calcSnap.param) {
    // v2 snapshot available
    const afpData = detRow.afp ? calcSnap.afps?.[normAfpKeyPatch(detRow.afp)] : undefined;
    patchTasas = {
      rmv: calcSnap.param.rmv,
      uit: calcSnap.param.uit,
      topeRma: calcSnap.param.topeRma,
      pctEssalud: calcSnap.param.pctEssalud,
      pctOnp: calcSnap.param.pctOnp,
      pctAfpAporte: calcSnap.param.pctAfpAporte,
      pctAsigFamiliar: calcSnap.param.pctAsigFamiliar,
      afp: afpData,
    };
  } else if (legacySnap.config) {
    // legacy snapshot — build best-effort TasasOficina from old shape
    const cfg = legacySnap.config;
    const afpRates = detRow.afp && legacySnap.afp ? legacySnap.afp[afpKey(detRow.afp)] : undefined;
    patchTasas = {
      rmv: cfg.rmv,
      uit: 5350,
      topeRma: cfg.topeSeguroAfp ?? 12599.27,
      pctEssalud: cfg.pctEssalud,
      pctOnp: cfg.pctOnp,
      pctAfpAporte: cfg.pctAfpAporte,
      pctAsigFamiliar: 0.10,
      afp: afpRates ? { pctAporte: 0.10, pctSeguro: afpRates.pctSeguro, pctComisionFlujo: afpRates.pctComision, pctComisionMixta: 0 } : undefined,
    };
  } else {
    // No snapshot: resolve live params
    const liveParam = await resolverParamLegal(mesRow.mes + '-01');
    const liveAfps = await cargarTasasAfp();
    const afpData = detRow.afp ? liveAfps[normAfpKeyPatch(detRow.afp)] : undefined;
    patchTasas = {
      rmv: liveParam.rmv, uit: liveParam.uit, topeRma: liveParam.topeRma,
      pctEssalud: liveParam.pctEssalud, pctOnp: liveParam.pctOnp,
      pctAfpAporte: liveParam.pctAfpAporte, pctAsigFamiliar: liveParam.pctAsigFamiliar,
      afp: afpData,
    };
  }

  // Derive afpComisionTipo and modalidadFormativa from snapshot or employee record
  const workerSnap = calcSnap.porTrabajador?.[detRow.empleadoId];
  const patchAfpComisionTipo: 'flujo' | 'mixta' | 'saldo' =
    (workerSnap?.afpComisionTipo as 'flujo' | 'mixta' | 'saldo') ?? 'saldo';
  const patchModalidadFormativa = workerSnap?.modalidadFormativa ?? (empRow?.tipoTrabajador === 'practicante');

  const calc = calcularDetalleOficina(
    {
      sueldoMensual,
      sistemaPension: tipoSP,
      afpComisionTipo: patchAfpComisionTipo,
      modalidadFormativa: patchModalidadFormativa,
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
      diasTrab,
      diasMes,
    },
    patchTasas,
  );

  // Determine cuentaContable update
  const newCuentaContable = b.cuentaContable !== undefined ? (b.cuentaContable as string | null) : detRow.cuentaContable;
  const newCuentaContableOrigen =
    b.cuentaContable !== undefined
      ? (b.cuentaContable ? 'USUARIO' : null)
      : detRow.cuentaContableOrigen;

  // If imptoRenta5ta is provided in the PATCH body, Kelly is taking manual control
  const setRenta5taManual = b.imptoRenta5ta !== undefined ? true : detRow.renta5taManual;

  const [updated] = await db
    .update(schema.planillaOficinaDetalle)
    .set({
      diasTrab: calc.diasTrab,
      horasTrab: calc.horasTrab,
      sueldoMensual: String(calc.sueldoBase),
      valorHora: String(calc.valorHora),
      asigFamiliar: String(calc.asigFamiliar),
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
      retencionJudicial: String(retencionJudicial),
      otrosDescuentos: String(otrosDescuentos),
      totalDescuento: String(calc.totalDescuento),
      essalud: String(calc.essalud),
      essaludVida: '0',
      totalAporte: String(calc.essalud),
      netoPago: String(calc.netoPago),
      costoTotal: String(calc.costoTotal),
      cuentaContable: newCuentaContable,
      cuentaContableOrigen: newCuentaContableOrigen,
      renta5taManual: setRenta5taManual,
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
router.post('/adelantos', requireOficinaEdit, async (req, res) => {
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
router.post('/planilla/:mesId/cerrar', requireOficinaEdit, async (req, res) => {
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

  // FIX 1: Validate accounting period BEFORE applying cuotas (mirror reabrir guard)
  // periodo = mes (already 'YYYY-MM'); last day doesn't change the period.
  const periodo = mesRow.mes;
  if (await periodoCerrado(periodo)) {
    return res.status(423).json({ error: `Periodo contable ${periodo} cerrado; reabrelo primero` });
  }

  // Load detalle rows
  const detalleRows = await db
    .select()
    .from(schema.planillaOficinaDetalle)
    .where(eq(schema.planillaOficinaDetalle.planillaMesId, mesId!));

  // FIX 3: Guard against empty month (no detalle rows → crearAsiento would throw)
  if (detalleRows.length === 0) {
    return res.status(400).json({ error: 'La planilla no tiene detalle; calcula primero' });
  }

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

  // ── Step 4: Create accounting entry via WS1 engine (idempotent) ──
  // If a previous cerrar call created the asiento but the mes update failed, reuse it
  // instead of creating a duplicate.
  const [existente] = await db
    .select({ id: schema.asientos.id })
    .from(schema.asientos)
    .where(and(
      eq(schema.asientos.origen, 'planilla_oficina'),
      eq(schema.asientos.origenId, mesId!),
      ne(schema.asientos.status, 'anulado'),
    ))
    .limit(1);

  let asientoId: string;
  if (existente) {
    // Reuse existing asiento — no duplicate created on retry
    asientoId = existente.id;
  } else {
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
    asientoId = asiento.id;
  }

  // ── Step 5: Update mes row ──
  const [updatedMes] = await db
    .update(schema.planillaOficinaMes)
    .set({
      estado: 'cerrada',
      asientoId,
      cerradoPor: req.user!.id,
      cerradoEn: new Date(),
    })
    .where(eq(schema.planillaOficinaMes.id, mesId!))
    .returning();

  // ── Step 5b: Upsert renta5ta_mes ledger rows (idempotent) ──
  // remunComputable = totalBruto (= remuneraciónAfecta + gratificación + bonif. extraordinaria)
  // retencion = imptoRenta5ta determinado para el mes
  const anioMes = Number(mesRow.mes.slice(0, 4));
  const mesNumeroMes = Number(mesRow.mes.slice(5, 7));
  for (const det of detalleRows) {
    await upsertLedgerMes({
      empleadoId: det.empleadoId,
      planillaMesId: mesId!,
      anio: anioMes,
      mesNumero: mesNumeroMes,
      remunComputable: Number(det.totalBruto),
      retencion: Number(det.imptoRenta5ta),
    });
  }

  // ── Step 6: Boleta PDF batch (best-effort, outside accounting tx) ──
  // Load empresa row for razonSocial/ruc/direccion. Fail-safe: use empty strings if missing.
  let empresaData = { razonSocial: '', ruc: '', direccion: '' };
  try {
    const [empRow] = await db
      .select({
        razonSocial: schema.empresas.razonSocial,
        ruc: schema.empresas.ruc,
        direccion: schema.empresas.direccion,
      })
      .from(schema.empresas)
      .where(eq(schema.empresas.id, mesRow.empresaId))
      .limit(1);
    if (empRow) {
      empresaData = {
        razonSocial: empRow.razonSocial ?? '',
        ruc: empRow.ruc ?? '',
        direccion: empRow.direccion ?? '',
      };
    }
  } catch (_e) {
    // empresa lookup failure must not abort cierre
  }

  let boletasSubidas = 0;
  const boletaErrores: string[] = [];

  for (const detalle of detalleRows) {
    try {
      // Idempotent: skip if boleta_pago already exists for this detalle
      const docs = await docsDetalle(detalle.id);
      if (docs.boleta) continue;

      const pdf = await generarBoletaPdf(detalle, empresaData, mesRow.mes);
      await registrarDocumento({
        entidadTipo: 'planilla_oficina_detalle',
        entidadId: detalle.id,
        docTipo: 'boleta_pago',
        fileBuffer: pdf,
        nombreArchivo: 'boleta.pdf',
        subidoPor: req.user?.id ?? null,
        subPath: `${mesRow.mes}/${detalle.dni ?? detalle.id}`,
      });
      boletasSubidas++;
    } catch (e) {
      boletaErrores.push(`${detalle.dni ?? detalle.id}: ${(e as Error).message}`);
      console.warn('boleta NAS fallo', detalle.id, (e as Error).message);
    }
  }

  res.json({ mes: updatedMes, asientoId, boletasSubidas, boletasFallidas: boletaErrores.length });
});

// ─── POST /api/oficina/planilla/:mesId/reabrir ───────────────
router.post('/planilla/:mesId/reabrir', requireOficinaEdit, async (req, res) => {
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

// ─── GET /api/oficina/param-legal ────────────────────────────
// Returns all versioned legal param rows ordered by fechaVigencia desc.
router.get('/param-legal', async (_req, res) => {
  const rows = await db
    .select()
    .from(schema.paramLegalOficina)
    .orderBy(desc(schema.paramLegalOficina.fechaVigencia));
  res.json({ params: rows });
});

// ─── PUT /api/oficina/param-legal ────────────────────────────
// Upsert one row by fechaVigencia (ISO date string YYYY-MM-DD).
router.put('/param-legal', requireOficinaEdit, async (req, res) => {
  const b = req.body as Record<string, unknown>;
  const { fechaVigencia, rmv, uit, topeRma, pctEssalud, pctOnp, pctAfpAporte, pctAsigFamiliar } = b;

  if (!fechaVigencia || typeof fechaVigencia !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fechaVigencia)) {
    return res.status(400).json({ error: 'fechaVigencia requerida (YYYY-MM-DD)' });
  }
  // Guard: every numeric field is REQUIRED (not just checked when present).
  // Number(undefined) → NaN, which would silently corrupt decimal columns.
  const numFields: [string, unknown][] = [
    ['rmv', rmv], ['uit', uit], ['topeRma', topeRma],
    ['pctEssalud', pctEssalud], ['pctOnp', pctOnp],
    ['pctAfpAporte', pctAfpAporte], ['pctAsigFamiliar', pctAsigFamiliar],
  ];
  for (const [field, val] of numFields) {
    if (val === undefined || val === null || !Number.isFinite(Number(val))) {
      return res.status(400).json({ error: `Campo '${field}' requerido y numérico` });
    }
  }

  const values = {
    fechaVigencia,
    rmv: String(Number(rmv)),
    uit: String(Number(uit)),
    topeRma: String(Number(topeRma)),
    pctEssalud: String(Number(pctEssalud)),
    pctOnp: String(Number(pctOnp)),
    pctAfpAporte: String(Number(pctAfpAporte)),
    pctAsigFamiliar: String(Number(pctAsigFamiliar)),
  };

  const [row] = await db
    .insert(schema.paramLegalOficina)
    .values(values)
    .onConflictDoUpdate({
      target: schema.paramLegalOficina.fechaVigencia,
      set: {
        rmv: values.rmv, uit: values.uit, topeRma: values.topeRma,
        pctEssalud: values.pctEssalud, pctOnp: values.pctOnp,
        pctAfpAporte: values.pctAfpAporte, pctAsigFamiliar: values.pctAsigFamiliar,
      },
    })
    .returning();

  res.json({ param: row });
});

// ─── GET /api/oficina/afp-tasas ──────────────────────────────
// Lista todas las AFP con sus tasas actuales (para el panel de config editable).
router.get('/afp-tasas', async (_req, res) => {
  const tasas = await db.select().from(schema.afpTasas).orderBy(asc(schema.afpTasas.afp));
  res.json({ tasas });
});

// ─── PUT /api/oficina/afp-tasas/:afp ─────────────────────────
// Update AFP rates by AFP name (exact match, case-insensitive strip).
router.put('/afp-tasas/:afp', requireOficinaEdit, async (req, res) => {
  const afpName = decodeURIComponent(req.params.afp ?? '').trim();
  if (!afpName) return res.status(400).json({ error: 'Nombre de AFP requerido' });

  const b = req.body as Record<string, unknown>;
  const numFields: [string, unknown][] = [
    ['pctAporte', b.pctAporte], ['pctSeguro', b.pctSeguro],
    ['pctComisionFlujo', b.pctComisionFlujo], ['pctComisionMixta', b.pctComisionMixta],
  ];
  for (const [field, val] of numFields) {
    if (val !== undefined && !Number.isFinite(Number(val))) {
      return res.status(400).json({ error: `Campo '${field}' debe ser un número finito` });
    }
  }

  // Verify the AFP exists
  const rows = await db.select().from(schema.afpTasas);
  const match = rows.find((r) => r.afp.trim().toUpperCase() === afpName.toUpperCase());
  if (!match) return res.status(404).json({ error: `AFP '${afpName}' no encontrada` });

  const set: Record<string, string> = {};
  if (b.pctAporte !== undefined)       set.pctAporte       = String(frac(b.pctAporte));
  if (b.pctSeguro !== undefined)       set.pctSeguro       = String(frac(b.pctSeguro));
  if (b.pctComisionFlujo !== undefined) set.pctComisionFlujo = String(frac(b.pctComisionFlujo));
  if (b.pctComisionMixta !== undefined) set.pctComisionMixta = String(frac(b.pctComisionMixta));

  const [updated] = await db
    .update(schema.afpTasas)
    .set(set)
    .where(eq(schema.afpTasas.id, match.id))
    .returning();

  res.json({ afp: updated });
});

// ─── GET /api/oficina/renta5ta-baseline ──────────────────────
// Query: ?empleadoId=&anio=
router.get('/renta5ta-baseline', async (req, res) => {
  const { empleadoId, anio } = req.query as { empleadoId?: string; anio?: string };
  if (!empleadoId) return res.status(400).json({ error: 'Parámetro empleadoId requerido' });
  if (!anio || !Number.isFinite(Number(anio))) return res.status(400).json({ error: 'Parámetro anio requerido' });

  const [row] = await db
    .select()
    .from(schema.renta5taBaseline)
    .where(and(
      eq(schema.renta5taBaseline.empleadoId, empleadoId),
      eq(schema.renta5taBaseline.anio, Number(anio)),
    ))
    .limit(1);

  res.json({ baseline: row ?? null });
});

// ─── PUT /api/oficina/renta5ta-baseline ──────────────────────
// Upsert acumuladoImportado + retencionesImportadas for one employee/year.
// Query: ?empleadoId=&anio=
router.put('/renta5ta-baseline', requireOficinaEdit, async (req, res) => {
  const { empleadoId, anio } = req.query as { empleadoId?: string; anio?: string };
  if (!empleadoId) return res.status(400).json({ error: 'Parámetro empleadoId requerido' });
  if (!anio || !Number.isFinite(Number(anio))) return res.status(400).json({ error: 'Parámetro anio requerido' });

  const b = req.body as Record<string, unknown>;
  const { acumuladoImportado, retencionesImportadas } = b;

  if (acumuladoImportado === undefined || !Number.isFinite(Number(acumuladoImportado))) {
    return res.status(400).json({ error: 'acumuladoImportado requerido (número)' });
  }
  if (retencionesImportadas === undefined || !Number.isFinite(Number(retencionesImportadas))) {
    return res.status(400).json({ error: 'retencionesImportadas requerido (número)' });
  }

  const [row] = await db
    .insert(schema.renta5taBaseline)
    .values({
      empleadoId,
      anio: Number(anio),
      acumuladoImportado: String(Number(acumuladoImportado)),
      retencionesImportadas: String(Number(retencionesImportadas)),
      importadoPor: req.user?.id,
      importadoEn: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.renta5taBaseline.empleadoId, schema.renta5taBaseline.anio],
      set: {
        acumuladoImportado: String(Number(acumuladoImportado)),
        retencionesImportadas: String(Number(retencionesImportadas)),
        importadoPor: req.user?.id,
        importadoEn: new Date(),
      },
    })
    .returning();

  res.json({ baseline: row });
});

// ─── POST /api/oficina/documentos/upload ─────────────────────
// Multipart: field 'file' + body fields entidadTipo, entidadId, docTipo.
// For planilla_oficina_detalle entities, derives subPath from mes+dni.
router.post('/documentos/upload', requireOficinaEdit, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Sin archivo (field name: file)' });

  const { entidadTipo, entidadId, docTipo } = req.body as Record<string, string>;

  if (!entidadTipo || !entidadId || !docTipo) {
    return res.status(400).json({ error: 'Faltan campos: entidadTipo, entidadId, docTipo' });
  }
  if (!DOC_TIPOS_PERMITIDOS.has(docTipo)) {
    return res.status(400).json({
      error: `docTipo '${docTipo}' no permitido. Valores: ${[...DOC_TIPOS_PERMITIDOS].join('|')}`,
    });
  }

  try {
    // For planilla_oficina_detalle, derive subPath = mes/dni
    let subPath: string | undefined;
    if (entidadTipo === 'planilla_oficina_detalle') {
      const [det] = await db
        .select({
          dni: schema.planillaOficinaDetalle.dni,
          planillaMesId: schema.planillaOficinaDetalle.planillaMesId,
        })
        .from(schema.planillaOficinaDetalle)
        .where(eq(schema.planillaOficinaDetalle.id, entidadId))
        .limit(1);

      if (!det) return res.status(404).json({ error: 'planilla_oficina_detalle no encontrado' });

      const [mes] = await db
        .select({ mes: schema.planillaOficinaMes.mes })
        .from(schema.planillaOficinaMes)
        .where(eq(schema.planillaOficinaMes.id, det.planillaMesId))
        .limit(1);

      subPath = `${mes?.mes ?? 'sin-mes'}/${det.dni ?? 'sin-dni'}`;
    }

    const { nasPath } = await registrarDocumento({
      entidadTipo,
      entidadId,
      docTipo,
      fileBuffer: req.file.buffer,
      nombreArchivo: req.file.originalname,
      subidoPor: req.user?.id ?? null,
      subPath,
    });

    res.json({ ok: true, nasPath });
  } catch (e) {
    res.status(502).json({ error: `Upload error: ${(e as Error).message}` });
  }
});

// ─── GET /api/oficina/planilla-detalle/:id/docs ───────────────
router.get('/planilla-detalle/:id/docs', async (req, res) => {
  try {
    const result = await docsDetalle(req.params.id!);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
