import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Check, HardHat, Loader2, Pencil, Search, Sparkles, Wrench, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type Recurso, api } from '@/lib/api.js';
import { cn, fmtPEN } from '@/lib/utils.js';
import { AutoClasificarModal } from './AutoClasificarModal.js';

type FiltroTipo = 'todos' | 'mano_obra' | 'material' | 'equipo';
type FiltroIu = 'todos' | 'sin_iu' | 'con_iu';

export function LogisticaRecursosPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['logistica-recursos'],
    queryFn: () => api.logistica.listRecursos(),
  });
  const iusQ = useQuery({
    queryKey: ['logistica-ius'],
    queryFn: () => api.logistica.listIus(),
    staleTime: 5 * 60 * 1000,
  });

  const [search, setSearch] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>('todos');
  const [filtroIu, setFiltroIu] = useState<FiltroIu>('todos');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [creatingIu, setCreatingIu] = useState<string | null>(null);
  const [newIuCodigo, setNewIuCodigo] = useState('');
  const [newIuDesc, setNewIuDesc] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [showAutoModal, setShowAutoModal] = useState(false);

  const updateMut = useMutation({
    mutationFn: ({ id, iuCodigo }: { id: string; iuCodigo: string | null }) =>
      api.logistica.updateRecurso(id, { iuCodigo }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logistica-recursos'] });
      qc.invalidateQueries({ queryKey: ['logistica-ius'] });
      setEditingId(null);
    },
  });

  const createIuMut = useMutation({
    mutationFn: (data: { codigo: string; descripcion: string }) => api.logistica.createIu(data),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['logistica-ius'] });
      if (creatingIu) updateMut.mutate({ id: creatingIu, iuCodigo: r.iu.codigo });
      setCreatingIu(null);
      setNewIuCodigo('');
      setNewIuDesc('');
      setCreateError(null);
    },
    onError: (e: Error) => setCreateError(e.message),
  });

  const recursos = data?.recursos ?? [];
  const ius = iusQ.data?.ius ?? [];
  const stats = data?.stats ?? null;

  const recursosFiltrados = useMemo(() => {
    const ql = search.trim().toLowerCase();
    return recursos.filter((r) => {
      if (filtroTipo !== 'todos' && r.tipo !== filtroTipo) return false;
      if (filtroIu === 'sin_iu' && r.iuCodigo) return false;
      if (filtroIu === 'con_iu' && !r.iuCodigo) return false;
      if (!ql) return true;
      return (
        r.descripcion.toLowerCase().includes(ql) ||
        r.codigo.toLowerCase().includes(ql) ||
        (r.iuCodigo?.includes(ql) ?? false)
      );
    });
  }, [recursos, search, filtroTipo, filtroIu]);

  if (isLoading) return <div className="text-[12px] text-ink-3">Cargando recursos...</div>;

  if (recursos.length === 0) {
    return (
      <div className="rounded-md border border-line bg-bg-elev p-12 text-center">
        <Boxes className="mx-auto mb-4 h-8 w-8 text-ink-4" />
        <h3 className="text-[14px] font-semibold mb-1.5">Catálogo recursos vacío</h3>
        <p className="text-[12px] text-ink-3">Importa calendario de adquisiciones para poblar</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Stat lbl="Total" val={String(stats?.total ?? 0)} accent />
        <Stat lbl="Mano Obra" val={String(stats?.porTipo.mano_obra ?? 0)} />
        <Stat lbl="Materiales" val={String(stats?.porTipo.material ?? 0)} />
        <Stat lbl="Equipos" val={String(stats?.porTipo.equipo ?? 0)} />
        <Stat
          lbl="Con IU"
          val={`${stats?.iuClasificados ?? 0}/${stats?.total ?? 0}`}
          sub={`${(((stats?.iuClasificados ?? 0) / Math.max(1, stats?.total ?? 1)) * 100).toFixed(0)}%`}
        />
        <Stat lbl="Sin IU" val={String(stats?.sinIu ?? 0)} sub="por clasificar" />
      </div>

      {/* Tabla */}
      <div className="rounded-md border border-line bg-bg-elev">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h3 className="text-[13px] font-semibold">Catálogo Recursos · Global</h3>
            <p className="text-[11px] text-ink-3 mt-0.5">
              {recursosFiltrados.length} de {recursos.length} · cross-proyecto
              {(stats?.sinIu ?? 0) > 0 && (
                <>
                  {' · '}
                  <button
                    type="button"
                    onClick={() => setShowAutoModal(true)}
                    className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                  >
                    <Sparkles className="h-3 w-3" />
                    Auto-clasificar {stats?.sinIu} sin IU con IA
                  </button>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
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
                placeholder="Buscar recurso..."
                className="h-8 w-60 rounded-md border border-line bg-bg-sunken pl-7 pr-3 text-[12px] outline-none placeholder:text-ink-4 focus:border-primary"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[700px] overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-bg-sunken z-10">
              <tr className="border-b border-line">
                <Th width="w-8">T</Th>
                <Th width="w-24">Código</Th>
                <Th>Descripción</Th>
                <Th align="center" width="w-12">Und</Th>
                <Th align="right" width="w-24">PU Ref</Th>
                <Th align="center" width="w-32">IU</Th>
                <Th width="w-32">Categoría</Th>
              </tr>
            </thead>
            <tbody>
              {recursosFiltrados.slice(0, 300).map((r) => (
                <tr key={r.id} className="border-b border-line hover:bg-bg-sunken/30">
                  <td className="px-2 py-1.5 text-center">
                    <TipoIcon tipo={r.tipo} />
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[10px] text-ink-3">{r.codigo}</td>
                  <td className="px-2 py-1.5 text-[11px]">{r.descripcion}</td>
                  <td className="px-2 py-1.5 text-center text-[10.5px] text-ink-3">{r.unidad ?? '—'}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-[10.5px] tabular-nums">
                    {fmtPEN(Number(r.precioReferencial ?? 0))}
                  </td>
                  <td className="px-2 py-1.5 text-center min-w-[120px]">
                    {creatingIu === r.id ? (
                      <div className="flex flex-col gap-1 items-center">
                        <input
                          value={newIuCodigo}
                          onChange={(e) => setNewIuCodigo(e.target.value.toUpperCase().slice(0, 3))}
                          placeholder="cód"
                          autoFocus
                          className="h-6 w-14 px-1 rounded border border-primary bg-bg-elev text-[10px] font-mono outline-none text-center"
                        />
                        <input
                          value={newIuDesc}
                          onChange={(e) => setNewIuDesc(e.target.value)}
                          placeholder="descripción"
                          className="h-6 w-32 px-1 rounded border border-primary bg-bg-elev text-[10px] outline-none"
                        />
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              if (!newIuCodigo.trim() || !newIuDesc.trim()) {
                                setCreateError('código y descripción obligatorios');
                                return;
                              }
                              createIuMut.mutate({
                                codigo: newIuCodigo.trim(),
                                descripcion: newIuDesc.trim(),
                              });
                            }}
                            disabled={createIuMut.isPending}
                            className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                          >
                            {createIuMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCreatingIu(null);
                              setNewIuCodigo('');
                              setNewIuDesc('');
                              setCreateError(null);
                            }}
                            className="text-ink-3 hover:text-foreground"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                        {createError && <span className="text-[9px] text-destructive">{createError}</span>}
                      </div>
                    ) : editingId === r.id ? (
                      <div className="flex items-center gap-1 justify-center">
                        <select
                          value={editValue}
                          onChange={(e) => {
                            if (e.target.value === '__create__') {
                              setEditingId(null);
                              setCreatingIu(r.id);
                              setNewIuCodigo('');
                              setNewIuDesc(r.descripcion.slice(0, 50));
                            } else setEditValue(e.target.value);
                          }}
                          autoFocus
                          className="h-6 px-1 rounded border border-primary bg-bg-elev text-[10px] font-mono outline-none min-w-[80px]"
                        >
                          <option value="">— sin —</option>
                          {ius.map((iu) => (
                            <option key={iu.codigo} value={iu.codigo}>
                              {iu.codigo} · {iu.descripcion.slice(0, 24)}
                            </option>
                          ))}
                          <option value="__create__">+ Crear IU nuevo...</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => updateMut.mutate({ id: r.id, iuCodigo: editValue || null })}
                          disabled={updateMut.isPending}
                          className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                        >
                          {updateMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="text-ink-3 hover:text-foreground"
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
                            ? `Origen: ${r.iuClasificacionOrigen ?? 'manual'} · confianza ${((Number(r.iuConfianza ?? 0)) * 100).toFixed(0)}%`
                            : 'Click para asignar IU'
                        }
                      >
                        {r.iuCodigo ? (
                          <span
                            className={cn(
                              'text-[9px] font-mono px-1 py-0.5 rounded inline-flex items-center gap-0.5',
                              r.iuClasificacionOrigen === 'auto_ia'
                                ? Number(r.iuConfianza ?? 0) >= 0.85
                                  ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-500/30'
                                  : 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-500/50'
                                : 'bg-primary-soft text-primary-ink',
                            )}
                          >
                            {r.iuClasificacionOrigen === 'auto_ia' && (
                              <Sparkles className="h-2.5 w-2.5" />
                            )}
                            {r.iuCodigo}
                          </span>
                        ) : (
                          <span className="text-amber-600 text-[10px]">⚠ sin IU</span>
                        )}
                        <Pencil className="h-2.5 w-2.5 text-ink-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-[10.5px] text-ink-3 truncate" title={r.categoria ?? ''}>
                    {r.categoria ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {recursosFiltrados.length > 300 && (
            <div className="px-4 py-3 text-[11px] text-ink-3 border-t border-line">
              Mostrando primeros 300 de {recursosFiltrados.length} · refina búsqueda
            </div>
          )}
        </div>
      </div>

      {/* Modal auto-clasificar IA */}
      {showAutoModal && <AutoClasificarModal onClose={() => setShowAutoModal(false)} />}
    </div>
  );
}

function TipoIcon({ tipo }: { tipo: Recurso['tipo'] }) {
  if (tipo === 'mano_obra') return <HardHat className="inline h-3 w-3 text-primary" />;
  if (tipo === 'equipo') return <Wrench className="inline h-3 w-3 text-warn-ink" />;
  return <Boxes className="inline h-3 w-3 text-ink-3" />;
}

function Stat({ lbl, val, sub, accent }: { lbl: string; val: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-bg-elev p-3 min-w-0">
      <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4">{lbl}</div>
      <div className={cn('mt-1 text-[14px] font-bold tracking-[-0.02em] truncate', accent && 'text-primary')}>{val}</div>
      {sub && <div className="text-[10px] text-ink-3 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

function Th({ children, align = 'left', width }: { children: React.ReactNode; align?: 'left' | 'center' | 'right'; width?: string }) {
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
