import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Landmark, Plus, Receipt, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type GastoInput, type MovimientoInput, api } from '@/lib/api.js';
import { cn, fmtPEN } from '@/lib/utils.js';
import { invalidateResumen } from '@/lib/invalidate.js';

type Sub = 'gastos' | 'movimientos';

export function FinanzasTab({ proyectoId }: { proyectoId: string }) {
  const [sub, setSub] = useState<Sub>('gastos');
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-md border border-line p-0.5 bg-bg-sunken">
        {([['gastos', 'Gastos (costo real)'], ['movimientos', 'Flujo de cuentas']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setSub(k)} className={cn('h-8 px-4 rounded-[5px] text-[12px] font-medium transition-colors', sub === k ? 'bg-bg-elev text-foreground shadow-sm' : 'text-ink-3 hover:text-foreground')}>{l}</button>
        ))}
      </div>
      {sub === 'gastos' ? <GastosSection proyectoId={proyectoId} /> : <MovimientosSection proyectoId={proyectoId} />}
    </div>
  );
}

const TIPOS_GASTO = [
  'Compra Materiales', 'Servicio Terceros', 'Movilidad', 'Viáticos', 'Seguro', 'Servicios básicos',
  'Comisión', 'Planilla', 'Cliente', 'Socio', 'Varios', 'Impuestos', 'Mantenimiento', 'Devolucion',
  'Gasto Bancario', 'Herramientas', 'Maquinaria y equipo', 'EPPS', 'Abono de cliente', 'Prestamo otorgado',
  'Prestamo recibido', 'Gasto Administrativo', 'Combustible', 'Alquileres', 'Utiles de oficina', 'Nota de Credito', 'Otros',
];
const FORMAS_PAGO = ['Contado', 'Crédito 15 días', 'Crédito 30 días', 'Transferencia', 'Yape/Plin', 'Caja Chica'];
const FUENTES_PAGO = ['Caja Chica', 'Cuenta Corriente'];
const TIPOS_COMPROBANTE = ['Factura', 'Boleta', 'Recibo por Honorarios', 'Nota de Crédito', 'Sin Comprobante', 'Contrato', 'Invoice', 'Recibo de servicios'];

const inputCls = 'h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] min-w-0';

