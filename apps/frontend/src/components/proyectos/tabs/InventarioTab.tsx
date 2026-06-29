import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, History, PackageCheck, Plus, Receipt, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { type InventarioInput, api } from '@/lib/api.js';
import { cn, fmtPEN } from '@/lib/utils.js';

const CATEGORIAS = ['Compra Materiales', 'Herramientas', 'Maquinaria y equipo', 'EPPS', 'Combustible', 'Utiles de oficina', 'Otros'];
const ESTADOS = ['Disponible', 'Usado', 'Devuelto', 'Bajado'];
const ESTADO_CHIP: Record<string, string> = { Disponible: 'green', Usado: 'blue', Devuelto: 'amber', Bajado: 'red' };
const inputCls = 'h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] min-w-0';

export function InventarioTab({ proyectoId }: { proyectoId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['inventario', proyectoId], queryFn: () => api.finanzas.listInventario(proyectoId) });
  const items = data?.items ?? [];
  const stats = data?.stats;
  const inval = () => qc.invalidateQueries({ queryKey: ['inventario', proyectoId] });
  const del = useMutation({ mutationFn: (id: string) => api.finanzas.deleteInventario(id), onSuccess: inval });
  const setEstado = useMutation({ mutationFn: (v: { id: string; estado: string }) => api.finanzas.setInventarioEstado(v.id, v.estado), onSuccess: inval });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <Stat label="Items" value={String(stats?.count ?? 0)} />
        <Stat label="Valor total" value={fmtPEN(stats?.valorTotal ?? 0)} mono accent />
        <Stat label="Categorías" value={String(Object.keys(stats?.porCategoria ?? {}).length)} />
      </div>

      <div className="rounded-md border border-line bg-bg-elev">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h3 className="text-[13px] font-semibold flex items-center gap-1.5"><Boxes className="h-4 w-4 text-ink-3" /> Inventario / almacén</h3>
          <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium hover:opacity-90"><Plus className="h-3.5 w-3.5" /> Item</button>
        </div>
        <div className="p-3 space-y-3">
          {open && <ItemForm proyectoId={proyectoId} onDone={() => { inval(); setOpen(false); }} />}
          {isLoading ? <div className="text-center py-4 text-[12px] text-ink-3">Cargando...</div>
            : items.length === 0 ? <div className="text-center py-6 text-[12px] text-ink-3">Sin items · registra ingresos a almacén</div>
            : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-line bg-bg-sunken">{['Fecha', 'Descripción', 'Categoría', 'Cant.', 'V.Unit', 'Valor', 'Estado', ''].map((h, i) => <th key={i} className={cn('px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-4', i >= 3 && i <= 5 ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
                <tbody>
                  {items.map((it) => {
                    const valor = Number(it.cantidad) * Number(it.valorUnitario);
                    return (
                      <tr key={it.id} className="border-b border-line hover:bg-bg-sunken/30">
                        <td className="px-2.5 py-1.5 text-[11px] font-mono tabular-nums">{it.fecha}</td>
                        <td className="px-2.5 py-1.5 text-[11.5px] max-w-[220px] truncate">
                          <button onClick={() => setDetalleId(it.id)} className="text-left hover:text-primary hover:underline truncate w-full" title="Ver compra origen + historial">{it.descripcionItem ?? '—'}</button>
                        </td>
                        <td className="px-2.5 py-1.5 text-[11px] text-ink-3">{it.categoria ?? '—'}</td>
                        <td className="px-2.5 py-1.5 text-[11px] font-mono tabular-nums text-right">{Number(it.cantidad)}</td>
                        <td className="px-2.5 py-1.5 text-[11px] font-mono tabular-nums text-right text-ink-3">{fmtPEN(Number(it.valorUnitario))}</td>
                        <td className="px-2.5 py-1.5 text-[11px] font-mono tabular-nums text-right font-semibold">{fmtPEN(valor)}</td>
                        <td className="px-2.5 py-1.5">
                          <select className={cn('chip border-0 cursor-pointer', ESTADO_CHIP[it.estado ?? ''] ?? '')} value={it.estado ?? 'Disponible'} onChange={(e) => setEstado.mutate({ id: it.id, estado: e.target.value })}>
                            {ESTADOS.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5"><button onClick={() => del.mutate(it.id)} className="text-ink-4 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {detalleId && <DetalleModal id={detalleId} onClose={() => setDetalleId(null)} />}
    </div>
  );
}

// FX-4 · detalle ítem: compra origen + ítems de la factura + historial de compras + valuación
function DetalleModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['inv-detalle', id], queryFn: () => api.finanzas.inventarioDetalle(id) });
  // ponytail: promueve con valores derivados del ítem; afinar marca/serie/% se hace luego en Activos
  const promover = useMutation({
    mutationFn: () => api.activos.promover(id),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['inventario'] }); qc.invalidateQueries({ queryKey: ['inv-detalle', id] }); alert(`Activo creado: ${r.activo.codigo}`); },
    onError: (e: unknown) => alert(e instanceof Error ? e.message : 'Error al promover'),
  });
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm p-4 sm:p-6" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-line bg-bg-elev p-5 shadow-xl">
        {isLoading || !data ? <div className="text-center py-10 text-[12px] text-ink-3">Cargando...</div> : (
          <>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-[15px] font-semibold leading-tight">{data.item.descripcionItem ?? '—'}</h3>
                <p className="text-[11px] text-ink-4 mt-0.5">{data.item.categoria ?? '—'} · {data.item.proveedorRazon ?? 's/proveedor'}</p>
              </div>
              <button onClick={onClose} className="h-7 w-7 rounded-md border border-line inline-flex items-center justify-center text-ink-3 hover:bg-bg-sunken"><X className="h-3.5 w-3.5" /></button>
            </div>

            {/* Compra origen + valuación */}
            {data.gasto ? (
              <div className="rounded-md border border-line bg-bg-sunken/40 p-3 mb-3">
                <div className="text-[10px] font-mono uppercase tracking-wider text-ink-4 mb-1.5 flex items-center gap-1.5"><Receipt className="h-3.5 w-3.5" /> Compra origen</div>
                <div className="text-[12px]">{data.gasto.tipoComprobante} {data.gasto.serie}-{data.gasto.numero} · {data.gasto.fecha}</div>
                {data.valuacion && (
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11.5px]">
                    <div><div className="text-ink-4 text-[9.5px] uppercase">Total factura</div><div className="font-mono font-semibold">{fmtPEN(data.valuacion.facturaTotal)}</div></div>
                    <div><div className="text-ink-4 text-[9.5px] uppercase">Inventariable</div><div className="font-mono font-semibold">{fmtPEN(data.valuacion.inventariable)}</div></div>
                    <div><div className="text-ink-4 text-[9.5px] uppercase">Diferencia</div><div className={cn('font-mono font-semibold', Math.abs(data.valuacion.diferencia) > 0.5 ? 'text-amber-600' : 'text-emerald-600')}>{fmtPEN(data.valuacion.diferencia)}</div></div>
                  </div>
                )}
                {data.itemsFactura.length > 1 && (
                  <div className="mt-2 pt-2 border-t border-line">
                    <div className="text-[9.5px] uppercase text-ink-4 mb-1">Otros ítems de esta factura ({data.itemsFactura.length})</div>
                    {data.itemsFactura.map((it) => (
                      <div key={it.id} className="flex justify-between text-[11px] py-0.5">
                        <span className="truncate max-w-[320px]">{it.descripcionItem}</span>
                        <span className="font-mono tabular-nums text-ink-3">{Number(it.cantidad)} × {fmtPEN(Number(it.valorUnitario))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-md border border-amber-300/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11.5px] text-amber-800 dark:text-amber-300 mb-3">Sin compra ligada (sin comprobante o sin match)</div>
            )}

            {/* Historial de compras del mismo ítem (descripción exacta) */}
            <div className="text-[10px] font-mono uppercase tracking-wider text-ink-4 mb-1.5 flex items-center gap-1.5"><History className="h-3.5 w-3.5" /> Historial de compras ({data.historial.length})</div>
            <table className="w-full text-[11.5px]">
              <thead><tr className="border-b border-line text-[9.5px] font-mono uppercase text-ink-4"><th className="text-left py-1">Fecha</th><th className="text-left py-1">Comprobante</th><th className="text-left py-1">Proveedor</th><th className="text-right py-1">Cant</th><th className="text-right py-1">V.unit</th></tr></thead>
              <tbody>
                {data.historial.map((h) => (
                  <tr key={h.id} className="border-b border-line/50 last:border-0">
                    <td className="py-1 font-mono tabular-nums">{h.fecha}</td>
                    <td className="py-1 text-ink-3">{[h.serie, h.numero].filter(Boolean).join('-') || '—'}</td>
                    <td className="py-1 text-ink-3 truncate max-w-[150px]">{h.proveedorRazon ?? '—'}</td>
                    <td className="py-1 text-right font-mono tabular-nums">{Number(h.cantidad)}</td>
                    <td className="py-1 text-right font-mono tabular-nums">{fmtPEN(Number(h.valorUnitario))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-ink-4 mt-2">Agrupado por descripción exacta (sin catálogo SKU · "TALADRO BOSCH GBH" ≠ "Taladro Bosch").</p>

            {/* FX-5 · promover a activo */}
            <div className="mt-4 pt-3 border-t border-line">
              {data.item.activoId ? (
                <div className="inline-flex items-center gap-1.5 text-[11.5px] text-emerald-600 font-medium"><PackageCheck className="h-4 w-4" /> Ya promovido a activo</div>
              ) : (
                <button
                  onClick={() => { if (confirm('¿Convertir este ítem en activo (herramienta/equipo)? Se genera un código MM-A-xxxx con depreciación SUNAT.')) promover.mutate(); }}
                  disabled={promover.isPending}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-line text-[11.5px] font-medium hover:bg-bg-sunken disabled:opacity-50"
                >
                  <PackageCheck className="h-4 w-4 text-ink-3" /> {promover.isPending ? 'Promoviendo...' : 'Marcar como activo'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function ItemForm({ proyectoId, onDone }: { proyectoId: string; onDone: () => void }) {
  const empty: InventarioInput = { fecha: new Date().toISOString().slice(0, 10), descripcionItem: '', categoria: 'Compra Materiales', cantidad: 1, valorUnitario: 0, estado: 'Disponible', proveedorRazon: '', responsable: '' };
  const [f, setF] = useState<InventarioInput>(empty);
  const set = (p: Partial<InventarioInput>) => setF({ ...f, ...p });
  const create = useMutation({ mutationFn: () => api.finanzas.createInventario(proyectoId, f), onSuccess: onDone });
  const valor = (f.cantidad ?? 0) * (f.valorUnitario ?? 0);
  return (
    <div className="rounded-md border border-line bg-bg-sunken/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input className={inputCls} type="date" value={f.fecha} onChange={(e) => set({ fecha: e.target.value })} />
        <input className={cn(inputCls, 'flex-1 min-w-[160px]')} placeholder="descripción del item" value={f.descripcionItem ?? ''} onChange={(e) => set({ descripcionItem: e.target.value })} />
        <select className={inputCls} value={f.categoria ?? ''} onChange={(e) => set({ categoria: e.target.value })}>{CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className={cn(inputCls, 'flex-1 min-w-[120px]')} placeholder="proveedor" value={f.proveedorRazon ?? ''} onChange={(e) => set({ proveedorRazon: e.target.value })} />
        <input className={cn(inputCls, 'w-20')} type="number" placeholder="cant" value={f.cantidad || ''} onChange={(e) => set({ cantidad: Number(e.target.value) })} />
        <input className={cn(inputCls, 'w-24')} type="number" placeholder="V.unit" value={f.valorUnitario || ''} onChange={(e) => set({ valorUnitario: Number(e.target.value) })} />
        <span className="text-[12px] font-semibold">Valor {fmtPEN(valor)}</span>
        <button disabled={!f.fecha || valor <= 0 || create.isPending} onClick={() => create.mutate()} className="ml-auto inline-flex items-center gap-1 h-7 px-3 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium disabled:opacity-50">{create.isPending ? 'Guardando...' : 'Guardar'}</button>
      </div>
    </div>
  );
}

function Stat({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-bg-elev p-2.5">
      <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4 truncate">{label}</div>
      <div className={cn('mt-0.5 font-bold tracking-[-0.02em]', mono ? 'text-[14px] font-mono' : 'text-[16px]', accent && 'text-primary')}>{value}</div>
    </div>
  );
}
