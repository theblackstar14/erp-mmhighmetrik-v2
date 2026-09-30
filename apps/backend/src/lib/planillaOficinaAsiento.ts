// F2 · armado de las líneas del asiento de planilla oficina.
// ÚNICA fuente de las líneas: la usan `cerrar` y `asiento-preview`. Si se duplica,
// la vista previa puede divergir del asiento real, que es justo lo que F2 evita.
import { db, schema } from '@erp/db';
import { eq } from 'drizzle-orm';
import type { LineaIn } from '../routes/contabilidad.js';
import {
  repartir,
  resolverDistribucion,
  round2,
  type ReglaDistribucion,
} from './planillaOficinaDistribucion.js';

// Conjunto CERRADO de conceptos. Kelly edita la cuenta (planilla_oficina_concepto_cuenta),
// no la lista. `reparte` = la línea lleva dimensión obra; los pasivos van agregados.
export const CONCEPTOS = [
  { concepto: 'sueldos',            cuentaDefault: '6211',  label: 'Sueldos y salarios',            lado: 'debe',  reparte: true },
  { concepto: 'essalud_empleador',  cuentaDefault: '62711', label: 'EsSalud empleador',             lado: 'debe',  reparte: true },
  { concepto: 'essalud_por_pagar',  cuentaDefault: '4031',  label: 'EsSalud por pagar',             lado: 'haber', reparte: false },
  { concepto: 'afp_por_pagar',      cuentaDefault: '407',   label: 'AFP por pagar',                 lado: 'haber', reparte: false },
  { concepto: 'onp_por_pagar',      cuentaDefault: '4032',  label: 'ONP por pagar',                 lado: 'haber', reparte: false },
  { concepto: 'renta5ta_por_pagar', cuentaDefault: '40173', label: 'Renta 5ta por pagar',           lado: 'haber', reparte: false },
  { concepto: 'otros_por_pagar',    cuentaDefault: '469',   label: 'Otros por pagar (judicial + descuentos + adelanto)', lado: 'haber', reparte: false },
  { concepto: 'neto_por_pagar',     cuentaDefault: '411',   label: 'Neto por pagar',                lado: 'haber', reparte: false },
] as const;

export const CONCEPTOS_SET = new Set<string>(CONCEPTOS.map((c) => c.concepto));

// Umbral de emisión: por debajo de medio céntimo la línea no existe.
const MIN = 0.005;

// Descripción de la pata bancaria del pago. `cerrar` la consulta para saber si un
// asiento ya existente se cerró pagando o sin pagar: dato, no cadena decorativa.
export const DESC_PAGO_BANCO = 'Pago de planilla · banco';

export type DetalleCierre = {
  empleadoId: string;
  cuentaContable: string | null;
  totalBruto: string | number | null;
  essalud: string | number | null;
  onp: string | number | null;
  afpAporte: string | number | null;
  afpSeguro: string | number | null;
  afpComision: string | number | null;
  imptoRenta5ta: string | number | null;
  retencionJudicial: string | number | null;
  otrosDescuentos: string | number | null;
  adelantoCuota: string | number | null;
  netoPago: string | number | null;
};

export type ArmarLineasInput = {
  detalle: DetalleCierre[];
  reglas: ReglaDistribucion[];
  mapa: Record<string, string>;
  cuentaBanco?: string | null; // código 104x de la cuenta elegida; null = el neto queda en 411
};

export type ArmarLineasOut = { lineas: LineaIn[]; totalNeto: number };

const n = (v: string | number | null | undefined) => Number(v ?? 0);

