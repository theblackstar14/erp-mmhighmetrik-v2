import { db, parseCronogramaValorizado, parseValInversionTotales, parseValorizacionXlsx, valEsFormatoSimple, schema } from '@erp/db';
import { proyectoCreateSchema } from '@erp/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import multer from 'multer';
import { env } from '../env.js';
import { computeCurvaS } from '../lib/curvaS.js';
import { clasificarSalud, construirForecast, type SerieProy } from '../lib/dashboard.js';
import { crossValidate, parseLlmTotalesFromXlsx } from '../lib/llmTotales.js';
import { parseMSProjectXML, tasksToPartidas } from '../lib/mppParser.js';
import { convertMppToXml } from '../lib/mppToXml.js';
import { nasArchivarProyecto } from '../lib/nas.js';
import { parseValorizacionLlm, validateValLlm } from '../lib/valorizacionLlm.js';
import { requireAuth } from '../middleware/auth.js';
import { periodoCerradoDeFecha } from '../lib/periodos.js';
import { audit } from '../lib/audit.js';

const router = Router();

router.use(requireAuth);

// F3 · Detectar cómo se calculan GG+Utilidad en el presupuesto del colegio.
//   embebido_cd · CD ya incluye GG+UT (no hay líneas GG/UT desglosadas) → pctGg/pctUtilidad NULL
//   separado    · GG+UT como % sobre CD + mobiliario/adicionales (S10 completo)
//   simple_pct  · GG+UT como % sobre CD pero sin mobiliario (desglose simple)
type GgUtModo = 'separado' | 'embebido_cd' | 'simple_pct';
function detectGgUtModo(p: {
  pctGg: number | null;
  pctUtilidad: number | null;
  montoGg: number | null;
  montoUtilidad: number | null;
  mobiliario: number | null;
}): GgUtModo {
  const tieneGgUt = !!(p.pctGg || p.pctUtilidad || p.montoGg || p.montoUtilidad);
  if (!tieneGgUt) return 'embebido_cd';
  return (p.mobiliario ?? 0) > 0 ? 'separado' : 'simple_pct';
}

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

// GET /api/proyectos/_dashboard · KPIs baratos (cartera, P&L, conteos, tabla) · SIN curva-S.
// La salud/forecast (caro: curva-S por obra) vive en /_dashboard/salud aparte → KPIs salen al toque.
router.get('/_dashboard', async (_req, res) => {
  const [proys, clientesAll, valsAll, ocsAll, usersAll] = await Promise.all([
    db.select().from(schema.proyectos).where(isNull(schema.proyectos.deletedAt)).orderBy(desc(schema.proyectos.createdAt)),
    db.select({ id: schema.clientes.id, razonSocial: schema.clientes.razonSocial }).from(schema.clientes),
    db.select({ proyectoId: schema.valorizaciones.proyectoId, numero: schema.valorizaciones.numero, montoCd: schema.valorizaciones.montoCd, pctAvance: schema.valorizaciones.pctAvance }).from(schema.valorizaciones),
    db.select({ proyectoId: schema.ordenesCompra.proyectoId, estado: schema.ordenesCompra.estado, subtotalSinIgv: schema.ordenesCompra.subtotalSinIgv }).from(schema.ordenesCompra),
    db.select({ id: schema.users.id, nombres: schema.users.nombres, apellidos: schema.users.apellidos }).from(schema.users),
  ]);
  const cliMap = new Map(clientesAll.map((c) => [c.id, c.razonSocial]));
  const userName = new Map(usersAll.map((u) => [u.id, `${u.nombres} ${u.apellidos}`.trim()]));
  const EG = new Set(['aprobada', 'emitida', 'en_transito', 'entregada']);
  const ACTIVAS = new Set(['adjudicado', 'ejecucion', 'liquidacion']);

  const valsByP = new Map<string, typeof valsAll>();
  for (const v of valsAll) { const arr = valsByP.get(v.proyectoId) ?? []; arr.push(v); valsByP.set(v.proyectoId, arr); }
  const ocsByP = new Map<string, typeof ocsAll>();
  for (const o of ocsAll) {
    if (!o.proyectoId) continue; // OC de oficina/empresa · no entra al rollup por-proyecto
    const arr = ocsByP.get(o.proyectoId) ?? [];
    arr.push(o);
    ocsByP.set(o.proyectoId, arr);
  }

  const obras = proys.map((p) => {
    const vs = valsByP.get(p.id) ?? [];
    const os = (ocsByP.get(p.id) ?? []).filter((o) => EG.has(o.estado));
    const ingresos = vs.reduce((s, v) => s + Number(v.montoCd ?? 0), 0);
    const egresos = os.reduce((s, o) => s + Number(o.subtotalSinIgv ?? 0), 0);
    const miPct = p.pctParticipacionPropia != null ? Number(p.pctParticipacionPropia) : 1;
    const miUtilidad = ingresos * miPct - egresos;
    // avance físico ACUMULADO = Σ pctAvance de todas las valos
    // (cada pctAvance ya es montoCd_periodo / subtotal · sumarlas da el acumulado · antes tomaba
    //  solo la última valo = % del periodo, no el acumulado → mostraba mal)
    const avanceFisico = vs.reduce((s, v) => s + Number(v.pctAvance ?? 0), 0);
    const presupuesto = Number(p.montoContractual ?? 0) || Number(p.costoDirecto ?? 0);
    return {
      id: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
      cliente: p.clienteId ? cliMap.get(p.clienteId) ?? null : null,
      status: p.status,
      ubicacion: p.ubicacion ?? null,
      fechaInicio: p.fechaInicio ?? null,
      fechaFin: p.fechaFin ?? null,
      montoContractual: Number(p.montoContractual ?? 0),
      presupuesto,
      avanceFisico,
      ingresos,
      egresos,
      miPct,
      miUtilidad,
      responsableUserId: p.responsableUserId ?? null,
      responsable: p.responsableUserId ? userName.get(p.responsableUserId) ?? null : null,
    };
  });

  const totales = {
    cartera: obras.reduce((s, o) => s + o.presupuesto, 0),
    ingresos: obras.reduce((s, o) => s + o.ingresos, 0),
    egresos: obras.reduce((s, o) => s + o.egresos, 0),
    miUtilidad: obras.reduce((s, o) => s + o.miUtilidad, 0),
    obrasActivas: obras.filter((o) => ACTIVAS.has(o.status)).length,
    obrasTotal: obras.length,
    licitacion: obras.filter((o) => o.status === 'licitacion').length,
    // Promedio solo sobre obras activas · las de licitación (avance 0, sin valos) diluían el indicador
    avanceFisicoProm: (() => {
      const act = obras.filter((o) => ACTIVAS.has(o.status));
      return act.length > 0 ? act.reduce((s, o) => s + o.avanceFisico, 0) / act.length : 0;
    })(),
  };
  res.json({ totales, obras });
});

// GET /api/proyectos/_dashboard/salud · curva-S por obra (CPI/SPI/salud) + forecast.
// Caro (computeCurvaS por proyecto) → query separada con su propio skeleton en el front.
router.get('/_dashboard/salud', async (_req, res) => {
  // select narrow · solo columnas que computeCurvaS lee (ver PartidaCS/AvanceCS/ValorizacionCS).
  // valorizacionesPartidas NO se consulta · computeCurvaS lo ignora (void) → se pasa [].
  const [proys, valsAll, partidasAll, gastosAll] = await Promise.all([
    db.select({ id: schema.proyectos.id, codigo: schema.proyectos.codigo, nombre: schema.proyectos.nombre, montoContractual: schema.proyectos.montoContractual, montoSubtotal: schema.proyectos.montoSubtotal, costoDirecto: schema.proyectos.costoDirecto, montoReferencial: schema.proyectos.montoReferencial, distribucionInversion: schema.proyectos.distribucionInversion, responsableUserId: schema.proyectos.responsableUserId }).from(schema.proyectos).where(isNull(schema.proyectos.deletedAt)),
    db.select({ proyectoId: schema.valorizaciones.proyectoId, fechaDesde: schema.valorizaciones.fechaDesde, fechaHasta: schema.valorizaciones.fechaHasta, montoCd: schema.valorizaciones.montoCd, montoReajuste: schema.valorizaciones.montoReajuste, montoInversionPeriodo: schema.valorizaciones.montoInversionPeriodo, mesPeriodo: schema.valorizaciones.mesPeriodo, montoInversionAcumulado: schema.valorizaciones.montoInversionAcumulado }).from(schema.valorizaciones),
    db.select({ id: schema.partidas.id, proyectoId: schema.partidas.proyectoId, codigo: schema.partidas.codigo, parentCodigo: schema.partidas.parentCodigo, fechaInicio: schema.partidas.fechaInicio, fechaFin: schema.partidas.fechaFin, presupuestoContractual: schema.partidas.presupuestoContractual, presupuesto: schema.partidas.presupuesto, distribucionMensual: schema.partidas.distribucionMensual }).from(schema.partidas),
    db.select({ proyectoId: schema.gastos.proyectoId, total: schema.gastos.total }).from(schema.gastos),
  ]);
  const avancesAll = partidasAll.length
    ? await db.select({ partidaId: schema.avances.partidaId, fecha: schema.avances.fecha, avancePct: schema.avances.avancePct, realCost: schema.avances.realCost }).from(schema.avances).where(inArray(schema.avances.partidaId, partidasAll.map((p) => p.id)))
    : [];

  const valsByP = new Map<string, typeof valsAll>();
  for (const v of valsAll) { const arr = valsByP.get(v.proyectoId) ?? []; arr.push(v); valsByP.set(v.proyectoId, arr); }
  const partidaProy = new Map(partidasAll.map((p) => [p.id, p.proyectoId]));
  const partidasByP = new Map<string, typeof partidasAll>();
  for (const p of partidasAll) { const arr = partidasByP.get(p.proyectoId) ?? []; arr.push(p); partidasByP.set(p.proyectoId, arr); }
  const avancesByP = new Map<string, typeof avancesAll>();
  for (const a of avancesAll) {
    const pid = partidaProy.get(a.partidaId);
    if (!pid) continue;
    const arr = avancesByP.get(pid) ?? [];
    arr.push(a);
    avancesByP.set(pid, arr);
  }
  const gastoByP = new Map<string, number>();
  for (const g of gastosAll) {
    if (!g.proyectoId) continue;
    gastoByP.set(g.proyectoId, (gastoByP.get(g.proyectoId) ?? 0) + Number(g.total ?? 0));
  }

  const hoy = new Date();
  const series: SerieProy[] = [];

  const obras = proys.map((p) => {
    const vs = valsByP.get(p.id) ?? [];
    const presupuesto = Number(p.montoContractual ?? 0) || Number(p.costoDirecto ?? 0);
    // EVM: SPI de curva-S (físico-obra) · CPI = EV / costo real (gastos importados)
    const parts = partidasByP.get(p.id) ?? [];
    const acReal = gastoByP.get(p.id) ?? 0;
    let cpi: number | null = null, spi: number | null = null, ev = 0;
    const cs = parts.length
      ? computeCurvaS(parts, avancesByP.get(p.id) ?? [], vs, [], hoy,
          p.distribucionInversion?.length ? { bac: Number(p.montoReferencial ?? 0), distribucion: p.distribucionInversion } : null,
          Number(p.montoSubtotal ?? 0) || null)
      : null;
    if (cs) {
      spi = cs.evm.SPI;
      ev = cs.evm.EV;
      // CPI = EV / costo real. Solo es fiable si el costo capturado es plausible (>=10% del
      // presupuesto); con gastos incompletos AC≈0 dispara CPI a miles → lo dejamos sin dato.
      // ponytail: umbral simple; subir cuando todas las obras tengan compras+planilla ligadas.
      cpi = acReal >= presupuesto * 0.1 ? ev / acReal : null;
      series.push({ keys: cs.buckets.map((b) => b.key), planAcum: cs.planAcum, earnedAcum: cs.earnedAcum });
    }
    const salud = clasificarSalud(cpi, spi);
    const desviacionPct = cpi != null ? Math.round((cpi - 1) * 1000) / 10 : null; // CV% relativo
    return {
      id: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
      cpi: cpi != null ? Math.round(cpi * 100) / 100 : null,
      spi: spi != null ? Math.round(spi * 100) / 100 : null,
      salud,
      desviacionPct,
      responsableUserId: p.responsableUserId ?? null,
    };
  });

  const salud = {
    critico: obras.filter((o) => o.salud === 'critico').length,
    observacion: obras.filter((o) => o.salud === 'observacion').length,
    saludable: obras.filter((o) => o.salud === 'saludable').length,
    sinDatos: obras.filter((o) => o.salud === 'sin_datos').length,
  };
  const forecast = construirForecast(series, hoy);
  res.json({ salud, forecast, obras });
});

