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

export function parseValorizacionXlsx(buffer: Buffer): ValParseResult {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const result: ValParseResult = {
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
  }

  // ─── 5. VALO N (partidas detalle) ───────────────────────────
  const valoSheetName = wb.SheetNames.find((n) => /^VALO\s*\d+$/i.test(n));
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