export function armarLineasCierre({ detalle, reglas, mapa, cuentaBanco }: ArmarLineasInput): ArmarLineasOut {
  const def = new Map(CONCEPTOS.map((c) => [c.concepto as string, c]));
  const cta = (concepto: string) => mapa[concepto] ?? def.get(concepto)!.cuentaDefault;
  const label = (concepto: string) => def.get(concepto)!.label;

  // Agregación de costo por (cuenta, obra): 17 empleados y 2 obras dan 4 líneas, no 34.
  type Costo = { cuenta: string; obraId: string | null; monto: number; hasManual: boolean; label: string };
  const costo = new Map<string, Costo>();
  const acum = (cuenta: string, obraId: string | null, monto: number, hasManual: boolean, desc: string) => {
    if (Math.abs(monto) < MIN) return;
    const k = `${cuenta}|${obraId ?? ''}`;
    const prev = costo.get(k);
    if (prev) {
      prev.monto = round2(prev.monto + monto);
      prev.hasManual = prev.hasManual || hasManual;
    } else {
      costo.set(k, { cuenta, obraId, monto: round2(monto), hasManual, label: desc });
    }
  };

  let totEssalud = 0, totAfp = 0, totOnp = 0, totRenta = 0, totOtros = 0, totNeto = 0;

  for (const det of detalle) {
    const slices = resolverDistribucion(det.empleadoId, reglas);

    // Precedencia WS1: cuenta manual del trabajador > mapa > default.
    const cuentaSueldo = det.cuentaContable ?? cta('sueldos');
    for (const p of repartir(round2(n(det.totalBruto)), slices)) {
      acum(cuentaSueldo, p.obraId, p.monto, !!det.cuentaContable, label('sueldos'));
    }

    const essalud = round2(n(det.essalud));
    for (const p of repartir(essalud, slices)) {
      acum(cta('essalud_empleador'), p.obraId, p.monto, false, label('essalud_empleador'));
    }

    totEssalud = round2(totEssalud + essalud);
    totAfp = round2(totAfp + n(det.afpAporte) + n(det.afpSeguro) + n(det.afpComision));
    totOnp = round2(totOnp + n(det.onp));
    totRenta = round2(totRenta + n(det.imptoRenta5ta));
    totOtros = round2(totOtros + n(det.retencionJudicial) + n(det.otrosDescuentos) + n(det.adelantoCuota));
    totNeto = round2(totNeto + n(det.netoPago));
  }

  const lineas: LineaIn[] = [];

  // Debe · costo repartido, orden determinista (cuenta, luego obra; oficina —null— primero por '')
  const ordenadas = [...costo.values()].sort(
    (a, b) => a.cuenta.localeCompare(b.cuenta) || (a.obraId ?? '').localeCompare(b.obraId ?? ''),
  );
  for (const c of ordenadas) {
    lineas.push({
      cuenta: c.cuenta,
      descripcion: c.label,
      debe: c.monto,
      haber: 0,
      cuentaContable: c.cuenta,
      obraId: c.obraId,
      cuentaOrigen: c.hasManual ? 'USUARIO' : 'AUTOMATICO',
    });
  }

  // Haber · pasivos agregados, SIN dimensión obra (la deuda con la AFP no es de una obra)
  const haber = (concepto: string, monto: number) => {
    if (Math.abs(monto) < MIN) return;
    const cuenta = cta(concepto);
    lineas.push({
      cuenta,
      descripcion: label(concepto),
      debe: 0,
      haber: monto,
      cuentaContable: cuenta,
      obraId: null,
      cuentaOrigen: 'AUTOMATICO',
    });
  };
  haber('essalud_por_pagar', totEssalud);
  haber('afp_por_pagar', totAfp);
  haber('onp_por_pagar', totOnp);
  haber('renta5ta_por_pagar', totRenta);
  haber('otros_por_pagar', totOtros);
  haber('neto_por_pagar', totNeto);

  // Pago (opción A): el 411 queda escrito en los dos lados — se lee qué se devengó y qué se pagó.
  // DESC_PAGO_BANCO identifica la pata bancaria; cerrar la usa para detectar un asiento ya pagado.
  // Si totNeto < MIN no hay nada que pagar: ni líneas de pago ni movimiento.
  if (cuentaBanco && totNeto >= MIN) {
    const c411 = cta('neto_por_pagar');
    lineas.push({
      cuenta: c411, descripcion: 'Pago de planilla · neto', debe: totNeto, haber: 0,
      cuentaContable: c411, obraId: null, cuentaOrigen: 'AUTOMATICO',
    });
    lineas.push({
      cuenta: cuentaBanco, descripcion: DESC_PAGO_BANCO, debe: 0, haber: totNeto,
      cuentaContable: cuentaBanco, obraId: null, cuentaOrigen: 'AUTOMATICO',
    });
  }

  return { lineas, totalNeto: totNeto };
}

export async function cargarMapaConceptos(): Promise<Record<string, string>> {
  const rows = await db.select().from(schema.planillaOficinaConceptoCuenta);
  const mapa: Record<string, string> = {};
  for (const r of rows) if (CONCEPTOS_SET.has(r.concepto)) mapa[r.concepto] = r.cuenta;
  return mapa;
}

// Reglas de UNA empresa. El filtro es obligatorio: sin él el costo de la empresa 1
// se repartiría a obras de la empresa 2.
export async function cargarReglas(empresaId: number): Promise<ReglaDistribucion[]> {
  const rows = await db
    .select({
      empleadoId: schema.planillaOficinaDistribucion.empleadoId,
      obraId: schema.planillaOficinaDistribucion.obraId,
      pct: schema.planillaOficinaDistribucion.pct,
    })
    .from(schema.planillaOficinaDistribucion)
    .where(eq(schema.planillaOficinaDistribucion.empresaId, empresaId));
  return rows.map((r) => ({ empleadoId: r.empleadoId, obraId: r.obraId, pct: Number(r.pct) }));
}
