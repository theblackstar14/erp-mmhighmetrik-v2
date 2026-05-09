import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CrearProyectoWizard } from '@/components/proyectos/CrearProyectoWizard.js';
import { Button } from '@/components/ui/button.js';
import { api } from '@/lib/api.js';
import { fmtCompact, fmtDate } from '@/lib/utils.js';

const STATUS_CHIP: Record<string, string> = {
  licitacion: '',
  adjudicado: 'blue',
  ejecucion: 'blue',
  liquidacion: 'amber',
  cerrado: 'green',
  cancelado: 'red',
};

const STATUS_LABEL: Record<string, string> = {
  licitacion: 'Licitación',
  adjudicado: 'Adjudicado',
  ejecucion: 'En ejecución',
  liquidacion: 'Liquidación',
  cerrado: 'Cerrado',
  cancelado: 'Cancelado',
};

export function ProyectosListPage() {
  const [q, setQ] = useState('');
  const [showWizard, setShowWizard] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['proyectos'],
    queryFn: () => api.proyectos.list(),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.proyectos.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proyectos'] });
      setDeletingId(null);
    },
    onError: (e: Error) => {
      alert('Error eliminando: ' + e.message);
      setDeletingId(null);
    },
  });

  const proyectoToDelete = data?.proyectos.find((p) => p.id === deletingId);

  const proyectos = (data?.proyectos ?? []).filter(
    (p) =>
      !q ||
      p.codigo.toLowerCase().includes(q.toLowerCase()) ||
      p.nombre.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-5">
      {showWizard && <CrearProyectoWizard onClose={() => setShowWizard(false)} />}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Proyectos</h1>
          <p className="text-[13px] text-ink-3 mt-0.5">{proyectos.length} en cartera</p>
        </div>
        <Button onClick={() => setShowWizard(true)}>
          <Plus className="h-4 w-4" /> Nuevo proyecto
        </Button>
      </header>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-4" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por código o nombre..."
          className="h-9 w-full rounded-md border border-line bg-bg-elev pl-9 pr-3 text-[13px] outline-none placeholder:text-ink-4 focus:border-primary focus:ring-1 focus:ring-primary"
        />
      </div>

      {isLoading ? (
        <div className="rounded-md border border-line bg-bg-elev p-12 text-center text-ink-3 text-[13px]">
          Cargando...
        </div>
      ) : proyectos.length === 0 ? (
        <div className="rounded-md border border-line bg-bg-elev p-12 text-center">
          <p className="text-[13px] text-ink-3">Sin proyectos todavía.</p>
          <Button className="mt-4" onClick={() => setShowWizard(true)}>
            <Plus className="h-4 w-4" /> Crear primer proyecto
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 4xl:grid-cols-4 gap-3">
          {proyectos.map((p) => (
            <div key={p.id} className="group relative">
              <Link to={`/proyectos/${p.id}`}>
                <div className="h-full rounded-md border border-line bg-bg-elev p-4 transition-all hover:border-primary/40 hover:shadow-md">
                  <div className="mb-2 flex items-center gap-2 pr-7">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.04em] text-ink-3">
                      {p.codigo}
                    </span>
                    <span className={`chip ${STATUS_CHIP[p.status] ?? ''}`}>
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </div>
                  <h3 className="line-clamp-2 text-[13.5px] font-semibold leading-snug tracking-[-0.005em] mb-1.5">
                    {p.nombre}
                  </h3>
                  <p className="line-clamp-1 text-[11px] text-ink-3 mb-3">{p.ubicacion ?? '—'}</p>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <p className="text-ink-4">Contrato</p>
                      <p className="font-mono font-semibold text-foreground mt-0.5">
                        {fmtCompact(Number.parseFloat(p.montoContractual))}
                      </p>
                    </div>
                    <div>
                      <p className="text-ink-4">Fin</p>
                      <p className="font-mono mt-0.5">{fmtDate(p.fechaFin)}</p>
                    </div>
                  </div>
                </div>
              </Link>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDeletingId(p.id);
                }}
                title="Eliminar proyecto"
                className="absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-md text-ink-4 opacity-0 group-hover:opacity-100 hover:bg-destructive-soft hover:text-destructive transition-opacity"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Modal confirmar eliminación */}
      {proyectoToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => e.target === e.currentTarget && setDeletingId(null)}
        >
          <div className="w-full max-w-md rounded-md border border-line bg-bg-elev shadow-xl p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive-soft text-destructive">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-[14px] font-semibold">Eliminar proyecto</h3>
                <p className="mt-1 text-[12.5px] text-ink-3">
                  ¿Eliminar <span className="font-mono font-semibold text-foreground">{proyectoToDelete.codigo}</span> ·{' '}
                  <span className="font-medium text-foreground">{proyectoToDelete.nombre}</span>?
                </p>
                <p className="mt-2 text-[11px] text-ink-4">
                  Esta acción soft-elimina el proyecto. Datos quedan en DB pero no aparecen en lista.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingId(null)}
                disabled={deleteMut.isPending}
                className="px-3 py-1.5 rounded-md border border-line text-[12px] text-ink-2 hover:bg-bg-sunken disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => deleteMut.mutate(deletingId!)}
                disabled={deleteMut.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground text-[12px] font-medium hover:opacity-90 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deleteMut.isPending ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
