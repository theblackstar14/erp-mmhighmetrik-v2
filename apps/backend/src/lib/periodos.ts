// H1 · Guard de periodo contable cerrado · centralizado y reutilizable.
// Bloquea mutaciones retroactivas (movimientos/gastos/pago/cobro) en periodos cerrados.
// Determinístico: el periodo se deriva por slice 'YYYY-MM' de la fecha (que ya es date string,
// sin tz local). Empresa = proyectoId null. No tiene side-effects (a diferencia del legacy
// periodoAbierto que auto-inserta).
import { db, schema } from '@erp/db';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';

export const periodoDe = (fecha: string | Date): string => {
  const s = fecha instanceof Date ? fecha.toISOString() : String(fecha);
  return s.slice(0, 7); // 'YYYY-MM'
};

// boundaries determinísticos del periodo (fin de mes real)
export const rangoPeriodo = (periodo: string) => {
  const [anio, mes] = periodo.split('-').map(Number) as [number, number];
  const fin = new Date(anio, mes, 0).getDate();
  return { desde: `${periodo}-01`, hasta: `${periodo}-${String(fin).padStart(2, '0')}` };
};

// H2.1 · congela las filas del periodo (movimientos+gastos locked_at, asientos cerrado_mes).
// Idempotente: solo toca filas aún no congeladas. Devuelve conteos.
export async function freezePeriodo(periodo: string) {
  const { desde, hasta } = rangoPeriodo(periodo);
  const ts = new Date();
  const m = await db.update(schema.movimientos).set({ lockedAt: ts })
    .where(and(gte(schema.movimientos.fecha, desde), lte(schema.movimientos.fecha, hasta), isNull(schema.movimientos.lockedAt))).returning({ id: schema.movimientos.id });
  const g = await db.update(schema.gastos).set({ lockedAt: ts })
    .where(and(gte(schema.gastos.fecha, desde), lte(schema.gastos.fecha, hasta), isNull(schema.gastos.lockedAt))).returning({ id: schema.gastos.id });
  const a = await db.update(schema.asientos).set({ cerradoMes: periodo })
    .where(and(eq(schema.asientos.periodo, periodo), isNull(schema.asientos.cerradoMes))).returning({ id: schema.asientos.id });
  return { movimientos: m.length, gastos: g.length, asientos: a.length };
}

// H2.2 · descongela (al reabrir). Limpia locked_at/cerrado_mes del periodo.
export async function unfreezePeriodo(periodo: string) {
  const { desde, hasta } = rangoPeriodo(periodo);
  const m = await db.update(schema.movimientos).set({ lockedAt: null }).where(and(gte(schema.movimientos.fecha, desde), lte(schema.movimientos.fecha, hasta))).returning({ id: schema.movimientos.id });
  const g = await db.update(schema.gastos).set({ lockedAt: null }).where(and(gte(schema.gastos.fecha, desde), lte(schema.gastos.fecha, hasta))).returning({ id: schema.gastos.id });
  const a = await db.update(schema.asientos).set({ cerradoMes: null }).where(eq(schema.asientos.periodo, periodo)).returning({ id: schema.asientos.id });
  return { movimientos: m.length, gastos: g.length, asientos: a.length };
}

// ¿el periodo (YYYY-MM) está cerrado? · no existe → abierto · 'reabierto' → abierto.
export async function periodoCerrado(periodo: string): Promise<boolean> {
  const [anio, mes] = periodo.split('-').map(Number) as [number, number];
  if (!anio || !mes) return false;
  const [p] = await db
    .select({ estado: schema.periodosContables.estado })
    .from(schema.periodosContables)
    .where(and(eq(schema.periodosContables.anio, anio), eq(schema.periodosContables.mes, mes), isNull(schema.periodosContables.proyectoId)));
  return p?.estado === 'cerrado';
}

// Devuelve el periodo (YYYY-MM) si la fecha cae en un periodo cerrado, o null si está abierto.
// Patrón sin throw (Express 4 no captura throws async) → la ruta retorna 423 explícito.
export async function periodoCerradoDeFecha(fecha: string | Date): Promise<string | null> {
  const periodo = periodoDe(fecha);
  return (await periodoCerrado(periodo)) ? periodo : null;
}
