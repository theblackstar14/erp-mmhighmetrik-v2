/**
 * Parser Excel valorización S10 · 9 hojas estándar:
 *   RES. VALO · cabecera + V/R/D/A/VN/IGV/Retención/Total
 *   FICHA · ficha técnica
 *   C.G. AVANCE DE OBRA · curva general
 *   VALO N · detalle metrado por partida
 *   SUSTENTO METRADOS
 *   RES. MET. EJEC.
 *   CURVA S
 *   K · cálculo coeficiente K + IUs Io/Ir
 *   Reajuste · V-real, V-prog, reajuste real/prog/reconocido/pagado
 *
 * Extrae:
 *   - Cabecera: V, R, D, VB, A, VN, multa, IGV, retención, total
 *   - K: monomios + IUs (Io, Ir) + K calculado
 *   - Reajuste: V-real, V-prog, reajuste real/prog/reconocido/pagado, acum
 *   - VALO N: partidas con metrados ant/actual/acum + montos
 */
import * as XLSX from 'xlsx';

export interface ValMonomioIu {
  iuCodigo: string;
  descripcion: string;
  pesoPorcentual: number; // 100 si único
  io: number;
  ir: number;
}

export interface ValMonomio {
  numero: number;
  simbolo: string;
  descripcion: string;
  coeficiente: number;
  ius: ValMonomioIu[];
}

export interface ValCurvaPunto {
  label: string; // 'INICIO' o '2025-10'
  fecha: string | null; // ISO date
  pctProgMes: number; // porcentaje (0-100)
  pctProgAcum: number;
  pctEjecMes: number;
  pctEjecAcum: number;
}

export interface ValPartida {
  codigo: string;
  descripcion: string;
  unidad: string | null;
  metradoContractual: number;
  precioUnitario: number;
  subTotal: number;
  metradoAnterior: number;
  valorAnterior: number;
  pctAnterior: number;
  metradoActual: number;
  valorActual: number;
  pctActual: number;
  metradoAcumulado: number;
  valorAcumulado: number;
  pctAcumulado: number;
  metradoSaldo: number;
  valorSaldo: number;
  pctSaldo: number;
}

export interface ValParseResult {
  numero: number;
  mesPeriodo: string; // 2025-10
  fechaDesde: string | null;
  fechaHasta: string | null;
  // RES. VALO
  valorizacion: number; // V
  reajustes: number; // R (suele ser 0 si Reajuste Presente = 0)
  deducciones: number; // D
  valorizacionBruta: number; // VB
  amortizaciones: number;
  valorizacionNeta: number; // VN
  multa: number;
  montoPagarSinIgv: number;
  igv: number;
  montoTotalConIgv: number;
  retencion: number;
  totalContratista: number;
  // Reajuste
  vReal: number | null;
  vProgramado: number | null;
  kMenosUno: number | null;
  reajusteReal: number | null;
  reajusteProgramado: number | null;
  reajusteReconocido: number | null;
  reajustePagado: number | null;
  vrConReajuste: number | null;
  reajusteAcumAnterior: number;
  reajusteAcumActual: number;
  reajustePresente: number;
  condicion: string | null;
  // K
  kCalculado: number | null;
  monomios: ValMonomio[];
  // Partidas
  partidas: ValPartida[];
  // Curva S
  curvaS: ValCurvaPunto[];
  // Metadata
  obra: string | null;
  asNumero: string | null;
  entidad: string | null;
  contratista: string | null;
  pptoBase: number | null;
  pptoContratado: number | null;
  fechaPresupuestoBase: string | null;
  warnings: string[];
  errors: string[];
}

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = Number.parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v).trim() || null;
}

