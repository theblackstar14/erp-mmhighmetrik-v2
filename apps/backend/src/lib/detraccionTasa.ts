// Tasa de detracción vigente a una fecha (catálogo cargado en Fase 0). null si no existe, no está vigente o no tiene %.
import { db, schema } from '@erp/db';
import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';

export async function buscarTasaDetraccion(codigo: string, fecha: string) {
  const t = schema.detraccionTasa;
  const [tasa] = await db.select().from(t)
    .where(and(eq(t.codigo, codigo), lte(t.vigenciaDesde, fecha), or(isNull(t.vigenciaHasta), gte(t.vigenciaHasta, fecha))))
    .orderBy(desc(t.vigenciaDesde))
    .limit(1);
  if (!tasa || tasa.porcentaje == null) return null;
  return { codigo: tasa.codigo, porcentaje: Number(tasa.porcentaje), montoMinimo: Number(tasa.montoMinimo) };
}
