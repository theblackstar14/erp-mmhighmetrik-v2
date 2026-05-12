import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Check, HardHat, Loader2, Pencil, Search, Wrench, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type Recurso, api } from '@/lib/api.js';
import { cn, fmtPEN } from '@/lib/utils.js';

type FiltroTipo = 'todos' | 'mano_obra' | 'material' | 'equipo';
type FiltroIu = 'todos' | 'sin_iu' | 'con_iu';

export function RecursosTab({ proyectoId }: { proyectoId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['recursos', proyectoId],
    queryFn: () => api.proyectos.getRecursos(proyectoId),
  });
  const iusCatQ = useQuery({
    queryKey: ['ius-catalogo'],
    queryFn: () => api.proyectos.getIusCatalogo(),
    staleTime: 5 * 60 * 1000, // 5min · cambia poco
  });

  const [search, setSearch] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>('todos');
  const [filtroIu, setFiltroIu] = useState<FiltroIu>('todos');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  const updateMut = useMutation({
    mutationFn: ({ recursoId, iuCodigo }: { recursoId: string; iuCodigo: string | null }) =>
      api.proyectos.updateRecurso(proyectoId, recursoId, { iuCodigo }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recursos', proyectoId] });
      setEditingId(null);
    },
  });

  const ius = iusCatQ.data?.ius ?? [];

  // Hooks ANTES de early returns (regla React)
  const recursos = data?.recursos ?? [];
  const cronograma = data?.cronograma ?? [];
  const stats = data?.stats ?? null;

  const cronogPorRecurso = useMemo(() => {
    const map = new Map<string, { mes: number; etiqueta: string; monto: number }[]>();
    for (const c of cronograma) {
      if (!c.recursoId) continue;
      const arr = map.get(c.recursoId) ?? [];
      arr.push({
        mes: c.mesIndex,
        etiqueta: c.mesEtiqueta,
        monto: Number(c.monto),
      });
      map.set(c.recursoId, arr);
    }
    return map;
  }, [cronograma]);

  const recursosConTotal = useMemo(() => {
    return recursos
      .map((r) => {
        const mesesR = cronogPorRecurso.get(r.id) ?? [];
        const total = mesesR.reduce((s, m) => s + m.monto, 0);
        return { recurso: r, meses: mesesR, total };
      })
      .sort((a, b) => b.total - a.total);
  }, [recursos, cronogPorRecurso]);

  const recursosFiltrados = useMemo(() => {
    const ql = search.trim().toLowerCase();
    return recursosConTotal.filter((rt) => {
      if (filtroTipo !== 'todos' && rt.recurso.tipo !== filtroTipo) return false;
      if (filtroIu === 'sin_iu' && rt.recurso.iuCodigo) return false;
      if (filtroIu === 'con_iu' && !rt.recurso.iuCodigo) return false;
      if (!ql) return true;
      return (
        rt.recurso.descripcion.toLowerCase().includes(ql) ||
        rt.recurso.codigo.toLowerCase().includes(ql) ||
        (rt.recurso.iuCodigo?.includes(ql) ?? false)
      );
    });
  }, [recursosConTotal, search, filtroTipo, filtroIu]);

  const meses = useMemo(() => {
    const set = new Map<number, string>();
    for (const c of cronograma) set.set(c.mesIndex, c.mesEtiqueta);
    return Array.from(set.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([idx, etiqueta]) => ({ idx, etiqueta }));
  }, [cronograma]);

  // Early returns DESPUÉS de hooks
  if (isLoading) return <div className="text-[12px] text-ink-3">Cargando recursos...</div>;

  if (!data || data.recursos.length === 0) {
    return (
      <div className="rounded-md border border-line bg-bg-elev p-12 text-center">
        <Boxes className="mx-auto mb-4 h-8 w-8 text-ink-4" />
        <h3 className="text-[14px] font-semibold mb-1.5">Sin recursos catalogados</h3>
        <p className="text-[12px] text-ink-3">
          Importa el calendario de adquisiciones para cargar recursos
        </p>
        <code className="mt-3 inline-block px-2 py-1 bg-bg-sunken rounded text-[10.5px]">
          pnpm db:import-pg0005-calendario
        </code>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Stat lbl="Total Recursos" val={String(stats?.total ?? 0)} accent />
        <Stat
          lbl="Mano Obra"
          val={String(stats?.porTipo.mano_obra ?? 0)}
          sub={fmtPEN(stats?.montosPorTipo.mano_obra ?? 0)}
        />
        <Stat
          lbl="Materiales"
          val={String(stats?.porTipo.material ?? 0)}
          sub={fmtPEN(stats?.montosPorTipo.material ?? 0)}
        />
        <Stat
          lbl="Equipos"
          val={String(stats?.porTipo.equipo ?? 0)}
          sub={fmtPEN(stats?.montosPorTipo.equipo ?? 0)}
        />
        <Stat
          lbl="CD Contractual"
          val={fmtPEN(stats?.montoTotal ?? 0)}
          sub="Σ recursos"
          accent
        />
        <Stat
          lbl="IU Clasificados"
          val={`${stats?.iuClasificados ?? 0}/${stats?.total ?? 0}`}
          sub={`${(((stats?.iuClasificados ?? 0) / Math.max(1, stats?.total ?? 1)) * 100).toFixed(0)}%`}
        />
      </div>

      {/* Curva valorizada por mes */}
      <div className="rounded-md border border-line bg-bg-elev">
        <div className="border-b border-line px-4 py-3">
          <h3 className="text-[13px] font-semibold">Curva valorizada · distribución mensual</h3>
          <p className="text-[11px] text-ink-3 mt-0.5">
            CD contractual distribuido en {meses.length} meses
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-4">
          {meses.map((m) => {
            const monto = stats?.montoPorMes[m.idx - 1] ?? 0;
            const pct =
              stats && stats.montoTotal > 0 ? (monto / stats.montoTotal) * 100 : 0;
            return (
              <div key={m.idx} className="rounded-md border border-line bg-bg-sunken p-3">
                <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4">
                  Mes {m.idx} · {m.etiqueta}
                </div>
                <div className="mt-1 text-[14px] font-bold tabular-nums">{fmtPEN(monto)}</div>
                <div className="mt-1.5 h-1 w-full rounded-full bg-bg-elev overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${pct.toFixed(1)}%` }}
                  />
                </div>
                <div className="text-[10px] text-ink-3 mt-0.5">{pct.toFixed(1)}% del CD</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tabla recursos */}
      <div className="rounded-md border border-line bg-bg-elev">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h3 className="text-[13px] font-semibold">Catálogo recursos</h3>
            <p className="text-[11px] text-ink-3 mt-0.5">
              {recursosFiltrados.length} de {recursos.length} · ordenados por monto
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Filtro tipo */}
            <div className="flex rounded-md border border-line overflow-hidden">
              {(['todos', 'mano_obra', 'material', 'equipo'] as FiltroTipo[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFiltroTipo(t)}
                  className={cn(
                    'px-2.5 py-1 text-[10.5px] font-medium border-l border-line first:border-l-0',
                    filtroTipo === t
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-bg-elev text-ink-3 hover:bg-bg-sunken',
                  )}
                >
                  {t === 'todos' ? 'Todos' : t === 'mano_obra' ? 'MO' : t === 'material' ? 'Mat' : 'Eq'}
                </button>
              ))}
            </div>
            {/* Filtro IU clasificación */}
            <div className="flex rounded-md border border-line overflow-hidden">
              {(['todos', 'sin_iu', 'con_iu'] as FiltroIu[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFiltroIu(t)}
                  className={cn(
                    'px-2.5 py-1 text-[10.5px] font-medium border-l border-line first:border-l-0',
                    filtroIu === t
                      ? 'bg-amber-500 text-white'
                      : 'bg-bg-elev text-ink-3 hover:bg-bg-sunken',
                  )}
                  title={t === 'sin_iu' ? 'Solo recursos sin IU asignado' : t === 'con_iu' ? 'Solo recursos clasificados' : 'Todos'}
                >
                  {t === 'todos' ? 'IU: Todos' : t === 'sin_iu' ? 'Sin IU' : 'Con IU'}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-4" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar recurso · código · IU..."
                className="h-8 w-60 rounded-md border border-line bg-bg-sunken pl-7 pr-3 text-[12px] outline-none placeholder:text-ink-4 focus:border-primary"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-bg-sunken z-10">
              <tr className="border-b border-line">
                <Th width="w-8">T</Th>
                <Th width="w-24">Código</Th>
                <Th>Descripción</Th>
                <Th align="center" width="w-12">Und</Th>
                <Th align="right" width="w-20">Cant</Th>
                <Th align="right" width="w-24">PU</Th>
                <Th align="right" width="w-28">Total</Th>
                <Th align="center" width="w-12">IU</Th>
                {meses.map((m) => (
                  <Th key={m.idx} align="right" width="w-24">
                    {m.etiqueta}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recursosFiltrados.slice(0, 200).map(({ recurso: r, meses: rmeses, total }) => (
                <tr key={r.id} className="border-b border-line hover:bg-bg-sunken/30">
                  <td className="px-2 py-1.5 text-center">
                    <TipoIcon tipo={r.tipo} />
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[10px] text-ink-3">{r.codigo}</td>
                  <td className="px-2 py-1.5 text-[11px]">{r.descripcion}</td>
                  <td className="px-2 py-1.5 text-center text-[10.5px] text-ink-3">
                    {r.unidad ?? '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-[10.5px] tabular-nums">
                    {Number(r.precioReferencial ?? 0) > 0
                      ? Number(rmeses.reduce((s, m) => s + m.monto, 0) / Number(r.precioReferencial)).toFixed(2)
                      : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-[10.5px] tabular-nums">
                    {fmtPEN(Number(r.precioReferencial ?? 0))}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-[11px] font-medium tabular-nums">
                    {fmtPEN(total)}
                  </td>
                  <td className="px-2 py-1.5 text-center min-w-[110px]">
                    {editingId === r.id ? (
                      <div className="flex items-center gap-1 justify-center">
                        <select
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          autoFocus
                          className="h-6 px-1 rounded border border-primary bg-bg-elev text-[10px] font-mono outline-none min-w-[80px]"
                        >
                          <option value="">— sin —</option>
                          {ius.map((iu) => (
                            <option key={iu.codigo} value={iu.codigo}>
                              {iu.codigo} · {iu.descripcion.slice(0, 24)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            updateMut.mutate({
                              recursoId: r.id,
                              iuCodigo: editValue || null,
                            })
                          }
                          disabled={updateMut.isPending}
                          className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                          title="Guardar"
                        >
                          {updateMut.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="text-ink-3 hover:text-foreground"
                          title="Cancelar"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(r.id);
                          setEditValue(r.iuCodigo ?? '');
                        }}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-bg-sunken/60 group"
                        title={
                          r.iuCodigo
                            ? `IU ${r.iuCodigo} · click para editar`
                            : 'Click para asignar IU'
                        }
                      >
                        {r.iuCodigo ? (
                          <span className="text-[9px] font-mono bg-primary-soft text-primary-ink px-1 py-0.5 rounded">
                            {r.iuCodigo}
                          </span>
                        ) : (
                          <span className="text-amber-600 text-[10px]">⚠ sin IU</span>
                        )}
                        <Pencil className="h-2.5 w-2.5 text-ink-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    )}
                  </td>
                  {meses.map((m) => {
                    const matched = rmeses.find((rm) => rm.mes === m.idx);
                    return (
                      <td
                        key={m.idx}
                        className={cn(
                          'px-2 py-1.5 text-right font-mono text-[10px] tabular-nums',
                          matched && matched.monto > 0 ? 'text-foreground' : 'text-ink-4',
                        )}
                      >
                        {matched && matched.monto > 0 ? fmtPEN(matched.monto) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {recursosFiltrados.length > 200 && (
            <div className="px-4 py-3 text-[11px] text-ink-3 border-t border-line">
              Mostrando primeros 200 de {recursosFiltrados.length} · refina búsqueda para ver más
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TipoIcon({ tipo }: { tipo: Recurso['tipo'] }) {
  if (tipo === 'mano_obra') return <HardHat className="inline h-3 w-3 text-primary" aria-label="MO" />;
  if (tipo === 'equipo') return <Wrench className="inline h-3 w-3 text-warn-ink" aria-label="Equipo" />;
  return <Boxes className="inline h-3 w-3 text-ink-3" aria-label="Material" />;
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
      <div className={cn('mt-1 text-[14px] font-bold tracking-[-0.02em] truncate', accent && 'text-primary')}>
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
  align?: 'left' | 'center' | 'right';
  width?: string;
}) {
  return (
    <th
      className={cn(
        'px-2 py-2 font-mono text-[9px] uppercase tracking-wider text-ink-4 font-medium',
        align === 'center' && 'text-center',
        align === 'right' && 'text-right',
        width,
      )}
    >
      {children}
    </th>
  );
}
