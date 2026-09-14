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

// ─── WS1 · derivarClase(cuenta, obra_id) ──────────────────────────────
// CD/GG DERIVADO de la cuenta (nunca input). Regla WS0 §6:
//   !clasificable (no elem 6/9)  → null
//   clasificable + obra_id       → mapa_cuenta_clase[cuenta] (CD|GG_OBRA), default CD
//   clasificable + sin obra_id   → GG_CORP
export type ClaseDerivada = 'CD' | 'GG_OBRA' | 'GG_CORP' | null;

// Núcleo PURO (unit-testeable · sin DB). Recibe los datos ya resueltos.
export function derivarClaseCore(
  clasificable: boolean,
  obraId: string | null | undefined,
  claseObraMapeada: 'CD' | 'GG_OBRA' | null | undefined,
): ClaseDerivada {
  if (!clasificable) return null;
  if (obraId) return claseObraMapeada ?? 'CD'; // clasificable+obra sin mapa → CD por defecto
  return 'GG_CORP';
}

// Contexto precargable para el motor (evita N queries por línea).
export type DerivarCtx = {
  clasificablePorCuenta: Map<string, boolean>; // codigo → clasificable
  claseObraPorCuenta: Map<string, 'CD' | 'GG_OBRA'>; // codigo → clase_obra (mapa_cuenta_clase)
};

// Wrapper: usa ctx precargado si viene; si no, consulta DB (una cuenta).
// Spec §2: cuenta inexistente o inactiva → THROW (error de dominio). No clasificable → null.
export async function derivarClase(
  cuenta: string,
  obraId: string | null | undefined,
  ctx?: DerivarCtx,
): Promise<ClaseDerivada> {
  if (ctx) {
    // en modo batch (motor) la existencia ya se valida en crearAsiento; el ctx solo trae clasificable+mapa
    return derivarClaseCore(ctx.clasificablePorCuenta.get(cuenta) ?? false, obraId, ctx.claseObraPorCuenta.get(cuenta));
  }
  const [pc] = await db.select({ clasificable: schema.planContable.clasificable, activa: schema.planContable.activa }).from(schema.planContable).where(eq(schema.planContable.codigo, cuenta)).limit(1);
  if (!pc) throw new Error(`cuenta contable ${cuenta} no existe en el plan`);
  if (pc.activa === false) throw new Error(`cuenta contable ${cuenta} está inactiva`);
  const [mc] = await db.select({ clase: schema.mapaCuentaClase.claseObra }).from(schema.mapaCuentaClase).where(eq(schema.mapaCuentaClase.cuenta, cuenta)).limit(1);
  const claseObra = mc?.clase === 'CD' || mc?.clase === 'GG_OBRA' ? mc.clase : undefined;
  return derivarClaseCore(pc.clasificable ?? false, obraId, claseObra);
}

// Carga el contexto una vez (para el motor /generar).
export async function cargarDerivarCtx(): Promise<DerivarCtx> {
  const [plan, mapa] = await Promise.all([
    db.select({ codigo: schema.planContable.codigo, clasificable: schema.planContable.clasificable }).from(schema.planContable),
    db.select({ cuenta: schema.mapaCuentaClase.cuenta, clase: schema.mapaCuentaClase.claseObra }).from(schema.mapaCuentaClase),
  ]);
  const clasificablePorCuenta = new Map(plan.map((r) => [r.codigo, r.clasificable ?? false]));
  const claseObraPorCuenta = new Map<string, 'CD' | 'GG_OBRA'>();
  for (const r of mapa) if (r.clase === 'CD' || r.clase === 'GG_OBRA') claseObraPorCuenta.set(r.cuenta, r.clase);
  return { clasificablePorCuenta, claseObraPorCuenta };
}
