import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CrearProyectoWizard } from '@/components/proyectos/CrearProyectoWizard.js';
import { Button } from '@/components/ui/button.js';
import { SkelCards } from '@/components/ui/Skeleton.js';
import { type DashboardObra, type SaludObra, api } from '@/lib/api.js';

// Obra del listado + datos de salud (curva-S, endpoint aparte) mergeados por id
type ObraConSalud = DashboardObra & { cpi: number | null; spi: number | null; salud: SaludObra; desviacionPct: number | null };
import { cn, fmtCompact } from '@/lib/utils.js';

const STATUS_LABEL: Record<string, string> = {
  licitacion: 'Licitación', adjudicado: 'Adjudicado', ejecucion: 'En ejecución',
  liquidacion: 'Liquidación', cerrado: 'Cerrado', cancelado: 'Cancelado',
};
const STATUS_CHIP: Record<string, string> = {
  licitacion: 'amber', adjudicado: 'blue', ejecucion: 'blue', liquidacion: 'amber', cerrado: 'green', cancelado: 'red',
};
const SALUD: Record<string, { l: string; dot: string; txt: string }> = {
  saludable: { l: 'Saludable', dot: 'bg-emerald-500', txt: 'text-emerald-600' },
  observacion: { l: 'Observación', dot: 'bg-amber-500', txt: 'text-amber-600' },
  critico: { l: 'Crítico', dot: 'bg-rose-500', txt: 'text-rose-600' },
  sin_datos: { l: 'Sin datos', dot: 'bg-ink-4/40', txt: 'text-ink-4' },
};
const diasRest = (fin: string | null) => (fin ? Math.round((new Date(`${fin}T00:00:00Z`).getTime() - Date.now()) / 86400000) : null);

