import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Loader2, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api.js';
import { fmtPEN } from '@/lib/utils.js';

const UNIDADES_SUNAT = [
  'UND', 'M2', 'ML', 'M3', 'KG', 'TON', 'BLS', 'CJ', 'GLN', 'LT', 'H', 'DIA', 'ZZ',
];

type Linea = {
  descripcion: string;
  unidad: string;
  cantidad: string;
  precioUnitario: string;
};

const EMPTY_LINEA: Linea = { descripcion: '', unidad: 'UND', cantidad: '', precioUnitario: '' };

const MEDIOS_PAGO = ['Transferencia Bancaria', 'Cheque', 'Efectivo', 'Tarjeta crédito', 'Letra de cambio'];
const FORMAS_PAGO = ['Al contado', 'Crédito 7 días', 'Crédito 15 días', 'Crédito 30 días', 'Crédito 60 días', 'Crédito 90 días'];
const TASAS_DETRACCION = [
  { v: 4, l: '4% · Construcción' },
  { v: 10, l: '10% · Servicios diversos' },
  { v: 12, l: '12% · Intermediación' },
  { v: 1.5, l: '1.5% · Comisión mercantil' },
];

export function NuevaOcModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (ocId: string) => void }) {
  const proveedoresQ = useQuery({
    queryKey: ['logistica-proveedores'],
    queryFn: () => api.logistica.listProveedores(),
  });
  const proyectosQ = useQuery({
    queryKey: ['proyectos-list'],
    queryFn: () => api.proyectos.list(),
  });

  const [form, setForm] = useState({
    proyectoId: '',
    proveedorId: '',
    fechaEmision: new Date().toISOString().slice(0, 10),
    fechaEntrega: '',
    lugarEntrega: 'LIMA',
    moneda: 'PEN' as 'PEN' | 'USD',
    concepto: 'BIEN' as 'BIEN' | 'SERVICIO',
    medioPago: 'Transferencia Bancaria',
    formaPago: 'Al contado',
    cotizacion: '',
    pctIgv: '18',
    incluyeIgv: true,
    aplicaDetraccion: false,
    pctDetraccion: '4',
    gestorEmail: '',
    gestorNombre: '',
    terminos:
      '- Términos y condiciones de acuerdo a cotización adjunta.\n- El precio está expresado en soles.',
    lineas: [{ ...EMPTY_LINEA }] as Linea[],
  });
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () =>
      api.logistica.createOc({
        proyectoId: form.proyectoId,
        proveedorId: form.proveedorId,
        fechaEmision: form.fechaEmision,
        fechaEntrega: form.fechaEntrega || null,
        lugarEntrega: form.lugarEntrega || null,
        moneda: form.moneda,
        concepto: form.concepto,
        medioPago: form.medioPago,
        formaPago: form.formaPago,
        cotizacion: form.cotizacion || null,
        pctIgv: form.pctIgv,
        incluyeIgv: form.incluyeIgv,
        aplicaDetraccion: form.aplicaDetraccion,
        pctDetraccion: form.aplicaDetraccion ? form.pctDetraccion : null,
        gestorEmail: form.gestorEmail || null,
        gestorNombre: form.gestorNombre || null,
        terminos: form.terminos,
        estado: 'pendiente_aprobacion',
        lineas: form.lineas
          .filter((l) => l.descripcion.trim() && l.cantidad && l.precioUnitario)
          .map((l) => ({
            descripcion: l.descripcion.trim(),
            unidad: l.unidad,
            cantidad: l.cantidad,
            precioUnitario: l.precioUnitario,
          })),
      }),
    onSuccess: (r) => onSuccess(r.oc.id),
    onError: (e: Error) => setError(e.message),
  });

  const proveedores = proveedoresQ.data?.proveedores ?? [];
  const proyectos = proyectosQ.data?.proyectos ?? [];

  const totales = useMemo(() => {
    const subtotalLineas = form.lineas.reduce(
      (s, l) => s + (parseFloat(l.cantidad) || 0) * (parseFloat(l.precioUnitario) || 0),
      0,
    );
    const pctIgv = parseFloat(form.pctIgv) || 0;
    let subtotalSinIgv: number;
    let igv: number;
    let total: number;
    if (form.incluyeIgv) {
      total = subtotalLineas;
      subtotalSinIgv = total / (1 + pctIgv / 100);
      igv = total - subtotalSinIgv;
    } else {
      subtotalSinIgv = subtotalLineas;
      igv = subtotalSinIgv * (pctIgv / 100);
      total = subtotalSinIgv + igv;
    }
    const pctDet = form.aplicaDetraccion ? parseFloat(form.pctDetraccion) || 0 : 0;
    const detraccion = total * (pctDet / 100);
    const neto = total - detraccion;
    return { subtotalSinIgv, igv, total, detraccion, neto };
  }, [form.lineas, form.pctIgv, form.incluyeIgv, form.aplicaDetraccion, form.pctDetraccion]);

  const onSelectProveedor = (id: string) => {
    setForm({ ...form, proveedorId: id });
  };

  const proveedorSelected = proveedores.find((p) => p.id === form.proveedorId);

  const addLinea = () => setForm({ ...form, lineas: [...form.lineas, { ...EMPTY_LINEA }] });
  const delLinea = (idx: number) =>
    setForm({
      ...form,
      lineas: form.lineas.length > 1 ? form.lineas.filter((_, i) => i !== idx) : form.lineas,
    });
  const setLinea = (idx: number, k: keyof Linea, v: string) =>
    setForm({
      ...form,
      lineas: form.lineas.map((l, i) => (i === idx ? { ...l, [k]: v } : l)),
    });

  const onSave = () => {
    setError(null);
    if (!form.proyectoId) return setError('Proyecto obligatorio');
    if (!form.proveedorId) return setError('Proveedor obligatorio');
    const validLineas = form.lineas.filter(
      (l) => l.descripcion.trim() && parseFloat(l.cantidad) > 0 && parseFloat(l.precioUnitario) >= 0,
    );
    if (validLineas.length === 0) return setError('Al menos 1 línea con datos válidos');
    createMut.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-4xl max-h-[94vh] overflow-hidden rounded-md border border-line bg-bg-elev shadow-xl flex flex-col">
        <div className="flex items-start justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold">Nueva Orden de Compra</h2>
            <p className="text-[11px] text-ink-3 mt-0.5">Datos comerciales · proveedor · ítems · detracción</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded text-ink-3 hover:bg-bg-sunken">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-[12px]">
          {/* Datos comerciales */}
          <Section title="Datos comerciales">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Proyecto *">
                <select value={form.proyectoId} onChange={(e) => setForm({ ...form, proyectoId: e.target.value })} className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary">
                  <option value="">— elegir —</option>
                  {proyectos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.codigo} · {p.nombre.slice(0, 30)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Fecha emisión">
                <input type="date" value={form.fechaEmision} onChange={(e) => setForm({ ...form, fechaEmision: e.target.value })} className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary" />
              </Field>
              <Field label="Fecha entrega">
                <input type="date" value={form.fechaEntrega} onChange={(e) => setForm({ ...form, fechaEntrega: e.target.value })} className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary" />
              </Field>
              <Field label="Moneda">
                <select value={form.moneda} onChange={(e) => setForm({ ...form, moneda: e.target.value as 'PEN' | 'USD' })} className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary">
                  <option value="PEN">Soles (S/)</option>
                  <option value="USD">Dólares ($)</option>
                </select>
              </Field>
              <Field label="Concepto">
                <select value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value as 'BIEN' | 'SERVICIO' })} className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary">
                  <option value="BIEN">BIEN</option>
                  <option value="SERVICIO">SERVICIO</option>
                </select>
              </Field>
              <Field label="Cotización">
                <input value={form.cotizacion} onChange={(e) => setForm({ ...form, cotizacion: e.target.value })} placeholder="COT-2026-XXXX" className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary" />
              </Field>
              <Field label="Medio de pago">
                <select value={form.medioPago} onChange={(e) => setForm({ ...form, medioPago: e.target.value })} className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary">
                  {MEDIOS_PAGO.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Forma de pago">
                <select value={form.formaPago} onChange={(e) => setForm({ ...form, formaPago: e.target.value })} className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary">
                  {FORMAS_PAGO.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Lugar entrega">
                <input value={form.lugarEntrega} onChange={(e) => setForm({ ...form, lugarEntrega: e.target.value })} className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary" />
              </Field>
            </div>
          </Section>

          {/* Proveedor */}
          <Section title="Proveedor">
            <Field label="Seleccionar *">
              <select value={form.proveedorId} onChange={(e) => onSelectProveedor(e.target.value)} className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary">
                <option value="">— elegir proveedor —</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.razonSocial} · RUC {p.ruc}
                  </option>
                ))}
              </select>
            </Field>
            {proveedorSelected && (
              <div className="rounded border border-line bg-bg-sunken/30 px-3 py-2 text-[11px] space-y-0.5">
                <div><span className="text-ink-3">Razón:</span> <span className="font-medium">{proveedorSelected.razonSocial}</span></div>
                <div><span className="text-ink-3">RUC:</span> <span className="font-mono">{proveedorSelected.ruc}</span></div>
                {proveedorSelected.domicilio && <div><span className="text-ink-3">Domicilio:</span> {proveedorSelected.domicilio}</div>}
              </div>
            )}
          </Section>

          {/* Ítems */}
          <Section title="Ítems">
            <div className="rounded-md border border-line overflow-hidden">
              <table className="w-full text-[11px]">
                <thead className="bg-bg-sunken">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-ink-3">
                    <th className="px-2 py-1.5 w-8">#</th>
                    <th className="px-2 py-1.5">Descripción</th>
                    <th className="px-2 py-1.5 w-20">Unidad</th>
                    <th className="px-2 py-1.5 w-20 text-right">Cant.</th>
                    <th className="px-2 py-1.5 w-28 text-right">PU</th>
                    <th className="px-2 py-1.5 w-28 text-right">Total</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {form.lineas.map((l, i) => {
                    const tot = (parseFloat(l.cantidad) || 0) * (parseFloat(l.precioUnitario) || 0);
                    return (
                      <tr key={i} className="border-t border-line/40">
                        <td className="px-2 py-1 font-mono text-[9.5px] text-ink-4 text-center">{(i + 1).toString().padStart(2, '0')}</td>
                        <td className="px-2 py-1">
                          <input value={l.descripcion} onChange={(e) => setLinea(i, 'descripcion', e.target.value)} placeholder="Descripción del bien/servicio" className="h-7 w-full px-1.5 rounded border border-line bg-bg-elev text-[11px] outline-none focus:border-primary" />
                        </td>
                        <td className="px-2 py-1">
                          <select value={l.unidad} onChange={(e) => setLinea(i, 'unidad', e.target.value)} className="h-7 w-full px-1 rounded border border-line bg-bg-elev text-[11px] font-mono outline-none focus:border-primary">
                            {UNIDADES_SUNAT.map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <input type="number" step="0.0001" value={l.cantidad} onChange={(e) => setLinea(i, 'cantidad', e.target.value)} className="h-7 w-full px-1 rounded border border-line bg-bg-elev text-[11px] font-mono outline-none focus:border-primary text-right" />
                        </td>
                        <td className="px-2 py-1">
                          <input type="number" step="0.00001" value={l.precioUnitario} onChange={(e) => setLinea(i, 'precioUnitario', e.target.value)} className="h-7 w-full px-1 rounded border border-line bg-bg-elev text-[11px] font-mono outline-none focus:border-primary text-right" />
                        </td>
                        <td className="px-2 py-1 text-right font-mono text-[11px] tabular-nums">{tot > 0 ? tot.toFixed(2) : '—'}</td>
                        <td className="px-1 py-1">
                          <button type="button" onClick={() => delLinea(i)} disabled={form.lineas.length === 1} className="text-ink-3 hover:text-destructive disabled:opacity-30">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="border-t border-line px-2 py-1.5">
                <button type="button" onClick={addLinea} className="inline-flex items-center gap-1 text-[10.5px] text-primary hover:underline">
                  <Plus className="h-3 w-3" />
                  Agregar línea
                </button>
              </div>
            </div>
          </Section>

          {/* IGV + Detracción */}
          <Section title="IGV y detracción">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Field label="% IGV">
                  <input type="number" step="0.01" value={form.pctIgv} onChange={(e) => setForm({ ...form, pctIgv: e.target.value })} className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary" />
                </Field>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.incluyeIgv} onChange={(e) => setForm({ ...form, incluyeIgv: e.target.checked })} className="rounded border-line" />
                  <span className="text-[11.5px]">PUs ya incluyen IGV (precio bruto)</span>
                </label>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.aplicaDetraccion} onChange={(e) => setForm({ ...form, aplicaDetraccion: e.target.checked })} className="rounded border-line" />
                  <span className="text-[11.5px] font-medium">Aplica detracción SUNAT</span>
                </label>
                {form.aplicaDetraccion && (
                  <Field label="Tasa detracción">
                    <select value={form.pctDetraccion} onChange={(e) => setForm({ ...form, pctDetraccion: e.target.value })} className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary">
                      {TASAS_DETRACCION.map((t) => (
                        <option key={t.v} value={t.v}>
                          {t.l}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>
            </div>

            {/* Totales preview */}
            <div className="mt-3 rounded-md border border-primary/30 bg-primary-soft/30 p-3 grid grid-cols-2 gap-2 text-[11.5px]">
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-ink-3">Subtotal sin IGV:</span>
                  <span className="font-mono tabular-nums">{fmtPEN(totales.subtotalSinIgv)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-3">IGV {form.pctIgv}%:</span>
                  <span className="font-mono tabular-nums">{fmtPEN(totales.igv)}</span>
                </div>
                <div className="flex justify-between border-t border-primary/20 pt-1 font-semibold">
                  <span>Total con IGV:</span>
                  <span className="font-mono tabular-nums">{fmtPEN(totales.total)}</span>
                </div>
              </div>
              <div className="space-y-1">
                {form.aplicaDetraccion ? (
                  <>
                    <div className="flex justify-between text-amber-700 dark:text-amber-400">
                      <span>Detracción {form.pctDetraccion}%:</span>
                      <span className="font-mono tabular-nums">- {fmtPEN(totales.detraccion)}</span>
                    </div>
                    <div className="flex justify-between border-t border-primary/20 pt-1 font-semibold text-emerald-600 dark:text-emerald-400">
                      <span>Neto a pagar:</span>
                      <span className="font-mono tabular-nums">{fmtPEN(totales.neto)}</span>
                    </div>
                  </>
                ) : (
                  <div className="text-[10.5px] text-ink-3 italic">Sin detracción aplicable</div>
                )}
              </div>
            </div>
          </Section>

          {/* Gestor + términos */}
          <Section title="Otros">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Gestor email">
                <input value={form.gestorEmail} onChange={(e) => setForm({ ...form, gestorEmail: e.target.value })} placeholder="victor.moreno@mmhighmetrik.com" className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary" />
              </Field>
              <Field label="Gestor nombre">
                <input value={form.gestorNombre} onChange={(e) => setForm({ ...form, gestorNombre: e.target.value })} placeholder="Victor Moreno" className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary" />
              </Field>
            </div>
            <Field label="Términos y condiciones">
              <textarea value={form.terminos} onChange={(e) => setForm({ ...form, terminos: e.target.value })} rows={3} className="w-full px-2 py-1.5 rounded border border-line bg-bg-sunken text-[11.5px] outline-none focus:border-primary" />
            </Field>
          </Section>

          {error && <div className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-[12px] text-destructive">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-md border border-line text-[12px] text-ink-2 hover:bg-bg-sunken">
            Cancelar
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={createMut.isPending}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90 disabled:opacity-50"
          >
            {createMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Crear OC · pendiente aprobación
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4 font-semibold mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10.5px] text-ink-3 mb-0.5">{label}</label>
      {children}
    </div>
  );
}