function GastosSection({ proyectoId }: { proyectoId: string }) {
  const qc = useQueryClient();
  const [tipoFiltro, setTipoFiltro] = useState('');
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['gastos', proyectoId, tipoFiltro],
    queryFn: () => api.finanzas.listGastos(proyectoId, tipoFiltro ? { tipo: tipoFiltro } : undefined),
  });
  const cuentasQ = useQuery({ queryKey: ['cuentas'], queryFn: () => api.finanzas.listCuentas() });

  const gastos = data?.gastos ?? [];
  const stats = data?.stats;
  const inval = () => { qc.invalidateQueries({ queryKey: ['gastos', proyectoId] }); invalidateResumen(qc); };
  const del = useMutation({ mutationFn: (id: string) => api.finanzas.deleteGasto(id), onSuccess: inval });

  const topTipos = useMemo(() => Object.entries(stats?.porTipo ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 4), [stats]);

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Stat label="Gastos registrados" value={String(stats?.count ?? 0)} />
        <Stat label="Σ Total (c/IGV)" value={fmtPEN(stats?.totalGeneral ?? 0)} mono accent="warn" />
        <Stat label="Σ Subtotal (s/IGV)" value={fmtPEN(stats?.subtotalGeneral ?? 0)} mono />
        <Stat label="Categorías" value={String(Object.keys(stats?.porTipo ?? {}).length)} />
      </div>

      {topTipos.length > 0 && (
        <div className="rounded-md border border-line bg-bg-elev p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-ink-4 mb-2">Top categorías de gasto</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
            {topTipos.map(([t, v]) => (
              <button key={t} onClick={() => setTipoFiltro(tipoFiltro === t ? '' : t)} className={cn('flex justify-between rounded px-2 py-1', tipoFiltro === t ? 'bg-primary/10' : 'hover:bg-bg-sunken')}>
                <span className="text-ink-3 truncate">{t}</span>
                <span className="font-mono tabular-nums ml-2">{fmtPEN(v)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Ledger */}
      <div className="rounded-md border border-line bg-bg-elev">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h3 className="text-[13px] font-semibold flex items-center gap-1.5"><Receipt className="h-4 w-4 text-ink-3" /> Gastos (costo real ejecutado)</h3>
          <div className="flex items-center gap-2">
            <select className={inputCls} value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)}>
              <option value="">Todos los tipos</option>
              {TIPOS_GASTO.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium hover:opacity-90"><Plus className="h-3.5 w-3.5" /> Gasto</button>
          </div>
        </div>

        <div className="p-3 space-y-3">
          {open && <GastoForm proyectoId={proyectoId} cuentas={cuentasQ.data?.cuentas ?? []} onDone={() => { inval(); setOpen(false); }} />}
          {isLoading ? <div className="text-center py-4 text-[12px] text-ink-3">Cargando...</div>
            : gastos.length === 0 ? <div className="text-center py-6 text-[12px] text-ink-3">Sin gastos · registra el primero o importa desde Excel</div>
            : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line bg-bg-sunken">
                    {['Fecha', 'Comprobante', 'Proveedor', 'Descripción', 'Tipo', 'Subtotal', 'IGV', 'Total', ''].map((h, i) => (
                      <th key={i} className={cn('px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-4', i >= 5 && i <= 7 ? 'text-right' : 'text-left')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gastos.map((g) => (
                    <tr key={g.id} className="border-b border-line hover:bg-bg-sunken/30">
                      <td className="px-2.5 py-1.5 text-[11px] font-mono tabular-nums">{g.fecha}</td>
                      <td className="px-2.5 py-1.5 text-[11px]">{g.tipoComprobante ?? '—'}{g.numero && <span className="text-ink-4"> {g.serie}-{g.numero}</span>}</td>
                      <td className="px-2.5 py-1.5 text-[11.5px] max-w-[160px] truncate">{g.proveedorRazon ?? '—'}</td>
                      <td className="px-2.5 py-1.5 text-[11.5px] max-w-[180px] truncate text-ink-3">{g.descripcionItem ?? '—'}</td>
                      <td className="px-2.5 py-1.5"><span className="chip">{g.tipoGasto ?? '—'}</span></td>
                      <td className="px-2.5 py-1.5 text-[11px] font-mono tabular-nums text-right">{fmtPEN(Number(g.subtotal))}</td>
                      <td className="px-2.5 py-1.5 text-[11px] font-mono tabular-nums text-right text-ink-3">{fmtPEN(Number(g.igv))}</td>
                      <td className="px-2.5 py-1.5 text-[11px] font-mono tabular-nums text-right font-semibold">{fmtPEN(Number(g.total))}</td>
                      <td className="px-2 py-1.5"><button onClick={() => del.mutate(g.id)} className="text-ink-4 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <p className="text-[10.5px] text-ink-4">Estos gastos alimentan el costo real del P&L (tab Económico) · modelo "Fact de Compras"</p>
    </div>
  );
}

function GastoForm({ proyectoId, cuentas, onDone }: { proyectoId: string; cuentas: { id: string; descripcion: string | null; codigo: string }[]; onDone: () => void }) {
  const empty: GastoInput = {
    fecha: new Date().toISOString().slice(0, 10), tipoRegistro: 'Gasto Directo', tipoIgv: 'IGV',
    proveedorRuc: '', proveedorRazon: '', tipoComprobante: 'Factura', serie: '', numero: '',
    moneda: 'PEN', formaPago: 'Transferencia', fuentePago: 'Cuenta Corriente', cuentaId: null,
    descripcionItem: '', subtotal: 0, igv: 0, exonerado: 0, total: 0, tipoGasto: 'Compra Materiales', observaciones: '',
  };
  const [f, setF] = useState<GastoInput>(empty);
  const set = (patch: Partial<GastoInput>) => setF({ ...f, ...patch });

  // subtotal → IGV 18% auto + total
  const onSubtotal = (v: number) => {
    const igv = f.tipoIgv === 'Exonerado' ? 0 : Number((v * 0.18).toFixed(2));
    set({ subtotal: v, igv, total: Number((v + igv).toFixed(2)) });
  };

  const create = useMutation({ mutationFn: () => api.finanzas.createGasto(proyectoId, f), onSuccess: onDone });
  const canSubmit = !!f.fecha && (f.total ?? 0) > 0 && !!f.tipoGasto;

  return (
    <div className="rounded-md border border-line bg-bg-sunken/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input className={inputCls} type="date" value={f.fecha} onChange={(e) => set({ fecha: e.target.value })} />
        <Sel value={f.tipoGasto ?? ''} onChange={(v) => set({ tipoGasto: v })} opts={TIPOS_GASTO} />
        <input className={cn(inputCls, 'w-28')} placeholder="RUC" value={f.proveedorRuc ?? ''} onChange={(e) => set({ proveedorRuc: e.target.value })} />
        <input className={cn(inputCls, 'flex-1 min-w-[140px]')} placeholder="Proveedor / razón social" value={f.proveedorRazon ?? ''} onChange={(e) => set({ proveedorRazon: e.target.value })} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Sel value={f.tipoComprobante ?? ''} onChange={(v) => set({ tipoComprobante: v })} opts={TIPOS_COMPROBANTE} />
        <input className={cn(inputCls, 'w-20')} placeholder="serie" value={f.serie ?? ''} onChange={(e) => set({ serie: e.target.value })} />
        <input className={cn(inputCls, 'w-28')} placeholder="número" value={f.numero ?? ''} onChange={(e) => set({ numero: e.target.value })} />
        <Sel value={f.formaPago ?? ''} onChange={(v) => set({ formaPago: v })} opts={FORMAS_PAGO} />
        <Sel value={f.fuentePago ?? ''} onChange={(v) => set({ fuentePago: v })} opts={FUENTES_PAGO} />
        <select className={inputCls} value={f.cuentaId ?? ''} onChange={(e) => set({ cuentaId: e.target.value || null })}>
          <option value="">— cuenta —</option>
          {cuentas.map((c) => <option key={c.id} value={c.id}>{c.descripcion ?? c.codigo}</option>)}
        </select>
      </div>
      <input className={cn(inputCls, 'w-full')} placeholder="descripción del item" value={f.descripcionItem ?? ''} onChange={(e) => set({ descripcionItem: e.target.value })} />
      <div className="flex flex-wrap items-center gap-2">
        <Sel value={f.tipoIgv ?? ''} onChange={(v) => set({ tipoIgv: v })} opts={['IGV', 'Exonerado']} />
        <label className="text-[11px] text-ink-3">Subtotal</label>
        <input className={cn(inputCls, 'w-28')} type="number" value={f.subtotal || ''} onChange={(e) => onSubtotal(Number(e.target.value))} />
        <span className="text-[11px] text-ink-3">IGV {fmtPEN(f.igv ?? 0)}</span>
        <span className="text-[12px] font-semibold">Total {fmtPEN(f.total ?? 0)}</span>
        <button disabled={!canSubmit || create.isPending} onClick={() => create.mutate()} className="ml-auto inline-flex items-center gap-1 h-7 px-3 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium disabled:opacity-50">
          {create.isPending ? 'Guardando...' : 'Guardar gasto'}
        </button>
      </div>
    </div>
  );
}

const FUENTES_MOV = ['Cliente', 'Socio', 'Préstamo', 'Abono de cliente', 'Devolución', 'Transferencia interna', 'Otros'];

function MovimientosSection({ proyectoId }: { proyectoId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['movimientos', proyectoId], queryFn: () => api.finanzas.listMovimientos(proyectoId) });
  const cuentasQ = useQuery({ queryKey: ['cuentas'], queryFn: () => api.finanzas.listCuentas() });
  const saldosQ = useQuery({ queryKey: ['saldos'], queryFn: () => api.finanzas.saldos() });

  const movs = data?.movimientos ?? [];
  const stats = data?.stats;
  const inval = () => { qc.invalidateQueries({ queryKey: ['movimientos', proyectoId] }); qc.invalidateQueries({ queryKey: ['saldos'] }); invalidateResumen(qc); };
  // H1.3 · anulación formal (reemplaza delete operacional de movimientos)
  const anular = useMutation({ mutationFn: ({ id, motivo }: { id: string; motivo: string }) => api.finanzas.anularMovimiento(id, motivo), onSuccess: inval });
  const anularMov = (id: string) => { const motivo = window.prompt('Motivo de anulación (obligatorio):')?.trim(); if (motivo) anular.mutate({ id, motivo }); };
  const cuentaMap = new Map((cuentasQ.data?.cuentas ?? []).map((c) => [c.id, c.descripcion ?? c.codigo]));

  return (
    <div className="space-y-4">
      {/* Saldos por cuenta (global) */}
      {(saldosQ.data?.saldos.length ?? 0) > 0 && (
        <div className="rounded-md border border-line bg-bg-elev p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-ink-4 mb-2 flex items-center gap-1.5"><Landmark className="h-3.5 w-3.5" /> Saldos por cuenta (toda la empresa)</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[12px]">
            {saldosQ.data!.saldos.map((s) => (
              <div key={s.cuenta.id} className="flex justify-between rounded border border-line px-2.5 py-1.5">
                <span className="text-ink-3 truncate">{s.cuenta.descripcion ?? s.cuenta.codigo}</span>
                <span className={cn('font-mono tabular-nums font-semibold ml-2', s.saldo >= 0 ? 'text-foreground' : 'text-destructive')}>{fmtPEN(s.saldo)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats del proyecto */}
      <div className="grid grid-cols-3 gap-2.5">
        <Stat label="Ingresos (proyecto)" value={fmtPEN(stats?.ingresos ?? 0)} mono />
        <Stat label="Egresos (proyecto)" value={fmtPEN(stats?.egresos ?? 0)} mono accent="warn" />
        <Stat label="Neto (proyecto)" value={fmtPEN(stats?.neto ?? 0)} mono />
      </div>

      <div className="rounded-md border border-line bg-bg-elev">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h3 className="text-[13px] font-semibold">Movimientos de cuenta · caja real</h3>
          <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium hover:opacity-90"><Plus className="h-3.5 w-3.5" /> Movimiento</button>
        </div>
        <div className="p-3 space-y-3">
          {open && <MovForm proyectoId={proyectoId} cuentas={cuentasQ.data?.cuentas ?? []} onDone={() => { inval(); setOpen(false); }} />}
          {isLoading ? <div className="text-center py-4 text-[12px] text-ink-3">Cargando...</div>
            : movs.length === 0 ? <div className="text-center py-6 text-[12px] text-ink-3">Sin movimientos · registra ingresos/egresos de caja</div>
            : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-line bg-bg-sunken">{['Fecha', 'Tipo', 'Cuenta', 'Fuente', 'Descripción', 'Monto', ''].map((h, i) => <th key={i} className={cn('px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-4', i === 5 ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
                <tbody>
                  {movs.map((m) => {
                    const ing = m.tipoMovimiento === 'Ingreso';
                    return (
                      <tr key={m.id} className="border-b border-line hover:bg-bg-sunken/30">
                        <td className="px-2.5 py-1.5 text-[11px] font-mono tabular-nums">{m.fecha}</td>
                        <td className="px-2.5 py-1.5"><span className={cn('inline-flex items-center gap-0.5 text-[11px] font-medium', ing ? 'text-ok' : 'text-warn-ink')}>{ing ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{m.tipoMovimiento}</span></td>
                        <td className="px-2.5 py-1.5 text-[11.5px] text-ink-3 max-w-[130px] truncate">{m.cuentaId ? cuentaMap.get(m.cuentaId) ?? '—' : '—'}</td>
                        <td className="px-2.5 py-1.5 text-[11px] text-ink-3">{m.fuenteMovimiento ?? '—'}</td>
                        <td className="px-2.5 py-1.5 text-[11.5px] max-w-[200px] truncate">{m.descripcion ?? '—'}</td>
                        <td className={cn('px-2.5 py-1.5 text-[11px] font-mono tabular-nums text-right font-semibold', ing ? 'text-ok' : 'text-warn-ink')}>{ing ? '+' : '−'}{fmtPEN(Number(m.monto))}</td>
                        <td className="px-2 py-1.5"><button onClick={() => anularMov(m.id)} title="Anular movimiento" className="text-ink-4 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MovForm({ proyectoId, cuentas, onDone }: { proyectoId: string; cuentas: { id: string; descripcion: string | null; codigo: string }[]; onDone: () => void }) {
  const empty: MovimientoInput = { fecha: new Date().toISOString().slice(0, 10), tipoMovimiento: 'Egreso', fuentePago: 'Cuenta Corriente', cuentaId: null, fuenteMovimiento: 'Otros', clienteNombre: '', moneda: 'PEN', monto: 0, descripcion: '', numOperacion: '' };
  const [f, setF] = useState<MovimientoInput>(empty);
  const set = (p: Partial<MovimientoInput>) => setF({ ...f, ...p });
  const create = useMutation({ mutationFn: () => api.finanzas.createMovimiento(proyectoId, f), onSuccess: onDone });
  return (
    <div className="rounded-md border border-line bg-bg-sunken/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input className={inputCls} type="date" value={f.fecha} onChange={(e) => set({ fecha: e.target.value })} />
        <Sel value={f.tipoMovimiento} onChange={(v) => set({ tipoMovimiento: v as 'Ingreso' | 'Egreso' })} opts={['Ingreso', 'Egreso']} />
        <select className={inputCls} value={f.cuentaId ?? ''} onChange={(e) => set({ cuentaId: e.target.value || null })}>
          <option value="">— cuenta —</option>
          {cuentas.map((c) => <option key={c.id} value={c.id}>{c.descripcion ?? c.codigo}</option>)}
        </select>
        <Sel value={f.fuenteMovimiento ?? ''} onChange={(v) => set({ fuenteMovimiento: v })} opts={FUENTES_MOV} />
        <input className={cn(inputCls, 'w-28')} type="number" placeholder="monto" value={f.monto || ''} onChange={(e) => set({ monto: Number(e.target.value) })} />
      </div>
      <div className="flex items-center gap-2">
        <input className={cn(inputCls, 'flex-1')} placeholder="descripción del movimiento" value={f.descripcion ?? ''} onChange={(e) => set({ descripcion: e.target.value })} />
        <input className={cn(inputCls, 'w-28')} placeholder="N° operación" value={f.numOperacion ?? ''} onChange={(e) => set({ numOperacion: e.target.value })} />
        <button disabled={!f.fecha || f.monto <= 0 || create.isPending} onClick={() => create.mutate()} className="inline-flex items-center gap-1 h-7 px-3 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium disabled:opacity-50">{create.isPending ? 'Guardando...' : 'Guardar'}</button>
      </div>
    </div>
  );
}

function Sel({ value, onChange, opts }: { value: string; onChange: (v: string) => void; opts: string[] }) {
  return <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
}

function Stat({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: 'warn' }) {
  return (
    <div className="rounded-md border border-line bg-bg-elev p-2.5">
      <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4 truncate">{label}</div>
      <div className={cn('mt-0.5 font-bold tracking-[-0.02em]', mono ? 'text-[14px] font-mono' : 'text-[16px]', accent === 'warn' && 'text-warn-ink')}>{value}</div>
    </div>
  );
}
