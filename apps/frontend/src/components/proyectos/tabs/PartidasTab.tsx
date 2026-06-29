import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, FileText, Pencil, RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { EditAvanceModal } from '@/components/proyectos/avance/EditAvanceModal.js';
import { type Partida, api } from '@/lib/api.js';
import { cn, fmtPEN, partidaPrecioUnitario, partidaPresupuesto } from '@/lib/utils.js';

type RollupVal = { realCost: number; pctAvance: number; fromVal: boolean; comprometido: number };

export function PartidasTab({ proyectoId }: { proyectoId: string }) {
  const qc = useQueryClient();
  const partidasQ = useQuery({ queryKey: ['partidas', proyectoId], queryFn: () => api.proyectos.listPartidas(proyectoId) });
  const avancesQ = useQuery({ queryKey: ['avances-proyecto', proyectoId], queryFn: () => api.proyectos.getAvances(proyectoId) });
  const costosQ = useQuery({ queryKey: ['partidas-costos', proyectoId], queryFn: () => api.proyectos.getPartidasCostos(proyectoId) });
  const rebuildMut = useMutation({
    mutationFn: () => api.proyectos.rebuildRollup(proyectoId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partidas', proyectoId] });
      qc.invalidateQueries({ queryKey: ['proyecto', proyectoId] });
      qc.invalidateQueries({ queryKey: ['curva-s', proyectoId] });
    },
  });

  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<Partida | null>(null);
  const [selected, setSelected] = useState<Partida | null>(null);

  // Memoizar la fuente · era un .filter nuevo cada render → rompía la memoización de todo lo de abajo
  const partidas = useMemo(
    () => (partidasQ.data?.partidas ?? []).filter((p) => !p.isMilestone && !p.codigo.startsWith('00.HITO')),
    [partidasQ.data],
  );
  const avances = avancesQ.data?.avances ?? {};
  const costos = costosQ.data?.costos ?? {};

  const getBudget = partidaPresupuesto;
  const getPU = partidaPrecioUnitario;

  // Índices O(1) · reemplazan find/some dentro de loops (era O(n²) con cientos de partidas)
  const byCodigo = useMemo(() => new Map(partidas.map((p) => [p.codigo, p])), [partidas]);
  const childrenOf = useMemo(() => {
    const m = new Map<string, Partida[]>();
    for (const p of partidas) {
      if (!p.parentCodigo) continue;
      const arr = m.get(p.parentCodigo) ?? [];
      arr.push(p);
      m.set(p.parentCodigo, arr);
    }
    return m;
  }, [partidas]);

  // Expandir nivel-1 al cargar · useEffect (no useMemo · era un setState como efecto de render)
  useEffect(() => {
    if (partidas.length > 0 && expanded.size === 0) {
      setExpanded(new Set(partidas.filter((p) => p.nivel === 1).map((p) => p.codigo)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partidas]);

  const visiblePartidas = useMemo(() => {
    if (partidas.length === 0) return [];
    const ql = search.trim().toLowerCase();
    if (ql) {
      const matched = new Set<string>();
      partidas.forEach((p) => {
        if (p.nombre.toLowerCase().includes(ql) || p.codigo.includes(ql)) {
          matched.add(p.codigo);
          let parent = p.parentCodigo;
          while (parent) {
            matched.add(parent);
            parent = byCodigo.get(parent)?.parentCodigo ?? null;
          }
        }
      });
      return partidas.filter((p) => matched.has(p.codigo));
    }
    return partidas.filter((p) => {
      if (p.nivel === 1) return true;
      let parent = p.parentCodigo;
      while (parent) {
        if (!expanded.has(parent)) return false;
        parent = byCodigo.get(parent)?.parentCodigo ?? null;
      }
      return true;
    });
  }, [partidas, search, expanded, byCodigo]);

  const hasChildren = (p: Partida) => childrenOf.has(p.codigo);

  const toggle = (codigo: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(codigo)) next.delete(codigo);
      else next.add(codigo);
      return next;
    });
  const expandAll = () => setExpanded(new Set(partidas.map((p) => p.codigo)));
  const collapseAll = () => setExpanded(new Set(partidas.filter((p) => p.nivel === 1).map((p) => p.codigo)));

  const totalCD = partidas.filter((p) => p.nivel === 1).reduce((s, p) => s + getBudget(p), 0);
  const summariesSinRollup = partidas.filter((p) => {
    if (!p.isSummary) return false;
    if (!partidas.some((c) => c.parentCodigo === p.codigo)) return false;
    return getBudget(p) === 0 || Boolean(p.fechaInicio && p.fechaFin && !p.duracionDias);
  });
  const hojasSinDuracion = partidas.filter((p) => !p.isSummary && p.fechaInicio && p.fechaFin && !p.duracionDias);
  const necesitaRollup = summariesSinRollup.length > 0 || hojasSinDuracion.length > 0;

  const totalReal = partidas.reduce((s, p) => (p.valorizado ? s + Number(p.valorizado.montoAcumulado) : s), 0);
  const totalRealEfectivo = totalReal > 0 ? totalReal : partidas.filter((p) => p.nivel === 1).reduce((s, p) => s + (avances[p.codigo]?.realCost ?? 0), 0);
  const pctAvanceGlobal = totalCD > 0 ? (totalRealEfectivo / totalCD) * 100 : 0;
  const totalComprometido = Object.values(costos).reduce((s, c) => s + c.comprometido, 0);

  // ─── Rollup · ejecutado (valos) + comprometido (OC), parents = suma hojas ───
  const rollup = useMemo(() => {
    const result = new Map<string, RollupVal>();
    if (partidas.length === 0) return result;
    for (const p of partidas) {
      const has = childrenOf.has(p.codigo);
      const comp = costos[p.id]?.comprometido ?? 0;
      if (!has && p.valorizado) {
        result.set(p.codigo, { realCost: Number(p.valorizado.montoAcumulado), pctAvance: Number(p.valorizado.pctAvanceReal), fromVal: true, comprometido: comp });
      } else if (!has) {
        const a = avances[p.codigo];
        result.set(p.codigo, { realCost: a?.realCost ?? 0, pctAvance: a?.avancePct ?? 0, fromVal: false, comprometido: comp });
      }
    }
    const byParent = childrenOf; // reusa el índice O(1)
    const niveles = [...new Set(partidas.map((p) => p.nivel))].sort((a, b) => b - a);
    for (const lvl of niveles) {
      for (const p of partidas.filter((p) => p.nivel === lvl)) {
        if (result.has(p.codigo)) continue;
        const hijos = byParent.get(p.codigo) ?? [];
        if (hijos.length === 0) continue;
        let sumReal = 0, sumBudget = 0, sumComp = 0, anyFromVal = false;
        for (const h of hijos) {
          const r = result.get(h.codigo);
          sumReal += r?.realCost ?? 0;
          sumComp += r?.comprometido ?? 0;
          sumBudget += getBudget(h);
          if (r?.fromVal) anyFromVal = true;
        }
        const budget = getBudget(p);
        const denom = budget > 0 ? budget : sumBudget;
        result.set(p.codigo, { realCost: sumReal, pctAvance: denom > 0 ? (sumReal / denom) * 100 : 0, fromVal: anyFromVal, comprometido: sumComp });
      }
    }
    return result;
  }, [partidas, avances, costos, childrenOf]);

  // Virtualización · solo renderiza las filas visibles en viewport (antes: todas las del árbol)
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirt = useVirtualizer({
    count: visiblePartidas.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 32,
    overscan: 14,
  });

  if (partidasQ.isLoading) return <div className="text-[12px] text-ink-3">Cargando partidas...</div>;
  if (partidas.length === 0) {
    return (
      <div className="rounded-md border border-line bg-bg-elev p-12 text-center">
        <FileText className="mx-auto mb-4 h-8 w-8 text-ink-4" />
        <h3 className="text-[14px] font-semibold mb-1.5">Sin partidas todavía</h3>
        <p className="text-[12px] text-ink-3">Sube el cronograma desde el tab Cronograma para extraer partidas auto</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {necesitaRollup && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-warn/30 bg-warn-soft px-3 py-2.5">
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-warn-ink">{summariesSinRollup.length} capítulos sin presupuesto · {hojasSinDuracion.length} partidas sin duración</p>
            <p className="text-[11px] text-warn-ink/80 mt-0.5">Capítulos padres en S/ 0. Click para calcular rollup bottom-up.</p>
          </div>
          <button type="button" onClick={() => rebuildMut.mutate()} disabled={rebuildMut.isPending} className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-warn text-white text-[11.5px] font-medium hover:opacity-90 disabled:opacity-50 shrink-0">
            <RefreshCw className={cn('h-3 w-3', rebuildMut.isPending && 'animate-spin')} /> {rebuildMut.isPending ? 'Calculando...' : 'Calcular rollup'}
          </button>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat lbl="Total Presupuesto" val={fmtPEN(totalCD)} sub={`${partidas.length} partidas · ${partidas.filter((p) => p.nivel === 1).length} grupos`} accent />
        <Stat lbl="Ejecutado (valos)" val={fmtPEN(totalRealEfectivo)} sub={`${pctAvanceGlobal.toFixed(1)}% del presupuesto`} accent />
        <Stat lbl="Comprometido (OC)" val={fmtPEN(totalComprometido)} sub={totalComprometido > 0 ? `${((totalComprometido / (totalCD || 1)) * 100).toFixed(1)}% del presupuesto` : 'sin órdenes aún'} warn={totalComprometido > totalCD && totalCD > 0} />
        <Stat lbl="Saldo presupuesto" val={fmtPEN(totalCD - totalComprometido)} sub="presupuesto − comprometido" />
      </div>

      {/* Tabla + panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 items-start">
        <div className="rounded-md border border-line bg-bg-elev min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div>
              <h3 className="text-[13px] font-semibold">Presupuesto · partidas</h3>
              <p className="text-[11px] text-ink-3 mt-0.5">{visiblePartidas.length} visibles · click → detalle</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-4" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar partida..." className="h-8 w-48 rounded-md border border-line bg-bg-sunken pl-7 pr-3 text-[12px] outline-none placeholder:text-ink-4 focus:border-primary" />
              </div>
              <button type="button" onClick={expandAll} className="h-8 px-2.5 rounded-md border border-line text-[11px] text-ink-2 hover:bg-bg-sunken">Expandir</button>
              <button type="button" onClick={collapseAll} className="h-8 px-2.5 rounded-md border border-line text-[11px] text-ink-2 hover:bg-bg-sunken">Colapsar</button>
            </div>
          </div>

          <div ref={scrollRef} className="overflow-x-auto max-h-[640px] overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-bg-sunken z-10">
                <tr className="border-b border-line">
                  <Th width="w-24">Código</Th>
                  <Th>Descripción</Th>
                  <Th align="right" width="w-28">Presup.</Th>
                  <Th align="right" width="w-28">Ejecutado</Th>
                  <Th align="right" width="w-28">Compromet.</Th>
                  <Th align="right" width="w-20">Desv.</Th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const items = rowVirt.getVirtualItems();
                  const padTop = items.length ? items[0]!.start : 0;
                  const padBottom = items.length ? rowVirt.getTotalSize() - items[items.length - 1]!.end : 0;
                  return (<>
                {padTop > 0 && <tr aria-hidden><td colSpan={6} style={{ height: padTop }} className="p-0" /></tr>}
                {items.map((vi) => {
                  const p = visiblePartidas[vi.index]!;
                  const has = hasChildren(p);
                  const isOpen = expanded.has(p.codigo);
                  const indent = (p.nivel - 1) * 14;
                  const fontWeight = p.nivel === 1 ? 700 : p.nivel === 2 ? 600 : 500;
                  const bg = p.nivel === 1 ? 'bg-bg-sunken/50' : p.nivel === 2 ? 'bg-bg-sunken/20' : '';
                  const r = rollup.get(p.codigo);
                  const budget = getBudget(p);
                  const real = r?.realCost ?? 0;
                  const comp = r?.comprometido ?? 0;
                  const fromVal = r?.fromVal ?? false;
                  // Desviación · comprometido vs presupuesto (señal de sobrecosto)
                  const desv = budget > 0 && comp > 0 ? ((comp - budget) / budget) * 100 : null;
                  const sobreComp = comp > budget && budget > 0;
                  const isSel = selected?.id === p.id;

                  return (
                    <tr
                      key={p.id}
                      ref={rowVirt.measureElement}
                      data-index={vi.index}
                      className={cn('border-b border-line transition-colors cursor-pointer', bg, isSel ? 'bg-primary/10 ring-1 ring-inset ring-primary/30' : 'hover:bg-bg-sunken/30')}
                      onClick={() => { setSelected(p); if (has) toggle(p.codigo); }}
                    >
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1" style={{ paddingLeft: indent }}>
                          {has ? (isOpen ? <ChevronDown className="h-3 w-3 text-ink-3 shrink-0" /> : <ChevronRight className="h-3 w-3 text-ink-3 shrink-0" />) : <span className="w-3 shrink-0" />}
                          <span className="font-mono text-[10px] text-ink-3 font-bold">{p.codigo}</span>
                        </div>
                      </td>
                      <td className="px-3 py-1.5" style={{ fontWeight, textTransform: p.nivel === 1 ? 'uppercase' : 'none' }}>
                        <span className="text-[11.5px]">{p.nombre}</span>
                        {fromVal && p.valorizado?.ultimaValNumero != null && <span className="ml-2 text-[9.5px] text-primary font-medium">● Val N°{p.valorizado.ultimaValNumero}</span>}
                        {sobreComp && <span className="ml-2 inline-flex items-center gap-0.5 text-[9.5px] text-destructive font-medium"><AlertTriangle className="h-2.5 w-2.5" />sobre-comprometido</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {budget > 0 ? <span className={cn('font-mono text-[11px] tabular-nums', p.nivel <= 2 ? 'font-bold' : 'font-medium text-ink-2')}>{fmtPEN(budget)}</span> : <span className="text-ink-4">—</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right">{real > 0 ? <span className="font-mono text-[11px] tabular-nums font-semibold text-primary">{fmtPEN(real)}</span> : <span className="text-ink-4">—</span>}</td>
                      <td className="px-3 py-1.5 text-right">{comp > 0 ? <span className={cn('font-mono text-[11px] tabular-nums', sobreComp ? 'text-destructive font-semibold' : 'text-warn-ink')}>{fmtPEN(comp)}</span> : <span className="text-ink-4">—</span>}</td>
                      <td className="px-3 py-1.5 text-right">
                        {desv != null ? <span className={cn('chip', desv > 0 ? 'red' : 'green')}>{desv > 0 ? '+' : ''}{desv.toFixed(1)}%</span> : <span className="text-ink-4 text-[10px]">—</span>}
                      </td>
                    </tr>
                  );
                })}
                {padBottom > 0 && <tr aria-hidden><td colSpan={6} style={{ height: padBottom }} className="p-0" /></tr>}
                  </>);
                })()}
              </tbody>
            </table>
          </div>
        </div>

        {/* Panel detalle */}
        <DetallePanel
          partida={selected}
          rollup={selected ? rollup.get(selected.codigo) : undefined}
          budget={selected ? getBudget(selected) : 0}
          pu={selected ? getPU(selected) ?? 0 : 0}
          isLeaf={selected ? !hasChildren(selected) : false}
          onEdit={() => selected && setEditing(selected)}
          onClose={() => setSelected(null)}
        />
      </div>

      {editing && (
        <EditAvanceModal
          partida={editing}
          proyectoId={proyectoId}
          initialAvancePct={avances[editing.codigo]?.avancePct ?? 0}
          initialRealCost={avances[editing.codigo]?.realCost ?? 0}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function DetallePanel({ partida, rollup, budget, pu, isLeaf, onEdit, onClose }: {
  partida: Partida | null;
  rollup: RollupVal | undefined;
  budget: number;
  pu: number;
  isLeaf: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  if (!partida) {
    return (
      <div className="rounded-md border border-dashed border-line bg-bg-sunken/30 p-6 text-center lg:sticky lg:top-4">
        <FileText className="mx-auto mb-2 h-6 w-6 text-ink-4" />
        <p className="text-[12px] text-ink-3">Selecciona una partida para ver su detalle</p>
      </div>
    );
  }
  const real = rollup?.realCost ?? 0;
  const comp = rollup?.comprometido ?? 0;
  const max = Math.max(budget, real, comp, 1);
  const cantidad = partida.cantidad ? Number(partida.cantidad) : null;

  return (
    <div className="rounded-md border border-line bg-bg-elev lg:sticky lg:top-4">
      <div className="flex items-start justify-between border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] text-ink-3 font-bold">{partida.codigo}</div>
          <h3 className="text-[12.5px] font-semibold mt-0.5 leading-tight">{partida.nombre}</h3>
          <div className="text-[10.5px] text-ink-4 mt-0.5">{partida.unidad ?? '—'}{cantidad != null && pu > 0 && ` · ${cantidad} × ${fmtPEN(pu)}`}</div>
        </div>
        <button onClick={onClose} className="text-ink-4 hover:text-foreground shrink-0"><X className="h-4 w-4" /></button>
      </div>

      <div className="p-4 space-y-3">
        <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4">Ejecución</div>
        <Bar label="Presupuestado" value={budget} max={max} color="bg-ink-3" />
        <Bar label="Ejecutado (valos)" value={real} max={max} color="bg-primary" />
        <Bar label="Comprometido (OC)" value={comp} max={max} color={comp > budget && budget > 0 ? 'bg-destructive' : 'bg-warn'} />

        {comp > budget && budget > 0 && (
          <div className="rounded-md border border-destructive/30 bg-destructive-soft px-2.5 py-1.5 text-[10.5px] text-destructive flex items-start gap-1.5">
            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
            Comprometido supera el presupuesto en {fmtPEN(comp - budget)} ({(((comp - budget) / budget) * 100).toFixed(1)}%)
          </div>
        )}

        {isLeaf && budget > 0 && (
          <button onClick={onEdit} className="w-full inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-line text-[11.5px] text-ink-2 hover:bg-bg-sunken">
            <Pencil className="h-3.5 w-3.5" /> Editar avance manual
          </button>
        )}
      </div>

      {/* APU · próximamente */}
      <div className="border-t border-line px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-wider text-ink-4">APU · análisis precio unitario</span>
          <span className="chip">próximamente</span>
        </div>
        <p className="text-[10px] text-ink-4 mt-1.5">Desglose MO / materiales / equipo por partida</p>
      </div>
    </div>
  );
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-ink-3">{label}</span>
        <span className="font-mono tabular-nums font-medium">{value > 0 ? fmtPEN(value) : '—'}</span>
      </div>
      <div className="h-1.5 rounded-full bg-bg-sunken overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function Stat({ lbl, val, sub, accent, warn }: { lbl: string; val: string; sub?: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-bg-elev p-3 min-w-0">
      <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4 truncate" title={lbl}>{lbl}</div>
      <div className={cn('mt-1 text-[14px] font-bold tracking-[-0.02em] truncate', accent && 'text-primary', warn && 'text-destructive')}>{val}</div>
      {sub && <div className="text-[10px] text-ink-3 mt-0.5 truncate" title={sub}>{sub}</div>}
    </div>
  );
}

function Th({ children, align = 'left', width }: { children: React.ReactNode; align?: 'left' | 'right' | 'center'; width?: string }) {
  return (
    <th className={cn('px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-4 font-medium', align === 'left' && 'text-left', align === 'right' && 'text-right', align === 'center' && 'text-center', width)}>
      {children}
    </th>
  );
}
