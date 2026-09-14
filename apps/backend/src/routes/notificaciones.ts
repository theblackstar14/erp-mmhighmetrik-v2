/**
 * Notificaciones / alertas del dashboard (la campana).
 * Engine idempotente: materializa alertas reales por `clave` (no pisa el estado leído),
 * y limpia las auto-generadas que ya no aplican. Estado leído global (equipo chico).
 */
import { db, schema } from '@erp/db';
import { and, desc, eq, inArray, isNull, notInArray, sql as dsql } from 'drizzle-orm';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { clasificarHitos, type HitoItem } from '../lib/hitos.js';

const router = Router();
router.use(requireAuth);

const TIPOS_AUTO = [
  'valo_vencida', 'oc_pendiente', 'sobrecosto',
  'valo_presentar', 'valo_no_presentada', 'valo_cobranza',
  'garantia_vencer', 'sctr_vencer', 'oc_sin_pagar', 'rendicion_pendiente', 'cierre_periodo',
  'hito_vencido', 'hito_proximo', 'valorizado_incompleto',
];
const HITO_LABEL: Record<string, string> = {
  entrega_terreno: 'Entrega de terreno', inicio_plazo: 'Inicio de plazo', ampliacion_plazo: 'Ampliación de plazo',
  culminacion: 'Culminación de obra', recepcion: 'Recepción de obra', liquidacion: 'Liquidación', consentimiento_liquidacion: 'Consentimiento de liquidación',
};
const HITO_ALTA = new Set(['culminacion', 'recepcion', 'liquidacion', 'consentimiento_liquidacion']);
const diasDesde = (d: Date | string) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
const diasHasta = (d: Date | string) => Math.floor((new Date(`${String(d).slice(0, 10)}T00:00:00Z`).getTime() - Date.now()) / 86400000);
const addDays = (iso: string, n: number) => { const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const pen = (n: number) => `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const MESN = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
const ACTIVAS = new Set(['adjudicado', 'ejecucion', 'liquidacion']);

type NotifGen = {
  clave: string; tipo: string; severidad: string; titulo: string; detalle: string;
  proyectoId: string | null; proyectoCodigo: string | null; accionUrl: string | null;
};

async function generar(): Promise<void> {
  const proys = await db
    .select({ id: schema.proyectos.id, codigo: schema.proyectos.codigo, status: schema.proyectos.status, fechaInicio: schema.proyectos.fechaInicio, fechaFin: schema.proyectos.fechaFin, diasPlazo: schema.proyectos.diasPlazo, montoVigente: schema.proyectos.montoVigente, montoContractual: schema.proyectos.montoContractual })
    .from(schema.proyectos)
    .where(isNull(schema.proyectos.deletedAt));
  const cod = new Map(proys.map((p) => [p.id, p.codigo]));
  const estadoProy = new Map(proys.map((p) => [p.id, p.status]));
  const CERRANDO = new Set(['liquidacion', 'cerrado', 'cancelado']); // obras en cierre: no molestar con "sin facturar"
  const gen: NotifGen[] = [];

  // 1 · Valorizaciones sin facturar (emitida/aprobada/conformidad) con antigüedad
  const vals = await db.select().from(schema.valorizaciones);
  for (const v of vals) {
    if (['facturada', 'cobrada', 'borrador', 'rechazada'].includes(v.status)) continue;
    if (CERRANDO.has(estadoProy.get(v.proyectoId) ?? '')) continue; // obra en liquidación/cerrada → histórico, no alertar
    const dias = diasDesde(v.fechaEmision);
    if (dias < 7) continue;
    gen.push({
      clave: `valo-pend-${v.id}`, tipo: 'valo_vencida', severidad: dias > 15 ? 'alta' : 'media',
      titulo: `Valorización V${String(v.numero).padStart(2, '0')} sin facturar`,
      detalle: `${cod.get(v.proyectoId) ?? ''} · ${pen(Number(v.montoTotal))} · ${dias} días desde emisión.`,
      proyectoId: v.proyectoId, proyectoCodigo: cod.get(v.proyectoId) ?? null,
      accionUrl: `/proyectos/${v.proyectoId}/valorizaciones`,
    });
  }

  // 2 · OC/OS pendientes de aprobación (Finanzas)
  const ocs = await db.select().from(schema.ordenesCompra).where(eq(schema.ordenesCompra.estado, 'pendiente_aprobacion'));
  for (const o of ocs) {
    const dias = diasDesde(o.createdAt);
    const etq = o.concepto === 'SERVICIO' ? 'OS' : 'OC';
    gen.push({
      clave: `oc-pend-${o.id}`, tipo: 'oc_pendiente', severidad: dias >= 2 ? 'media' : 'baja',
      titulo: `${etq} ${o.numero} pendiente aprobación`,
      detalle: `${pen(Number(o.total))} · lleva ${dias} día(s) sin aprobarse.`,
      proyectoId: o.proyectoId ?? null, proyectoCodigo: o.proyectoId ? cod.get(o.proyectoId) ?? null : null,
      accionUrl: '/finanzas',
    });
  }

  // 3 · Sobrecosto de partida (último avance · realCost vs presupuesto contractual)
  const partidas = await db.select().from(schema.partidas);
  if (partidas.length > 0) {
    const avs = await db.select().from(schema.avances).where(inArray(schema.avances.partidaId, partidas.map((p) => p.id))).orderBy(desc(schema.avances.fecha));
    const ultimo = new Map<string, typeof avs[number]>();
    for (const a of avs) if (!ultimo.has(a.partidaId)) ultimo.set(a.partidaId, a); // primero = más reciente
    for (const p of partidas) {
      const a = ultimo.get(p.id);
      const presu = Number(p.presupuestoContractual ?? 0) || Number(p.presupuesto ?? 0);
      if (!a || presu <= 0) continue;
      const real = Number(a.realCost);
      const desv = (real / presu - 1) * 100;
      if (desv <= 10) continue; // umbral sobrecosto +10%
      gen.push({
        clave: `sobrecosto-${p.id}`, tipo: 'sobrecosto', severidad: desv > 20 ? 'alta' : 'media',
        titulo: `Sobrecosto · partida ${p.codigo}`,
        detalle: `${cod.get(p.proyectoId) ?? ''} · ${p.nombre.slice(0, 60)} · +${desv.toFixed(1)}% sobre presupuesto.`,
        proyectoId: p.proyectoId, proyectoCodigo: cod.get(p.proyectoId) ?? null,
        accionUrl: `/proyectos/${p.proyectoId}/partidas`,
      });
    }
  }

  // 4 · Valorización por presentar (≤10d) / no presentada · vs cronograma (fechaInicio + 30·N)
  const valsPorProy = new Map<string, Set<number>>();
  for (const v of vals) {
    const s = valsPorProy.get(v.proyectoId) ?? new Set<number>();
    s.add(v.numero);
    valsPorProy.set(v.proyectoId, s);
  }
  for (const p of proys) {
    if (!ACTIVAS.has(p.status) || !p.fechaInicio) continue;
    const plazo = Number(p.diasPlazo ?? 0) || (p.fechaFin ? diasHasta(p.fechaFin) - diasHasta(p.fechaInicio) : 0);
    const nPeriodos = Math.min(24, Math.max(1, Math.ceil(plazo / 30)));
    const presentadas = valsPorProy.get(p.id) ?? new Set<number>();
    let nextN = 0;
    for (let n = 1; n <= nPeriodos; n++) if (!presentadas.has(n)) { nextN = n; break; }
    if (!nextN) continue; // todas presentadas
    const fin = addDays(p.fechaInicio, nextN * 30); // fin del periodo ≈ presentación
    const d = diasHasta(fin);
    if (d < 0) {
      gen.push({
        clave: `valo-nopres-${p.id}-${nextN}`, tipo: 'valo_no_presentada', severidad: 'alta',
        titulo: `Valorización V${String(nextN).padStart(2, '0')} NO presentada`,
        detalle: `${p.codigo} · venció ${fin} (hace ${Math.abs(d)}d) · sin subir. Riesgo de cobranza.`,
        proyectoId: p.id, proyectoCodigo: p.codigo, accionUrl: `/proyectos/${p.id}/avance`,
      });
    } else if (d <= 10) {
      gen.push({
        clave: `valo-pres-${p.id}-${nextN}`, tipo: 'valo_presentar', severidad: d <= 3 ? 'alta' : 'media',
        titulo: `Presentar valorización V${String(nextN).padStart(2, '0')}`,
        detalle: `${p.codigo} · vence en ${d}d (${fin}). Prepara y sube la valo del periodo.`,
        proyectoId: p.id, proyectoCodigo: p.codigo, accionUrl: `/proyectos/${p.id}/avance`,
      });
    }
  }

  // 5 · Valo facturada sin cobrar (riesgo de caja)
  for (const v of vals) {
    if (v.status !== 'facturada') continue;
    const dias = diasDesde(v.fechaEmision);
    if (dias < 15) continue;
    gen.push({
      clave: `valo-cobr-${v.id}`, tipo: 'valo_cobranza', severidad: dias > 30 ? 'alta' : 'media',
      titulo: `Valorización V${String(v.numero).padStart(2, '0')} facturada sin cobrar`,
      detalle: `${cod.get(v.proyectoId) ?? ''} · ${pen(Number(v.montoTotal))} · ${dias}d desde factura.`,
      proyectoId: v.proyectoId, proyectoCodigo: cod.get(v.proyectoId) ?? null, accionUrl: `/proyectos/${v.proyectoId}/avance`,
    });
  }

  // 6 · Cartas fianza por vencer (≤30d) / vencidas
  const gar = await db.select().from(schema.garantias).where(eq(schema.garantias.estado, 'vigente'));
  for (const g of gar) {
    if (!g.vigenciaHasta) continue;
    const d = diasHasta(g.vigenciaHasta);
    if (d > 30) continue;
    gen.push({
      clave: `garantia-${g.id}`, tipo: 'garantia_vencer', severidad: 'alta',
      titulo: d < 0 ? `Carta fianza VENCIDA · ${g.tipo}` : `Carta fianza por vencer · ${g.tipo}`,
      detalle: `${cod.get(g.proyectoId) ?? ''} · ${g.numeroCarta ?? ''} · ${pen(Number(g.monto))} · ${d < 0 ? `venció hace ${Math.abs(d)}d` : `vence en ${d}d`}. ${g.bancoEmisor ?? ''}`,
      proyectoId: g.proyectoId, proyectoCodigo: cod.get(g.proyectoId) ?? null, accionUrl: `/proyectos/${g.proyectoId}/contractual`,
    });
  }

  // 7 · SCTR por vencer / vencido (obreros activos)
  const obreros = await db.select().from(schema.empleados).where(and(eq(schema.empleados.activo, true), eq(schema.empleados.tipoPlanilla, 'obrero')));
  for (const e of obreros) {
    if (!e.sctrVigencia) continue;
    const d = diasHasta(e.sctrVigencia);
    if (d > 30) continue;
    gen.push({
      clave: `sctr-${e.id}`, tipo: 'sctr_vencer', severidad: 'alta',
      titulo: d < 0 ? 'SCTR vencido' : 'SCTR por vencer',
      detalle: `${e.nombre} · ${d < 0 ? `venció hace ${Math.abs(d)}d` : `vence en ${d}d`}. Sin SCTR vigente no puede trabajar en obra.`,
      proyectoId: e.proyectoId ?? null, proyectoCodigo: e.proyectoId ? cod.get(e.proyectoId) ?? null : null, accionUrl: '/personal',
    });
  }

  // 8 · OC aprobada/entregada sin pagar
  const ocsPago = await db.select().from(schema.ordenesCompra).where(and(eq(schema.ordenesCompra.estadoPago, 'pendiente'), inArray(schema.ordenesCompra.estado, ['aprobada', 'en_transito', 'entregada'])));
  for (const o of ocsPago) {
    const dias = diasDesde(o.fechaEntrega ?? o.createdAt);
    if (dias < 7) continue;
    const etq = o.concepto === 'SERVICIO' ? 'OS' : 'OC';
    gen.push({
      clave: `oc-pago-${o.id}`, tipo: 'oc_sin_pagar', severidad: o.estado === 'entregada' && dias > 15 ? 'alta' : 'media',
      titulo: `${etq} ${o.numero} sin pagar`,
      detalle: `${pen(Number(o.total))} · ${o.estado} · ${dias}d. Programa el pago al proveedor.`,
      proyectoId: o.proyectoId ?? null, proyectoCodigo: o.proyectoId ? cod.get(o.proyectoId) ?? null : null, accionUrl: '/finanzas',
    });
  }

  // 9 · Rendiciones pendientes de acción (cola del contador)
  const rends = await db.select().from(schema.rendiciones).where(inArray(schema.rendiciones.estado, ['pendiente', 'rendido']));
  for (const r of rends) {
    gen.push({
      clave: `rend-${r.id}`, tipo: 'rendicion_pendiente', severidad: 'media',
      titulo: `Rendición ${r.codigo ?? ''} por ${r.estado === 'rendido' ? 'cerrar' : 'aprobar'}`,
      detalle: `${r.solicitanteNombre ?? ''} · ${r.modo} · ${pen(Number(r.modo === 'anticipo' && r.estado === 'pendiente' ? r.montoAnticipo : r.montoRendido))}.`,
      proyectoId: r.proyectoId ?? null, proyectoCodigo: r.proyectoId ? cod.get(r.proyectoId) ?? null : null, accionUrl: '/oficina',
    });
  }

  // 10 · Cierre de periodo contable pendiente (mes ya terminó · sigue abierto)
  const hoyIso = new Date().toISOString().slice(0, 10);
  const periodos = await db.select().from(schema.periodosContables).where(eq(schema.periodosContables.estado, 'abierto'));
  for (const per of periodos) {
    if (per.fechaFin >= hoyIso) continue; // mes aún en curso
    if (diasDesde(per.fechaFin) > 200) continue; // no spamear periodos muy viejos
    gen.push({
      clave: `cierre-${per.id}`, tipo: 'cierre_periodo', severidad: 'media',
      titulo: `Cierre contable ${MESN[per.mes - 1] ?? per.mes}-${per.anio} pendiente`,
      detalle: `${per.proyectoId ? cod.get(per.proyectoId) ?? '' : 'Empresa'} · el periodo terminó y sigue abierto. Cierra y contabiliza.`,
      proyectoId: per.proyectoId ?? null, proyectoCodigo: per.proyectoId ? cod.get(per.proyectoId) ?? null : null, accionUrl: '/contabilidad',
    });
  }

  // 11 · Hitos contractuales sugeridos por IA (del .mpp) · vencidos / próximos sin registrar
  const hitosReg = await db.select({ proyectoId: schema.hitosObra.proyectoId, tipo: schema.hitosObra.tipo }).from(schema.hitosObra);
  const regPorProy = new Map<string, Set<string>>();
  for (const h of hitosReg) {
    const s = regPorProy.get(h.proyectoId) ?? new Set<string>();
    s.add(h.tipo);
    regPorProy.set(h.proyectoId, s);
  }
  // Agrupa partidas por proyecto para clasificar hitos en vivo (mismas que generador 3)
  const partsPorProy = new Map<string, HitoItem[]>();
  for (const p of partidas) {
    const arr = partsPorProy.get(p.proyectoId) ?? [];
    arr.push({ nombre: p.nombre, isMilestone: !!p.isMilestone, inicio: p.fechaInicio, fin: p.fechaFin });
    partsPorProy.set(p.proyectoId, arr);
  }
  for (const p of proys) {
    if (!ACTIVAS.has(p.status)) continue;
    const sugs = clasificarHitos(partsPorProy.get(p.id) ?? [], p.fechaInicio, p.fechaFin);
    const yaReg = regPorProy.get(p.id) ?? new Set<string>();
    for (const s of sugs) {
      if (s.confianza < 0.6 || yaReg.has(s.tipo)) continue; // solo sólidas y no registradas
      const d = diasHasta(s.fechaPlan);
      const label = HITO_LABEL[s.tipo] ?? s.tipo;
      if (d < 0) {
        gen.push({
          clave: `hito-venc-${p.id}-${s.tipo}`, tipo: 'hito_vencido', severidad: HITO_ALTA.has(s.tipo) ? 'alta' : 'media',
          titulo: `Hito vencido · ${label}`,
          detalle: `${p.codigo} · planificado ${s.fechaPlan} (hace ${Math.abs(d)}d) · sin registrar el acta. ${s.fuente}`,
          proyectoId: p.id, proyectoCodigo: p.codigo, accionUrl: `/proyectos/${p.id}/contractual`,
        });
      } else if (d <= 7) {
        gen.push({
          clave: `hito-prox-${p.id}-${s.tipo}`, tipo: 'hito_proximo', severidad: 'media',
          titulo: `Hito próximo · ${label}`,
          detalle: `${p.codigo} · planificado ${s.fechaPlan} (en ${d}d). Prepara el acta correspondiente.`,
          proyectoId: p.id, proyectoCodigo: p.codigo, accionUrl: `/proyectos/${p.id}/contractual`,
        });
      }
    }
  }

  // 12 · Obra culminada pero valorizado incompleto · falta cargar valos antes del cierre
  const valConIgvPorProy = new Map<string, number>();
  for (const v of vals) {
    const conIgv = Number(v.montoTotalConIgv ?? 0) || Number(v.totalContratista ?? 0) || Number(v.montoValorizacionBruta ?? 0) * 1.18;
    valConIgvPorProy.set(v.proyectoId, (valConIgvPorProy.get(v.proyectoId) ?? 0) + conIgv);
  }
  for (const p of proys) {
    if (p.status === 'cerrado' || p.status === 'cancelado') continue;
    if (!regPorProy.get(p.id)?.has('culminacion')) continue; // solo obras ya culminadas
    const vigente = Number(p.montoVigente ?? 0) || Number(p.montoContractual ?? 0);
    if (vigente <= 0) continue;
    const valorizado = valConIgvPorProy.get(p.id) ?? 0;
    const faltaPct = (1 - valorizado / vigente) * 100;
    if (faltaPct <= 1) continue; // ya está ~100% (tolerancia 1%)
    gen.push({
      clave: `valo-incompleto-${p.id}`, tipo: 'valorizado_incompleto', severidad: faltaPct > 10 ? 'alta' : 'media',
      titulo: `Valorizado incompleto · ${p.codigo}`,
      detalle: `Obra culminada pero valorizado ${(100 - faltaPct).toFixed(1)}% (${pen(valorizado)} de ${pen(vigente)}). Carga las valorizaciones faltantes antes del cierre.`,
      proyectoId: p.id, proyectoCodigo: p.codigo, accionUrl: `/proyectos/${p.id}/valorizaciones`,
    });
  }

  // upsert (no pisa leidoEn) + limpieza de auto-alertas que ya no aplican
  for (const n of gen) {
    await db.insert(schema.notificaciones).values(n).onConflictDoUpdate({
      target: schema.notificaciones.clave,
      set: { titulo: n.titulo, detalle: n.detalle, severidad: n.severidad },
    });
  }
  const vivas = gen.map((n) => n.clave);
  await db.delete(schema.notificaciones).where(
    vivas.length > 0
      ? and(inArray(schema.notificaciones.tipo, TIPOS_AUTO), notInArray(schema.notificaciones.clave, vivas))
      : inArray(schema.notificaciones.tipo, TIPOS_AUTO),
  );
}

// GET /notificaciones · regenera (throttle 60s · evita writes en cada carga) + lista
let ultimaGen = 0;
router.get('/notificaciones', async (req, res) => {
  if (req.query.regen === '1' || Date.now() - ultimaGen > 60_000) {
    await generar();
    ultimaGen = Date.now();
  }
  const items = await db.select().from(schema.notificaciones).orderBy(desc(schema.notificaciones.createdAt)).limit(50);
  const noLeidas = items.filter((n) => !n.leidoEn).length;
  res.json({ items, noLeidas });
});

router.post('/notificaciones/:id/leer', async (req, res) => {
  const [n] = await db.update(schema.notificaciones).set({ leidoEn: new Date() }).where(eq(schema.notificaciones.id, String(req.params.id))).returning();
  if (!n) return res.status(404).json({ error: 'No encontrada' });
  res.json({ notificacion: n });
});

router.post('/notificaciones/leer-todo', async (_req, res) => {
  await db.update(schema.notificaciones).set({ leidoEn: new Date() }).where(isNull(schema.notificaciones.leidoEn));
  res.json({ ok: true });
});

export default router;
