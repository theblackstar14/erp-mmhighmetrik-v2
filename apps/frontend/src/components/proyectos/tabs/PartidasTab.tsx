import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FileText, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EditAvanceModal } from '@/components/proyectos/avance/EditAvanceModal.js';
import { type Partida, api } from '@/lib/api.js';
import { cn, fmtPEN, partidaPrecioUnitario, partidaPresupuesto } from '@/lib/utils.js';

export function PartidasTab({ proyectoId }: { proyectoId: string }) {
  const partidasQ = useQuery({
    queryKey: ['partidas', proyectoId],
    queryFn: () => api.proyectos.listPartidas(proyectoId),
  });
  const avancesQ = useQuery({
    queryKey: ['avances-proyecto', proyectoId],
    queryFn: () => api.proyectos.getAvances(proyectoId),
  });

  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<Partida | null>(null);

  // Filtrar hitos · pertenecen al cronograma, no al presupuesto
  const partidas = (partidasQ.data?.partidas ?? []).filter(
    (p) => !p.isMilestone && !p.codigo.startsWith('00.HITO'),
  );
  const avances = avancesQ.data?.avances ?? {};

  // Siempre vista contractual (lo que se cobra · MPP cronograma)
  const getBudget = partidaPresupuesto;
  const getPU = partidaPrecioUnitario;

  // Inicializar nivel 1 expandidos
  useMemo(() => {
    if (partidas.length > 0 && expanded.size === 0) {
      setExpanded(new Set(partidas.filter((p) => p.nivel === 1).map((p) => p.codigo)));
    }
  }, [partidas, expanded.size]);

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
            const found = partidas.find((x) => x.codigo === parent);
            parent = found?.parentCodigo ?? null;
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
        const found = partidas.find((x) => x.codigo === parent);
        parent = found?.parentCodigo ?? null;
      }
      return true;
    });
  }, [partidas, search, expanded]);

  const hasChildren = (p: Partida) => partidas.some((c) => c.parentCodigo === p.codigo);

  const toggle = (codigo: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(codigo)) next.delete(codigo);
      else next.add(codigo);
      return next;
    });
  const expandAll = () => setExpanded(new Set(partidas.map((p) => p.codigo)));
  const collapseAll = () =>
    setExpanded(new Set(partidas.filter((p) => p.nivel === 1).map((p) => p.codigo)));

  const totalCD = partidas.filter((p) => p.nivel === 1).reduce((s, p) => s + getBudget(p), 0);
  // Total real = suma valorizado de hojas + fallback manual avance solo si NO hay valorización
  const totalReal = partidas.reduce((s, p) => {
    if (p.valorizado) return s + Number(p.valorizado.montoAcumulado);
    return s;
  }, 0);
  // Si no hay valorizaciones, usar fallback manual (sum nivel 1 avances)
  const totalRealEfectivo = totalReal > 0
    ? totalReal
    : partidas.filter((p) => p.nivel === 1).reduce((s, p) => s + (avances[p.codigo]?.realCost ?? 0), 0);
  const pctAvanceGlobal = totalCD > 0 ? (totalRealEfectivo / totalCD) * 100 : 0;

  // ─── Rollup avance · parents = suma hojas descendientes ───
  const rollup = useMemo(() => {
    const result = new Map<string, { realCost: number; pctAvance: number; fromVal: boolean }>();
    if (partidas.length === 0) return result;

    // 1. Cada hoja con valorizado · valor directo
    for (const p of partidas) {
      const has = partidas.some((c) => c.parentCodigo === p.codigo);
      if (!has && p.valorizado) {
        const real = Number(p.valorizado.montoAcumulado);
        const pct = Number(p.valorizado.pctAvanceReal);
        result.set(p.codigo, { realCost: real, pctAvance: pct, fromVal: true });
      } else if (!has) {
        const a = avances[p.codigo];
        result.set(p.codigo, {
          realCost: a?.realCost ?? 0,
          pctAvance: a?.avancePct ?? 0,
          fromVal: false,
        });
      }
    }

    // 2. Bottom-up · parents = suma descendientes
    const byParent = new Map<string, typeof partidas>();
    for (const p of partidas) {
      if (p.parentCodigo) {
        const arr = byParent.get(p.parentCodigo) ?? [];
        arr.push(p);
        byParent.set(p.parentCodigo, arr);
      }
    }
    // Procesar por nivel descendente
    const niveles = [...new Set(partidas.map((p) => p.nivel))].sort((a, b) => b - a);
    for (const lvl of niveles) {
      for (const p of partidas.filter((p) => p.nivel === lvl)) {
        if (result.has(p.codigo)) continue; // ya es hoja
        const hijos = byParent.get(p.codigo) ?? [];
        if (hijos.length === 0) continue;
        let sumReal = 0;
        let sumBudget = 0;
        let anyFromVal = false;
        for (const h of hijos) {
          const r = result.get(h.codigo);
          sumReal += r?.realCost ?? 0;
          sumBudget += getBudget(h);
          if (r?.fromVal) anyFromVal = true;
        }
        const budget = getBudget(p);
        const denom = budget > 0 ? budget : sumBudget;
        const pct = denom > 0 ? (sumReal / denom) * 100 : 0;
        result.set(p.codigo, { realCost: sumReal, pctAvance: pct, fromVal: anyFromVal });
      }
    }
    return result;
  }, [partidas, avances]);

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
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat lbl="Total partidas" val={String(partidas.length)} />
        <Stat lbl="Capítulos" val={String(partidas.filter((p) => p.nivel === 1).length)} />
        <Stat
          lbl="Presupuesto Contractual"
          val={fmtPEN(totalCD)}
          sub="Suma capítulos nivel 1"
          accent
        />
        <Stat
          lbl="Real ejecutado"
          val={fmtPEN(totalRealEfectivo)}
          sub={`${pctAvanceGlobal.toFixed(2)}% del contractual`}
          accent
        />
      </div>

      {/* Tabla */}
      <div className="rounded-md border border-line bg-bg-elev">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h3 className="text-[13px] font-semibold">Árbol de partidas</h3>
            <p className="text-[11px] text-ink-3 mt-0.5">
              {visiblePartidas.length} visibles · click partida hoja → editar avance
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-4" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar partida..."
                className="h-8 w-56 rounded-md border border-line bg-bg-sunken pl-7 pr-3 text-[12px] outline-none placeholder:text-ink-4 focus:border-primary"
              />
            </div>
            <button
              type="button"
              onClick={expandAll}
              className="h-8 px-2.5 rounded-md border border-line text-[11px] text-ink-2 hover:bg-bg-sunken"
            >
              Expandir
            </button>
            <button
              type="button"
              onClick={collapseAll}
              className="h-8 px-2.5 rounded-md border border-line text-[11px] text-ink-2 hover:bg-bg-sunken"
            >
              Colapsar
            </button>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-bg-sunken z-10">
              <tr className="border-b border-line">
                <Th width="w-28">Código</Th>
                <Th>Descripción</Th>
                <Th align="center" width="w-16">Unid</Th>
                <Th align="right" width="w-28">Presup. S/</Th>
                <Th align="center" width="w-32">Avance %</Th>
                <Th align="right" width="w-28">Real S/</Th>
                <Th align="right" width="w-28">Saldo S/</Th>
              </tr>
            </thead>
            <tbody>
              {visiblePartidas.map((p) => {
                const has = hasChildren(p);
                const isOpen = expanded.has(p.codigo);
                const indent = (p.nivel - 1) * 16;
                const fontWeight = p.nivel === 1 ? 700 : p.nivel === 2 ? 600 : 500;
                const bg = p.nivel === 1 ? 'bg-bg-sunken/50' : p.nivel === 2 ? 'bg-bg-sunken/20' : '';
                const a = avances[p.codigo];
                // Rollup · si parent, usa suma descendientes; si hoja, valor directo
                const r = rollup.get(p.codigo);
                const valorizado = p.valorizado;
                const valPct = valorizado ? Number(valorizado.pctAvanceReal) : 0;
                const valMonto = valorizado ? Number(valorizado.montoAcumulado) : 0;
                // Prioridad: rollup > valorizado hoja > avance manual
                const pct = r ? r.pctAvance : valPct > 0 ? valPct : (a?.avancePct ?? 0);
                const real = r ? r.realCost : valMonto > 0 ? valMonto : (a?.realCost ?? 0);
                const fromVal = (r?.fromVal ?? false) || valPct > 0 || valMonto > 0;
                const budget = getBudget(p);
                const pu = getPU(p);
                const cantidad = p.cantidad ? Number(p.cantidad) : null;
                const saldo = budget - real;
                const isLeaf = !has;
                const isEditable = isLeaf && budget > 0;

                const onRowClick = () => {
                  if (isEditable) {
                    setEditing(p);
                  } else if (has) {
                    toggle(p.codigo);
                  }
                };

                return (
                  <tr
                    key={p.id}
                    className={cn(
                      'border-b border-line hover:bg-bg-sunken/30 transition-colors',
                      bg,
                      (has || isEditable) && 'cursor-pointer',
                    )}
                    onClick={onRowClick}
                  >
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1" style={{ paddingLeft: indent }}>
                        {has ? (
                          isOpen ? (
                            <ChevronDown className="h-3 w-3 text-ink-3 shrink-0" />
                          ) : (
                            <ChevronRight className="h-3 w-3 text-ink-3 shrink-0" />
                          )
                        ) : (
                          <span className="w-3 shrink-0" />
                        )}
                        <span className="font-mono text-[10px] text-ink-3 font-bold">{p.codigo}</span>
                      </div>
                    </td>
                    <td
                      className="px-3 py-1.5"
                      style={{ fontWeight, textTransform: p.nivel === 1 ? 'uppercase' : 'none' }}
                    >
                      <span className="text-[11.5px]">{p.nombre}</span>
                      {fromVal && valorizado?.ultimaValNumero != null && (
                        <span className="ml-2 text-[9.5px] text-primary font-medium">
                          ● Val N°{valorizado.ultimaValNumero}
                        </span>
                      )}
                      {!fromVal && a?.source === 'direct' && a.fecha && (
                        <span className="ml-2 text-[9.5px] text-ok">● editado</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-center text-[10.5px] text-ink-3">{p.unidad ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right">
                      {budget > 0 ? (
                        <span
                          className={cn(
                            'font-mono text-[11px]',
                            p.nivel <= 2 ? 'font-bold' : 'font-medium text-ink-2',
                          )}
                          title={
                            cantidad && pu
                              ? `${cantidad} ${p.unidad ?? ''} × ${fmtPEN(pu)} = ${fmtPEN(budget)}`
                              : fmtPEN(budget)
                          }
                        >
                          {fmtPEN(budget)}
                        </span>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {budget > 0 ? (
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 h-1 rounded-full bg-bg-sunken overflow-hidden min-w-[40px]">
                            <div
                              className={cn(
                                'h-full transition-all',
                                pct >= 100 ? 'bg-ok' : pct > 0 ? 'bg-primary' : '',
                              )}
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                          <span
                            className={cn(
                              'font-mono text-[10px] tabular-nums w-10 text-right',
                              pct >= 100 ? 'text-ok font-bold' : pct > 0 ? 'text-primary' : 'text-ink-4',
                            )}
                          >
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-ink-4 text-[10px]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {real > 0 ? (
                        <span className="font-mono text-[11px] font-semibold text-primary">
                          {fmtPEN(real)}
                        </span>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {budget > 0 ? (
                        <span
                          className={cn(
                            'font-mono text-[11px]',
                            saldo < 0 ? 'text-destructive font-semibold' : 'text-ink-3',
                          )}
                        >
                          {fmtPEN(saldo)}
                        </span>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
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

function Stat({
  lbl,
  val,
  sub,
  accent,
}: {
  lbl: string;
  val: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-md border border-line bg-bg-elev p-3 min-w-0">
      <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4 truncate" title={lbl}>
        {lbl}
      </div>
      <div
        className={cn(
          'mt-1 text-[14px] font-bold tracking-[-0.02em] truncate',
          accent && 'text-primary',
        )}
      >
        {val}
      </div>
      {sub && (
        <div className="text-[10px] text-ink-3 mt-0.5 truncate" title={sub}>
          {sub}
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  align = 'left',
  width,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string;
}) {
  return (
    <th
      className={cn(
        'px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-4 font-medium',
        align === 'left' && 'text-left',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        width,
      )}
    >
      {children}
    </th>
  );
}
