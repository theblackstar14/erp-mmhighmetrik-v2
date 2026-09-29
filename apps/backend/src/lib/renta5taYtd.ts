import { db, schema } from '@erp/db';
import { and, eq, lt, sql } from 'drizzle-orm';

export async function getYtd(empleadoId: string, anio: number, mesNumero: number): Promise<{ acumuladoPercibido: number; retencionesPrevias: number }> {
  const [base] = await db.select().from(schema.renta5taBaseline)
    .where(and(eq(schema.renta5taBaseline.empleadoId, empleadoId), eq(schema.renta5taBaseline.anio, anio))).limit(1);
  const [agg] = await db.select({
    remun: sql<string>`coalesce(sum(${schema.renta5taMes.remunComputable}), 0)`,
    ret: sql<string>`coalesce(sum(${schema.renta5taMes.retencion}), 0)`,
  }).from(schema.renta5taMes)
    .where(and(eq(schema.renta5taMes.empleadoId, empleadoId), eq(schema.renta5taMes.anio, anio), lt(schema.renta5taMes.mesNumero, mesNumero)));
  return {
    acumuladoPercibido: Number(base?.acumuladoImportado ?? 0) + Number(agg?.remun ?? 0),
    retencionesPrevias: Number(base?.retencionesImportadas ?? 0) + Number(agg?.ret ?? 0),
  };
}

export async function upsertLedgerMes(a: { empleadoId: string; planillaMesId: string; anio: number; mesNumero: number; remunComputable: number; retencion: number }): Promise<void> {
  await db.insert(schema.renta5taMes).values({
    empleadoId: a.empleadoId, planillaMesId: a.planillaMesId, anio: a.anio, mesNumero: a.mesNumero,
    remunComputable: String(a.remunComputable), retencion: String(a.retencion),
  }).onConflictDoUpdate({
    target: [schema.renta5taMes.empleadoId, schema.renta5taMes.planillaMesId],
    set: { remunComputable: String(a.remunComputable), retencion: String(a.retencion), anio: a.anio, mesNumero: a.mesNumero },
  });
}