// PATCH /api/proyectos/:id/responsable · asigna residente/gerente de obra
router.patch('/:id/responsable', async (req, res) => {
  const responsableUserId = (req.body?.responsableUserId ?? null) as string | null;
  const [p] = await db.update(schema.proyectos)
    .set({ responsableUserId })
    .where(and(eq(schema.proyectos.id, String(req.params.id)), isNull(schema.proyectos.deletedAt)))
    .returning({ id: schema.proyectos.id, responsableUserId: schema.proyectos.responsableUserId });
  if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
  res.json({ proyecto: p });
});

// ─── Equipo del proyecto (profesionales asignados del padrón) ─
router.get('/:id/equipo', async (req, res) => {
  const rows = await db
    .select({ profesionalId: schema.equipoProyecto.profesionalId, rol: schema.equipoProyecto.rol, asignadoEn: schema.equipoProyecto.asignadoEn, nombre: schema.profesionales.nombre, profesion: schema.profesionales.profesion })
    .from(schema.equipoProyecto)
    .leftJoin(schema.profesionales, eq(schema.profesionales.id, schema.equipoProyecto.profesionalId))
    .where(eq(schema.equipoProyecto.proyectoId, req.params.id!));
  const equipo = rows.map((r) => ({ profesionalId: r.profesionalId, rol: r.rol, asignadoEn: r.asignadoEn, nombre: r.nombre ?? '', profesion: r.profesion }));
  res.json({ equipo });
});
router.post('/:id/equipo', async (req, res) => {
  const b = req.body as { profesionalId?: string; rol?: string };
  if (!b.profesionalId || !b.rol) return res.status(400).json({ error: 'profesionalId y rol obligatorios' });
  // delete+insert · evita depender de constraint único exacto para onConflict
  await db.delete(schema.equipoProyecto).where(and(eq(schema.equipoProyecto.proyectoId, req.params.id!), eq(schema.equipoProyecto.profesionalId, b.profesionalId)));
  await db.insert(schema.equipoProyecto).values({ proyectoId: req.params.id!, profesionalId: b.profesionalId, rol: b.rol });
  res.json({ ok: true });
});
router.delete('/:id/equipo/:profesionalId', async (req, res) => {
  await db.delete(schema.equipoProyecto).where(and(eq(schema.equipoProyecto.proyectoId, req.params.id!), eq(schema.equipoProyecto.profesionalId, req.params.profesionalId!)));
  res.json({ ok: true });
});

// Reporte de costos de obra · CD / GG_OBRA ejecutado vs presupuesto + resultado de obra
router.get('/:id/costos-obra', async (req, res) => {
  const id = req.params.id!;
  const [proy] = await db.select().from(schema.proyectos).where(eq(schema.proyectos.id, id)).limit(1);
  if (!proy) return res.status(404).json({ error: 'Proyecto no encontrado' });

  const rows = await db.select({
      clasificacion: schema.gastos.clasificacion,
      prorrateable: schema.gastos.prorrateable,
      total: sql<number>`coalesce(sum(${schema.gastos.total}),0)::float8`,
    }).from(schema.gastos)
    .where(and(eq(schema.gastos.proyectoId, id), eq(schema.gastos.destino, 'proyecto')))
    .groupBy(schema.gastos.clasificacion, schema.gastos.prorrateable);

  const sumBy = (clase: string) => rows.filter((r) => r.clasificacion === clase).reduce((s, r) => s + Number(r.total), 0);
  const cdGastos = sumBy('CD');
  const ggEjec = sumBy('GG_OBRA');
  const compartidos = rows.filter((r) => r.prorrateable).reduce((s, r) => s + Number(r.total), 0);

  // Mano de obra directa de planilla → CD (read-through · el costo vive en el asiento de planilla, NO en gastos → sin doble conteo)
  const [mo] = await db.select({ v: sql<number>`coalesce(sum(${schema.planillaDetalle.montoCostoTotal}),0)::float8` })
    .from(schema.planillaDetalle)
    .innerJoin(schema.planillaSemanas, eq(schema.planillaDetalle.semanaId, schema.planillaSemanas.id))
    .where(eq(schema.planillaSemanas.proyectoId, id));
  const manoObra = Number(mo?.v ?? 0);
  const cdEjec = cdGastos + manoObra;

  const cdPres = Number(proy.costoDirectoSinIgv ?? proy.costoDirecto ?? 0);
  const separable = proy.ggUtModo === 'separado';
  const ggPres = separable ? cdPres * Number(proy.pctGg ?? 0) : null;

  const [val] = await db.select({ v: sql<number>`coalesce(sum(${schema.valorizaciones.montoCd}),0)::float8` })
    .from(schema.valorizaciones)
    .where(and(eq(schema.valorizaciones.proyectoId, id), inArray(schema.valorizaciones.status, ['aprobada', 'conformidad_supervision', 'facturada', 'cobrada'])));
  const valorizacion = Number(val?.v ?? 0);

  const costoTotal = cdEjec + ggEjec;
  res.json({
    cd: { presupuesto: cdPres, ejecutado: cdEjec, gastos: cdGastos, manoObra },
    ggObra: { presupuesto: ggPres, ejecutado: ggEjec, separable },
    costoTotal, valorizacion, resultadoObra: valorizacion - costoTotal,
    compartidosSinDistribuir: compartidos,
    ggUtModo: proy.ggUtModo,
  });
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

  // Garantía de fiel cumplimiento · auto-generada del % que el usuario fija al crear la obra.
  // Aparece en Finanzas (card Garantías) y en el tab Contractual · se libera al consentimiento de liquidación.
  const pctFiel = data.pctFielCumplimiento ?? 0;
  if (proyecto && pctFiel > 0 && contractual > 0) {
    await db.insert(schema.garantias).values({
      proyectoId: proyecto.id,
      tipo: 'fiel_cumplimiento',
      monto: (contractual * pctFiel).toFixed(2),
      estado: 'vigente',
      liberaEnHito: 'consentimiento_liquidacion',
      notas: `Fiel cumplimiento ${(pctFiel * 100).toFixed(1)}% · autogenerada al crear la obra`,
    });
  }
  res.status(201).json({ proyecto });
});