function dateToMonth(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}`;
  }
  return null;
}

function blankVal(): ValParseResult {
  return {
    numero: 0,
    mesPeriodo: '',
    fechaDesde: null,
    fechaHasta: null,
    valorizacion: 0,
    reajustes: 0,
    deducciones: 0,
    valorizacionBruta: 0,
    amortizaciones: 0,
    valorizacionNeta: 0,
    multa: 0,
    montoPagarSinIgv: 0,
    igv: 0,
    montoTotalConIgv: 0,
    retencion: 0,
    totalContratista: 0,
    vReal: null,
    vProgramado: null,
    kMenosUno: null,
    reajusteReal: null,
    reajusteProgramado: null,
    reajusteReconocido: null,
    reajustePagado: null,
    vrConReajuste: null,
    reajusteAcumAnterior: 0,
    reajusteAcumActual: 0,
    reajustePresente: 0,
    condicion: null,
    kCalculado: null,
    monomios: [],
    partidas: [],
    curvaS: [],
    obra: null,
    asNumero: null,
    entidad: null,
    contratista: null,
    pptoBase: null,
    pptoContratado: null,
    fechaPresupuestoBase: null,
    warnings: [],
    errors: [],
  };
}

// Hojas que delatan el template S10 rico (9 hojas). Si faltan todas → formato simple (1 hoja).
const HOJAS_S10_RICO = ['RES. VALO', 'K', 'Reajuste', 'CURVA S'];

/** true si el .xlsx es valorización de 1 hoja (formato MM "VAL SMP"), no el S10 rico de 9 hojas. */
export function valEsFormatoSimple(buffer: Buffer): boolean {
  const wb = XLSX.read(buffer, { type: 'buffer', bookSheets: true });
  return !HOJAS_S10_RICO.some((n) => wb.SheetNames.includes(n));
}

export function parseValorizacionXlsx(buffer: Buffer): ValParseResult {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  // Formato simple (1 hoja "VAL SMP") · sin las hojas del S10 rico → parser dedicado.
  if (!HOJAS_S10_RICO.some((n) => wb.Sheets[n])) return parseValSmp(wb);

  const result: ValParseResult = blankVal();

  // ─── 1. RES. VALO ──────────────────────────────────────────
  const sResVal = wb.Sheets['RES. VALO'];
  if (sResVal) {
    const a = XLSX.utils.sheet_to_json<unknown[]>(sResVal, { header: 1, defval: null, raw: true });

    // Title row · busco regex
    for (let i = 0; i < Math.min(5, a.length); i++) {
      const t = String(a[i]?.[0] ?? '');
      const m = t.match(/N°\s*(\d+)/i);
      if (m) {
        result.numero = Number(m[1]);
        break;
      }
    }

    // MES · label en col 0
    for (let i = 0; i < Math.min(10, a.length); i++) {
      const lbl = String(a[i]?.[0] ?? '').trim().toUpperCase();
      if (lbl.startsWith('MES')) {
        const d = a[i]?.[1];
        if (d instanceof Date) {
          result.mesPeriodo = dateToMonth(d) ?? '';
          result.fechaDesde = d.toISOString().slice(0, 10);
        }
        break;
      }
    }

    // Filas tabla · cols 0=item, 1=concepto, 2=monto
    for (let i = 9; i < Math.min(40, a.length); i++) {
      const row = a[i] ?? [];
      const item = String(row[0] ?? '').trim();
      const concepto = String(row[1] ?? '').trim().toUpperCase();
      const monto = toNum(row[2]);

      // 1 = V (en col 1)
      if (item === '1' && /VALORIZ/.test(concepto)) result.valorizacion = monto;
      else if (item === '2' && /REAJUST/.test(concepto)) result.reajustes = monto;
      else if (/TOTAL DEDUCCIONES/.test(concepto)) result.deducciones = monto;
      else if (/VALORIZACI[ÓO]N BRUTA/.test(concepto)) result.valorizacionBruta = monto;
      else if (/TOTAL.*AMORTIZACIONES/.test(concepto)) result.amortizaciones = monto;
      // VN row · label "VALORIZACIÓN NETA" en col 0
      else if (/VALORIZACI[ÓO]N NETA/.test(item.toUpperCase()) || /VALORIZACI[ÓO]N NETA/.test(concepto))
        result.valorizacionNeta = monto;
      else if (item === '5.1' && /MULTA/.test(concepto)) result.multa = monto;
      else if (item === '5.2' && /PAGAR/.test(concepto)) result.montoPagarSinIgv = monto;
      // IGV label en col 0
      else if (/^IGV/.test(item)) result.igv = monto;
      else if (/MONTO TOTAL A PAGAR/.test(concepto)) result.montoTotalConIgv = monto;
      else if (item === '5.3' && /RETENCION/.test(concepto)) result.retencion = monto;
      else if (/TOTAL A PAGAR AL CONTRATISTA/.test(item.toUpperCase())) result.totalContratista = monto;
    }
  } else {
    result.warnings.push('Hoja "RES. VALO" no encontrada');
  }

  // ─── 2. K (cálculo coeficiente) ─────────────────────────────
  const sK = wb.Sheets['K'];
  if (sK) {
    const a = XLSX.utils.sheet_to_json<unknown[]>(sK, { header: 1, defval: null, raw: true });

    // Metadata
    for (let i = 0; i < 12; i++) {
      const lbl = String(a[i]?.[0] ?? '').trim();
      if (lbl.startsWith('OBRA')) result.obra = toStr(a[i]?.[2]);
      else if (lbl.startsWith('AS')) result.asNumero = toStr(a[i]?.[2]);
      else if (lbl.startsWith('ENTIDAD')) result.entidad = toStr(a[i]?.[2]);
      else if (lbl.startsWith('PPTO. BASE')) result.pptoBase = toNum(a[i]?.[2]);
      else if (lbl.startsWith('PRESUPUESTO CONTRATADO')) result.pptoContratado = toNum(a[i]?.[2]);
      else if (lbl.startsWith('FECHA DE PRESUPUESTO BASE')) {
        const d = a[i]?.[2];
        if (d instanceof Date) result.fechaPresupuestoBase = d.toISOString().slice(0, 10);
      }
    }

    // Monomios · header row 15 (índice 15) · data desde row 17
    let monomioActual: ValMonomio | null = null;
    for (let i = 17; i < Math.min(30, a.length); i++) {
      const numStr = toStr(a[i]?.[0]);
      const iuCod = toStr(a[i]?.[1]);
      const desc = toStr(a[i]?.[2]) ?? '';
      const simb = toStr(a[i]?.[3]);
      const coef = toNum(a[i]?.[4]);
      const peso = toNum(a[i]?.[5]);
      const io = toNum(a[i]?.[6]);
      const ir = toNum(a[i]?.[7]);

      // Fila K= sub-totales
      if (simb === 'K=' || String(a[i]?.[3] ?? '').includes('K=')) break;

      if (!iuCod) continue;

      if (numStr && coef > 0) {
        // Nuevo monomio
        monomioActual = {
          numero: Number(numStr),
          simbolo: simb ?? '',
          descripcion: desc,
          coeficiente: coef,
          ius: [],
        };
        result.monomios.push(monomioActual);
        monomioActual.ius.push({
          iuCodigo: iuCod.padStart(2, '0'),
          descripcion: desc,
          pesoPorcentual: peso * 100, // viene como 1.0 o 0.87263
          io,
          ir,
        });
      } else if (monomioActual) {
        // Sub-IU del monomio compuesto (ej DM-MD)
        monomioActual.ius.push({
          iuCodigo: iuCod.padStart(2, '0'),
          descripcion: desc,
          pesoPorcentual: peso * 100,
          io,
          ir,
        });
      }
    }

    // K calculado · busca celda con "K=" y captura valor
    for (let i = 22; i < Math.min(28, a.length); i++) {
      if (String(a[i]?.[3] ?? '').includes('K=')) {
        // En esta fila pueden estar varios K (un Ir por mes). Tomo el último numérico col >= 4
        const row = a[i] ?? [];
        let k: number | null = null;
        for (let c = row.length - 1; c >= 4; c--) {
          const v = row[c];
          if (typeof v === 'number' && v > 0) {
            k = v;
            break;
          }
        }
        result.kCalculado = k;
        break;
      }
    }
  } else {
    result.warnings.push('Hoja "K" no encontrada');
  }

  // ─── 3. Reajuste ────────────────────────────────────────────
  const sR = wb.Sheets['Reajuste'];
  if (sR) {
    const a = XLSX.utils.sheet_to_json<unknown[]>(sR, { header: 1, defval: null, raw: true });

    // Buscar fila datos (después de headers MESES/VAL N°/V-REAL/...)
    // Encabezado en row 18-21. Datos típicamente row 22-24.
    for (let i = 21; i < Math.min(28, a.length); i++) {
      const valN = a[i]?.[1];
      if (typeof valN === 'number' && valN >= 1) {
        // Fila valorización
        result.vReal = toNum(a[i]?.[2]);
        result.vProgramado = toNum(a[i]?.[3]);
        result.kMenosUno = toNum(a[i]?.[4]);
        result.reajusteReal = toNum(a[i]?.[5]);
        result.reajusteProgramado = toNum(a[i]?.[6]);
        result.reajusteReconocido = toNum(a[i]?.[7]);
        result.vrConReajuste = toNum(a[i]?.[8]);
        result.reajustePagado = toNum(a[i]?.[9]);
        break;
      }
    }

    // Condición + acumulados (rows 25-29)
    for (let i = 25; i < Math.min(35, a.length); i++) {
      const row = a[i] ?? [];
      const lbl = String(row[2] ?? '').toUpperCase();
      if (lbl.startsWith('CONDICION')) result.condicion = toStr(row[5]);
      else if (lbl.includes('REAJUSTE ACUMULADO ACTUAL')) result.reajusteAcumActual = toNum(row[5]);
      else if (lbl.includes('REAJUSTE ACUMULADO ANTERIOR')) result.reajusteAcumAnterior = toNum(row[5]);
      else if (lbl.includes('REAJUSTE PRESENTE')) result.reajustePresente = toNum(row[5]);
    }
  } else {
    result.warnings.push('Hoja "Reajuste" no encontrada');
  }

  // ─── 4. CURVA S (programado + ejecutado mensual) ───────────
  const sCS = wb.Sheets['CURVA S'];
  if (sCS) {
    const a = XLSX.utils.sheet_to_json<unknown[]>(sCS, { header: 1, defval: null, raw: true });
    // Buscar fila INICIO en col 3
    for (let i = 0; i < a.length; i++) {
      const row = a[i] ?? [];
      const lbl = String(row[3] ?? '').trim();
      if (lbl !== 'INICIO' && !(row[3] instanceof Date)) continue;

      const pctProgMes = toNum(row[4]) * 100;
      const pctProgAcum = toNum(row[5]) * 100;
      const pctEjecMes = toNum(row[6]) * 100;
      const pctEjecAcum = toNum(row[7]) * 100;

      let label = lbl;
      let fecha: string | null = null;
      if (row[3] instanceof Date) {
        const d = row[3] as Date;
        fecha = d.toISOString().slice(0, 10);
        label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }

      // Evitar duplicados (la hoja tiene 2 secciones idénticas: principal + gráfico de barras)
      const exists = result.curvaS.some((c) => c.label === label);
      if (exists) continue;

      result.curvaS.push({
        label,
        fecha,
        pctProgMes,
        pctProgAcum,
        pctEjecMes,
        pctEjecAcum,
      });
    }

    // Override mesPeriodo · usar último mes con pctEjecMes > 0 en curvaS
    // (RES.VALO R7 a veces tiene fecha stale del template)
    const ultEjec = [...result.curvaS]
      .filter((c) => c.label !== 'INICIO' && c.pctEjecMes > 0.01)
      .pop();
    if (ultEjec && ultEjec.label.match(/^\d{4}-\d{2}$/)) {
      result.mesPeriodo = ultEjec.label;
      result.fechaDesde = ultEjec.fecha ?? `${ultEjec.label}-01`;
    }
  }

  // ─── 5. VALO N (partidas detalle) ───────────────────────────
  // Hoja VALO · puede ser "VALO 1", "VALO 3", o solo "VALO"
  const valoSheetName = wb.SheetNames.find((n) => /^VALO(\s*\d+)?$/i.test(n.trim()));
  if (valoSheetName) {
    const sV = wb.Sheets[valoSheetName]!;
    const a = XLSX.utils.sheet_to_json<unknown[]>(sV, { header: 1, defval: null, raw: true });

    // Detectar contratista para metadata
    if (!result.contratista) result.contratista = toStr(a[2]?.[1]);

    // Datos partidas desde row 14 aprox
    // Cols: 0=codigo, 1=descripción, 2=und, 3=metradoContractual, 4=PU, 5=subTotal,
    //       6=metAnt, 7=valAnt, 8=pctAnt, 9=metAct, 10=valAct, 11=pctAct,
    //       12=metAcum, 13=valAcum, 14=pctAcum, 15=metSaldo, 16=valSaldo, 17=pctSaldo
    for (let i = 13; i < a.length; i++) {
      const codigo = toStr(a[i]?.[0]);
      const desc = toStr(a[i]?.[1]);
      if (!codigo || !desc) continue;
      // Skip filas TOTAL/SUBTOTAL al final
      if (/^TOTAL|^SUB|^SON\s/i.test(codigo) || /^TOTAL|^SUB|^SON\s/i.test(desc)) break;

      const unidad = toStr(a[i]?.[2]);
      const metContr = toNum(a[i]?.[3]);
      const pu = toNum(a[i]?.[4]);
      const subTotal = toNum(a[i]?.[5]);
      const metAnt = toNum(a[i]?.[6]);
      const valAnt = toNum(a[i]?.[7]);
      const pctAnt = toNum(a[i]?.[8]);
      const metAct = toNum(a[i]?.[9]);
      const valAct = toNum(a[i]?.[10]);
      const pctAct = toNum(a[i]?.[11]);
      const metAcum = toNum(a[i]?.[12]);
      const valAcum = toNum(a[i]?.[13]);
      const pctAcum = toNum(a[i]?.[14]);
      const metSaldo = toNum(a[i]?.[15]);
      const valSaldo = toNum(a[i]?.[16]);
      const pctSaldo = toNum(a[i]?.[17]);

      // Filtrar solo partidas hoja (con PU > 0 o metradoContractual > 0)
      // Títulos sin metrado/PU se omiten (sólo guardamos hojas)
      if (!pu && !metContr) continue;

      result.partidas.push({
        codigo,
        descripcion: desc,
        unidad,
        metradoContractual: metContr,
        precioUnitario: pu,
        subTotal,
        metradoAnterior: metAnt,
        valorAnterior: valAnt,
        pctAnterior: pctAnt,
        metradoActual: metAct,
        valorActual: valAct,
        pctActual: pctAct,
        metradoAcumulado: metAcum,
        valorAcumulado: valAcum,
        pctAcumulado: pctAcum,
        metradoSaldo: metSaldo,
        valorSaldo: valSaldo,
        pctSaldo: pctSaldo,
      });
    }
  } else {
    result.warnings.push('Hoja "VALO N" no encontrada');
  }

  // Validaciones
  if (result.valorizacion === 0) result.errors.push('valorización V = 0 (cabecera no parseada?)');
  if (result.numero === 0) result.errors.push('número de valorización no detectado');
  if (result.partidas.length === 0) result.errors.push('sin partidas detectadas en VALO N');

  return result;
}

// ─── Parser formato simple · 1 hoja "VAL SMP" ───────────────────
// Layout (cols 0-index): 0=marcador nivel (14=partida hoja), 1=código, 2=descr,
//   3=unid, 4=metrado, 5=PU, 6=parcial · ant 7/8/9 · actual 10/11/12 ·
//   acum 13/14/15 · saldo 16/17/18 (metrado/parcial/%). Bloque totales al final:
//   ( A ) COSTO DIRECTO … MONTO DE INVERSIÓN, label en col2, base[6]/período[11]/acum[14].
const MESES_ES: Record<string, string> = {
  ENERO: '01', FEBRERO: '02', MARZO: '03', ABRIL: '04', MAYO: '05', JUNIO: '06',
  JULIO: '07', AGOSTO: '08', SETIEMBRE: '09', SEPTIEMBRE: '09', OCTUBRE: '10',
  NOVIEMBRE: '11', DICIEMBRE: '12',
};

function parseValSmp(wb: XLSX.WorkBook): ValParseResult {
  const result = blankVal();

  // Hoja de datos: la que contiene el bloque totales (COSTO DIRECTO en col2).
  const dataSheet =
    wb.SheetNames.find((n) => {
      const s = wb.Sheets[n];
      if (!s) return false;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(s, { header: 1, defval: null, raw: true });
      return rows.some((r) => /COSTO DIRECTO/i.test(String(r?.[2] ?? '')));
    }) ??
    wb.SheetNames.find((n) => !/CARATULA/i.test(n)) ??
    wb.SheetNames[0];
  if (!dataSheet || !wb.Sheets[dataSheet]) {
    result.errors.push('VAL simple: sin hoja de datos');
    return result;
  }
  const a = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[dataSheet], { header: 1, defval: null, raw: true });

  // ── Cabecera: número, período, metadata (primeras ~15 filas) ──
  const headRows = a.slice(0, 15);
  const flatHead = headRows.map((r) => (r ?? []).map((c) => String(c ?? '')).join(' ')).join('\n');

  const mNum = flatHead.match(/VALORIZACI[ÓO]N\s+(?:MENSUAL\s+DE\s+OBRA\s+)?N[°º]\s*0*(\d+)/i);
  if (mNum?.[1]) result.numero = Number(mNum[1]);

  // Período: "Del 27 al 30 del Abril 2026" → rango exacto; sino "ABRIL 2026" → mes.
  const mRango = flatHead.match(/del?\s+(\d{1,2})\s+al\s+(\d{1,2})\s+del?\s+([A-Za-zÁÉÍÓÚñ]+)\s+(\d{4})/i);
  if (mRango) {
    const mm = MESES_ES[mRango[3]!.toUpperCase()];
    if (mm) {
      result.mesPeriodo = `${mRango[4]}-${mm}`;
      result.fechaDesde = `${mRango[4]}-${mm}-${mRango[1]!.padStart(2, '0')}`;
      result.fechaHasta = `${mRango[4]}-${mm}-${mRango[2]!.padStart(2, '0')}`;
    }
  }
  if (!result.mesPeriodo) {
    const mMes = flatHead.match(/\b([A-Za-zÁÉÍÓÚñ]+)\s+(\d{4})\b/);
    const mm = mMes ? MESES_ES[mMes[1]!.toUpperCase()] : undefined;
    if (mMes && mm) result.mesPeriodo = `${mMes[2]}-${mm}`;
  }

  for (const r of headRows) {
    const lbl = String(r?.[1] ?? '').trim().toUpperCase();
    if (lbl.startsWith('ENTIDAD')) result.entidad = toStr(r?.[2]);
    else if (lbl.startsWith('CONTRATISTA')) result.contratista = toStr(r?.[2]);
    else if (lbl.startsWith('OBRA')) result.obra = (toStr(r?.[1]) ?? '').replace(/^OBRA:\s*/i, '') || null;
  }

  // ── Partidas (filas marcador 14) ──
  for (const r of a) {
    if (Number(r?.[0]) !== 14) continue;
    const codigo = toStr(r?.[1]);
    const desc = toStr(r?.[2]);
    if (!codigo || !desc) continue;
    result.partidas.push({
      codigo,
      descripcion: desc,
      unidad: toStr(r?.[3]),
      metradoContractual: toNum(r?.[4]),
      precioUnitario: toNum(r?.[5]),
      subTotal: toNum(r?.[6]),
      metradoAnterior: toNum(r?.[7]),
      valorAnterior: toNum(r?.[8]),
      pctAnterior: toNum(r?.[9]),
      metradoActual: toNum(r?.[10]),
      valorActual: toNum(r?.[11]),
      pctActual: toNum(r?.[12]),
      metradoAcumulado: toNum(r?.[13]),
      valorAcumulado: toNum(r?.[14]),
      pctAcumulado: toNum(r?.[15]),
      metradoSaldo: toNum(r?.[16]),
      valorSaldo: toNum(r?.[17]),
      pctSaldo: toNum(r?.[18]),
    });
  }

  // ── Totales (bloque final, label col2, período col11) ──
  const tot = (re: RegExp): { base: number; per: number } | null => {
    for (const r of a) {
      const lbl = String(r?.[2] ?? r?.[1] ?? '').trim().toUpperCase();
      if (lbl && re.test(lbl)) return { base: toNum(r?.[6]), per: toNum(r?.[11]) };
    }
    return null;
  };
  const cd = tot(/COSTO DIRECTO/);
  const sub = tot(/SUBTOTAL/);
  const mob = tot(/MOBILIARIO\s+Y\s+EQUIP/);
  const igv = tot(/^IGV/);
  const pte = tot(/PRESUPUESTO TOTAL DE EJECUCI/);

  // V = costo directo del período (montoCd). GG/UT van embebidos o en 0 en este formato.
  result.valorizacion = cd?.per ?? 0;
  result.valorizacionBruta = cd?.per ?? 0;
  result.valorizacionNeta = cd?.per ?? 0;
  result.igv = igv?.per ?? 0;
  result.montoTotalConIgv =
    pte?.per ?? ((sub?.per ?? cd?.per ?? 0) + (mob?.per ?? 0) + (igv?.per ?? 0));
  result.montoPagarSinIgv = result.montoTotalConIgv - result.igv;
  result.totalContratista = result.montoTotalConIgv;
  result.pptoBase = cd?.base ?? null;
  result.pptoContratado = pte?.base ?? null;

  if (result.valorizacion === 0) result.errors.push('VAL simple: COSTO DIRECTO período = 0');
  if (result.numero === 0) result.errors.push('VAL simple: número de valorización no detectado');
  if (result.partidas.length === 0) result.errors.push('VAL simple: sin partidas (marcador 14)');

  return result;
}

// ─── Bloque totales inversión (financiero-inversión real) ────────
// Parser-agnóstico · corre sobre el buffer crudo, independiente del path LLM/determinista.
// El Excel MM trae al final un bloque "totales de inversión":
//   ( A ) COSTO DIRECTO · MOBILIARIO Y EQUIPAMENTO · IGV · PRESUPUESTO TOTAL DE EJECUCIÓN
//   DOCUMENTO DE TRABAJO · SUPERVISIÓN DE DOCUMENTO · SUPERVISIÓN DE OBRA
//   MONTO DE INVERSIÓN · PORCENTAJE DE AVANCE
// Layout observado (template SMP): label[2], base[6], anterior[8], período[11], acum[14], saldo[17];
// fila %avance usa fracciones en período[12]/acum[15].
export interface ValTotalLinea {
  base: number;
  periodo: number;
  acumulado: number;
}

export interface ValInversionTotales {
  costoDirecto: ValTotalLinea | null;
  mobiliario: ValTotalLinea | null;
  igv: ValTotalLinea | null;
  presupuestoEjecucion: ValTotalLinea | null; // PRESUPUESTO TOTAL DE EJECUCIÓN (CD+GG+UT+IGV+mob)
  documentoTrabajo: ValTotalLinea | null; // expediente técnico
  supervisionDocTrabajo: ValTotalLinea | null;
  supervisionObra: ValTotalLinea | null;
  montoInversion: ValTotalLinea | null; // total inversión
  pctAvanceInversionPeriodo: number | null; // fracción 0-1
  pctAvanceInversionAcum: number | null; // fracción 0-1
  found: boolean;
}

// Columnas de valor en el bloque totales (offset por celdas combinadas en header)
const COL_BASE = 6;
const COL_PERIODO = 11;
const COL_ACUM = 14;
const COL_PCT_PERIODO = 12;
const COL_PCT_ACUM = 15;

function readTotalLinea(row: unknown[]): ValTotalLinea {
  return {
    base: toNum(row[COL_BASE]),
    periodo: toNum(row[COL_PERIODO]),
    acumulado: toNum(row[COL_ACUM]),
  };
}

export function parseValInversionTotales(buffer: Buffer): ValInversionTotales {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const out: ValInversionTotales = {
    costoDirecto: null,
    mobiliario: null,
    igv: null,
    presupuestoEjecucion: null,
    documentoTrabajo: null,
    supervisionDocTrabajo: null,
    supervisionObra: null,
    montoInversion: null,
    pctAvanceInversionPeriodo: null,
    pctAvanceInversionAcum: null,
    found: false,
  };

  for (const sn of wb.SheetNames) {
    const sheet = wb.Sheets[sn];
    if (!sheet) continue;
    const a = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
    for (let i = 0; i < a.length; i++) {
      const row = a[i] ?? [];
      // label puede estar en col 2 (totales) o col 1
      const label = String(row[2] ?? row[1] ?? '').trim().toUpperCase();
      if (!label) continue;

      if (/COSTO DIRECTO/.test(label) && !out.costoDirecto) out.costoDirecto = readTotalLinea(row);
      else if (/MOBILIARIO\s+Y\s+EQUIP/.test(label) && !out.mobiliario) out.mobiliario = readTotalLinea(row);
      else if (/^IGV/.test(label) && !out.igv) out.igv = readTotalLinea(row);
      else if (/PRESUPUESTO TOTAL DE EJECUCI/.test(label) && !out.presupuestoEjecucion)
        out.presupuestoEjecucion = readTotalLinea(row);
      else if (/SUPERVISI[ÓO]N DE DOCUMENTO/.test(label) && !out.supervisionDocTrabajo)
        out.supervisionDocTrabajo = readTotalLinea(row);
      else if (/DOCUMENTO DE TRABAJO/.test(label) && !out.documentoTrabajo)
        out.documentoTrabajo = readTotalLinea(row);
      else if (/SUPERVISI[ÓO]N DE OBRA/.test(label) && !out.supervisionObra)
        out.supervisionObra = readTotalLinea(row);
      else if (/MONTO DE INVERSI[ÓO]N/.test(label) && !out.montoInversion)
        out.montoInversion = readTotalLinea(row);
      else if (/PORCENTAJE DE AVANCE/.test(label) && out.pctAvanceInversionAcum === null) {
        out.pctAvanceInversionPeriodo = toNum(row[COL_PCT_PERIODO]) || null;
        out.pctAvanceInversionAcum = toNum(row[COL_PCT_ACUM]) || null;
      }
    }
    // si encontró el bloque en esta hoja, no sigas a otras
    if (out.montoInversion) break;
  }

  out.found = out.montoInversion != null;
  return out;
}
