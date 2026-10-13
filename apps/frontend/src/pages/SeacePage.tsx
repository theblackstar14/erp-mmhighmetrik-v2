/**
 * SEACE · vigilancia de licitaciones de obra pública (contrato: Desktop/SEACE/HANDOFF.md §4).
 * Regla de diseño que no se negocia (§4.3): oportunidad (verde · hallazgo) y manual
 * (ámbar · tarea de lectura) NUNCA se pintan igual. `indeterminado` no es "no": se
 * muestra con la razón de calidad ("Bases Estándar sin montos rellenos").
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, ExternalLink, FileText, Globe, Pin, PinOff, RefreshCw, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { type SeaceProceso, type SeaceResultado, api } from '@/lib/api.js';
import { cn, fmtPEN } from '@/lib/utils.js';

const RESULTADO_UI: Record<string, { lbl: string; chip: string }> = {
  califica: { lbl: 'Califica', chip: 'green' },
  consorcio: { lbl: 'Consorcio', chip: 'amber' },
  no_califica: { lbl: 'No califica', chip: 'red' },
  indeterminado: { lbl: 'En análisis', chip: 'gray' },
};
const NOVEDAD_LBL: Record<string, string> = {
  nuevo: 'Nuevo',
  bases_integradas: 'Bases Integradas publicadas',
  cambio_evaluacion: 'Cambió la evaluación',
  doc_actualizado: 'Documento actualizado',
};

const resultadoDe = (p: { evaluacion?: SeaceProceso['evaluacion']; resultado?: SeaceResultado | null }): SeaceResultado =>
  p.evaluacion?.resultado ?? p.resultado ?? 'indeterminado';

function DiasChip({ d }: { d: number | null }) {
  if (d == null) return <span className="text-ink-4">—</span>;
  const cls = d < 0 ? 'text-ink-4' : d < 15 ? 'text-destructive font-bold' : d < 25 ? 'text-warn-ink font-semibold' : 'text-ink-2';
  return <span className={cn('font-mono text-[11.5px] tabular-nums', cls)}>{d < 0 ? 'vencido' : `${d}d`}</span>;
}

function Monto({ p }: { p: Pick<SeaceProceso, 'valor_referencial' | 'integrada'> }) {
  const v = p.valor_referencial != null ? Number(p.valor_referencial) : null;
  if (!v) return <span className="text-ink-4 text-[10.5px]">sin publicar</span>;
  return (
    <span className="font-mono text-[11.5px] tabular-nums">
      {fmtPEN(v)}
      {!p.integrada && <span className="ml-1 text-[9px] text-amber-600" title="Monto preliminar · las Bases aún no están integradas">prelim.</span>}
    </span>
  );
}

export function SeacePage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [fResultado, setFResultado] = useState('');
  const [soloPinned, setSoloPinned] = useState(false);
  const [detalle, setDetalle] = useState<string | null>(null);

  const lastRunQ = useQuery({ queryKey: ['seace-lastrun'], queryFn: () => api.seace.lastRun(), retry: 1 });
  const alertasQ = useQuery({ queryKey: ['seace-alertas'], queryFn: () => api.seace.alertas(100), retry: 1 });
  const listaQ = useQuery({
    queryKey: ['seace-procesos', fResultado, soloPinned],
    queryFn: () => api.seace.procesos({ resultado: fResultado || undefined, pinned: soloPinned || undefined, orderBy: 'score', direction: 'desc', limit: 500 }),
    retry: 1,
  });

  const procesos = listaQ.data?.data ?? [];
  const filtrados = useMemo(() => {
    const ql = search.trim().toLowerCase();
    if (!ql) return procesos;
    return procesos.filter((p) => [p.nomenclatura, p.entidad, p.descripcion_corta].some((x) => (x ?? '').toLowerCase().includes(ql)));
  }, [procesos, search]);

  const kpis = useMemo(() => {
    const by = (r: SeaceResultado) => procesos.filter((p) => resultadoDe(p) === r);
    const suma = (arr: SeaceProceso[]) => arr.reduce((s, p) => s + Number(p.valor_referencial ?? 0), 0);
    const califica = by('califica');
    const consorcio = by('consorcio');
    return {
      total: procesos.length,
      califica: califica.length, montoCalifica: suma(califica),
      consorcio: consorcio.length, montoConsorcio: suma(consorcio),
      indeterminado: by('indeterminado').length,
      noCalifica: by('no_califica').length,
    };
  }, [procesos]);

  const pinMut = useMutation({
    mutationFn: ({ nid, pinned }: { nid: string; pinned: boolean }) => (pinned ? api.seace.unpin(nid) : api.seace.pin(nid)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seace-procesos'] });
      qc.invalidateQueries({ queryKey: ['seace-alertas'] });
      if (detalle) qc.invalidateQueries({ queryKey: ['seace-detalle', detalle] });
    },
  });

  const recargar = () => {
    qc.invalidateQueries({ queryKey: ['seace-lastrun'] });
    qc.invalidateQueries({ queryKey: ['seace-alertas'] });
    qc.invalidateQueries({ queryKey: ['seace-procesos'] });
  };

  // Salud del servicio: error = scraper apagado/no configurado · >30h sin corrida = cron caído
  const caido = lastRunQ.isError;
  const run = lastRunQ.data?.run ?? null;
  const horasDesdeRun = run?.started_at ? (Date.now() - new Date(run.started_at).getTime()) / 3_600_000 : null;

  const alertas = alertasQ.data?.data ?? [];
  const oportunidades = alertas.filter((a) => a.revisar_tipo === 'oportunidad');
  const manuales = alertas.filter((a) => a.revisar_tipo !== 'oportunidad');

  return (
    <div className="animate-dataIn space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary font-bold">SEACE</span>
            {caido ? (
              <span className="chip red">● sin conexión al scraper</span>
            ) : (
              <span className="chip green">● conectado</span>
            )}
            {run && (
              <span className={cn('chip', (horasDesdeRun ?? 0) > 30 ? 'red' : 'gray')} title={run.started_at}>
                última corrida {horasDesdeRun != null ? (horasDesdeRun < 1 ? 'hace menos de 1h' : `hace ${Math.round(horasDesdeRun)}h`) : '—'}
              </span>
            )}
          </div>
          <h1 className="text-[20px] font-bold tracking-[-0.01em] mt-1">Licitaciones de obra pública</h1>
          <p className="text-[12px] text-ink-3 mt-0.5">Vigilancia nocturna · Bases leídas con IA · cruce contra el plantel propio</p>
        </div>
        <button onClick={recargar} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-line text-[12px] text-ink-2 hover:bg-bg-sunken">
          <RefreshCw className={cn('h-3.5 w-3.5', (listaQ.isFetching || alertasQ.isFetching) && 'animate-spin')} /> Recargar
        </button>
      </div>

      {caido && (
        <div className="rounded-md border border-destructive/30 bg-destructive-soft px-4 py-3 text-[12px] text-destructive">
          No se puede hablar con el scraper SEACE. Mostrando nada: ¿servicio arriba? ¿SEACE_API_URL/KEY en el backend?
        </div>
      )}

      {/* Novedades de anoche · §4.4: dos bloques, NUNCA mezclados */}
      {!caido && (oportunidades.length > 0 || manuales.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-md border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-emerald-500/20 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <h3 className="text-[12.5px] font-semibold">Oportunidades</h3>
              <span className="text-[11px] text-ink-4">{oportunidades.length}</span>
              <span className="ml-auto text-[10px] text-ink-4">evaluadas por la máquina · hay que decidir</span>
            </div>
            {oportunidades.length === 0 ? (
              <p className="px-4 py-3 text-[11.5px] text-ink-4">Sin novedades</p>
            ) : (
              oportunidades.map((a) => (
                <button key={a.nid_proceso} onClick={() => setDetalle(a.nid_proceso)} className="w-full text-left px-4 py-2 border-b border-emerald-500/10 last:border-b-0 hover:bg-emerald-100/40 dark:hover:bg-emerald-900/20">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-400">{a.nomenclatura}</span>
                    <DiasChip d={a.dias_restantes_hoy} />
                    <span className="text-[10.5px] text-ink-3">{NOVEDAD_LBL[a.novedad ?? ''] ?? a.motivo ?? ''}</span>
                  </div>
                  <div className="text-[10.5px] text-ink-3 mt-0.5 truncate">{a.entidad}{a.valor_referencial ? ` · ${fmtPEN(Number(a.valor_referencial))}` : ''}</div>
                </button>
              ))
            )}
          </div>
          <div className="rounded-md border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-amber-500/20 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <h3 className="text-[12.5px] font-semibold">Revisar a mano</h3>
              <span className="text-[11px] text-ink-4">{manuales.length}</span>
              <span className="ml-auto text-[10px] text-ink-4">sin evaluación automática · leer las Bases</span>
            </div>
            {manuales.length === 0 ? (
              <p className="px-4 py-3 text-[11.5px] text-ink-4">Sin pendientes</p>
            ) : (
              manuales.map((a) => (
                <button key={a.nid_proceso} onClick={() => setDetalle(a.nid_proceso)} className="w-full text-left px-4 py-2 border-b border-amber-500/10 last:border-b-0 hover:bg-amber-100/40 dark:hover:bg-amber-900/20">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-bold text-amber-700 dark:text-amber-400">{a.nomenclatura}</span>
                    <DiasChip d={a.dias_restantes_hoy} />
                    <span className="text-[10.5px] text-ink-3 truncate">{a.motivo ?? 'sin motivo'}</span>
                  </div>
                  <div className="text-[10.5px] text-ink-3 mt-0.5 truncate">{a.entidad ?? ''}</div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat lbl="En seguimiento" val={String(kpis.total)} sub={run ? 'procesos vigilados' : 'sin corridas aún'} />
        <Stat lbl="Califican" val={String(kpis.califica)} sub={kpis.califica ? fmtPEN(kpis.montoCalifica) : '—'} tone="green" />
        <Stat lbl="Consorcio" val={String(kpis.consorcio)} sub={kpis.consorcio ? fmtPEN(kpis.montoConsorcio) : '—'} tone="amber" />
        <Stat lbl="En análisis" val={String(kpis.indeterminado)} sub="Bases aún sin datos" />
        <Stat lbl="No califican" val={String(kpis.noCalifica)} sub="descartadas con razón" tone="red" />
      </div>

      {/* Filtros + tabla */}
      <div className="rounded-md border border-line bg-bg-elev overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-4" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nomenclatura, entidad, descripción..." className="h-8 w-64 rounded-md border border-line bg-bg-sunken pl-7 pr-3 text-[12px] outline-none placeholder:text-ink-4 focus:border-primary" />
          </div>
          <select value={fResultado} onChange={(e) => setFResultado(e.target.value)} className="h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px]">
            <option value="">Todos los resultados</option>
            <option value="califica">Califica</option>
            <option value="consorcio">Consorcio</option>
            <option value="indeterminado">En análisis</option>
            <option value="no_califica">No califica</option>
          </select>
          <label className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-2 cursor-pointer">
            <input type="checkbox" checked={soloPinned} onChange={(e) => setSoloPinned(e.target.checked)} className="rounded border-line" />
            Solo marcados
          </label>
          <span className="ml-auto text-[11px] text-ink-4">{filtrados.length} procesos · orden: score</span>
        </div>

        {listaQ.isLoading ? (
          <div className="p-10 text-center text-[12px] text-ink-3">Cargando licitaciones...</div>
        ) : filtrados.length === 0 ? (
          <div className="p-12 text-center">
            <Globe className="mx-auto mb-3 h-8 w-8 text-ink-4" />
            <p className="text-[12.5px] font-medium">{caido ? 'Sin conexión' : 'Sin procesos'}</p>
            <p className="text-[11.5px] text-ink-3 mt-1">{caido ? 'Levanta el scraper y recarga' : 'El robot corre cada noche · aparecerán aquí'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-bg-sunken border-b border-line">
                <tr className="text-left text-[10px] font-mono uppercase tracking-wider text-ink-4">
                  <th className="px-3 py-2 w-8" />
                  <th className="px-3 py-2 w-56">Nomenclatura</th>
                  <th className="px-3 py-2">Entidad / Descripción</th>
                  <th className="px-3 py-2 w-36">Ubicación</th>
                  <th className="px-3 py-2 w-32 text-right">Monto</th>
                  <th className="px-3 py-2 w-16 text-center">Días</th>
                  <th className="px-3 py-2 w-14 text-center">Score</th>
                  <th className="px-3 py-2 w-24">Plantel</th>
                  <th className="px-3 py-2 w-28">Resultado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtrados.map((p) => {
                  const r = RESULTADO_UI[resultadoDe(p)] ?? RESULTADO_UI.indeterminado!;
                  const ubic = [p.distrito, p.provincia, p.region].filter(Boolean).join(', ');
                  return (
                    <tr key={p.nid_proceso} className="hover:bg-bg-sunken/30 cursor-pointer" onClick={() => setDetalle(p.nid_proceso)}>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => pinMut.mutate({ nid: p.nid_proceso, pinned: p.pinned })}
                          title={p.pinned ? 'Quitar marca (sus documentos vuelven a purgarse 7 días tras el cierre)' : 'Marcar · protege sus documentos de la purga'}
                          className={cn('h-6 w-6 rounded inline-flex items-center justify-center hover:bg-bg-sunken', p.pinned ? 'text-primary' : 'text-ink-4 hover:text-primary')}
                        >
                          {p.pinned ? <Pin className="h-3.5 w-3.5 fill-current" /> : <Pin className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-[10.5px] font-semibold text-primary">{p.nomenclatura}</span>
                        {p.novedad && p.revisar && (
                          <div className={cn('text-[9px] mt-0.5 font-medium', p.revisar_tipo === 'oportunidad' ? 'text-emerald-600' : 'text-amber-600')}>
                            ● {NOVEDAD_LBL[p.novedad] ?? p.novedad}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-[11.5px] truncate max-w-[320px]" title={p.entidad ?? ''}>{p.entidad ?? '—'}</div>
                        <div className="text-[10.5px] text-ink-4 truncate max-w-[320px]">{p.descripcion_corta ?? ''}</div>
                      </td>
                      <td className="px-3 py-2 text-[10.5px] text-ink-3">{ubic || '—'}</td>
                      <td className="px-3 py-2 text-right"><Monto p={p} /></td>
                      <td className="px-3 py-2 text-center"><DiasChip d={p.dias_restantes_hoy} /></td>
                      <td className="px-3 py-2 text-center font-mono text-[11px] text-ink-3">{p.score ?? '—'}</td>
                      <td className="px-3 py-2">
                        {p.plantel?.cumple
                          ? <span className={`chip ${p.plantel.cumple === 'si' ? 'green' : p.plantel.cumple === 'parcial' ? 'amber' : 'red'}`}>{p.plantel.cumple === 'si' ? 'cubierto' : p.plantel.cumple === 'parcial' ? `${p.plantel.cubiertos}/${p.plantel.total}` : 'falta'}</span>
                          : <span className="text-ink-4 text-[10px]">—</span>}
                      </td>
                      <td className="px-3 py-2"><span className={`chip ${r.chip}`}>{r.lbl}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[10.5px] text-ink-4">El sistema revisa SEACE cada noche y avisa cuando se publican las Bases Integradas.</p>

      {detalle && <DetalleModal nid={detalle} onClose={() => setDetalle(null)} onPin={(nid, pinned) => pinMut.mutate({ nid, pinned })} />}
    </div>
  );
}

// ─── Detalle ─────────────────────────────────────────────────
function DetalleModal({ nid, onClose, onPin }: { nid: string; onClose: () => void; onPin: (nid: string, pinned: boolean) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['seace-detalle', nid], queryFn: () => api.seace.proceso(nid) });
  const p = data?.proceso;
  const docs = data?.documentos ?? [];
  const r = p ? (RESULTADO_UI[resultadoDe(p)] ?? RESULTADO_UI.indeterminado!) : null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-backdropIn" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-xl border border-line bg-bg-elev shadow-2xl animate-modalPop">
        {isLoading || !p ? (
          <div className="p-10 text-center text-[12px] text-ink-3">Cargando...</div>
        ) : (
          <>
            <div className="sticky top-0 bg-bg-elev border-b border-line px-5 py-3.5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[12px] font-bold text-primary">{p.nomenclatura}</span>
                  {r && <span className={`chip ${r.chip}`}>{r.lbl}</span>}
                  {p.integrada ? <span className="chip green">Bases Integradas</span> : <span className="chip gray">pre-integración</span>}
                  <DiasChip d={p.dias_restantes_hoy} />
                </div>
                <p className="text-[11.5px] text-ink-3 mt-1">{p.entidad}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => onPin(p.nid_proceso, p.pinned)}
                  title={p.pinned ? 'Quitar marca' : 'Marcar · protege sus documentos de la purga (sin marca se borran 7 días tras el cierre)'}
                  className={cn('h-8 w-8 rounded-md border border-line inline-flex items-center justify-center hover:bg-bg-sunken', p.pinned ? 'text-primary' : 'text-ink-3')}
                >
                  {p.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                </button>
                <button onClick={onClose} className="h-8 w-8 rounded-md inline-flex items-center justify-center text-ink-3 hover:bg-bg-sunken"><X className="h-4 w-4" /></button>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {/* 1 · La decisión */}
              <section>
                <h4 className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4 mb-1.5">Evaluación</h4>
                {resultadoDe(p) === 'indeterminado' ? (
                  <div className="rounded-md border border-line bg-bg-sunken/40 px-3 py-2.5 text-[12px] text-ink-2 flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-500 shrink-0" />
                    <div>
                      Aún no se puede evaluar. {p.calidad_texto?.razonCalidad ?? 'Las Bases no traen los datos definitivos.'}
                      {p.dias_hasta_integracion != null && p.dias_hasta_integracion >= 0 && (
                        <div className="text-[11px] text-ink-3 mt-1">Bases Integradas estimadas en ~{p.dias_hasta_integracion} días · el sistema avisará.</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {(p.evaluacion?.razones ?? []).map((rz, i) => (
                      <div key={i} className="text-[12px] text-ink-2 flex items-start gap-2"><span className="text-ink-4 mt-0.5">·</span>{rz}</div>
                    ))}
                    {p.evaluacion?.sugerenciaConsorcio && (
                      <div className="rounded-md border border-amber-500/30 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2 text-[11.5px] text-amber-800 dark:text-amber-300">
                        Consorcio: {p.evaluacion.sugerenciaConsorcio}
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* 2 · Datos clave */}
              <section className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <Dato lbl="Valor referencial" val={p.valor_referencial ? fmtPEN(Number(p.valor_referencial)) : 'sin publicar'} warn={!p.integrada && !!p.valor_referencial} />
                <Dato lbl="Presentación" val={p.fecha_propuesta ? new Date(p.fecha_propuesta).toLocaleDateString('es-PE') : '—'} />
                <Dato lbl="Ubicación" val={[p.distrito, p.provincia, p.region].filter(Boolean).join(', ') || '—'} />
                <Dato lbl="Seguimiento" val={p.veces_visto ? `${p.veces_visto} corridas` : '—'} />
              </section>

              {p.descripcion && <p className="text-[11.5px] text-ink-3 leading-relaxed">{p.descripcion}</p>}

              {/* 3 · Plantel */}
              {p.plantel && (p.plantel.total ?? 0) > 0 && (
                <section>
                  <h4 className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4 mb-1.5">
                    Plantel exigido · {p.plantel.cubiertos ?? 0}/{p.plantel.total} cubierto con personal propio
                  </h4>
                  <div className="space-y-1">
                    {(p.plantel.asignaciones ?? []).map((a, i) => (
                      <div key={`a${i}`} className="flex items-center gap-2 text-[11.5px] rounded border border-emerald-500/20 bg-emerald-50/40 dark:bg-emerald-950/15 px-2.5 py-1.5">
                        <span className="text-emerald-600">✓</span>
                        <span className="text-ink-2">{String(a.cargo ?? a.puesto ?? 'cargo')}</span>
                        <span className="ml-auto text-ink-3 text-[10.5px]">{String(a.persona ?? a.nombre ?? '')}</span>
                      </div>
                    ))}
                    {(p.plantel.faltantes ?? []).map((f, i) => (
                      <div key={`f${i}`} className="flex items-center gap-2 text-[11.5px] rounded border border-line bg-bg-sunken/40 px-2.5 py-1.5">
                        <span className="text-ink-4">○</span>
                        <span className="text-ink-2">{String(f.cargo ?? f.puesto ?? f.titulo ?? 'requisito')}</span>
                        <span className="ml-auto text-ink-4 text-[10px]">falta · se contrata por obra</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* 4 · Documentos */}
              <section>
                <h4 className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4 mb-1.5">Documentos</h4>
                {docs.length === 0 ? (
                  <p className="text-[11.5px] text-ink-4">Sin documentos descargados aún</p>
                ) : (
                  <div className="space-y-1">
                    {docs.map((d, i) => {
                      const ref = String(d.hash_sha256 ?? d.ref ?? '');
                      const nombre = String(d.filename ?? d.documento ?? `documento ${i + 1}`);
                      const kb = d.size_bytes ? `${(Number(d.size_bytes) / 1024 / 1024).toFixed(1)} MB` : '';
                      return (
                        <a
                          key={ref || i}
                          href={ref ? api.seace.downloadUrl(p.nid_proceso, ref) : undefined}
                          className="flex items-center gap-2 rounded border border-line px-2.5 py-1.5 text-[11.5px] hover:border-primary/40 hover:bg-primary/5"
                        >
                          <FileText className="h-3.5 w-3.5 text-ink-3 shrink-0" />
                          <span className="truncate flex-1">{nombre}</span>
                          {d.etapa != null && <span className="text-[9.5px] text-ink-4 shrink-0">{String(d.etapa)}</span>}
                          <span className="text-[10px] text-ink-4 font-mono shrink-0">{kb}</span>
                          <Download className="h-3 w-3 text-ink-4 shrink-0" />
                        </a>
                      );
                    })}
                  </div>
                )}
                {!p.pinned && <p className="text-[10px] text-ink-4 mt-1.5">Sin marcar, los archivos se purgan 7 días después del cierre.</p>}
              </section>

              {/* Link al portal */}
              <a
                href={`https://prod2.seace.gob.pe/seacebus-uiwd-pub/buscadorPublico/buscadorPublico.xhtml`}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] text-ink-3 hover:text-primary"
              >
                <ExternalLink className="h-3 w-3" /> Buscar en el portal SEACE (nomenclatura: {p.nomenclatura})
              </a>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Dato({ lbl, val, warn }: { lbl: string; val: string; warn?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-bg-sunken/40 px-2.5 py-2">
      <div className="font-mono text-[8.5px] uppercase tracking-wider text-ink-4">{lbl}</div>
      <div className="text-[12px] font-semibold mt-0.5 truncate" title={val}>{val}{warn && <span className="ml-1 text-[9px] text-amber-600 font-normal">prelim.</span>}</div>
    </div>
  );
}

function Stat({ lbl, val, sub, tone }: { lbl: string; val: string; sub?: string; tone?: 'green' | 'amber' | 'red' }) {
  const color = tone === 'green' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : tone === 'red' ? 'text-destructive' : 'text-foreground';
  return (
    <div className="rounded-md border border-line bg-bg-elev p-3 min-w-0">
      <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4 truncate">{lbl}</div>
      <div className={cn('mt-1 text-[18px] font-bold tracking-[-0.02em]', color)}>{val}</div>
      {sub && <div className="text-[10px] text-ink-3 mt-0.5 truncate" title={sub}>{sub}</div>}
    </div>
  );
}