// POST /api/proyectos/preview-xlsx · parse + return preview (no DB write)
// P2 · default inteligente del tipo de entidad a partir del nombre del cliente (municipalidad != gobierno_regional)
function inferirTipoEntidad(cliente: string | null | undefined): string {
  const c = (cliente ?? '').toUpperCase();
  if (/MUNICIPALIDAD|MUNICIPAL/.test(c)) return 'municipalidad';
  if (/GOBIERNO\s+REGIONAL|REGION\b|GORE/.test(c)) return 'gobierno_regional';
  if (/MINISTERIO|MINEDU|MINSA|MTC|GOBIERNO\s+NACIONAL/.test(c)) return 'ministerio';
  if (/UNIVERSIDAD|UGEL|EDUCACION/.test(c)) return 'gobierno_regional';
  if (c && !/MUNICI|GOBIERNO|MINISTERIO|UNIVERS|UGEL/.test(c)) return 'privado';
  return 'gobierno_regional';
}

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

    // Si el Excel trae el MONTO pero no el % (caso "Desglose simple"), derivar el % del monto
    // (evita mostrar/persistir 0% con monto != 0). En "embebido_cd" montoGg=null → queda null (correcto).
    const _cd = parsed.costoDirecto ?? 0;
    const _baseIgv = (parsed.subTotal ?? 0) + (parsed.mobiliario ?? 0);
    const pctGgRes = parsed.pctGg ?? (_cd > 0 && parsed.montoGg ? parsed.montoGg / _cd : null);
    const pctUtilRes = parsed.pctUtilidad ?? (_cd > 0 && parsed.montoUtilidad ? parsed.montoUtilidad / _cd : null);
    const pctIgvRes = parsed.pctIgv ?? (_baseIgv > 0 && parsed.montoIgv ? parsed.montoIgv / _baseIgv : null);

    // Validación cruzada (con los % ya derivados → no genera falsas discrepancias por % null vs IA)
    let validation: ReturnType<typeof crossValidate> | null = null;
    let llmMeta: { modelUsed: string; latencyMs: number; costUsd: number } | null = null;
    if (llmResult.status === 'fulfilled') {
      const llm = llmResult.value;
      validation = crossValidate(
        {
          costoDirecto: parsed.costoDirecto,
          pctGg: pctGgRes,
          montoGg: parsed.montoGg,
          pctUtilidad: pctUtilRes,
          montoUtilidad: parsed.montoUtilidad,
          subTotal: parsed.subTotal,
          mobiliario: parsed.mobiliario,
          pctIgv: pctIgvRes,
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
      sugerencia: { codigo: sugCodigo, tipoEntidad: inferirTipoEntidad(parsed.cliente) }, // P2 · default inteligente del tipo
      ggUtModo: detectGgUtModo(parsed), // F3 · estructura GG+UT detectada (preview HITL)
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
        pctGg: pctGgRes,           // % derivado del monto si el Excel no lo traía
        montoGg: parsed.montoGg,
        pctUtilidad: pctUtilRes,
        montoUtilidad: parsed.montoUtilidad,
        subTotal: parsed.subTotal,
        mobiliario: parsed.mobiliario,
        pctIgv: pctIgvRes,
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
    const inversionId = (body.inversionId ?? '').trim() || null; // F3 · vincular colegio a inversión-padre
    const codigoIe = (body.codigoIe ?? '').trim() || null; // F3 · nº institución educativa
    if (!codigo) return res.status(400).json({ error: 'codigo es obligatorio (ej: PG0010)' });

    const existingCodigo = await db
      .select({ id: schema.proyectos.id })
      .from(schema.proyectos)
      .where(eq(schema.proyectos.codigo, codigo))
      .limit(1);
    if (existingCodigo.length) return res.status(409).json({ error: `Código ${codigo} ya existe` });

    // Validar inversión-padre si se envió (no crear colegio huérfano apuntando a CUI inexistente)
    let inversionCui: string | null = null;
    if (inversionId) {
      const [inv] = await db
        .select({ cui: schema.inversiones.cui })
        .from(schema.inversiones)
        .where(and(eq(schema.inversiones.id, inversionId), isNull(schema.inversiones.deletedAt)))
        .limit(1);
      if (!inv) return res.status(400).json({ error: `Inversión ${inversionId} no existe` });
      inversionCui = inv.cui;
    }

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

    // F3 · Detectar estructura GG+Utilidad del expediente
    //   embebido_cd → CD ya incluye GG+UT · pctGg/pctUtilidad van NULL (no inventar)
    //   separado    → GG+UT como % + mobiliario · simple_pct → GG+UT % sin mobiliario
    const cd = parsed.costoDirecto ?? 0;
    const pctIgvFinal = parsed.pctIgv ?? 0.18;
    const ggUtModo = detectGgUtModo(parsed);
    const indirectosEmbebidos = ggUtModo === 'embebido_cd';
    // pct NULL si embebido (no hay % real). Si NO embebido y el Excel trajo el MONTO pero no el %,
    // derivar el % del monto (montoGg/CD) → nunca persistir 0% con monto != 0 (riesgo contable).
    const pctGgFinal = indirectosEmbebidos ? null : (parsed.pctGg ?? (cd > 0 && parsed.montoGg ? parsed.montoGg / cd : 0));
    const pctUtilFinal = indirectosEmbebidos ? null : (parsed.pctUtilidad ?? (cd > 0 && parsed.montoUtilidad ? parsed.montoUtilidad / cd : 0));

    // Derivar montos si parser no los extrajo (embebido → factor 1, GG+UT ya en CD)
    const subtotalCalc = parsed.subTotal ?? cd * (1 + (pctGgFinal ?? 0) + (pctUtilFinal ?? 0));
    const mobiliarioCalc = parsed.mobiliario ?? 0;
    const igvBase = subtotalCalc + mobiliarioCalc;
    const montoIgvCalc = parsed.montoIgv ?? igvBase * pctIgvFinal;
    const presupTotalCalc = parsed.presupuestoTotal ?? igvBase + montoIgvCalc;
    const supervisionCalc = parsed.supervision ?? 0;
    const vrCalc = parsed.valorReferencial ?? presupTotalCalc + supervisionCalc;

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
          costoDirecto: cd.toString(),
          costoDirectoSinIgv: cd.toString(),
          igvEnXml: false,
          ggUtModo,
          inversionId,
          cui: inversionCui,
          codigoIe,
          fuenteMontos: 'cronograma_valorizado',
          pctGg: pctGgFinal === null ? null : pctGgFinal.toString(),
          pctUtilidad: pctUtilFinal === null ? null : pctUtilFinal.toString(),
          pctIgv: pctIgvFinal.toString(),
          montoSubtotal: subtotalCalc.toFixed(2),
          montoIgv: montoIgvCalc.toFixed(2),
          montoReferencial: vrCalc.toFixed(2),
          montoContractual: presupTotalCalc.toFixed(2),
          montoVigente: presupTotalCalc.toFixed(2),
          // Componentes inversión + plan financiero-inversión mensual (PV)
          montoMobiliario: parsed.mobiliario != null ? parsed.mobiliario.toFixed(2) : null,
          montoExpedienteTecnico: parsed.documentoTrabajo != null ? parsed.documentoTrabajo.toFixed(2) : null,
          montoSupervisionExpediente: parsed.supervisionDocTrabajo != null ? parsed.supervisionDocTrabajo.toFixed(2) : null,
          montoSupervisionObra: parsed.supervision != null ? parsed.supervision.toFixed(2) : null,
          distribucionInversion: parsed.distribucionInversion,
          fechaInicio,
          fechaFin,
          diasPlazo: parsed.diasPlazo,
          managerId: req.user!.id,
        })
        .returning();

      const proyId = proyecto!.id;

      // Mapear distribución mensual: array números → [{ym: '2026-04', monto: X}]
      // parsed.meses[k] tiene year/month → ym = 'YYYY-MM'
      const mesYmMap = parsed.meses.map((m) => `${m.year}-${String(m.month).padStart(2, '0')}`);

      const partidaRows = parsed.partidas.map((p) => {
        const distrib: Array<{ ym: string; monto: number }> = [];
        for (let k = 0; k < p.distribucionMensual.length; k++) {
          const monto = p.distribucionMensual[k] ?? 0;
          if (monto > 0 && mesYmMap[k]) {
            distrib.push({ ym: mesYmMap[k]!, monto });
          }
        }
        return {
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
          distribucionMensual: distrib,
          orden: p.orden,
        };
      });

      const CHUNK = 100;
      for (let i = 0; i < partidaRows.length; i += CHUNK) {
        await tx.insert(schema.partidas).values(partidaRows.slice(i, i + CHUNK));
      }

      return proyId;
    });

    // Auto-archivar el cronograma valorizado al NAS (best-effort · crea la carpeta base de la obra)
    await nasArchivarProyecto(codigo, '02_Expediente_Tecnico', 'Cronograma_Valorizado.xlsx', req.file.buffer);

    res.status(201).json({
      ok: true,
      proyectoId,
      ggUtModo,
      inversionId,
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

      // Después: summaries bottom-up · acumula presupuesto + fechas + distribución mensual
      for (const lvl of niveles) {
        for (const p of partidas.filter((x) => x.nivel === lvl && x.isSummary)) {
          const hijos = childrenByParent.get(p.codigo);
          if (!hijos || hijos.length === 0) continue;

          let sumPresup = 0;
          let sumPresupCon = 0;
          let minIni: string | null = null;
          let maxFin: string | null = null;
          // Acumular distribución mensual por ym
          const distribMap = new Map<string, number>();
          for (const h of hijos) {
            sumPresup += Number(h.presupuesto ?? 0);
            sumPresupCon += Number(h.presupuestoContractual ?? 0);
            if (h.fechaInicio && (!minIni || h.fechaInicio < minIni)) minIni = h.fechaInicio;
            if (h.fechaFin && (!maxFin || h.fechaFin > maxFin)) maxFin = h.fechaFin;
            const hDistrib = (h.distribucionMensual ?? []) as Array<{ ym: string; monto: number }>;
            for (const d of hDistrib) {
              distribMap.set(d.ym, (distribMap.get(d.ym) ?? 0) + d.monto);
            }
          }

          const newIni = minIni ?? p.fechaInicio;
          const newFin = maxFin ?? p.fechaFin;
          const newDur = diasEntre(newIni, newFin);
          const newDistrib = [...distribMap.entries()]
            .map(([ym, monto]) => ({ ym, monto: Number(monto.toFixed(2)) }))
            .sort((a, b) => a.ym.localeCompare(b.ym));

          // Mutar in-memory para que niveles más bajos vean valores nuevos
          p.presupuesto = sumPresup.toFixed(2);
          p.presupuestoContractual = sumPresupCon.toFixed(2);
          p.fechaInicio = newIni;
          p.fechaFin = newFin;
          p.duracionDias = newDur;
          p.distribucionMensual = newDistrib;

          await tx
            .update(schema.partidas)
            .set({
              presupuesto: sumPresup.toFixed(2),
              presupuestoContractual: sumPresupCon.toFixed(2),
              fechaInicio: newIni,
              fechaFin: newFin,
              duracionDias: newDur,
              distribucionMensual: newDistrib,
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

// POST /api/proyectos/:id/contrato · archiva el PDF del contrato al NAS (01_Contrato)
router.post('/:id/contrato', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const [pc] = await db.select({ codigo: schema.proyectos.codigo }).from(schema.proyectos).where(eq(schema.proyectos.id, req.params.id!)).limit(1);
    if (!pc) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const ok = await nasArchivarProyecto(pc.codigo, '01_Contrato', 'Contrato.pdf', req.file.buffer);
    res.json({ ok });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
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

    // Auto-archivar el cronograma original (.mpp/.xml) al NAS (best-effort)
    {
      const [pc] = await db.select({ codigo: schema.proyectos.codigo }).from(schema.proyectos).where(eq(schema.proyectos.id, req.params.id!)).limit(1);
      const e = req.file!.originalname.slice(req.file!.originalname.lastIndexOf('.')) || '.mpp';
      if (pc) await nasArchivarProyecto(pc.codigo, '02_Expediente_Tecnico', `Cronograma${e}`, req.file!.buffer);
    }

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
  // partidas (UI necesita filas completas) + valos (solo id/numero) en paralelo
  const [list, vals] = await Promise.all([
    db.select().from(schema.partidas).where(eq(schema.partidas.proyectoId, proyectoId)).orderBy(asc(schema.partidas.orden)),
    db.select({ id: schema.valorizaciones.id, numero: schema.valorizaciones.numero }).from(schema.valorizaciones).where(eq(schema.valorizaciones.proyectoId, proyectoId)),
  ]);
  if (vals.length === 0) {
    return res.json({ partidas: list });
  }
  const valIds = vals.map((v) => v.id);
  const valNumMap = new Map(vals.map((v) => [v.id, v.numero]));
  const valpart = await db
    .select({ partidaId: schema.valorizacionesPartidas.partidaId, valorizacionId: schema.valorizacionesPartidas.valorizacionId, metradoAcumulado: schema.valorizacionesPartidas.metradoAcumulado, montoAcumulado: schema.valorizacionesPartidas.montoAcumulado, pctAvance: schema.valorizacionesPartidas.pctAvance })
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

  const recursosFiltered = await db.select().from(schema.recursos).where(inArray(schema.recursos.id, recursoIds));

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
// Estrategia: LLM Claude Haiku 4.5 (maneja cualquier formato S10) + fallback
// al parser determinista rico si falla cuadre o falta API key.
router.post('/:id/valorizaciones', upload.single('file'), async (req, res) => {
  try {
    const proyectoId = req.params.id!;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const filename = req.file.originalname.toLowerCase();
    if (!filename.endsWith('.xlsx') && !filename.endsWith('.xls'))
      return res.status(400).json({ error: 'Solo .xlsx/.xls soportados' });

    // ─── Estrategia híbrida · LLM primero · fallback determinista ─
    // Formato simple (1 hoja "VAL SMP") → parser determinista exacto, sin gastar LLM
    // (la IA no es confiable extrayendo 500+ partidas de una sola hoja).
    const formatoSimple = valEsFormatoSimple(req.file.buffer);
    const useDeterministic = formatoSimple || req.body?.forceDeterministic === 'true' || !env.ANTHROPIC_API_KEY;
    let parsed: ReturnType<typeof parseValorizacionXlsx>;
    let llmMeta: { modelUsed: string; latencyMs: number; costUsd: number; warnings: string[] } | null = null;

    if (!useDeterministic) {
      try {
        const llm = await parseValorizacionLlm(req.file.buffer);
        // Cross-validate codes con proyecto
        const dbPartidasPre = await db
          .select({ codigo: schema.partidas.codigo })
          .from(schema.partidas)
          .where(eq(schema.partidas.proyectoId, proyectoId));
        const codesSet = new Set(dbPartidasPre.map((p) => p.codigo));
        const validation = validateValLlm(llm, codesSet);
        llmMeta = {
          modelUsed: llm.modelUsed,
          latencyMs: llm.latencyMs,
          costUsd: llm.costUsd,
          warnings: validation.warnings,
        };

        // Si cuadre OK y codes >= 80% match · usamos LLM
        // Sino · fallback al S10 rico
        if (validation.okCuadre && validation.codesMatchPct >= 80) {
          // Adaptar shape LLM → shape ValParseResult (campos opcionales se llenan con defaults)
          parsed = {
            numero: llm.numero,
            mesPeriodo: llm.mesPeriodo ?? '',
            fechaDesde: llm.fechaDesde,
            fechaHasta: llm.fechaHasta,
            valorizacion: llm.montoCd,
            reajustes: 0,
            deducciones: 0,
            valorizacionBruta: llm.montoCd,
            amortizaciones: 0,
            valorizacionNeta: llm.montoCd,
            multa: 0,
            montoPagarSinIgv: llm.montoCd,
            igv: llm.montoIgv,
            montoTotalConIgv: llm.montoCd + llm.montoIgv,
            retencion: 0,
            totalContratista: llm.montoCd + llm.montoIgv,
            obra: llm.obra ?? '',
            contratista: llm.contratista ?? '',
            asNumero: '',
            entidad: llm.entidad ?? '',
            pptoBase: llm.valorReferencial ?? 0,
            pptoContratado: llm.presupuestoTotal ?? 0,
            fechaPresupuestoBase: llm.costoBase ?? '',
            kCalculado: llm.kCalculado ?? null,
            kMenosUno: llm.kCalculado != null ? llm.kCalculado - 1 : null,
            vReal: llm.montoCd,
            reajusteReal: null,
            reajusteProgramado: null,
            reajusteReconocido: null,
            reajustePagado: null,
            vProgramado: null,
            vrConReajuste: null,
            reajusteAcumAnterior: 0,
            reajusteAcumActual: 0,
            reajustePresente: llm.reajustePresente ?? 0,
            condicion: null,
            monomios: [],
            curvaS: [],
            partidas: llm.partidas.map((p) => ({
              codigo: p.codigo,
              descripcion: p.descripcion,
              unidad: p.unidad,
              metradoContractual: p.metradoContractual ?? 0,
              precioUnitario: p.precioUnitario ?? 0,
              subTotal: p.parcialContractual ?? 0,
              metradoAnterior: p.metradoAnterior,
              valorAnterior: p.parcialAnterior,
              pctAnterior: p.pctAnterior > 1 ? p.pctAnterior / 100 : p.pctAnterior,
              metradoActual: p.metradoActual,
              valorActual: p.parcialActual,
              pctActual: p.pctActual > 1 ? p.pctActual / 100 : p.pctActual,
              metradoAcumulado: p.metradoAcumulado,
              valorAcumulado: p.parcialAcumulado,
              pctAcumulado: p.pctAcumulado > 1 ? p.pctAcumulado / 100 : p.pctAcumulado,
              metradoSaldo: p.metradoSaldo ?? 0,
              valorSaldo: p.parcialSaldo ?? 0,
              pctSaldo: p.pctSaldo ?? 0,
            })),
            errors: [],
            warnings: validation.warnings,
          };
        } else {
          // LLM falló validación · intenta parser determinista
          const detRes = parseValorizacionXlsx(req.file.buffer);
          if (detRes.errors.length) {
            return res.status(400).json({
              error: 'Ambos parsers fallaron',
              llm: { ...llmMeta, validation },
              deterministic: { errors: detRes.errors, warnings: detRes.warnings },
              hint: 'Revisa que el archivo corresponda al proyecto · que tenga estructura S10 reconocible',
            });
          }
          parsed = detRes;
          llmMeta.warnings.push('Fallback a parser determinista · LLM no cumplió validación');
        }
      } catch (e) {
        // LLM threw · fallback determinista
        const detRes = parseValorizacionXlsx(req.file.buffer);
        if (detRes.errors.length) {
          return res.status(400).json({
            error: 'LLM error + parser determinista falló',
            llmError: e instanceof Error ? e.message : String(e),
            detalles: detRes.errors,
            warnings: detRes.warnings,
          });
        }
        parsed = detRes;
        llmMeta = {
          modelUsed: 'error',
          latencyMs: 0,
          costUsd: 0,
          warnings: [`LLM falló: ${e instanceof Error ? e.message : String(e)} · usado parser determinista`],
        };
      }
    } else {
      // forceDeterministic o sin API key
      parsed = parseValorizacionXlsx(req.file.buffer);
      if (parsed.errors.length) {
        return res.status(400).json({ error: 'Parse errors', detalles: parsed.errors, warnings: parsed.warnings });
      }
    }

    // Bloque totales inversión (financiero-inversión real) · parser-agnóstico sobre buffer
    const inversion = parseValInversionTotales(req.file.buffer);

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

    // Mapear partidas Excel ↔ partidas DB por código (narrow · solo lo usado abajo)
    const dbPartidas = await db
      .select({ id: schema.partidas.id, codigo: schema.partidas.codigo, precioUnitarioContractual: schema.partidas.precioUnitarioContractual, presupuestoContractual: schema.partidas.presupuestoContractual })
      .from(schema.partidas)
      .where(eq(schema.partidas.proyectoId, proyectoId));
    const partidasMap = new Map(dbPartidas.map((p) => [p.codigo, p]));

    // Idempotencia · borrar valo previa con mismo número (filtro en SQL · cascade limpia detalle)
    const [prev] = await db
      .select({ id: schema.valorizaciones.id })
      .from(schema.valorizaciones)
      .where(and(eq(schema.valorizaciones.proyectoId, proyectoId), eq(schema.valorizaciones.numero, parsed.numero)))
      .limit(1);
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
        // Inversión (financiero-inversión real · bloque totales Excel)
        montoInversionPeriodo: inversion.montoInversion ? inversion.montoInversion.periodo.toFixed(2) : null,
        montoInversionAcumulado: inversion.montoInversion ? inversion.montoInversion.acumulado.toFixed(2) : null,
        pctInversionAcumulado:
          inversion.pctAvanceInversionAcum != null ? (inversion.pctAvanceInversionAcum * 100).toFixed(2) : null,
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
          inversion, // breakdown completo: CD/mob/ET/superv/montoInversión base·período·acum
        },
        observaciones: `Importado desde ${req.file.originalname}`,
      })
      .returning();

    // Insertar valorizaciones_partidas (solo las que matchean con DB)
    // Además sincronizar partida.precio_unitario_contractual y presupuesto_contractual
    // con valores Excel S10 (source of truth · evita drift de rounding)
    let partidasSinMatch = 0;
    const vpRows: (typeof schema.valorizacionesPartidas.$inferInsert)[] = [];
    const syncs: { id: string; pu: string; budget: string }[] = [];
    for (const p of parsed.partidas) {
      const dbP = partidasMap.get(p.codigo);
      if (!dbP) {
        partidasSinMatch++;
        continue;
      }
      const subp = p.codigo.split('.')[0] ?? '';
      vpRows.push({
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
      // Sync partida con valores S10 si difieren (acumular · se aplica en lote abajo)
      const dbPu = Number(dbP.precioUnitarioContractual ?? 0);
      const dbBudget = Number(dbP.presupuestoContractual ?? 0);
      const excelSubTotal = p.subTotal > 0 ? p.subTotal : p.precioUnitario * p.metradoContractual;
      if (Math.abs(dbPu - p.precioUnitario) > 0.0001 || Math.abs(dbBudget - excelSubTotal) > 0.01) {
        syncs.push({ id: dbP.id, pu: String(p.precioUnitario), budget: excelSubTotal.toFixed(2) });
      }
    }
    // 1 INSERT batch en vez de N round-trips (antes: 1 insert por partida · cientos)
    // ponytail: sin transacción explícita (el código previo tampoco la tenía); envolver header+
    // detalle+sync en db.transaction si se necesita atomicidad ante fallo parcial.
    if (vpRows.length) await db.insert(schema.valorizacionesPartidas).values(vpRows);
    const partidasInsertadas = vpRows.length;
    for (const s of syncs) {
      await db.update(schema.partidas).set({ precioUnitarioContractual: s.pu, presupuestoContractual: s.budget }).where(eq(schema.partidas.id, s.id));
    }
    const partidasSincronizadas = syncs.length;

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

    // Auto-archivar la valorización original (XLSX) al NAS (best-effort)
    await nasArchivarProyecto(proy.codigo, '03_Valorizaciones', `Valorizacion_V${String(parsed.numero).padStart(2, '0')}.xlsx`, req.file.buffer);

    return res.json({
      ok: true,
      valorizacion: valRow,
      partidasInsertadas,
      partidasSinMatch,
      partidasSincronizadas,
      inversion: inversion.found
        ? {
            montoInversionPeriodo: inversion.montoInversion?.periodo ?? null,
            montoInversionAcumulado: inversion.montoInversion?.acumulado ?? null,
            pctAvanceInversion:
              inversion.pctAvanceInversionAcum != null ? inversion.pctAvanceInversionAcum * 100 : null,
          }
        : null,
      warnings: parsed.warnings,
      llmMeta,
      strategy: llmMeta ? 'llm' : 'deterministic',
    });
  } catch (err) {
    console.error('Error upload val:', err);
    return res.status(500).json({ error: String(err) });
  }
});

// GET /api/proyectos/:id/valorizaciones · cabeceras + reajustes + partidas resumen
// PATCH /api/proyectos/:id/valorizaciones/:valId/estado · avanzar workflow de valo
const VALO_ESTADOS = ['borrador', 'emitida', 'conformidad_supervision', 'aprobada', 'facturada', 'cobrada', 'rechazada'] as const;
router.patch('/:id/valorizaciones/:valId/estado', async (req, res) => {
  const body = req.body as { estado?: unknown; cuentaId?: unknown; fechaCobro?: unknown; cuentaContable?: unknown };
  const estado = String(body.estado ?? '');
  if (!VALO_ESTADOS.includes(estado as (typeof VALO_ESTADOS)[number])) {
    return res.status(400).json({ error: `estado inválido · usar: ${VALO_ESTADOS.join(', ')}` });
  }
  // WS1 · cuenta de ingreso confirmada por Kelly (default fuerte 7041 en el motor). Valida existe+activa.
  let cuentaIngresoSet: { cuentaContable: string; cuentaContableOrigen: string } | undefined;
  if (body.cuentaContable != null && String(body.cuentaContable).trim()) {
    const cta = String(body.cuentaContable).trim();
    const [pc] = await db.select({ activa: schema.planContable.activa }).from(schema.planContable).where(eq(schema.planContable.codigo, cta)).limit(1);
    if (!pc) return res.status(400).json({ error: `cuenta contable ${cta} no existe` });
    if (pc.activa === false) return res.status(400).json({ error: `cuenta contable ${cta} está inactiva` });
    cuentaIngresoSet = { cuentaContable: cta, cuentaContableOrigen: 'USUARIO' };
  }
  // F2 · al marcar COBRADA nace el movimiento Ingreso de caja (mismo patrón que pago OC)
  const esCobro = estado === 'cobrada';
  const cuentaId = body.cuentaId ? String(body.cuentaId) : null;
  if (esCobro && !cuentaId) return res.status(400).json({ error: 'cuenta de destino requerida para marcar cobrada' });
  if (esCobro) {
    const fechaCobroEff = (body.fechaCobro ? String(body.fechaCobro) : '') || new Date().toISOString().slice(0, 10);
    const cerrado = await periodoCerradoDeFecha(fechaCobroEff); // H1.1 · no cobrar en periodo cerrado
    if (cerrado) return res.status(423).json({ error: `Periodo ${cerrado} cerrado · no se permite cobrar con fecha retroactiva` });
  }

  // Al marcar FACTURADA se captura el comprobante electrónico (serie/número reales · o mock auto-correlativo si no se envían).
  // Alimenta Registro de Ventas (14.1) y SIRE RVIE. Idempotente: no re-numera si la valo ya tiene comprobante.
  let comprobante: Partial<typeof schema.valorizaciones.$inferInsert> | undefined;
  if (estado === 'facturada') {
    const [cur] = await db.select({ n: schema.valorizaciones.comprobanteNumero }).from(schema.valorizaciones).where(eq(schema.valorizaciones.id, req.params.valId!)).limit(1);
    if (!cur?.n) {
      const c = (body as { comprobante?: { tipo?: string; serie?: string; numero?: string; fecha?: string; fechaVenc?: string; detraccion?: number } }).comprobante ?? {};
      const serie = c.serie?.trim() || 'F001';
      let numero = c.numero?.trim();
      if (!numero) {
        const [mx] = await db.select({ n: schema.valorizaciones.comprobanteNumero }).from(schema.valorizaciones)
          .where(eq(schema.valorizaciones.comprobanteSerie, serie)).orderBy(desc(schema.valorizaciones.comprobanteNumero)).limit(1);
        numero = String(Number(mx?.n ?? 0) + 1).padStart(8, '0'); // ponytail: correlativo mock; el número real se envía en body.comprobante
      }
      const fechaEmi = c.fecha?.trim() || new Date().toISOString().slice(0, 10);
      comprobante = {
        comprobanteTipo: c.tipo?.trim() || 'factura', comprobanteSerie: serie, comprobanteNumero: numero, comprobanteFecha: fechaEmi,
        comprobanteFechaVenc: c.fechaVenc?.trim() || fechaEmi,
        comprobanteDetraccion: Number(c.detraccion) > 0 ? String(c.detraccion) : null,
      };
    }
  }

  const val = await db.transaction(async (tx) => {
    const [v] = await tx
      .update(schema.valorizaciones)
      .set({ status: estado as (typeof VALO_ESTADOS)[number], updatedAt: new Date(), ...comprobante, ...cuentaIngresoSet })
      .where(eq(schema.valorizaciones.id, req.params.valId!))
      .returning();
    if (!v) return null;
    if (esCobro) {
      // idempotente · no recrear si la valo ya tiene movimiento de cobro
      const [movPrev] = await tx.select({ id: schema.movimientos.id }).from(schema.movimientos).where(eq(schema.movimientos.valorizacionId, v.id)).limit(1);
      if (!movPrev) {
        const cliRow = v.proyectoId
          ? (await tx.select({ cli: schema.clientes.razonSocial }).from(schema.proyectos).leftJoin(schema.clientes, eq(schema.proyectos.clienteId, schema.clientes.id)).where(eq(schema.proyectos.id, v.proyectoId)).limit(1))[0]
          : null;
        const fecha = (body.fechaCobro ? String(body.fechaCobro) : '') || new Date().toISOString().slice(0, 10);
        await tx.insert(schema.movimientos).values({
          fecha,
          proyectoId: v.proyectoId,
          tipoMovimiento: 'Ingreso',
          cuentaId,
          fuenteMovimiento: 'Cliente',
          clienteNombre: cliRow?.cli ?? null,
          moneda: 'PEN',
          monto: v.totalContratista ?? v.montoTotalConIgv ?? v.montoTotal,
          descripcion: `Cobro Valorización N°${v.numero}`,
          subtipo: 'Cobro valorización',
          naturalezaContable: 'COBRO_CLIENTE',
          valorizacionId: v.id,
          estado: 'Cobrada',
          userId: req.user!.id, // H1.2 · trazabilidad
          tipoCambio: '1', montoBase: String(v.totalContratista ?? v.montoTotalConIgv ?? v.montoTotal), // H3.1 · valos en PEN
        });
      }
    }
    return v;
  });
  if (!val) return res.status(404).json({ error: 'Valorización no encontrada' });
  if (esCobro) await audit(req, { action: 'cobro_valo', entityType: 'valorizacion', entityId: val.id, after: { numero: val.numero, total: val.totalContratista ?? val.montoTotalConIgv, cuentaId } });
  res.json({ ok: true, valorizacion: val });
});

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

// ─── F5 · Reconciliación de montos · GET /api/proyectos/:id/reconciliacion ──
// Cruza el Costo Directo entre las 3 fuentes que viven en DB:
//   1. Expediente (proyecto.costoDirecto · viene del Cronograma Valorizado)
//   2. Σ partidas hoja (presupuesto actual en DB · el desglose real)
//   3. Σ valorizaciones (montoCd acumulado ejecutado)
// Epsilon S/ 1.00 · NADA se modifica · solo reporta para revisión (HITL).
const EPSILON_CD = 1.0;
router.get('/:id/reconciliacion', async (req, res) => {
  const proyectoId = req.params.id!;
  const [proyecto] = await db
    .select()
    .from(schema.proyectos)
    .where(and(eq(schema.proyectos.id, proyectoId), isNull(schema.proyectos.deletedAt)))
    .limit(1);
  if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });

  // Fuente 1 · CD del expediente (cronograma)
  const expedienteCd = proyecto.costoDirecto ? Number(proyecto.costoDirecto) : null;

  // Fuente 2 · Σ partidas hoja (no summaries · evita doble conteo de títulos)
  const partidas = await db
    .select({ presupuesto: schema.partidas.presupuesto, isSummary: schema.partidas.isSummary })
    .from(schema.partidas)
    .where(eq(schema.partidas.proyectoId, proyectoId));
  const partidasHoja = partidas.filter((p) => !p.isSummary);
  const partidasCd = partidasHoja.length
    ? partidasHoja.reduce((s, p) => s + Number(p.presupuesto ?? 0), 0)
    : null;

  // Fuente 3 · Σ valorizaciones (CD acumulado ejecutado)
  const vals = await db
    .select({
      montoCd: schema.valorizaciones.montoCd,
      pctAvance: schema.valorizaciones.pctAvance,
      numero: schema.valorizaciones.numero,
      montoInversionAcumulado: schema.valorizaciones.montoInversionAcumulado,
      pctInversionAcumulado: schema.valorizaciones.pctInversionAcumulado,
    })
    .from(schema.valorizaciones)
    .where(eq(schema.valorizaciones.proyectoId, proyectoId))
    .orderBy(asc(schema.valorizaciones.numero));
  const valorizadoCd = vals.length ? vals.reduce((s, v) => s + Number(v.montoCd), 0) : null;
  // Base correcta del valorizado = SUBTOTAL de obra (CD+GG+UT sin IGV). La valorización bruta ya incluye
  // GG+UT (el con-IGV = bruta×1.18, sin sumar GG+UT aparte) → compararla vs CD-solo daba >100% falso.
  // pctAvance de cada valo = montoCd/subtotal, por eso el acumulado (Σ) = avance real; la última valo NO.
  const expedienteSubtotal = proyecto.montoSubtotal != null && Number(proyecto.montoSubtotal) > 0
    ? Number(proyecto.montoSubtotal)
    : expedienteCd; // embebido_cd: subtotal = CD
  const normPct = (n: number) => (n <= 1 ? n * 100 : n); // fracción→%
  const valorizadoPctAcum = vals.length ? vals.reduce((s, v) => s + normPct(Number(v.pctAvance ?? 0)), 0) : null;

  type Check = {
    nombre: string;
    descripcion: string;
    grupo: 'obra' | 'inversion';
    a: { fuente: string; valor: number | null };
    b: { fuente: string; valor: number | null };
    diff: number | null;
    ok: boolean | null; // null = no evaluable (falta una fuente)
    severidad: 'ok' | 'warn' | 'error' | 'na';
  };
  const checks: Check[] = [];

  // Check 1 · Cuadre presupuesto: expediente CD == Σ partidas hoja
  {
    const evaluable = expedienteCd != null && partidasCd != null;
    const diff = evaluable ? Math.abs(expedienteCd! - partidasCd!) : null;
    const ok = evaluable ? diff! <= EPSILON_CD : null;
    checks.push({
      nombre: 'cuadre_presupuesto',
      descripcion: 'CD del expediente debe igualar la suma de partidas hoja',
      grupo: 'obra',
      a: { fuente: 'Expediente (cronograma)', valor: expedienteCd },
      b: { fuente: 'Σ partidas hoja (DB)', valor: partidasCd },
      diff,
      ok,
      severidad: ok === null ? 'na' : ok ? 'ok' : 'error',
    });
  }

  // Check 2 · No sobre-valorización: Σ valorizado (sin IGV, incluye GG+UT) <= subtotal de obra (+epsilon)
  {
    const evaluable = expedienteSubtotal != null && valorizadoCd != null;
    const diff = evaluable ? valorizadoCd! - expedienteSubtotal! : null; // >0 = sobre-valorizado
    const ok = evaluable ? valorizadoCd! <= expedienteSubtotal! + EPSILON_CD : null;
    checks.push({
      nombre: 'no_sobre_valorizacion',
      descripcion: 'El valorizado acumulado (sin IGV) no debe superar el subtotal de obra (CD+GG+UT)',
      grupo: 'obra',
      a: { fuente: 'Σ valorizaciones (sin IGV)', valor: valorizadoCd },
      b: { fuente: 'Subtotal de obra (CD+GG+UT)', valor: expedienteSubtotal },
      diff,
      ok,
      severidad: ok === null ? 'na' : ok ? 'ok' : 'error',
    });
  }

  // Check 3 · Coherencia % avance reportado (acumulado) vs valorizado/subtotal
  {
    const evaluable = expedienteSubtotal != null && valorizadoCd != null && valorizadoPctAcum != null && expedienteSubtotal! > 0;
    const pctCalculado = evaluable ? (valorizadoCd! / expedienteSubtotal!) * 100 : null;
    const pctReportado = valorizadoPctAcum; // acumulado (Σ pctAvance), NO la última valo
    const diff = evaluable && pctReportado != null ? Math.abs(pctCalculado! - pctReportado) : null;
    const ok = diff != null ? diff <= 1.0 : null; // 1 punto porcentual de tolerancia
    checks.push({
      nombre: 'coherencia_pct_avance',
      descripcion: '% avance reportado (acumulado) debe coincidir con Σ valorizado / subtotal de obra',
      grupo: 'obra',
      a: { fuente: '% avance reportado (Σ valos)', valor: pctReportado },
      b: { fuente: '% calculado (Σ val / subtotal)', valor: pctCalculado },
      diff,
      ok,
      severidad: ok === null ? 'na' : ok ? 'ok' : 'warn',
    });
  }

  // ─── Checks INVERSIÓN (monto inversión = obra + mobiliario + ET + supervisiones) ──
  const montoInversion = proyecto.montoReferencial != null ? Number(proyecto.montoReferencial) : null;
  const compCD = proyecto.costoDirecto != null ? Number(proyecto.costoDirecto) : null;
  const compSubtotal = proyecto.montoSubtotal != null ? Number(proyecto.montoSubtotal) : compCD; // CD+GG+UT (=CD si embebido)
  const compIgv = proyecto.montoIgv != null ? Number(proyecto.montoIgv) : null;
  const compMob = proyecto.montoMobiliario != null ? Number(proyecto.montoMobiliario) : 0;
  const compET = proyecto.montoExpedienteTecnico != null ? Number(proyecto.montoExpedienteTecnico) : 0;
  const compSupDoc = proyecto.montoSupervisionExpediente != null ? Number(proyecto.montoSupervisionExpediente) : 0;
  const compSupObra = proyecto.montoSupervisionObra != null ? Number(proyecto.montoSupervisionObra) : 0;
  const distInv = (proyecto.distribucionInversion ?? []) as Array<{ ym: string; monto: number }>;
  const sumDistInv = distInv.length ? distInv.reduce((s, d) => s + Number(d.monto ?? 0), 0) : null;
  const ultVal = vals.length ? vals[vals.length - 1]! : null;
  const inversionAcum = ultVal?.montoInversionAcumulado != null ? Number(ultVal.montoInversionAcumulado) : null;
  const pctInversionReportado = ultVal?.pctInversionAcumulado != null ? Number(ultVal.pctInversionAcumulado) : null;

  // Check 4 · Cuadre estructura inversión
  {
    const sumaComp =
      compSubtotal != null && compIgv != null
        ? compSubtotal + compIgv + compMob + compET + compSupDoc + compSupObra
        : null;
    const evaluable = sumaComp != null && montoInversion != null && montoInversion > 0;
    const diff = evaluable ? Math.abs(sumaComp! - montoInversion!) : null;
    const ok = evaluable ? diff! <= EPSILON_CD : null;
    checks.push({
      nombre: 'cuadre_inversion',
      descripcion: 'Σ componentes (subtotal+IGV+mobiliario+ET+superv) debe igualar el monto de inversión',
      grupo: 'inversion',
      a: { fuente: 'Σ componentes inversión', valor: sumaComp },
      b: { fuente: 'Monto de inversión', valor: montoInversion },
      diff,
      ok,
      severidad: ok === null ? 'na' : ok ? 'ok' : 'error',
    });
  }

  // Check 5 · Plan inversión completo (Σ distribución = monto inversión)
  {
    const evaluable = sumDistInv != null && montoInversion != null && montoInversion > 0;
    const diff = evaluable ? Math.abs(sumDistInv! - montoInversion!) : null;
    const ok = evaluable ? diff! <= EPSILON_CD : null;
    checks.push({
      nombre: 'plan_inversion_completo',
      descripcion: 'La distribución mensual de inversión (PV) debe sumar el monto de inversión total',
      grupo: 'inversion',
      a: { fuente: 'Σ distribución inversión', valor: sumDistInv },
      b: { fuente: 'Monto de inversión', valor: montoInversion },
      diff,
      ok,
      severidad: ok === null ? 'na' : ok ? 'ok' : 'error',
    });
  }

  // Check 6 · No sobre-ejecución inversión
  {
    const evaluable = inversionAcum != null && montoInversion != null && montoInversion > 0;
    const diff = evaluable ? inversionAcum! - montoInversion! : null; // >0 = sobre-ejecutado
    const ok = evaluable ? inversionAcum! <= montoInversion! + EPSILON_CD : null;
    checks.push({
      nombre: 'no_sobre_ejecucion_inversion',
      descripcion: 'El monto de inversión ejecutado acumulado no debe superar el monto de inversión total',
      grupo: 'inversion',
      a: { fuente: 'Inversión ejecutada (última val)', valor: inversionAcum },
      b: { fuente: 'Monto de inversión', valor: montoInversion },
      diff,
      ok,
      severidad: ok === null ? 'na' : ok ? 'ok' : 'error',
    });
  }

  // Check 7 · Coherencia % inversión oficial
  {
    const evaluable = inversionAcum != null && montoInversion != null && montoInversion > 0 && pctInversionReportado != null;
    const pctCalculado = evaluable ? (inversionAcum! / montoInversion!) * 100 : null;
    const diff = evaluable ? Math.abs(pctCalculado! - pctInversionReportado!) : null;
    const ok = diff != null ? diff <= 1.0 : null; // 1 punto de tolerancia
    checks.push({
      nombre: 'coherencia_pct_inversion',
      descripcion: '% avance de inversión reportado (Excel) debe coincidir con ejecutado / monto de inversión',
      grupo: 'inversion',
      a: { fuente: '% inversión reportado (Excel)', valor: pctInversionReportado },
      b: { fuente: '% calculado (ejec / monto inversión)', valor: pctCalculado },
      diff,
      ok,
      severidad: ok === null ? 'na' : ok ? 'ok' : 'warn',
    });
  }

  // Check 8 · Inversión ⊇ obra (sanity · inversión ejecutada incluye la obra)
  {
    const evaluable = inversionAcum != null && valorizadoCd != null;
    const diff = evaluable ? inversionAcum! - valorizadoCd! : null; // >=0 esperado
    const ok = evaluable ? inversionAcum! >= valorizadoCd! - EPSILON_CD : null;
    checks.push({
      nombre: 'inversion_incluye_obra',
      descripcion: 'La inversión ejecutada debe ser mayor o igual al CD de obra ejecutado (lo incluye)',
      grupo: 'inversion',
      a: { fuente: 'Inversión ejecutada', valor: inversionAcum },
      b: { fuente: 'Σ valorizaciones CD (obra)', valor: valorizadoCd },
      diff,
      ok,
      severidad: ok === null ? 'na' : ok ? 'ok' : 'warn',
    });
  }

  const discrepancias = checks.filter((c) => c.ok === false);
  res.json({
    ok: discrepancias.length === 0,
    epsilon: EPSILON_CD,
    proyecto: { id: proyecto.id, codigo: proyecto.codigo, nombre: proyecto.nombre, ggUtModo: proyecto.ggUtModo },
    fuentes: {
      expedienteCd,
      partidasCd,
      partidasHoja: partidasHoja.length,
      valorizadoCd,
      expedienteSubtotal,
      pctAvanceAcum: valorizadoPctAcum,
      valorizaciones: vals.length,
      inversion: {
        montoInversion,
        componentes: {
          subtotal: compSubtotal,
          igv: compIgv,
          mobiliario: compMob,
          expedienteTecnico: compET,
          supervisionExpediente: compSupDoc,
          supervisionObra: compSupObra,
        },
        sumDistribucion: sumDistInv,
        inversionAcum,
        pctInversionReportado,
      },
    },
    checks,
    discrepancias: discrepancias.map((d) => d.nombre),
  });
});

// ─── P&L por obra · "mi bolsillo" · GET /api/proyectos/:id/pnl ──
// Ingreso = Σ valorizaciones montoCd (V sin IGV) · Egreso = Σ OC comprometidas (subtotal sin IGV)
// Utilidad = ingreso − egreso · Mi utilidad = utilidad × pctParticipacionPropia
const OC_EGRESO_ESTADOS = new Set(['aprobada', 'emitida', 'en_transito', 'entregada']);
router.get('/:id/pnl', async (req, res) => {
  const proyectoId = req.params.id!;
  const [proyecto] = await db
    .select()
    .from(schema.proyectos)
    .where(and(eq(schema.proyectos.id, proyectoId), isNull(schema.proyectos.deletedAt)))
    .limit(1);
  if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });

  // Ingresos (valos) · egresos (OC) · costo real (gastos) · 3 queries independientes en paralelo
  const [vals, ocs, gs] = await Promise.all([
    db.select({ montoCd: schema.valorizaciones.montoCd, numero: schema.valorizaciones.numero }).from(schema.valorizaciones).where(eq(schema.valorizaciones.proyectoId, proyectoId)),
    db.select({ subtotal: schema.ordenesCompra.subtotalSinIgv, total: schema.ordenesCompra.total, estado: schema.ordenesCompra.estado, concepto: schema.ordenesCompra.concepto }).from(schema.ordenesCompra).where(eq(schema.ordenesCompra.proyectoId, proyectoId)),
    db.select({ subtotal: schema.gastos.subtotal, tipoGasto: schema.gastos.tipoGasto }).from(schema.gastos).where(eq(schema.gastos.proyectoId, proyectoId)),
  ]);
  const ingresos = vals.reduce((s, v) => s + Number(v.montoCd ?? 0), 0);
  const ocsComprometidas = ocs.filter((o) => OC_EGRESO_ESTADOS.has(o.estado));
  const comprometido = ocsComprometidas.reduce((s, o) => s + Number(o.subtotal ?? 0), 0);
  const egresosBien = ocsComprometidas.filter((o) => o.concepto === 'BIEN').reduce((s, o) => s + Number(o.subtotal ?? 0), 0);
  const egresosServicio = ocsComprometidas.filter((o) => o.concepto === 'SERVICIO').reduce((s, o) => s + Number(o.subtotal ?? 0), 0);
  const costoReal = gs.reduce((s, g) => s + Number(g.subtotal ?? 0), 0);
  // Desglose de costo real por rubro (tipoGasto) · drill-down en el tab Financiero
  const costoPorTipo: Record<string, number> = {};
  for (const g of gs) {
    const t = (g.tipoGasto && String(g.tipoGasto).trim()) || 'Otros';
    costoPorTipo[t] = (costoPorTipo[t] ?? 0) + Number(g.subtotal ?? 0);
  }

  // Utilidad sobre COSTO REAL (no compromiso) · si no hay gastos aún, costoReal=0
  const utilidad = ingresos - costoReal;
  const miPct = proyecto.pctParticipacionPropia != null ? Number(proyecto.pctParticipacionPropia) : 1;
  // Modelo B · "mi bolsillo": ingreso mi% − costo real completo
  const miUtilidad = ingresos * miPct - costoReal;
  const margenPct = ingresos > 0 ? (utilidad / ingresos) * 100 : 0;
  // Índice de rentabilidad · ingreso / costo real (>1 = ganando)
  const indiceRent = costoReal > 0 ? ingresos / costoReal : null;

  res.json({
    proyecto: { id: proyecto.id, codigo: proyecto.codigo, nombre: proyecto.nombre },
    ingresos: { total: ingresos, valorizaciones: vals.length },
    costoReal: { total: costoReal, gastos: gs.length, porTipo: costoPorTipo },
    comprometido: { total: comprometido, ordenes: ocsComprometidas.length, bien: egresosBien, servicio: egresosServicio, ordenesTotal: ocs.length },
    // egresos mantenido para compat · ahora = costo real
    egresos: { total: costoReal, ordenes: ocsComprometidas.length, bien: egresosBien, servicio: egresosServicio, ordenesTotal: ocs.length },
    utilidad,
    margenPct,
    indiceRent,
    miPct,
    miUtilidad,
  });
});

// GET /api/proyectos/:id/partidas-costos · ejecutado (valos) + comprometido (OC) por partida
// Para control de costos en PartidasTab: presupuesto vs ejecutado vs comprometido
router.get('/:id/partidas-costos', async (req, res) => {
  const proyectoId = req.params.id!;
  // 2 cadenas independientes (valos→vparts · ocs→líneas) en paralelo
  const [vparts, { ocs, lineas }] = await Promise.all([
    (async () => {
      const vals = await db.select({ id: schema.valorizaciones.id }).from(schema.valorizaciones).where(eq(schema.valorizaciones.proyectoId, proyectoId));
      const valIds = vals.map((v) => v.id);
      return valIds.length
        ? db.select({ partidaId: schema.valorizacionesPartidas.partidaId, montoAcumulado: schema.valorizacionesPartidas.montoAcumulado }).from(schema.valorizacionesPartidas).where(inArray(schema.valorizacionesPartidas.valorizacionId, valIds))
        : [];
    })(),
    (async () => {
      const ocs = await db.select({ id: schema.ordenesCompra.id, estado: schema.ordenesCompra.estado }).from(schema.ordenesCompra).where(eq(schema.ordenesCompra.proyectoId, proyectoId));
      const ocIds = ocs.map((o) => o.id);
      const lineas = ocIds.length
        ? await db.select({ partidaId: schema.ocLineas.partidaId, ordenCompraId: schema.ocLineas.ordenCompraId, subtotal: schema.ocLineas.subtotal }).from(schema.ocLineas).where(inArray(schema.ocLineas.ordenCompraId, ocIds))
        : [];
      return { ocs, lineas };
    })(),
  ]);
  const EG = new Set(['aprobada', 'emitida', 'en_transito', 'entregada']);
  const ocComprometidas = new Set(ocs.filter((o) => EG.has(o.estado)).map((o) => o.id));

  // ejecutado = MAX(montoAcumulado) por partida (acumulado es monótono)
  const ejecutado = new Map<string, number>();
  for (const vp of vparts) {
    const cur = ejecutado.get(vp.partidaId) ?? 0;
    ejecutado.set(vp.partidaId, Math.max(cur, Number(vp.montoAcumulado ?? 0)));
  }
  // comprometido = Σ subtotal de líneas OC comprometidas, por partida
  const comprometido = new Map<string, number>();
  for (const l of lineas) {
    if (!l.partidaId || !ocComprometidas.has(l.ordenCompraId)) continue;
    comprometido.set(l.partidaId, (comprometido.get(l.partidaId) ?? 0) + Number(l.subtotal ?? 0));
  }

  const partidaIds = new Set([...ejecutado.keys(), ...comprometido.keys()]);
  const costos: Record<string, { ejecutado: number; comprometido: number }> = {};
  for (const pid of partidaIds) {
    costos[pid] = { ejecutado: ejecutado.get(pid) ?? 0, comprometido: comprometido.get(pid) ?? 0 };
  }
  res.json({ costos });
});

// GET /api/proyectos/:id/cashflow · flujo de caja real (con IGV) mensual + saldo acumulado
// Entradas: adelantos + valos (totalContratista) + devolución retención (en hito liquidación)
// Salidas: OC comprometidas (total c/IGV) + IGV neto a SUNAT (IGV ventas − IGV compras)
router.get('/:id/cashflow', async (req, res) => {
  const proyectoId = req.params.id!;
  const [proyecto] = await db
    .select()
    .from(schema.proyectos)
    .where(and(eq(schema.proyectos.id, proyectoId), isNull(schema.proyectos.deletedAt)))
    .limit(1);
  if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });

  const [adelantos, vals, ocs, hitos] = await Promise.all([
    db.select().from(schema.adelantos).where(eq(schema.adelantos.proyectoId, proyectoId)),
    db.select().from(schema.valorizaciones).where(eq(schema.valorizaciones.proyectoId, proyectoId)),
    db.select().from(schema.ordenesCompra).where(eq(schema.ordenesCompra.proyectoId, proyectoId)),
    db.select().from(schema.hitosObra).where(eq(schema.hitosObra.proyectoId, proyectoId)),
  ]);

  const EG = new Set(['aprobada', 'emitida', 'en_transito', 'entregada']);
  const ADEL_OK = new Set(['aprobado', 'pagado', 'amortizado']);
  const ym = (d: string | null | undefined) => (d ? String(d).slice(0, 7) : null);

  type Bucket = { ym: string; adelantos: number; valos: number; devolucionRetencion: number; compras: number; igvSunat: number };
  const map = new Map<string, Bucket>();
  const bk = (k: string): Bucket => {
    let b = map.get(k);
    if (!b) { b = { ym: k, adelantos: 0, valos: 0, devolucionRetencion: 0, compras: 0, igvSunat: 0 }; map.set(k, b); }
    return b;
  };

  // Adelantos (entrada)
  for (const a of adelantos) {
    if (!ADEL_OK.has(a.estado)) continue;
    const k = ym(a.fechaPago) ?? ym(a.fechaSolicitud);
    if (k) bk(k).adelantos += Number(a.monto ?? 0);
  }

  // Valos · entrada neta (totalContratista) + IGV ventas para SUNAT
  // El flujo es PROYECTADO (se ubica por mesPeriodo, no por fecha de cobro real).
  // Separamos cuánto ya está cobrado (status=cobrada) vs por cobrar, para mostrarlo honesto.
  let retencionAcum = 0;
  let valosCobrado = 0;
  let valosPendiente = 0;
  for (const v of vals) {
    const k = v.mesPeriodo ?? ym(v.fechaHasta);
    if (!k) continue;
    const neto = Number(v.totalContratista ?? 0) || Number(v.montoTotalConIgv ?? 0) || Number(v.montoCd ?? 0) * 1.18;
    bk(k).valos += neto;
    bk(k).igvSunat += Number(v.montoIgv ?? 0); // IGV ventas (lo debes a SUNAT)
    retencionAcum += Number(v.montoRetencion ?? 0);
    if (v.status === 'cobrada') valosCobrado += neto;
    else valosPendiente += neto;
  }

  // OC · salida (total c/IGV) − IGV compras (crédito fiscal reduce SUNAT)
  for (const o of ocs) {
    if (!EG.has(o.estado)) continue;
    const k = ym(o.fechaEmision);
    if (!k) continue;
    bk(k).compras += Number(o.total ?? 0);
    bk(k).igvSunat -= Number(o.igv ?? 0); // crédito fiscal
  }

  // Devolución de retención · en hito liquidación/consentimiento
  const hitoLiq = hitos.find((h) => h.tipo === 'consentimiento_liquidacion') ?? hitos.find((h) => h.tipo === 'liquidacion');
  if (hitoLiq && retencionAcum > 0) {
    const k = ym(hitoLiq.fecha);
    if (k) bk(k).devolucionRetencion += retencionAcum;
  }

  // Ordenar + rellenar meses + saldo acumulado
  const keys = [...map.keys()].sort();
  const buckets: Array<Bucket & { entradas: number; salidas: number; neto: number; saldoAcum: number }> = [];
  let saldo = 0;
  for (const k of keys) {
    const b = map.get(k)!;
    const igvOut = Math.max(0, b.igvSunat); // solo si neto positivo se paga
    const entradas = b.adelantos + b.valos + b.devolucionRetencion;
    const salidas = b.compras + igvOut;
    const neto = entradas - salidas;
    saldo += neto;
    buckets.push({ ...b, igvSunat: igvOut, entradas, salidas, neto, saldoAcum: saldo });
  }

  res.json({
    proyecto: { id: proyecto.id, codigo: proyecto.codigo, nombre: proyecto.nombre },
    buckets,
    totales: {
      entradas: buckets.reduce((s, b) => s + b.entradas, 0),
      salidas: buckets.reduce((s, b) => s + b.salidas, 0),
      saldoFinal: saldo,
      retencionAcum,
      retencionDevuelta: hitoLiq != null && retencionAcum > 0,
      valosCobrado,
      valosPendiente,
    },
  });
});

