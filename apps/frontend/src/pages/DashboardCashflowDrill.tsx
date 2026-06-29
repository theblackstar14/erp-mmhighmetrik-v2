import { useQuery } from '@tanstack/react-query';
import ReactECharts from '@/lib/echarts.js';
import { Download, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { type CashflowEntry, api } from '@/lib/api.js';
import { useThemeStore } from '@/lib/theme-store.js';
import { cn, fmtCompact, fmtPEN } from '@/lib/utils.js';
import { Skel } from '@/components/ui/Skeleton.js';
import type { CashflowClick } from './DashboardCashflowChart.js';

const PAL_ING = ['#4f6ef7', '#5b84f0', '#8fa3f0', '#b9c6f4'];
const PAL_EG = ['#dc2626', '#f59e0b', '#7c3aed', '#0ea5b7', '#d97757', '#16a34a', '#9a9a96', '#ec4899'];

// Drill del flujo: tabla de movimientos + dona por categoría + modal de detalle por categoría.
// Trae el detalle on-demand (solo el alcance clickeado) en vez de recibir todo el dataset.
export default function DashboardCashflowDrill({ drill, onClose, onChangeTab, proyectoId = 'todos' }: {
  drill: CashflowClick; onClose: () => void; onChangeTab: (t: 'ingresos' | 'egresos') => void; proyectoId?: string;
}) {
  const dark = useThemeStore((s) => s.theme === 'dark');
  const { mode, periodKey, tab } = drill;
  const [catOpen, setCatOpen] = useState<string | null>(null);

  // periodo para el endpoint: total→'todos', año→year, mes→ym
  const periodoParam = mode === 'total' ? 'todos' : periodKey;
  const detalleQ = useQuery({
    queryKey: ['cashflow-entries', proyectoId, periodoParam, tab],
    queryFn: () => api.finanzas.getCashflowEntries(proyectoId, periodoParam, tab),
  });
  const entries = detalleQ.data?.entries ?? [];
  const loading = detalleQ.isLoading;

  const catKey = tab === 'ingresos' ? 'tipo' : 'categoria';
  const total = entries.reduce((s, e) => s + e.monto, 0);
  const byCat = useMemo(() => {
    const agg: Record<string, number> = {};
    entries.forEach((e) => { const k = (e[catKey] ?? 'Otros') as string; agg[k] = (agg[k] ?? 0) + e.monto; });
    return Object.entries(agg).sort((a, b) => b[1] - a[1]);
  }, [entries, catKey]);
  const palette = tab === 'ingresos' ? PAL_ING : PAL_EG;
  const accent = tab === 'ingresos' ? '#4f6ef7' : '#dc2626';
  const label = mode === 'mes' ? periodKey : mode === 'año' ? `Año ${periodKey}` : 'Consolidado';

  const donut = useMemo(() => ({
    tooltip: { trigger: 'item', backgroundColor: dark ? '#1c1c20' : '#fff', borderColor: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)', textStyle: { color: dark ? '#e4e4e7' : '#27272a', fontSize: 11 }, formatter: (p: { name: string; value: number; percent: number }) => `<b>${p.name}</b><br/>${fmtCompact(p.value)} · ${p.percent}%` },
    series: [{
      type: 'pie', radius: ['58%', '82%'], avoidLabelOverlap: true, cursor: 'pointer',
      itemStyle: { borderColor: dark ? '#1c1c20' : '#fff', borderWidth: 2 }, label: { show: false }, labelLine: { show: false },
      emphasis: { scale: true, scaleSize: 6 },
      data: byCat.map(([name, value], i) => ({ name, value, itemStyle: { color: palette[i % palette.length] } })),
    }],
  }), [byCat, palette, dark]);

  return (
    <div className="rounded-md border border-line border-l-[3px] bg-bg-elev animate-pageEnter" style={{ borderLeftColor: accent }}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <h3 className="text-[13px] font-semibold">Flujo · {label}</h3>
          <span className="font-mono text-[10.5px] text-ink-4">{entries.length} movimientos</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-line overflow-hidden text-[11px]">
            <button onClick={() => onChangeTab('ingresos')} className={cn('px-3 h-7', tab === 'ingresos' ? 'bg-primary text-primary-foreground' : 'bg-bg-elev text-ink-2 hover:bg-bg-sunken')}>↑ Ingresos</button>
            <button onClick={() => onChangeTab('egresos')} className={cn('px-3 h-7 border-l border-line', tab === 'egresos' ? 'bg-destructive text-white' : 'bg-bg-elev text-ink-2 hover:bg-bg-sunken')}>↓ Egresos</button>
          </div>
          <button onClick={onClose} className="h-7 w-7 rounded-md border border-line inline-flex items-center justify-center text-ink-3 hover:bg-bg-sunken"><X className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr]">
        <div className="lg:border-r border-line max-h-[420px] overflow-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-bg-sunken"><tr className="text-left text-[9.5px] font-mono uppercase tracking-wider text-ink-4 border-b border-line">
              <th className="px-3 py-2">Concepto</th><th className="px-3 py-2">{tab === 'ingresos' ? 'Cliente' : 'Proveedor'}</th>
              <th className="px-3 py-2 w-24">Proyecto</th><th className="px-3 py-2 w-24">Comprob.</th><th className="px-3 py-2 w-16">Fecha</th><th className="px-3 py-2 w-24 text-right">Monto</th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {loading && <tr><td colSpan={6} className="p-3"><Skel className="h-40 w-full" /></td></tr>}
              {!loading && entries.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-ink-4 text-[12px]">Sin movimientos en este período</td></tr>}
              {!loading && entries.slice(0, 200).map((e, i) => (
                <tr key={i} className="hover:bg-bg-sunken/40">
                  <td className="px-3 py-2"><div className="font-medium truncate max-w-[220px]">{e.concepto}</div><div className="text-[10px] text-ink-4">{(e[catKey] ?? '') as string}</div></td>
                  <td className="px-3 py-2 text-ink-3 truncate max-w-[140px]">{e.contraparte}</td>
                  <td className="px-3 py-2"><span className="font-mono text-[10px] text-ink-3">{e.proyecto}</span></td>
                  <td className="px-3 py-2 font-mono text-[10px] text-ink-4">{e.comprobante}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-ink-4">{e.fecha.slice(5)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold" style={{ color: accent }}>{fmtPEN(e.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length > 200 && <div className="px-3 py-2 text-[10.5px] text-ink-4 border-t border-line">Mostrando 200 de {entries.length} · usa el desglose por categoría →</div>}
        </div>
        <div className="p-3.5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4">Desglose por {tab === 'ingresos' ? 'tipo' : 'categoría'}</span>
            <span className="text-[9px] text-primary">click para detalle</span>
          </div>
          {byCat.length > 0 && <ReactECharts option={donut} style={{ height: 170 }} notMerge onEvents={{ click: (p: { name: string }) => p?.name && setCatOpen(p.name) }} />}
          <div className="flex flex-col gap-1">
            {byCat.map(([name, value], i) => (
              <button key={name} onClick={() => setCatOpen(name)} className="flex items-center gap-2 text-[11px] px-1.5 py-1 rounded hover:bg-bg-sunken text-left">
                <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: palette[i % palette.length] }} />
                <span className="flex-1 text-ink-2 truncate">{name}</span>
                <span className="font-mono text-ink-4 w-9 text-right">{total > 0 ? ((value / total) * 100).toFixed(0) : 0}%</span>
                <span className="font-mono font-semibold w-16 text-right">{fmtCompact(value)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {catOpen && (
        <CategoryModal category={catOpen} tab={tab} periodLabel={label} accent={accent} tabTotal={total}
          entries={entries.filter((e) => ((e[catKey] ?? 'Otros') as string) === catOpen)} onClose={() => setCatOpen(null)} />
      )}
    </div>
  );
}

// Modal profundo de categoría · búsqueda / agrupación / orden
function CategoryModal({ category, tab, periodLabel, accent, tabTotal, entries, onClose }: {
  category: string; tab: 'ingresos' | 'egresos'; periodLabel: string; accent: string; tabTotal: number; entries: CashflowEntry[]; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [groupBy, setGroupBy] = useState<'ninguno' | 'proyecto' | 'contraparte'>('ninguno');
  const [sortBy, setSortBy] = useState<'fecha-desc' | 'monto-desc' | 'monto-asc'>('fecha-desc');

  const total = entries.reduce((s, e) => s + e.monto, 0);
  const pct = tabTotal > 0 ? (total / tabTotal) * 100 : 0;
  const avg = entries.length > 0 ? total / entries.length : 0;

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let list = entries;
    if (ql) list = list.filter((e) => [e.concepto, e.contraparte, e.proyecto, e.comprobante].some((x) => (x ?? '').toLowerCase().includes(ql)));
    return [...list].sort((a, b) => sortBy === 'monto-desc' ? b.monto - a.monto : sortBy === 'monto-asc' ? a.monto - b.monto : (b.fecha || '').localeCompare(a.fecha || ''));
  }, [entries, q, sortBy]);

  const grouped = useMemo(() => {
    if (groupBy === 'ninguno') return [{ key: 'all', label: null as string | null, items: filtered }];
    const g: Record<string, { key: string; label: string; items: CashflowEntry[] }> = {};
    filtered.forEach((e) => { const k = (groupBy === 'proyecto' ? e.proyecto : e.contraparte) || '—'; (g[k] ??= { key: k, label: k, items: [] }); g[k]!.items.push(e); });
    return Object.values(g).sort((a, b) => b.items.reduce((s, e) => s + e.monto, 0) - a.items.reduce((s, e) => s + e.monto, 0));
  }, [filtered, groupBy]);

  const csv = () => {
    const rows = [['Concepto', 'Contraparte', 'Proyecto', 'Comprobante', 'Fecha', 'Monto'], ...filtered.map((e) => [e.concepto, e.contraparte, e.proyecto, e.comprobante, e.fecha, String(e.monto)])];
    const blob = new Blob(['﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${category}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4 animate-backdropIn" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-xl border border-line bg-bg-elev shadow-2xl overflow-hidden border-l-[4px] animate-modalPop" style={{ borderLeftColor: accent }}>
        <div className="px-5 py-3.5 border-b border-line">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4 mb-1">{tab === 'ingresos' ? 'Tipo de ingreso' : 'Categoría de egreso'} · {periodLabel}</div>
              <h2 className="text-[19px] font-bold tracking-[-0.02em]">{category}</h2>
            </div>
            <button onClick={onClose} className="h-7 w-7 rounded-md border border-line inline-flex items-center justify-center text-ink-3 hover:bg-bg-sunken"><X className="h-3.5 w-3.5" /></button>
          </div>
          <div className="flex gap-7">
            <Stat label="Total" val={fmtPEN(total)} color={accent} />
            <Stat label={`% del ${tab}`} val={`${pct.toFixed(1)}%`} />
            <Stat label="Movimientos" val={String(entries.length)} />
            <Stat label="Ticket prom." val={fmtCompact(avg)} />
          </div>
        </div>
        <div className="px-5 py-2.5 border-b border-line bg-bg-sunken/50 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="h-3.5 w-3.5 text-ink-4 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar concepto, proyecto, contraparte…" className="h-8 w-full pl-8 pr-3 rounded-md border border-line bg-bg-elev text-[12px]" />
          </div>
          <div className="flex rounded-md border border-line overflow-hidden text-[11px]">
            {(['ninguno', 'proyecto', 'contraparte'] as const).map((g) => (
              <button key={g} onClick={() => setGroupBy(g)} className={cn('px-2.5 h-8 border-r border-line last:border-r-0', groupBy === g ? 'bg-primary text-primary-foreground' : 'hover:bg-bg-sunken')}>
                {g === 'ninguno' ? 'Sin agrupar' : g === 'proyecto' ? 'Proyecto' : tab === 'ingresos' ? 'Cliente' : 'Proveedor'}
              </button>
            ))}
          </div>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="h-8 px-2 rounded-md border border-line bg-bg-elev text-[11px]">
            <option value="fecha-desc">↓ Fecha reciente</option><option value="monto-desc">↓ Mayor monto</option><option value="monto-asc">↑ Menor monto</option>
          </select>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && <div className="py-10 text-center text-ink-4 text-[12px]">{q ? `Sin resultados para "${q}"` : 'Sin movimientos'}</div>}
          {grouped.map((g) => (
            <div key={g.key}>
              {g.label !== null && (
                <div className="px-5 py-2 bg-bg-elev border-b border-line flex items-center justify-between sticky top-0 z-[1]">
                  <div className="flex items-center gap-2"><span className="text-[12px] font-semibold">{g.label}</span><span className="chip text-[9.5px]">{g.items.length} mov.</span></div>
                  <span className="font-mono text-[12px] font-bold" style={{ color: accent }}>{fmtPEN(g.items.reduce((s, e) => s + e.monto, 0))}</span>
                </div>
              )}
              {g.items.map((e, i) => (
                <div key={g.key + i} className="px-5 py-2.5 border-b border-line/60 grid grid-cols-[1fr_auto] gap-3 items-center">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold truncate">{e.concepto}</div>
                    <div className="flex items-center gap-1.5 text-[10.5px] text-ink-3 flex-wrap mt-0.5">
                      <span className="truncate max-w-[180px]">{e.contraparte}</span><span className="text-ink-4">·</span>
                      <span className="font-mono px-1.5 rounded bg-bg-sunken text-[9.5px]">{e.proyecto}</span><span className="text-ink-4">·</span>
                      <span className="font-mono text-[9.5px]">{e.comprobante}</span><span className="text-ink-4">·</span><span className="font-mono text-[9.5px]">{e.fecha}</span>
                    </div>
                  </div>
                  <div className="font-mono text-[13px] font-bold text-right" style={{ color: accent }}>{fmtPEN(e.monto)}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="px-5 py-2.5 border-t border-line flex items-center justify-between">
          <span className="text-[11px] text-ink-4">Mostrando {filtered.length} de {entries.length} movimientos</span>
          <button onClick={csv} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-line text-[11.5px] hover:bg-bg-sunken"><Download className="h-3.5 w-3.5" /> Exportar CSV</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Stat({ label, val, color }: { label: string; val: string; color?: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4 mb-0.5">{label}</div>
      <div className="font-mono text-[15px] font-bold" style={{ color: color ?? 'inherit' }}>{val}</div>
    </div>
  );
}
