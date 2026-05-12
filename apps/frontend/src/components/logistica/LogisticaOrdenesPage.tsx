import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  Eye,
  FileDown,
  Loader2,
  Plus,
  ShoppingCart,
  ThumbsDown,
  ThumbsUp,
  Truck,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api.js';
import { cn, fmtPEN } from '@/lib/utils.js';
import { NuevaOcModal } from './NuevaOcModal.js';
import { OcPdfPreview } from './OcPdfPreview.js';

const ESTADOS_FILTROS = [
  { k: '', l: 'Todas' },
  { k: 'borrador', l: 'Borrador' },
  { k: 'pendiente_aprobacion', l: 'Pendiente' },
  { k: 'aprobada', l: 'Aprobadas' },
  { k: 'emitida', l: 'Emitidas' },
  { k: 'en_transito', l: 'En tránsito' },
  { k: 'entregada', l: 'Entregadas' },
  { k: 'anulada', l: 'Anuladas' },
];

const ESTADO_CHIP: Record<string, string> = {
  borrador: 'gray',
  pendiente_aprobacion: 'amber',
  aprobada: 'blue',
  emitida: 'blue',
  en_transito: 'amber',
  entregada: 'green',
  anulada: 'red',
  rechazada: 'red',
};

export function LogisticaOrdenesPage() {
  const qc = useQueryClient();
  const [filterEstado, setFilterEstado] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [previewOcId, setPreviewOcId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['logistica-ocs', filterEstado],
    queryFn: () => api.logistica.listOcs({ estado: filterEstado || undefined }),
  });

  const aprobarMut = useMutation({
    mutationFn: (id: string) => api.logistica.aprobarOc(id, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['logistica-ocs'] }),
  });
  const emitirMut = useMutation({
    mutationFn: (id: string) => api.logistica.emitirOc(id, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['logistica-ocs'] }),
  });
  const cambiarEstadoMut = useMutation({
    mutationFn: ({ id, estado, comentario }: { id: string; estado: string; comentario?: string }) =>
      api.logistica.cambiarEstadoOc(id, { estado, comentario }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['logistica-ocs'] }),
  });

  const ordenes = data?.ordenes ?? [];
  const stats = data?.stats ?? null;

  const totalMonto = useMemo(() => ordenes.reduce((s, o) => s + Number(o.total), 0), [ordenes]);

  if (isLoading) return <div className="text-[12px] text-ink-3">Cargando órdenes...</div>;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Stat lbl="Total OCs" val={String(stats?.total ?? 0)} accent />
        <Stat lbl="Monto total" val={fmtPEN(stats?.montoTotal ?? 0)} />
        <Stat
          lbl="Pendientes aprobar"
          val={String(stats?.porEstado.pendiente_aprobacion ?? 0)}
          accent={stats?.porEstado.pendiente_aprobacion ? 'amber' : undefined}
        />
        <Stat lbl="Monto emitidas" val={fmtPEN(stats?.montoEmitidas ?? 0)} accent="green" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-md border border-line overflow-hidden flex-wrap">
          {ESTADOS_FILTROS.map((f) => (
            <button
              key={f.k}
              type="button"
              onClick={() => setFilterEstado(f.k)}
              className={cn(
                'px-2.5 py-1.5 text-[11px] font-medium border-l border-line first:border-l-0',
                filterEstado === f.k
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-bg-elev text-ink-3 hover:bg-bg-sunken',
              )}
            >
              {f.l}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" />
          Nueva OC
        </button>
      </div>

      {/* Tabla */}
      {ordenes.length === 0 ? (
        <div className="rounded-md border border-line bg-bg-elev p-12 text-center">
          <ShoppingCart className="mx-auto mb-3 h-8 w-8 text-ink-4" />
          <h3 className="text-[14px] font-semibold mb-1">Sin órdenes de compra</h3>
          <p className="text-[11.5px] text-ink-3">Crea la primera OC</p>
        </div>
      ) : (
        <div className="rounded-md border border-line bg-bg-elev overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-bg-sunken border-b border-line">
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3">
                <th className="px-3 py-2 w-36">Nº OC</th>
                <th className="px-3 py-2 w-44">Proveedor</th>
                <th className="px-3 py-2 w-28">Proyecto</th>
                <th className="px-3 py-2 w-24">Fecha</th>
                <th className="px-3 py-2 w-20 text-center">Moneda</th>
                <th className="px-3 py-2 w-28 text-right">Total</th>
                <th className="px-3 py-2 w-24">Estado</th>
                <th className="px-3 py-2 w-40">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ordenes.map((o) => (
                <tr key={o.id} className="hover:bg-bg-sunken/30">
                  <td className="px-3 py-2 font-mono text-[10.5px] text-primary font-semibold">
                    {o.numero}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-[11.5px] truncate max-w-[180px]" title={o.proveedor?.razonSocial}>
                      {o.proveedor?.razonSocial ?? '—'}
                    </div>
                    <div className="font-mono text-[9.5px] text-ink-4">{o.proveedor?.ruc ?? 'S/ RUC'}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[10.5px] text-ink-3">{o.proyecto?.codigo ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-[10.5px] text-ink-3">{o.fechaEmision}</td>
                  <td className="px-3 py-2 text-center text-[10.5px] text-ink-3">{o.moneda}</td>
                  <td className="px-3 py-2 text-right font-mono text-[11.5px] tabular-nums font-medium">
                    {fmtPEN(Number(o.total))}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`chip ${ESTADO_CHIP[o.estado] ?? 'gray'}`}>
                      {o.estado.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setPreviewOcId(o.id)}
                        className="h-6 w-6 rounded inline-flex items-center justify-center text-ink-3 hover:text-primary hover:bg-bg-sunken"
                        title="Ver OC + PDF"
                      >
                        <Eye className="h-3 w-3" />
                      </button>
                      {(o.estado === 'borrador' || o.estado === 'pendiente_aprobacion') && (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Aprobar OC ${o.numero}?`)) aprobarMut.mutate(o.id);
                          }}
                          disabled={aprobarMut.isPending}
                          className="h-6 w-6 rounded inline-flex items-center justify-center text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50"
                          title="Aprobar"
                        >
                          <ThumbsUp className="h-3 w-3" />
                        </button>
                      )}
                      {o.estado === 'aprobada' && (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Emitir OC ${o.numero}? Esta acción es definitiva.`)) emitirMut.mutate(o.id);
                          }}
                          disabled={emitirMut.isPending}
                          className="h-6 px-2 rounded inline-flex items-center text-[10px] text-primary hover:bg-primary-soft disabled:opacity-50"
                          title="Emitir"
                        >
                          Emitir
                        </button>
                      )}
                      {o.estado === 'emitida' && (
                        <button
                          type="button"
                          onClick={() => cambiarEstadoMut.mutate({ id: o.id, estado: 'en_transito', comentario: 'En camino' })}
                          className="h-6 w-6 rounded inline-flex items-center justify-center text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                          title="Marcar en tránsito"
                        >
                          <Truck className="h-3 w-3" />
                        </button>
                      )}
                      {o.estado === 'en_transito' && (
                        <button
                          type="button"
                          onClick={() => cambiarEstadoMut.mutate({ id: o.id, estado: 'entregada', comentario: 'Recibida' })}
                          className="h-6 w-6 rounded inline-flex items-center justify-center text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                          title="Marcar entregada"
                        >
                          <Check className="h-3 w-3" />
                        </button>
                      )}
                      {!['entregada', 'anulada'].includes(o.estado) && (
                        <button
                          type="button"
                          onClick={() => {
                            const motivo = prompt('Motivo anulación?');
                            if (motivo !== null) {
                              cambiarEstadoMut.mutate({ id: o.id, estado: 'anulada', comentario: motivo });
                            }
                          }}
                          className="h-6 w-6 rounded inline-flex items-center justify-center text-ink-4 hover:text-destructive hover:bg-destructive-soft"
                          title="Anular"
                        >
                          <ThumbsDown className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-line px-3 py-2 bg-bg-sunken/30 flex items-center justify-between text-[11px] text-ink-3">
            <span>{ordenes.length} órdenes</span>
            <span className="font-mono tabular-nums">Σ {fmtPEN(totalMonto)}</span>
          </div>
        </div>
      )}

      {showModal && (
        <NuevaOcModal
          onClose={() => setShowModal(false)}
          onSuccess={(ocId) => {
            setShowModal(false);
            qc.invalidateQueries({ queryKey: ['logistica-ocs'] });
            setPreviewOcId(ocId);
          }}
        />
      )}
      {previewOcId && <OcPdfPreview ocId={previewOcId} onClose={() => setPreviewOcId(null)} />}
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
  accent?: boolean | 'amber' | 'red' | 'green';
}) {
  const accentClass = accent === true
    ? 'text-primary'
    : accent === 'amber'
      ? 'text-amber-700 dark:text-amber-400'
      : accent === 'red'
        ? 'text-destructive'
        : accent === 'green'
          ? 'text-emerald-600'
          : '';
  return (
    <div className="rounded-md border border-line bg-bg-elev p-3 min-w-0">
      <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4">{lbl}</div>
      <div className={cn('mt-1 text-[14px] font-bold truncate', accentClass)}>{val}</div>
      {sub && <div className="text-[10px] text-ink-3 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

void AlertTriangle;
void FileDown;
void Loader2;
