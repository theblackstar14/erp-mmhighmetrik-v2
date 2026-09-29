import { db, schema } from '@erp/db';
import { desc, lte } from 'drizzle-orm';

export async function resolverParamLegal(fechaAplicacion: string) {
  const [row] = await db.select().from(schema.paramLegalOficina)
    .where(lte(schema.paramLegalOficina.fechaVigencia, fechaAplicacion))
    .orderBy(desc(schema.paramLegalOficina.fechaVigencia)).limit(1);
  if (!row) throw new Error(`Sin parámetros legales vigentes para ${fechaAplicacion}`);
  return {
    rmv: Number(row.rmv), uit: Number(row.uit), topeRma: Number(row.topeRma),
    pctEssalud: Number(row.pctEssalud), pctOnp: Number(row.pctOnp),
    pctAfpAporte: Number(row.pctAfpAporte), pctAsigFamiliar: Number(row.pctAsigFamiliar),
    fechaVigencia: String(row.fechaVigencia),
  };
}

const normAfp = (s: string) => s.replace(/\s*\([FM]\)\s*$/i, '').trim().toUpperCase();
export async function cargarTasasAfp() {
  const rows = await db.select().from(schema.afpTasas);
  const out: Record<string, { pctAporte: number; pctSeguro: number; pctComisionFlujo: number; pctComisionMixta: number }> = {};
  for (const r of rows) out[normAfp(r.afp)] = {
    pctAporte: Number(r.pctAporte), pctSeguro: Number(r.pctSeguro),
    pctComisionFlujo: Number(r.pctComisionFlujo), pctComisionMixta: Number(r.pctComisionMixta),
  };
  return out;
}
