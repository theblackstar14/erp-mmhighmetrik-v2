/**
 * Calculadora factor reajuste K · Fórmula Polinómica
 *
 * K = Σ (coef_monomio × Ir_monomio / Io_monomio)
 *
 * Para monomio compuesto (n IUs con peso_iu sumando 100%):
 *   Ir_monomio = Σ (peso_iu/100 × Ir_iu)
 *   Io_monomio = Σ (peso_iu/100 × Io_iu)
 *   relacion   = Ir_monomio / Io_monomio
 *
 * K-1 = factor reajuste · monto reajuste = montoCD × (K - 1)
 *
 * Σ coef = 1.0 → si todos Ir=Io entonces K=1 (sin reajuste)
 */
import { eq, and } from 'drizzle-orm';
import { db } from '../client.js';
import {
  formulasPolinomicas,
  formulasMonomios,
  formulasMonomiosIus,
  indicesMensuales,
} from '../schema.js';

export interface KMonomioDetalle {
  monomio: number;
  simbolo: string;
  coef: number;
  ir: number;
  io: number;
  relacion: number;
  ius: Array<{ iuCodigo: string; pesoPct: number; ir: number; io: number }>;
}

export interface KResultado {
  fpId: string;
  subpresupuestoCodigo: string;
  anioMesIr: string;
  anioMesIo: string; // derivado de fecha_base FP
  k: number;
  detalle: KMonomioDetalle[];
  warnings: string[];
}

export async function calcKFactor(
  fpId: string,
  anioMesIr: string,
  area = 'lima',
): Promise<KResultado> {
  const warnings: string[] = [];

  // 1. Get FP
  const fp = await db.select().from(formulasPolinomicas).where(eq(formulasPolinomicas.id, fpId)).limit(1);
  if (!fp.length) throw new Error(`FP ${fpId} no encontrada`);
  const fpRow = fp[0];

  // anio_mes Io = mes de fecha_base
  const anioMesIo = String(fpRow.fechaBase).slice(0, 7);

  // 2. Get monomios + IUs
  const monomios = await db
    .select()
    .from(formulasMonomios)
    .where(eq(formulasMonomios.formulaId, fpId))
    .orderBy(formulasMonomios.numero);

  const detalle: KMonomioDetalle[] = [];
  let k = 0;

  for (const m of monomios) {
    const ius = await db
      .select()
      .from(formulasMonomiosIus)
      .where(eq(formulasMonomiosIus.monomioId, m.id));

    let irSum = 0;
    let ioSum = 0;
    const iusDet: KMonomioDetalle['ius'] = [];

    for (const iu of ius) {
      const peso = Number(iu.pesoPorcentual);
      // Ir
      const irRow = await db
        .select()
        .from(indicesMensuales)
        .where(
          and(
            eq(indicesMensuales.iuCodigo, iu.iuCodigo),
            eq(indicesMensuales.area, area),
            eq(indicesMensuales.anioMes, anioMesIr),
          ),
        )
        .limit(1);
      // Io
      const ioRow = await db
        .select()
        .from(indicesMensuales)
        .where(
          and(
            eq(indicesMensuales.iuCodigo, iu.iuCodigo),
            eq(indicesMensuales.area, area),
            eq(indicesMensuales.anioMes, anioMesIo),
          ),
        )
        .limit(1);

      if (!irRow.length) {
        warnings.push(`IU ${iu.iuCodigo} sin valor Ir ${anioMesIr} ${area}`);
        continue;
      }
      if (!ioRow.length) {
        warnings.push(`IU ${iu.iuCodigo} sin valor Io ${anioMesIo} ${area}`);
        continue;
      }
      const ir = Number(irRow[0].valor);
      const io = Number(ioRow[0].valor);
      irSum += (peso / 100) * ir;
      ioSum += (peso / 100) * io;
      iusDet.push({ iuCodigo: iu.iuCodigo, pesoPct: peso, ir, io });
    }

    const relacion = ioSum > 0 ? irSum / ioSum : 0;
    const coef = Number(m.coeficiente);
    k += coef * relacion;

    detalle.push({
      monomio: m.numero,
      simbolo: m.simbolo,
      coef,
      ir: irSum,
      io: ioSum,
      relacion,
      ius: iusDet,
    });
  }

  return {
    fpId,
    subpresupuestoCodigo: fpRow.subpresupuestoCodigo,
    anioMesIr,
    anioMesIo,
    k,
    detalle,
    warnings,
  };
}