export function ProyectosListPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('todos');
  const [cliente, setCliente] = useState('');
  const [orden, setOrden] = useState('default');
  const [showWizard, setShowWizard] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['proyectos-dashboard'], queryFn: () => api.proyectos.getDashboard(), staleTime: 60_000 });
  const saludQ = useQuery({ queryKey: ['dashboard-salud'], queryFn: () => api.proyectos.getDashboardSalud(), staleTime: 60_000 });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.proyectos.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['proyectos-dashboard'] }); setDeletingId(null); },
    onError: (e: Error) => { alert('Error eliminando: ' + e.message); setDeletingId(null); },
  });

  const obras: ObraConSalud[] = useMemo(() => {
    const sById = new Map((saludQ.data?.obras ?? []).map((s) => [s.id, s]));
    return (data?.obras ?? []).map((o) => {
      const s = sById.get(o.id);
      return { ...o, cpi: s?.cpi ?? null, spi: s?.spi ?? null, salud: s?.salud ?? 'sin_datos', desviacionPct: s?.desviacionPct ?? null };
    });
  }, [data, saludQ.data]);
  const tot = data?.totales;
  const critico = saludQ.data?.salud.critico ?? 0;
  const clientes = useMemo(() => [...new Set(obras.map((o) => o.cliente).filter(Boolean))] as string[], [obras]);

  const filtered = useMemo(() => {
    let r = obras.filter((o) =>
      (!q || o.codigo.toLowerCase().includes(q.toLowerCase()) || o.nombre.toLowerCase().includes(q.toLowerCase())) &&
      (estado === 'todos' || o.status === estado) &&
      (!cliente || o.cliente === cliente),
    );
    const by: Record<string, (a: ObraConSalud, b: ObraConSalud) => number> = {
      avance: (a, b) => b.avanceFisico - a.avanceFisico,
      desviacion: (a, b) => (a.desviacionPct ?? 0) - (b.desviacionPct ?? 0),
      dias: (a, b) => (diasRest(a.fechaFin) ?? 1e9) - (diasRest(b.fechaFin) ?? 1e9),
      monto: (a, b) => b.montoContractual - a.montoContractual,
    };
    if (by[orden]) r = [...r].sort(by[orden]);
    return r;
  }, [obras, q, estado, cliente, orden]);

  const exportCsv = () => {
    const head = ['Código', 'Nombre', 'Cliente', 'Estado', 'Contrato', 'Avance %', 'Salud', 'CPI', 'SPI', 'Desv %', 'Fin', 'Días rest', 'Responsable'];
    const rows = filtered.map((o) => [o.codigo, o.nombre, o.cliente ?? '', STATUS_LABEL[o.status] ?? o.status, o.montoContractual, (o.avanceFisico * 100).toFixed(1), SALUD[o.salud]?.l ?? '', o.cpi ?? '', o.spi ?? '', o.desviacionPct ?? '', o.fechaFin ?? '', diasRest(o.fechaFin) ?? '', o.responsable ?? '']);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'proyectos.csv'; a.click(); URL.revokeObjectURL(url);
  };

  const proyectoToDelete = obras.find((p) => p.id === deletingId);
  const ESTADOS = [{ v: 'todos', l: 'Todos' }, { v: 'ejecucion', l: 'En ejecución' }, { v: 'licitacion', l: 'Licitación' }, { v: 'liquidacion', l: 'Liquidación' }, { v: 'cerrado', l: 'Cerrados' }];

  return (
    <div className="space-y-5">
      {showWizard && <CrearProyectoWizard onClose={() => setShowWizard(false)} />}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Proyectos</h1>
          <p className="text-[13px] text-ink-3 mt-0.5">{filtered.length} / {obras.length} obras</p>
        </div>
        <Button onClick={() => setShowWizard(true)}><Plus className="h-4 w-4" /> Nuevo proyecto</Button>
      </header>

      {/* KPIs */}
      {tot && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <Kpi label="Cartera activa" value={fmtCompact(tot.cartera)} sub={`${tot.obrasActivas} obras activas`} />
          <Kpi label="En riesgo" value={saludQ.isLoading ? '·' : String(critico)} sub="salud crítica" danger={critico > 0} />
          <Kpi label="Avance prom." value={`${tot.avanceFisicoProm.toFixed(0)}%`} sub={`${tot.obrasTotal} en cartera`} />
          <Kpi label="Mi utilidad" value={fmtCompact(tot.miUtilidad)} sub="proyectada" accent />
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-4" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar código o nombre…" className="h-9 w-full rounded-md border border-line bg-bg-elev pl-9 pr-3 text-[13px] outline-none placeholder:text-ink-4 focus:border-primary" />
        </div>
        <div className="flex items-center gap-1">
          {ESTADOS.map((e) => <button key={e.v} onClick={() => setEstado(e.v)} className={cn('h-9 px-2.5 rounded-md text-[11.5px] border', estado === e.v ? 'bg-primary text-primary-foreground border-primary' : 'border-line text-ink-2')}>{e.l}</button>)}
        </div>
        <select value={cliente} onChange={(e) => setCliente(e.target.value)} className="h-9 px-2 rounded-md border border-line bg-bg-elev text-[12px]"><option value="">Todos los clientes</option>{clientes.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select value={orden} onChange={(e) => setOrden(e.target.value)} className="h-9 px-2 rounded-md border border-line bg-bg-elev text-[12px]"><option value="default">Orden: reciente</option><option value="avance">Avance</option><option value="desviacion">Desviación</option><option value="dias">Días rest.</option><option value="monto">Monto</option></select>
        <button onClick={exportCsv} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-line text-[12px] text-ink-2 hover:bg-bg-sunken ml-auto"><Download className="h-3.5 w-3.5" /> CSV</button>
      </div>

      {isLoading ? (
        <SkelCards count={6} />
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-line bg-bg-elev p-12 text-center">
          <p className="text-[13px] text-ink-3">Sin proyectos.</p>
          <Button className="mt-4" onClick={() => setShowWizard(true)}><Plus className="h-4 w-4" /> Crear proyecto</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 4xl:grid-cols-4 gap-3">
          {filtered.map((p) => <ObraCard key={p.id} p={p} onDelete={() => setDeletingId(p.id)} />)}
        </div>
      )}

      {proyectoToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => e.target === e.currentTarget && setDeletingId(null)}>
          <div className="w-full max-w-md rounded-md border border-line bg-bg-elev shadow-xl p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive-soft text-destructive"><Trash2 className="h-5 w-5" /></div>
              <div className="flex-1 min-w-0">
                <h3 className="text-[14px] font-semibold">Eliminar proyecto</h3>
                <p className="mt-1 text-[12.5px] text-ink-3">¿Eliminar <span className="font-mono font-semibold text-foreground">{proyectoToDelete.codigo}</span> · <span className="font-medium text-foreground">{proyectoToDelete.nombre}</span>?</p>
                <p className="mt-2 text-[11px] text-ink-4">Soft-elimina · datos quedan en DB pero no aparecen en lista.</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setDeletingId(null)} disabled={deleteMut.isPending} className="px-3 py-1.5 rounded-md border border-line text-[12px] text-ink-2 hover:bg-bg-sunken disabled:opacity-50">Cancelar</button>
              <button onClick={() => deleteMut.mutate(deletingId!)} disabled={deleteMut.isPending} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground text-[12px] font-medium hover:opacity-90 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> {deleteMut.isPending ? 'Eliminando…' : 'Eliminar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ObraCard({ p, onDelete }: { p: ObraConSalud; onDelete: () => void }) {
  const dr = diasRest(p.fechaFin);
  const s = SALUD[p.salud] ?? SALUD.sin_datos!;
  const avance = Math.round(p.avanceFisico); // avanceFisico ya es % (pctAvance de la valo)
  return (
    <div className="group relative">
      <Link to={`/proyectos/${p.id}`}>
        <div className="h-full rounded-md border border-line bg-bg-elev p-4 transition-all hover:border-primary/40 hover:shadow-md">
          <div className="mb-2 flex items-center gap-2 pr-7">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.04em] text-ink-3">{p.codigo}</span>
            <span className={`chip ${STATUS_CHIP[p.status] ?? ''}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
            <span className={cn('ml-auto inline-flex items-center gap-1 text-[10px] font-medium', s.txt)}><span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />{s.l}</span>
          </div>
          <h3 className="line-clamp-2 text-[13.5px] font-semibold leading-snug tracking-[-0.005em] mb-0.5">{p.nombre}</h3>
          <p className="line-clamp-1 text-[11px] text-ink-3 mb-2">{p.cliente ?? p.ubicacion ?? '—'}</p>

          {/* alertas */}
          {(p.desviacionPct != null && p.desviacionPct < -5) || (dr != null && dr < 30 && dr >= 0) || (p.spi != null && p.spi < 0.9) ? (
            <div className="mb-2 flex flex-wrap gap-1">
              {p.desviacionPct != null && p.desviacionPct < -5 && <Badge>⚠ Sobrecosto {Math.abs(p.desviacionPct).toFixed(0)}%</Badge>}
              {p.spi != null && p.spi < 0.9 && <Badge>⏱ Atraso (SPI {p.spi})</Badge>}
              {dr != null && dr < 30 && dr >= 0 && <Badge amber>🔥 Entrega en {dr}d</Badge>}
            </div>
          ) : null}

          {/* avance */}
          <div className="mb-2.5">
            <div className="flex items-center justify-between text-[10.5px] mb-0.5"><span className="text-ink-4">Avance físico</span><span className="font-mono font-medium">{avance}%</span></div>
            <div className="h-1.5 rounded-full bg-bg-sunken overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, avance)}%` }} /></div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <div><p className="text-ink-4">Contrato</p><p className="font-mono font-semibold mt-0.5">{fmtCompact(p.montoContractual)}</p></div>
            <div><p className="text-ink-4">Días rest.</p><p className={cn('font-mono mt-0.5', dr != null && dr < 30 && 'text-rose-500 font-semibold')}>{dr != null ? `${dr}d` : '—'}</p></div>
            <div><p className="text-ink-4">CPI</p><p className="font-mono mt-0.5">{p.cpi ?? '—'}</p></div>
          </div>
        </div>
      </Link>
      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }} title="Eliminar" className="absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-md text-ink-4 opacity-0 group-hover:opacity-100 hover:bg-destructive-soft hover:text-destructive transition-opacity"><Trash2 className="h-3.5 w-3.5" /></button>
    </div>
  );
}

function Badge({ children, amber }: { children: React.ReactNode; amber?: boolean }) {
  return <span className={cn('rounded px-1.5 py-0.5 text-[9.5px] font-medium', amber ? 'bg-amber-500/15 text-amber-600' : 'bg-rose-500/15 text-rose-600')}>{children}</span>;
}
function Kpi({ label, value, sub, accent, danger }: { label: string; value: string; sub?: string; accent?: boolean; danger?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-bg-elev p-3">
      <div className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4">{label}</div>
      <div className={cn('mt-0.5 text-[19px] font-bold tracking-[-0.02em]', accent && 'text-primary', danger && 'text-rose-500')}>{value}</div>
      {sub && <div className="text-[10.5px] text-ink-4">{sub}</div>}
    </div>
  );
}