// PATCH /api/proyectos/:id/participacion · setear mi % de participación (0..1)
router.patch('/:id/participacion', async (req, res) => {
  const pct = Number((req.body as { pct?: unknown }).pct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 1) {
    return res.status(400).json({ error: 'pct debe estar entre 0 y 1 (ej. 0.5 = 50%)' });
  }
  const [proyecto] = await db
    .update(schema.proyectos)
    .set({ pctParticipacionPropia: pct.toFixed(4), updatedAt: new Date() })
    .where(eq(schema.proyectos.id, req.params.id))
    .returning();
  if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });
  res.json({ ok: true, pctParticipacionPropia: proyecto.pctParticipacionPropia });
});

// ════════ CIERRE DE OBRA · checklist "prueba de cierre" + gate ════════
// Fuente única: la usa el GET (mostrar) y el POST (re-valida antes de cerrar · nunca confiar en el cliente).
const CIERRE_TOL = 0.01;
async function buildCierreChecklist(proyectoId: string) {
  const [proyecto] = await db.select().from(schema.proyectos).where(and(eq(schema.proyectos.id, proyectoId), isNull(schema.proyectos.deletedAt))).limit(1);
  if (!proyecto) return null;
  const [hitos, garantias, adelantos, vals] = await Promise.all([
    db.select().from(schema.hitosObra).where(eq(schema.hitosObra.proyectoId, proyectoId)),
    db.select().from(schema.garantias).where(eq(schema.garantias.proyectoId, proyectoId)),
    db.select().from(schema.adelantos).where(eq(schema.adelantos.proyectoId, proyectoId)),
    db.select().from(schema.valorizaciones).where(eq(schema.valorizaciones.proyectoId, proyectoId)),
  ]);
  const hito = (t: string) => hitos.find((h) => h.tipo === t);
  const fechaDe = (t: string) => hito(t)?.fecha ?? null;

  const garVigentes = garantias.filter((g) => g.estado === 'vigente');
  const retencionVigente = garVigentes.filter((g) => g.tipo === 'retencion' || g.tipo === 'fiel_cumplimiento');
  // Retención real = Σ retención de las valos. Solo se LIBERA legalmente al consentir la liquidación;
  // el flag manual de la garantía (estado=devuelta) no basta ni debe pintar verde antes del consentimiento.
  const consentido = !!hito('consentimiento_liquidacion');
  const retencionValos = vals.reduce((s, v) => s + Number(v.montoRetencion ?? 0), 0);
  const retencionPendiente = retencionValos > CIERRE_TOL && !consentido;
  // Amortización real = desde las valos (Σ montoAmortizaciones), no el montoAmortizado manual (puede estar desactualizado).
  // MAX(manual, valos) evita regresión si se amortizó fuera de valo, y evita doble conteo.
  const totalAdelantos = adelantos.reduce((s, a) => s + Number(a.monto ?? 0), 0);
  const amortizadoManual = adelantos.reduce((s, a) => s + Number(a.montoAmortizado ?? 0), 0);
  const amortizadoValos = vals.reduce((s, v) => s + Number(v.montoAmortizaciones ?? 0), 0);
  const adelSaldo = totalAdelantos - Math.max(amortizadoManual, amortizadoValos);
  const sumMonto = (gs: Array<{ monto: string | null }>) => gs.reduce((s, g) => s + Number(g.monto ?? 0), 0);

  const vigente = Number(proyecto.montoVigente ?? 0) || Number(proyecto.montoContractual ?? 0);
  const valorizadoConIgv = vals.reduce((s, v) => s + (Number(v.montoTotalConIgv ?? 0) || Number(v.totalContratista ?? 0) || Number(v.montoValorizacionBruta ?? 0) * 1.18), 0);

  const items = [
    { key: 'culminacion', label: 'Culminación de obra', ok: !!hito('culminacion'), detail: fechaDe('culminacion') ?? 'sin registrar' },
    { key: 'recepcion', label: 'Recepción de obra', ok: !!hito('recepcion'), detail: fechaDe('recepcion') ?? 'sin registrar' },
    { key: 'liquidacion', label: 'Liquidación practicada', ok: !!hito('liquidacion'), detail: fechaDe('liquidacion') ?? 'sin registrar' },
    { key: 'consentimiento', label: 'Consentimiento de liquidación', ok: !!hito('consentimiento_liquidacion'), detail: fechaDe('consentimiento_liquidacion') ?? 'sin registrar' },
    { key: 'adelantos', label: 'Adelantos amortizados', ok: adelSaldo <= CIERRE_TOL, detail: adelSaldo > CIERRE_TOL ? `saldo S/ ${adelSaldo.toLocaleString('es-PE', { minimumFractionDigits: 2 })}` : 'sin saldo' },
    { key: 'garantias', label: 'Garantías devueltas', ok: garVigentes.length === 0, detail: garVigentes.length ? `${garVigentes.length} vigente(s)` : 'ninguna vigente' },
    { key: 'retencion', label: 'Retención liberada', ok: !retencionPendiente && retencionVigente.length === 0, detail: retencionPendiente ? `S/ ${retencionValos.toLocaleString('es-PE', { minimumFractionDigits: 2 })} pendiente · falta consentimiento` : retencionVigente.length ? `S/ ${sumMonto(retencionVigente).toLocaleString('es-PE', { minimumFractionDigits: 2 })} sin liberar` : 'liberada' },
    { key: 'valorizado', label: 'Valorizado al 100%', ok: vigente > 0 && valorizadoConIgv >= vigente - Math.max(CIERRE_TOL, vigente * 0.005), detail: vigente > 0 ? `${((valorizadoConIgv / vigente) * 100).toFixed(1)}%` : '—' },
  ];
  // Gate duro: hitos de cierre + sin pendientes financieros. 'valorizado' es informativo (un deductivo puede dejarlo <100% legítimamente).
  const GATE = new Set(['culminacion', 'recepcion', 'liquidacion', 'consentimiento', 'adelantos', 'garantias', 'retencion']);
  const canClose = items.filter((i) => GATE.has(i.key)).every((i) => i.ok);
  const veredicto = proyecto.status === 'cerrado' ? 'CERRADA'
    : canClose ? 'LISTA PARA CERRAR'
    : hito('recepcion') ? 'EN LIQUIDACIÓN'
    : 'EN EJECUCIÓN';
  const faltantes = items.filter((i) => GATE.has(i.key) && !i.ok).map((i) => i.label);
  return { status: proyecto.status, veredicto, canClose, items, faltantes, valorizadoConIgv, vigente };
}

// GET /:id/cierre · checklist de prueba de cierre (solo lectura)
router.get('/:id/cierre', async (req, res) => {
  const data = await buildCierreChecklist(req.params.id!);
  if (!data) return res.status(404).json({ error: 'Proyecto no encontrado' });
  res.json(data);
});

// POST /:id/cerrar · re-valida el gate y marca la obra cerrada (auditado)
router.post('/:id/cerrar', async (req, res) => {
  const proyectoId = req.params.id!;
  const data = await buildCierreChecklist(proyectoId);
  if (!data) return res.status(404).json({ error: 'Proyecto no encontrado' });
  if (data.status === 'cerrado') return res.status(409).json({ error: 'La obra ya está cerrada' });
  if (!data.canClose) return res.status(422).json({ error: 'No cumple el gate de cierre', faltantes: data.faltantes });
  const [proyecto] = await db.update(schema.proyectos)
    .set({ status: 'cerrado', updatedAt: new Date() })
    .where(eq(schema.proyectos.id, proyectoId)).returning();
  await audit(req, { action: 'cerrar_obra', entityType: 'proyecto', entityId: proyectoId, before: { status: data.status }, after: { status: 'cerrado' } });
  res.json({ ok: true, status: proyecto.status });
});

export default router;
