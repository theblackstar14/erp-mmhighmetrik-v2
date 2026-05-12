import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api.js';
import { cn } from '@/lib/utils.js';

export function LogisticaIusPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['logistica-ius'],
    queryFn: () => api.logistica.listIus(),
  });

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editCat, setEditCat] = useState('');
  const [creating, setCreating] = useState(false);
  const [newCod, setNewCod] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCat, setNewCat] = useState('Custom');
  const [createError, setCreateError] = useState<string | null>(null);

  const updateMut = useMutation({
    mutationFn: ({ codigo, ...data }: { codigo: string; descripcion?: string; categoria?: string }) =>
      api.logistica.updateIu(codigo, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logistica-ius'] });
      setEditing(null);
    },
  });

  const createMut = useMutation({
    mutationFn: (data: { codigo: string; descripcion: string; categoria?: string }) =>
      api.logistica.createIu(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logistica-ius'] });
      setCreating(false);
      setNewCod('');
      setNewDesc('');
      setNewCat('Custom');
      setCreateError(null);
    },
    onError: (e: Error) => setCreateError(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (codigo: string) => api.logistica.deleteIu(codigo),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['logistica-ius'] }),
  });

  const ius = data?.ius ?? [];
  const stats = data?.stats ?? null;

  const filtered = useMemo(() => {
    const ql = search.trim().toLowerCase();
    if (!ql) return ius;
    return ius.filter(
      (iu) =>
        iu.codigo.toLowerCase().includes(ql) ||
        iu.descripcion.toLowerCase().includes(ql) ||
        (iu.categoria?.toLowerCase().includes(ql) ?? false),
    );
  }, [ius, search]);

  if (isLoading) return <div className="text-[12px] text-ink-3">Cargando IUs...</div>;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        <Stat lbl="Total IUs" val={String(stats?.total ?? 0)} accent />
        <Stat lbl="En uso" val={String(stats?.enUso ?? 0)} sub="con recursos" />
        <Stat lbl="Sin uso" val={String(stats?.sinUso ?? 0)} sub="huérfanos" />
        <Stat lbl="Recursos clasificados" val={String(stats?.totalRecursosClasificados ?? 0)} />
        <Stat lbl="Recursos sin IU" val={String(stats?.totalRecursosSinClasificar ?? 0)} sub="por curar" />
      </div>

      <div className="rounded-md border border-line bg-bg-elev">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h3 className="text-[13px] font-semibold">Catálogo IUs INEI</h3>
            <p className="text-[11px] text-ink-3 mt-0.5">
              80 oficiales + custom · usados en fórmula polinómica
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-4" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar IU..."
                className="h-8 w-56 rounded-md border border-line bg-bg-sunken pl-7 pr-3 text-[12px] outline-none focus:border-primary"
              />
            </div>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />
              Nuevo IU
            </button>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[700px] overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-bg-sunken z-10">
              <tr className="border-b border-line">
                <Th width="w-20">Código</Th>
                <Th>Descripción</Th>
                <Th width="w-40">Categoría</Th>
                <Th align="right" width="w-24">Recursos</Th>
                <Th align="center" width="w-32">Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {creating && (
                <tr className="bg-primary-soft/30 border-b border-primary/30">
                  <td className="px-2 py-1.5">
                    <input
                      value={newCod}
                      onChange={(e) => setNewCod(e.target.value.toUpperCase().slice(0, 3))}
                      placeholder="cód"
                      autoFocus
                      className="h-7 w-16 px-1.5 rounded border border-primary bg-bg-elev text-[11px] font-mono outline-none"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      value={newDesc}
                      onChange={(e) => setNewDesc(e.target.value)}
                      placeholder="descripción"
                      className="h-7 w-full px-1.5 rounded border border-primary bg-bg-elev text-[11px] outline-none"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      value={newCat}
                      onChange={(e) => setNewCat(e.target.value)}
                      placeholder="categoría"
                      className="h-7 w-full px-1.5 rounded border border-primary bg-bg-elev text-[11px] outline-none"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right text-[10.5px] text-ink-3">—</td>
                  <td className="px-2 py-1.5 text-center">
                    <div className="flex items-center gap-1 justify-center">
                      <button
                        type="button"
                        onClick={() => {
                          if (!newCod.trim() || !newDesc.trim()) {
                            setCreateError('código y descripción obligatorios');
                            return;
                          }
                          createMut.mutate({
                            codigo: newCod.trim(),
                            descripcion: newDesc.trim(),
                            categoria: newCat.trim() || 'Custom',
                          });
                        }}
                        disabled={createMut.isPending}
                        className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                      >
                        {createMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCreating(false);
                          setNewCod('');
                          setNewDesc('');
                          setCreateError(null);
                        }}
                        className="text-ink-3 hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {createError && (
                      <div className="text-[9.5px] text-destructive mt-0.5">{createError}</div>
                    )}
                  </td>
                </tr>
              )}
              {filtered.map((iu) => (
                <tr key={iu.codigo} className="border-b border-line hover:bg-bg-sunken/30">
                  <td className="px-2 py-1.5">
                    <span className="font-mono text-[11px] bg-primary-soft text-primary-ink px-1.5 py-0.5 rounded font-bold">
                      {iu.codigo}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    {editing === iu.codigo ? (
                      <input
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        className="h-7 w-full px-1.5 rounded border border-primary bg-bg-elev text-[11px] outline-none"
                      />
                    ) : (
                      <span className="text-[11px]">{iu.descripcion}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-[10.5px] text-ink-3">
                    {editing === iu.codigo ? (
                      <input
                        value={editCat}
                        onChange={(e) => setEditCat(e.target.value)}
                        className="h-7 w-full px-1.5 rounded border border-primary bg-bg-elev text-[10.5px] outline-none"
                      />
                    ) : (
                      iu.categoria ?? '—'
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-[10.5px] tabular-nums">
                    {iu.recursosCount > 0 ? (
                      <span className="text-foreground font-medium">{iu.recursosCount}</span>
                    ) : (
                      <span className="text-ink-4">0</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {editing === iu.codigo ? (
                      <div className="flex items-center gap-1 justify-center">
                        <button
                          type="button"
                          onClick={() =>
                            updateMut.mutate({
                              codigo: iu.codigo,
                              descripcion: editDesc.trim(),
                              categoria: editCat.trim() || undefined,
                            })
                          }
                          disabled={updateMut.isPending}
                          className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                        >
                          {updateMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="text-ink-3 hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 justify-center">
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(iu.codigo);
                            setEditDesc(iu.descripcion);
                            setEditCat(iu.categoria ?? '');
                          }}
                          className="text-ink-3 hover:text-primary"
                          title="Editar"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (iu.recursosCount > 0) {
                              alert(`No se puede eliminar · ${iu.recursosCount} recursos lo usan`);
                              return;
                            }
                            if (confirm(`Eliminar IU ${iu.codigo} ${iu.descripcion}?`)) {
                              deleteMut.mutate(iu.codigo);
                            }
                          }}
                          disabled={iu.recursosCount > 0}
                          className={cn(
                            'transition-colors',
                            iu.recursosCount > 0
                              ? 'text-ink-4 cursor-not-allowed'
                              : 'text-ink-3 hover:text-destructive',
                          )}
                          title={iu.recursosCount > 0 ? `En uso por ${iu.recursosCount} recursos` : 'Eliminar'}
                        >
                          {iu.recursosCount > 0 ? <AlertTriangle className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ lbl, val, sub, accent }: { lbl: string; val: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-bg-elev p-3 min-w-0">
      <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4">{lbl}</div>
      <div className={cn('mt-1 text-[14px] font-bold truncate', accent && 'text-primary')}>{val}</div>
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
