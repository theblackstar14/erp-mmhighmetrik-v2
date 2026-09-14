import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';
import { type HitoObra, type Proyecto, api } from '@/lib/api.js';
import { cn, fmtDate, fmtPEN } from '@/lib/utils.js';

const ResumenCurvaS = lazy(() => import('./ResumenCurvaS.js'));

const HITO_LABEL: Record<string, string> = {
  entrega_terreno: 'Entrega de terreno', inicio_plazo: 'Inicio de plazo', ampliacion_plazo: 'Ampliación de plazo',
  culminacion: 'Culminación', recepcion: 'Recepción', liquidacion: 'Liquidación', consentimiento_liquidacion: 'Consentimiento liquidación',
};
const AVATAR = ['#3B5BDB', '#2F7D5C', '#7C3AED', '#D1453B', '#B45309', '#0891B2'];
const ini = (s: string) => s.split(' ').slice(0, 2).map((x) => x[0]).join('').toUpperCase();

export function ResumenTab({ proyecto }: { proyecto: Proyecto }) {
  const avancesQ = useQuery({
    queryKey: ['avances-proyecto', proyecto.id],
    queryFn: () => api.proyectos.getAvances(proyecto.id),
  });
  const valoresQ = useQuery({
    queryKey: ['valorizaciones', proyecto.id],
    queryFn: () => api.proyectos.getValorizaciones(proyecto.id),
  });
  const curvaQ = useQuery({ queryKey: ['curva-s', proyecto.id], queryFn: () => api.proyectos.getCurvaS(proyecto.id) });
  // misma queryKey que EconomicoTab · react-query dedup · fuente única de costo real
  const costosQ = useQuery({ queryKey: ['costos-obra', proyecto.id], queryFn: () => api.proyectos.getCostosObra(proyecto.id) });
  const hitosQ = useQuery({ queryKey: ['hitos', proyecto.id], queryFn: () => api.contractual.listHitos(proyecto.id) });
  const equipoQ = useQuery({ queryKey: ['equipo', proyecto.id], queryFn: () => api.proyectos.getEquipo(proyecto.id) });
  const notifsQ = useQuery({ queryKey: ['notificaciones'], queryFn: () => api.notificaciones.list() });

  const contrato = Number.parseFloat(proyecto.montoContractual ?? '0');
  // costoDirecto en DB YA es contractual (CD real empresa) · NO multiplicar otra vez
  const cdContractual = Number.parseFloat(proyecto.costoDirecto ?? '0');
  const factorOferta = Number.parseFloat(proyecto.factorOferta ?? '1');
  const montoVigente = Number.parseFloat(
    proyecto.montoVigente ?? proyecto.montoContractual ?? '0',
  );
  const subtotalContratado = Number.parseFloat(proyecto.montoSubtotal ?? '0');
  const pctGg = Number.parseFloat(proyecto.pctGg ?? '0.10');
  const pctUtilidad = Number.parseFloat(proyecto.pctUtilidad ?? '0.07');

  const k = avancesQ.data?.kpis;
  const valStats = valoresQ.data?.stats;
  // Prioridad: valorizaciones (oficial S10) sobre avances manuales
  const totalRealVal = valStats?.sumCd ?? 0;
  const totalReal = totalRealVal > 0 ? totalRealVal : k?.totalReal ?? 0;
  const avanceFisico = totalRealVal > 0 && subtotalContratado > 0
    ? (totalRealVal / subtotalContratado) * 100
    : (k?.avanceFisicoPct ?? 0);
  const avanceFinanciero = totalRealVal > 0 && subtotalContratado > 0
    ? (totalRealVal / subtotalContratado) * 100
    : (k?.avanceFinancieroPct ?? 0);

  // Días restantes · fix TZ + soporte vencido
  const diasRestantes = (() => {
    if (!proyecto.fechaFin) return null;
    const ff = new Date(`${String(proyecto.fechaFin).slice(0, 10)}T00:00:00Z`);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return Math.round((ff.getTime() - today.getTime()) / 86_400_000);
  })();

  // Utilidad CONTRACTUAL · lo que el contrato reconoce sobre CD CONTRACTUAL
  const ggContractual = cdContractual * pctGg;
  const utilNetaContractual = cdContractual * pctUtilidad;
  const subtotalContractual = cdContractual + ggContractual + utilNetaContractual; // sin IGV

  // Proyección utility REAL · si hay ejecución, extrapola costo total real
  // Costo total = CD ejecutado + GG ejecutado (asumido = presupuestado por ahora)
  const earnedValue = k?.earnedValue ?? 0;
  const cdEjecucionExtrapolada =
    earnedValue > 0 && totalReal > 0 ? cdContractual * (totalReal / earnedValue) : cdContractual;
  const ggExtrapolado = ggContractual; // hasta tener compras GG reales · usa presupuestado
  const costoTotalProyectado = cdEjecucionExtrapolada + ggExtrapolado;
  const utilProyectadaReal = subtotalContractual - costoTotalProyectado;
  const margenSobreCDPct =
    cdContractual > 0 ? (utilProyectadaReal / cdContractual) * 100 : 0;

  // Costo/resultado REAL ejecutado · misma fuente que EconomicoTab (evita contradicción entre tabs)
  const co = costosQ.data;
  const costoEjecReal = co ? co.cd.ejecutado + co.ggObra.ejecutado : null;
  const resultadoReal = co ? co.resultadoObra : null;

  const kpis = [
    {
      lbl: 'Contrato',
      val: fmtPEN(contrato),
      sub: montoVigente !== contrato ? `Vigente: ${fmtPEN(montoVigente)}` : 'Monto contractual',
      full: true,
    },
    {
      lbl: 'Costo Directo',
      val: fmtPEN(cdContractual),
      sub: `Contractual · factor oferta ${factorOferta.toFixed(4)}`,
      full: true,
    },
    {
      lbl: costoEjecReal != null ? 'Costo Ejecutado' : 'Valorizado',
      val: fmtPEN(costoEjecReal ?? totalReal),
      sub: costoEjecReal != null
        ? `CD ${fmtPEN(co!.cd.ejecutado)} + GG obra ${fmtPEN(co!.ggObra.ejecutado)}`
        : subtotalContratado > 0
          ? `${((totalReal / subtotalContratado) * 100).toFixed(1)}% del contrato (avance)`
          : 'Avance económico',
      accent: 'text-primary',
    },
    {
      lbl: 'GG Contractual',
      val: fmtPEN(ggContractual),
      sub: `${(pctGg * 100).toFixed(0)}% sobre CD contractual`,
      accent: '',
    },
    {
      lbl: 'Utilidad Presup.',
      val: fmtPEN(utilNetaContractual),
      sub: `${(pctUtilidad * 100).toFixed(0)}% sobre CD contractual`,
      accent: 'text-ok',
    },
    {
      lbl: resultadoReal != null ? 'Resultado Real' : 'Utilidad Real Proy.',
      val: fmtPEN(resultadoReal ?? utilProyectadaReal),
      sub:
        resultadoReal != null
          ? 'Devengado a hoy · valorizado − costo real'
          : totalReal > 0
            ? `Margen ${margenSobreCDPct.toFixed(1)}% · vs costo real`
            : `Sin ejecución · = presupuestada (${(pctUtilidad * 100).toFixed(0)}%)`,
      accent:
        (resultadoReal ?? utilProyectadaReal) >= 0 ? 'text-ok' : 'text-destructive',
    },
    { lbl: 'Avance Físico', val: `${avanceFisico.toFixed(1)}%`, progress: avanceFisico },
    { lbl: 'Avance Financiero', val: `${avanceFinanciero.toFixed(1)}%`, progress: avanceFinanciero },
    {
      lbl: 'Días Restantes',
      val:
        diasRestantes == null
          ? '—'
          : diasRestantes < 0
            ? `Vencido ${Math.abs(diasRestantes)}d`
            : `${diasRestantes}d`,
      sub: proyecto.fechaFin ? `Fin: ${proyecto.fechaFin.slice(0, 10)}` : 'Sin fecha fin',
      accent:
        diasRestantes == null
          ? ''
          : diasRestantes < 0
            ? 'text-destructive'
            : diasRestantes < 30
              ? 'text-warn'
              : '',
    },
  ];

  const equipo = equipoQ.data?.equipo ?? [];
  const hitos = (hitosQ.data?.hitos ?? []).slice().sort((a, b) => a.fecha.localeCompare(b.fecha));
  const alertas = (notifsQ.data?.items ?? []).filter((nt) => nt.proyectoId === proyecto.id && !nt.leidoEn).slice(0, 4);
  const curva = curvaQ.data?.data ?? null;
  const hoyStr = new Date().toISOString().slice(0, 10);
  const hitosPendientes = hitos.filter((h) => h.fecha > hoyStr).length;

  return (
    <div className="space-y-5">
      {/* KPIs · 7 cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2.5">
        {kpis.map((k) => (
          <div key={k.lbl} className="rounded-md border border-line bg-bg-elev p-3 min-w-0">
            <div
              className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-4 truncate"
              title={k.lbl}
            >
              {k.lbl}
            </div>
            <div
              className={`mt-1 text-[16px] font-bold tracking-[-0.02em] truncate ${k.accent ?? ''}`}
              title={k.full ? `${k.val}` : ''}
            >
              {k.val}
            </div>
            {k.sub && (
              <div className="text-[10px] text-ink-3 mt-0.5 truncate" title={k.sub}>
                {k.sub}
              </div>
            )}
            {'progress' in k && k.progress != null && (
              <div className="mt-2 h-1 w-full rounded-full bg-bg-sunken overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, Number(k.progress))}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Curva S + Hitos (izq) · Equipo + Alertas (der) · estilo v1 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-3">
        <div className="space-y-3">
          {/* Curva S grande interactiva */}
          <div className="rounded-md border border-line bg-bg-elev">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h3 className="text-[13px] font-semibold">Curva S — avance acumulado</h3>
              <Link to={`/proyectos/${proyecto.id}/avance`} className="text-[11px] text-primary hover:underline">Ver detalle →</Link>
            </div>
            <div className="p-3">
              {curva && curva.buckets.length > 1 ? (
                <Suspense fallback={<div className="h-[300px] animate-pulse rounded bg-bg-sunken/50" />}>
                  <ResumenCurvaS data={curva} />
                </Suspense>
              ) : (
                <p className="py-12 text-center text-[12px] text-ink-3">Sin curva S · sube cronograma con partidas (fecha + costo)</p>
              )}
            </div>
          </div>

          {/* Hitos del proyecto */}
          <div className="rounded-md border border-line bg-bg-elev">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h3 className="text-[13px] font-semibold">Hitos del proyecto</h3>
              {hitosPendientes > 0 && <span className="chip blue">{hitosPendientes} pendientes</span>}
            </div>
            {hitos.length === 0 ? (
              <p className="p-4 text-[11.5px] text-ink-3">Sin hitos registrados · agrégalos en Contractual</p>
            ) : (
              <div className="divide-y divide-line">
                {hitos.map((h: HitoObra) => {
                  const listo = h.fecha <= hoyStr;
                  return (
                    <div key={h.id} className="flex items-center gap-3 px-4 py-2.5 text-[12px]">
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', listo ? 'bg-emerald-500' : 'bg-amber-500')} />
                      <span className="font-mono text-[10px] uppercase text-ink-4 w-[60px] shrink-0">{fmtDate(h.fecha)}</span>
                      <span className={cn('flex-1 truncate', listo && 'text-ink-4 line-through')}>{HITO_LABEL[h.tipo] ?? h.tipo}{h.numeroDocumento ? ` · ${h.numeroDocumento}` : ''}</span>
                      <span className={cn('chip', listo ? 'green' : 'amber')}>{listo ? '✓ Listo' : 'Pendiente'}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Equipo + Alertas */}
        <div className="space-y-3">
          <div className="rounded-md border border-line bg-bg-elev">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h3 className="text-[13px] font-semibold">Equipo asignado</h3>
              <Link to={`/proyectos/${proyecto.id}/equipo`} className="text-[11px] text-primary hover:underline">{equipo.length} personas</Link>
            </div>
            {equipo.length === 0 ? (
              <p className="p-4 text-[11.5px] text-ink-3">Sin equipo asignado</p>
            ) : (
              <div className="p-3 space-y-2.5">
                {equipo.slice(0, 6).map((m, i) => (
                  <div key={m.profesionalId} className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: AVATAR[i % AVATAR.length] }}>{ini(m.nombre || '?')}</div>
                    <div className="min-w-0 flex-1"><div className="truncate text-[12px] font-medium">{m.nombre}</div><div className="text-[10.5px] text-ink-3">{m.rol}{m.profesion ? ` · ${m.profesion}` : ''}</div></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-md border border-line bg-bg-elev">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h3 className="text-[13px] font-semibold">Alertas activas</h3>
              <span className="inline-flex items-center gap-1 chip blue"><Sparkles className="h-3 w-3" /> IA</span>
            </div>
            {alertas.length === 0 ? (
              <p className="p-4 text-[11.5px] text-ink-3">Sin alertas activas</p>
            ) : (
              <div className="p-3 space-y-2">
                {alertas.map((a) => (
                  <div key={a.id} className={cn('rounded-md border-l-[3px] px-2.5 py-2', a.severidad === 'alta' ? 'border-l-rose-500 bg-rose-500/5' : a.severidad === 'media' ? 'border-l-amber-500 bg-amber-500/5' : 'border-l-ink-4 bg-bg-sunken/40')}>
                    <div className="flex items-center gap-1.5 text-[11.5px] font-semibold">
                      <AlertTriangle className={cn('h-3.5 w-3.5', a.severidad === 'alta' ? 'text-rose-500' : 'text-amber-500')} />
                      {a.titulo}
                    </div>
                    {a.detalle && <div className="text-[10.5px] text-ink-3 mt-0.5 leading-snug">{a.detalle}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Identificación + Estructura económica */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Identificación contractual */}
        <div className="rounded-md border border-line bg-bg-elev">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-[13px] font-semibold">Identificación contractual</h3>
          </div>
          <div className="grid grid-cols-2 gap-3 p-4">
            {[
              { lbl: 'N° Contrato', val: proyecto.numeroContrato ?? '—' },
              { lbl: 'CUI', val: proyecto.cui ?? '—' },
              { lbl: 'N° Licitación', val: proyecto.numeroProcesoLicitacion ?? '—' },
              { lbl: 'Etapa', val: proyecto.etapa ?? '—' },
              { lbl: 'Modalidad', val: proyecto.modalidad ?? '—' },
              { lbl: 'Estado', val: proyecto.status ?? '—' },
              { lbl: 'Fecha buena pro', val: fmtDate(proyecto.fechaBuenaPro) },
              { lbl: 'Firma contrato', val: fmtDate(proyecto.fechaFirmaContrato) },
              { lbl: 'Fecha inicio', val: fmtDate(proyecto.fechaInicio) },
              { lbl: 'Fecha fin', val: fmtDate(proyecto.fechaFin) },
              { lbl: 'Plazo', val: `${proyecto.diasPlazo ?? '—'} días` },
            ].map((d) => (
              <div key={d.lbl}>
                <div className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-4">{d.lbl}</div>
                <div className="text-[12px] text-foreground mt-0.5 break-words">{d.val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Económico · 3 montos clave */}
        <div className="rounded-md border border-line bg-bg-elev">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-[13px] font-semibold">Estructura económica</h3>
          </div>
          <div className="p-4 space-y-3">
            <div>
              <div className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-4">
                Presupuesto referencial · municipalidad
              </div>
              <div className="text-[14px] font-bold text-foreground mt-0.5">
                {fmtPEN(Number.parseFloat(proyecto.montoReferencial ?? '0'))}
              </div>
              <div className="text-[10px] text-ink-3 mt-0.5">CD contractual: {fmtPEN(cdContractual)}</div>
            </div>
            <div className="border-t border-line pt-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-4">
                Monto contractual · oferta consorcio (×{factorOferta.toFixed(2)})
              </div>
              <div className="text-[14px] font-bold text-primary mt-0.5">{fmtPEN(contrato)}</div>
              <div className="text-[10px] text-ink-3 mt-0.5">
                CD contractual: {fmtPEN(cdContractual)}
              </div>
            </div>
            {montoVigente !== contrato && (
              <div className="border-t border-line pt-3">
                <div className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-4">
                  Monto vigente · post modificaciones
                </div>
                <div className="text-[14px] font-bold text-warn mt-0.5">{fmtPEN(montoVigente)}</div>
                <div className="text-[10px] text-ink-3 mt-0.5">
                  Δ: {fmtPEN(montoVigente - contrato)}
                </div>
              </div>
            )}
            <div className="border-t border-line pt-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-4 mb-2">
                Breakdown contractual (lo que cobras)
              </div>
              <div className="space-y-1.5 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-ink-3">CD contractual</span>
                  <span className="font-mono">{fmtPEN(cdContractual)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-3">+ GG ({(pctGg * 100).toFixed(0)}%)</span>
                  <span className="font-mono">{fmtPEN(ggContractual)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-3">+ Utilidad ({(pctUtilidad * 100).toFixed(0)}%)</span>
                  <span className="font-mono text-ok">{fmtPEN(utilNetaContractual)}</span>
                </div>
                <div className="flex justify-between border-t border-line pt-1.5">
                  <span className="text-ink-2 font-medium">Subtotal</span>
                  <span className="font-mono font-medium">{fmtPEN(subtotalContractual)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-3">+ IGV (18%)</span>
                  <span className="font-mono">{fmtPEN(subtotalContractual * 0.18)}</span>
                </div>
                <div className="flex justify-between border-t border-line pt-1.5">
                  <span className="text-ink-2 font-bold">Total</span>
                  <span className="font-mono font-bold text-primary">{fmtPEN(contrato)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
