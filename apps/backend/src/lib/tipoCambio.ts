// Fase 0 · tipo de cambio cargado a mano (sin API SUNAT). Sin TC del día → último publicado, hasta MAX_DIAS_ATRAS.
import { db, schema } from '@erp/db';
import { and, desc, eq, gte, lte } from 'drizzle-orm';

export type FilaTc = { fecha: string; moneda: string; compra: number; venta: number };
export const MAX_DIAS_ATRAS = 10;

const dias = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);

export function elegirTipoCambio(filas: FilaTc[], fecha: string, moneda: string): (FilaTc & { diasAtras: number }) | null {
  if (moneda === 'PEN') return { fecha, moneda, compra: 1, venta: 1, diasAtras: 0 };
  const candidata = filas.filter((f) => f.moneda === moneda && f.fecha <= fecha).sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
  if (!candidata) return null;
  const diasAtras = dias(candidata.fecha, fecha);
  return diasAtras <= MAX_DIAS_ATRAS ? { ...candidata, diasAtras } : null;
}

export async function buscarTipoCambio(fecha: string, moneda: string) {
  if (moneda === 'PEN') return elegirTipoCambio([], fecha, moneda);
  const desde = new Date(Date.parse(`${fecha}T00:00:00Z`) - MAX_DIAS_ATRAS * 86_400_000).toISOString().slice(0, 10);
  const rows = await db.select().from(schema.tipoCambio)
    .where(and(eq(schema.tipoCambio.moneda, moneda), lte(schema.tipoCambio.fecha, fecha), gte(schema.tipoCambio.fecha, desde)))
    .orderBy(desc(schema.tipoCambio.fecha)).limit(1);
  return elegirTipoCambio(rows.map((r) => ({ fecha: r.fecha, moneda: r.moneda, compra: Number(r.compra), venta: Number(r.venta) })), fecha, moneda);
}
