import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Eye, FileText, Plus, Search, ShoppingCart, X } from 'lucide-react';
import { Suspense, lazy, useMemo, useState } from 'react';
import { api } from '@/lib/api.js';
import { cn, fmtPEN } from '@/lib/utils.js';
import { SkelRows } from '@/components/ui/Skeleton.js';

// Modales lazy · solo se descargan al abrirlos (form 800 líneas + visor PDF con CSS print)
const NuevaOcModal = lazy(() => import('./NuevaOcModal.js').then((m) => ({ default: m.NuevaOcModal })));
const OcPdfPreview = lazy(() => import('./OcPdfPreview.js').then((m) => ({ default: m.OcPdfPreview })));

const ESTADOS_FILTROS = [
  { k: '', l: 'Todas' },
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

const PAGE_SIZE = 12;

export function LogisticaOrdenesPage() {
  const qc = useQueryClient();
  const [filterEstado, setFilterEstado] = useState('');
  const [filterTipo, setFilterTipo] = useState<'' | 'BIEN' | 'SERVICIO'>('');
  const [busca, setBusca] = useState('');
  const [page, setPage] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [previewOcId, setPreviewOcId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['logistica-ocs', filterEstado, filterTipo],
    queryFn: () => api.logistica.listOcs({ estado: filterEstado || undefined, tipo: filterTipo || undefined }),
  });

  const ordenes = data?.ordenes ?? [];

  // búsqueda client-side
  const q = busca.trim().toLowerCase();
  const filtradas = useMemo(() => {
    if (!q) return ordenes;
    return ordenes.filter((o) =>
      [o.numero, o.proveedor?.razonSocial, o.proveedor?.ruc, o.proyecto?.codigo, o.proyecto?.nombre, o.itemPrincipal].some((x) =>
        String(x ?? '').toLowerCase().includes(q),
      ),
    );
  }, [ordenes, q]);

  // paginación client-side
  const totalPages = Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages - 1);
  const pageRows = filtradas.slice(pageSafe * PAGE_SIZE, pageSafe * PAGE_SIZE + PAGE_SIZE);
  const desde = filtradas.length === 0 ? 0 : pageSafe * PAGE_SIZE + 1;
  const hasta = Math.min(filtradas.length, (pageSafe + 1) * PAGE_SIZE);

  const limpiar = () => { setFilterEstado(''); setFilterTipo(''); setBusca(''); setPage(0); };
  const totalMonto = useMemo(() => filtradas.reduce((s, o) => s + Number(o.total), 0), [filtradas]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Tipo OC/OS */}
        <div className="inline-flex rounded-md border border-line p-0.5 bg-bg-sunken">
          {([['', 'Todas'], ['BIEN', 'OC · Compra'], ['SERVICIO', 'OS · Servicio']] as const).map(([k, l]) => (
            <button key={k} onClick={() => { setFilterTipo(k); setPage(0); }}
              className={cn('h-7 px-2.5 rounded-[5px] text-[11.5px] font-medium transition-colors', filterTipo === k ? 'bg-bg-elev text-foreground shadow-sm' : 'text-ink-3 hover:text-foreground')}>{l}</button>
          ))}
        </div>
        {/* Estado */}
        <select value={filterEstado} onChange={(e) => { setFilterEstado(e.target.value); setPage(0); }}
          className="h-8 px-2.5 rounded-md border border-line bg-bg-elev text-[12px]">
          {ESTADOS_FILTROS.map((f) => <option key={f.k} value={f.k}>{f.l === 'Todas' ? 'Todos los estados' : f.l}</option>)}
        </select>
        {/* Buscar */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="h-3.5 w-3.5 text-ink-4 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={busca} onChange={(e) => { setBusca(e.target.value); setPage(0); }} placeholder="Buscar OC/OS, proveedor, proyecto, ítem..."
            className="h-8 w-full pl-8 pr-2 rounded-md border border-line bg-bg-elev text-[12px]" />
        </div>
        {(filterEstado || filterTipo || busca) && (
          <button onClick={limpiar} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-line text-[11.5px] text-ink-3 hover:bg-bg-sunken"><X className="h-3.5 w-3.5" /> Limpiar</button>
        )}
        <button onClick={() => setShowModal(true)} className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90">
          <Plus className="h-3.5 w-3.5" /> Nueva OC / OS
        </button>
      </div>

      {/* Tabla */}
      {isLoading ? (
        <SkelRows rows={6} />
      ) : filtradas.length === 0 ? (
        <div className="rounded-md border border-line bg-bg-elev p-12 text-center">
          <ShoppingCart className="mx-auto mb-3 h-8 w-8 text-ink-4" />
          <h3 className="text-[14px] font-semibold mb-1">Sin órdenes</h3>
          <p className="text-[11.5px] text-ink-3">{ordenes.length === 0 ? 'Crea la primera OC / OS' : 'Sin resultados para el filtro'}</p>
        </div>
      ) : (
        <div className="rounded-md border border-line bg-bg-elev overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-bg-sunken border-b border-line">
              <tr className="text-left text-[10px] font-mono uppercase tracking-wider text-ink-4">
                <th className="px-3 py-2 w-32">Nº</th>
                <th className="px-3 py-2 w-44">Proveedor</th>
                <th className="px-3 py-2">Ítem principal</th>
                <th className="px-3 py-2 w-28">Proyecto</th>
                <th className="px-3 py-2 w-24">Emitida</th>
                <th className="px-3 py-2 w-28 text-right">Total</th>
                <th className="px-3 py-2 w-28">Estado</th>
                <th className="px-3 py-2 w-20 text-right">Docs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {pageRows.map((o) => {
                const esOs = o.concepto === 'SERVICIO';
                return (
                  <tr key={o.id} className="hover:bg-bg-sunken/30">
                    <td className="px-3 py-2">
                      <span className="font-mono text-[10.5px] text-primary font-semibold">{o.numero}</span>
                      <span className={cn('ml-1.5 text-[8.5px] font-bold px-1 py-0.5 rounded', esOs ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300')}>{esOs ? 'OS' : 'OC'}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-[11.5px] truncate max-w-[180px]" title={o.proveedor?.razonSocial}>{o.proveedor?.razonSocial ?? '—'}</div>
                      <div className="font-mono text-[9.5px] text-ink-4">{o.proveedor?.ruc ?? 'S/ RUC'}</div>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-ink-3 truncate max-w-[220px]" title={o.itemPrincipal ?? ''}>{o.itemPrincipal ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-[10.5px] text-ink-3">{o.proyecto?.codigo ?? 'Oficina'}</td>
                    <td className="px-3 py-2 font-mono text-[10.5px] text-ink-3">{o.fechaEmision}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11.5px] tabular-nums font-medium">{fmtPEN(Number(o.total))}</td>
                    <td className="px-3 py-2">
                      <span className={`chip ${ESTADO_CHIP[o.estado] ?? 'gray'}`}>{o.estado.replace(/_/g, ' ')}</span>
                      {o.estadoPago === 'pagada'
                        ? <div className="text-[9px] text-emerald-600 mt-0.5">✓ pagada</div>
                        : ['aprobada', 'emitida', 'en_transito', 'entregada'].includes(o.estado) && <div className="text-[9px] text-ink-4 mt-0.5">por pagar</div>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setPreviewOcId(o.id)} className="h-6 w-6 rounded inline-flex items-center justify-center text-ink-3 hover:text-primary hover:bg-bg-sunken" title="Ver OC + documentos"><Eye className="h-3.5 w-3.5" /></button>
                        {o.pdfNasPath && (
                          <a href={api.logistica.ocDocUrl(o.id, 'oc')} target="_blank" rel="noreferrer" className="h-6 w-6 rounded inline-flex items-center justify-center text-ink-3 hover:text-primary hover:bg-bg-sunken" title="OC.pdf (NAS)"><FileText className="h-3.5 w-3.5" /></a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* Footer · paginación */}
          <div className="border-t border-line px-3 py-2 bg-bg-sunken/30 flex items-center justify-between text-[11px] text-ink-3">
            <span>Mostrando {desde}-{hasta} de {filtradas.length} · Σ {fmtPEN(totalMonto)}</span>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button disabled={pageSafe === 0} onClick={() => setPage(pageSafe - 1)} className="h-6 w-6 rounded inline-flex items-center justify-center border border-line disabled:opacity-40 hover:bg-bg-sunken"><ChevronLeft className="h-3.5 w-3.5" /></button>
                <span className="px-2 font-mono">{pageSafe + 1} / {totalPages}</span>
                <button disabled={pageSafe >= totalPages - 1} onClick={() => setPage(pageSafe + 1)} className="h-6 w-6 rounded inline-flex items-center justify-center border border-line disabled:opacity-40 hover:bg-bg-sunken"><ChevronRight className="h-3.5 w-3.5" /></button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Nota · aprobación vive en Finanzas */}
      <p className="text-[10.5px] text-ink-4">Vista de seguimiento. La aprobación y el pago de órdenes se gestionan en <span className="font-medium text-ink-3">Finanzas → Órdenes</span> (separación de funciones).</p>

      <Suspense fallback={null}>
        {showModal && (
          <NuevaOcModal
            onClose={() => setShowModal(false)}
            onSuccess={(ocId) => { setShowModal(false); qc.invalidateQueries({ queryKey: ['logistica-ocs'] }); setPreviewOcId(ocId); }}
          />
        )}
        {previewOcId && <OcPdfPreview ocId={previewOcId} onClose={() => setPreviewOcId(null)} />}
      </Suspense>
    </div>
  );
}
