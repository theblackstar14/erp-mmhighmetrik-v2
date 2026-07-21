// Resuelve destino + clasificacion + origen de un gasto.
// Invariante: proyecto ⟹ CD|GG_OBRA ONLY; corporativo ⟹ GG_CORP ONLY.
// GG_CORP nunca puede quedar en un gasto de proyecto (clamp → GG_OBRA).
import { db, schema } from '@erp/db';
import { eq } from 'drizzle-orm';

export async function resolverClase(d: {
  proyectoId?: string | null;
  tipoGasto?: string | null;
  destino?: string | null;
  clasificacion?: string | null;
}) {
  const destino = d.destino ?? (d.proyectoId ? 'proyecto' : 'corporativo');

  if (destino === 'corporativo') {
    return { destino: 'corporativo', clasificacion: 'GG_CORP', clasificacionOrigen: 'AUTOMATICO' as const };
  }

  // destino === 'proyecto' → SOLO CD | GG_OBRA (clamp GG_CORP → GG_OBRA)
  if (d.clasificacion) {
    const c = d.clasificacion === 'CD' ? 'CD' : 'GG_OBRA';
    return { destino: 'proyecto', clasificacion: c, clasificacionOrigen: 'USUARIO' as const };
  }

  const [m] = await db
    .select({ clase: schema.gastoCuentaMap.clase })
    .from(schema.gastoCuentaMap)
    .where(eq(schema.gastoCuentaMap.tipoGasto, d.tipoGasto ?? ''))
    .limit(1);

  const clase =
    m?.clase === 'GG_OBRA' ? 'GG_OBRA'
    : m?.clase === 'CD' ? 'CD'
    : m?.clase === 'GG_CORP' ? 'GG_OBRA'  // clamp: proyecto nunca GG_CORP
    : 'CD';                                // default fallback

  return { destino: 'proyecto', clasificacion: clase, clasificacionOrigen: 'AUTOMATICO' as const };
}
