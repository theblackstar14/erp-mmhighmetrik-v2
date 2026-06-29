import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, Plus, Sparkles, X, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api.js';
import { EmittingOverlay } from '@/components/ui/EmittingOverlay.js';
import { cn, fmtPEN } from '@/lib/utils.js';

const UNIDADES_SUNAT = [
  { c: 'UND', l: 'Unidad' },
  { c: 'M2', l: 'Metro²' },
  { c: 'ML', l: 'Metro lineal' },
  { c: 'M3', l: 'Metro³' },
  { c: 'KG', l: 'Kilogramo' },
  { c: 'TON', l: 'Tonelada' },
  { c: 'BLS', l: 'Bolsa' },
  { c: 'CJ', l: 'Caja' },
  { c: 'GLN', l: 'Galón' },
  { c: 'LT', l: 'Litro' },
  { c: 'H', l: 'Hora' },
  { c: 'DIA', l: 'Día' },
  { c: 'ZZ', l: 'Servicio' },
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

// Mock TEST · cerámicas (de v1)
const TEST_OC_DATA = {
  fechaEmision: new Date().toISOString().slice(0, 10),
  moneda: 'PEN' as const,
  medioPago: 'Transferencia Bancaria',
  formaPago: 'Al contado',
  cotizacion: '3007-0000259632',
  concepto: 'BIEN' as const,
  sinRuc: false,
  ruc: '20466776336',
  proveedorRazonSocial: 'CENTRO CERÁMICO LAS FLORES S.A.C',
  proveedorDireccion: 'AV. CARLOS IZAGUIRRE 255 URB. PANAMERICANA NORTE, INDEPENDENCIA',
  lugarEntrega: 'LIMA',
  codigoProyecto: 'PG0005',
  lineas: [
    { descripcion: 'PORCELANATO CELIMA CONCRETO CEMENTO GRIS MATE 60×60 · CAJA 1.44 M2', unidad: 'M2', cantidad: '93.60', precioUnitario: '43.29807' },
    { descripcion: 'PORCELANATO CELIMA CEMENTO MATE BLANCO 60×60 · CAJA 1.44 M2', unidad: 'M2', cantidad: '60.48', precioUnitario: '40.90145' },
    { descripcion: 'GRES PORCELANICO CELIMA CATANIA PIEDRA RECTIFICADO 60×60 · CAJA 1.44 M2', unidad: 'M2', cantidad: '56.16', precioUnitario: '39.9031' },
  ],
};

// Mock TEST 2 · OC grande Sodimac (de v1)
const TEST_OC_DATA_BIG = {
  fechaEmision: new Date().toISOString().slice(0, 10),
  moneda: 'PEN' as const,
  medioPago: 'Transferencia Bancaria',
  formaPago: 'Crédito 30 días',
  cotizacion: 'COT-2026-SODIMAC-00483',
  concepto: 'BIEN' as const,
  sinRuc: false,
  ruc: '20536557858',
  proveedorRazonSocial: 'Sodimac Perú S.A.',
  proveedorDireccion: 'Av. Angamos Este 1805, Surquillo · Lima',
  lugarEntrega: 'Av. República de Panamá 3591, San Isidro · Obra Belcorp (almacén N1)',
  codigoProyecto: 'PG0021',
  lineas: [
    { descripcion: 'CEMENTO PORTLAND TIPO I · BOLSA 42.5 KG · MARCA UNACEM', unidad: 'BLS', cantidad: '480', precioUnitario: '25.50000' },
    { descripcion: 'ACERO CORRUGADO ASTM A615 GRADO 60 · 1/2" × 9 M · ACEROS AREQUIPA', unidad: 'UND', cantidad: '240', precioUnitario: '48.90000' },
    { descripcion: 'ACERO CORRUGADO ASTM A615 GRADO 60 · 3/8" × 9 M · ACEROS AREQUIPA', unidad: 'UND', cantidad: '180', precioUnitario: '28.40000' },
    { descripcion: 'ALAMBRE NEGRO RECOCIDO N° 16 · ROLLO 40 KG', unidad: 'KG', cantidad: '120', precioUnitario: '5.80000' },
    { descripcion: 'CLAVOS PARA MADERA 2 1/2" · CAJA 25 KG', unidad: 'CJ', cantidad: '8', precioUnitario: '135.00000' },
    { descripcion: 'LADRILLO KING KONG 18 HUECOS · 9×14×24 CM · LADRILLERA REX', unidad: 'UND', cantidad: '8400', precioUnitario: '1.28000' },
    { descripcion: 'TUBO PVC-SAP CLASE 10 · 4" × 5 M · PAVCO', unidad: 'UND', cantidad: '45', precioUnitario: '58.40000' },
    { descripcion: 'TUBO PVC-SAP CLASE 10 · 2" × 5 M · PAVCO', unidad: 'UND', cantidad: '60', precioUnitario: '22.50000' },
  ],
};

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
    // Datos comerciales
    fechaEmision: new Date().toISOString().slice(0, 10),
    fechaEntrega: '',
    moneda: 'PEN' as 'PEN' | 'USD',
    medioPago: 'Transferencia Bancaria',
    formaPago: 'Al contado',
    cotizacion: '',
    concepto: 'BIEN' as 'BIEN' | 'SERVICIO',
    // Proveedor
    sinRuc: false,
    ruc: '',
    proveedorRazonSocial: '',
    proveedorDireccion: '',
    // Entrega + proyecto
    lugarEntrega: 'LIMA',
    codigoProyecto: '',
    proyectoInternoId: '',
    // IGV + detracción
    pctIgv: '18',
    incluyeIgv: true,
    aplicaDetraccion: false,
    pctDetraccion: '4',
    // Gestión + términos
    gestorEmail: '',
    gestorNombre: '',
    terminos:
      '- Términos y condiciones de acuerdo a cotización adjunta.\n- El precio está expresado en soles.',
    // Ítems
    lineas: [{ ...EMPTY_LINEA }] as Linea[],
  });
  const [error, setError] = useState<string | null>(null);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [esOficina, setEsOficina] = useState(false); // OC sin proyecto (oficina/empresa MM)
  const [cotizacionFile, setCotizacionFile] = useState<File | null>(null);
  // Animación emitir · spinner → check → preview (estilo v1)
  const [emitting, setEmitting] = useState(false);
  const [emitDone, setEmitDone] = useState(false);
  const [emitNum, setEmitNum] = useState<string | null>(null);

  // Flujo: crear (borrador) → subir cotización (obligatoria) → enviar a aprobación
  const createMut = useMutation({
    mutationFn: async () => {
      const { oc } = await api.logistica.createOc({
        proyectoId: esOficina ? undefined : form.proyectoInternoId,
        proveedorId: matchedProveedor?.id ?? undefined,
        ruc: form.sinRuc ? undefined : form.ruc,
        sinRuc: form.sinRuc,
        proveedorRazonSocial: form.proveedorRazonSocial,
        proveedorDireccion: form.proveedorDireccion,
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
        estado: 'borrador',
        lineas: form.lineas
          .filter((l) => l.descripcion.trim() && l.cantidad && l.precioUnitario)
          .map((l) => ({ descripcion: l.descripcion.trim(), unidad: l.unidad, cantidad: l.cantidad, precioUnitario: l.precioUnitario })),
      });
      // cotización obligatoria → NAS
      await api.logistica.uploadCotizacion(oc.id, cotizacionFile!);
      // enviar a aprobación (Finanzas)
      await api.logistica.enviarAprobacion(oc.id);
      return oc;
    },
    onSuccess: (oc) => {
      setEmitNum(oc.numero ?? null);
      setEmitDone(true);
      // deja ver el check ~900ms antes de abrir el preview
      setTimeout(() => onSuccess(oc.id), 950);
    },
    onError: (e: Error) => { setEmitting(false); setEmitDone(false); setError(e.message); },
  });

  const proveedores = proveedoresQ.data?.proveedores ?? [];
  const proyectos = proyectosQ.data?.proyectos ?? [];

  // Auto-detect proveedor existente por RUC o razón social
  const matchedProveedor = useMemo(() => {
    if (form.sinRuc) return null;
    if (form.ruc && /^\d{11}$/.test(form.ruc)) {
      return proveedores.find((p) => p.ruc === form.ruc) ?? null;
    }
    return null;
  }, [form.ruc, form.sinRuc, proveedores]);

  // Sugerencias autocomplete por razón social
  const sugerencias = useMemo(() => {
    if (form.sinRuc || !form.proveedorRazonSocial.trim()) return [];
    const ql = form.proveedorRazonSocial.toLowerCase();
    return proveedores
      .filter((p) => p.razonSocial.toLowerCase().includes(ql) || (p.ruc?.includes(ql) ?? false))
      .slice(0, 6);
  }, [form.proveedorRazonSocial, form.sinRuc, proveedores]);

  // Cuando se selecciona proveedor frecuente · auto-llenar
  const selectProveedor = (id: string) => {
    const p = proveedores.find((x) => x.id === id);
    if (!p) return;
    setForm({
      ...form,
      ruc: p.ruc ?? '',
      sinRuc: !p.ruc,
      proveedorRazonSocial: p.razonSocial,
      proveedorDireccion: p.domicilio ?? '',
    });
    setShowAutocomplete(false);
  };

  // Cuando se llena RUC y matchea proveedor existente · auto-llenar
  const onRucChange = (v: string) => {
    const clean = v.replace(/\D/g, '').slice(0, 11);
    const m = proveedores.find((p) => p.ruc === clean);
    if (m && clean.length === 11) {
      setForm({
        ...form,
        ruc: clean,
        proveedorRazonSocial: m.razonSocial,
        proveedorDireccion: m.domicilio ?? '',
      });
    } else {
      setForm({ ...form, ruc: clean });
    }
  };

  // Detectar código proyecto · auto-mapear interno
  const onCodigoProyectoChange = (codigo: string) => {
    const cod = codigo.trim().toUpperCase();
    const proy = proyectos.find((p) => p.codigo === cod);
    setForm({
      ...form,
      codigoProyecto: cod,
      proyectoInternoId: proy?.id ?? form.proyectoInternoId,
    });
  };

  const onProyectoInternoChange = (id: string) => {
    const proy = proyectos.find((p) => p.id === id);
    setForm({
      ...form,
      proyectoInternoId: id,
      codigoProyecto: proy?.codigo ?? form.codigoProyecto,
    });
  };

  // Totales cálculo en vivo
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
    const itemsValidos = form.lineas.filter(
      (l) => l.descripcion.trim() && parseFloat(l.cantidad) > 0 && parseFloat(l.precioUnitario) >= 0,
    ).length;
    return { subtotalSinIgv, igv, total, detraccion, neto, itemsValidos };
  }, [form.lineas, form.pctIgv, form.incluyeIgv, form.aplicaDetraccion, form.pctDetraccion]);

  // Validación
  const validRuc = form.sinRuc || /^\d{11}$/.test(form.ruc);
  const validProv = form.proveedorRazonSocial.trim().length > 0 && validRuc;
  const validProyecto = esOficina || !!form.proyectoInternoId;
  const validItems = totales.itemsValidos > 0;
  const validCotiz = !!cotizacionFile;
  const isValid = validProv && validProyecto && validItems && validCotiz;

  const fillTest = () => setForm({ ...form, ...TEST_OC_DATA });
  const fillTestBig = () => setForm({ ...form, ...TEST_OC_DATA_BIG });

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
    if (!validProv) return setError('Razón social y RUC (o checkbox sin RUC) obligatorios');
    if (!validProyecto) return setError('Selecciona proyecto o marca "Oficina/empresa"');
    if (!validItems) return setError('Al menos 1 ítem con descripción + cantidad + precio');
    if (!validCotiz) return setError('Cotización obligatoria · adjunta el archivo (PDF/imagen)');
    setEmitting(true);
    setEmitDone(false);
    createMut.mutate();
  };

  const esServicio = form.concepto === 'SERVICIO';
  const docLabel = esServicio ? 'Orden de Servicio' : 'Orden de Compra';
  const docPrefix = esServicio ? 'OS' : 'OC';
  const correlativoPreview = '00XX'; // placeholder · backend asigna real
  const anioPreview = new Date().getFullYear();
  const ocNumPreview = `${docPrefix}-${anioPreview}-${correlativoPreview}`;

  if (emitting) {
    return (
      <EmittingOverlay
        done={emitDone}
        titulo={emitDone ? `${docLabel} emitida` : `Procesando ${docLabel}…`}
        refLabel={`N° ${emitNum ?? ocNumPreview}`}
        subtitulo={emitDone ? 'Abriendo vista previa del documento...' : 'Subiendo cotización y enviando a aprobación'}
      />
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-6 animate-backdropIn" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-xl border border-line bg-bg-elev shadow-2xl flex flex-col animate-modalPop">
        {/* Header · estilo screenshot */}
        <div className="shrink-0 flex items-start justify-between border-b border-line px-6 py-4">
          <div>
            <h2 className="text-[17px] font-bold tracking-[-0.01em]">Nueva {docLabel}</h2>
            <p className="text-[11.5px] text-ink-3 mt-0.5 font-mono">
              N° {ocNumPreview} · {new Date().toLocaleDateString('es-PE')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fillTest}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border-2 border-dashed border-amber-500 bg-amber-50 dark:bg-amber-950/30 text-[10.5px] font-bold text-amber-700 dark:text-amber-400 hover:bg-amber-100"
              title="Llenar con datos de prueba · OC pequeña"
            >
              <Zap className="h-3 w-3" />
              TEST
            </button>
            <button
              type="button"
              onClick={fillTestBig}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border-2 border-dashed border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-[10.5px] font-bold text-violet-700 dark:text-violet-400 hover:bg-violet-100"
              title="Llenar con OC grande · 8+ items"
            >
              <Zap className="h-3 w-3" />
              TEST 2
            </button>
            <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded text-ink-3 hover:bg-bg-sunken">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body scroll */}
        <div className="flex-1 overflow-y-auto bg-bg-sunken/40 pb-5">
          {/* ─── Tipo de orden · OC (bien) / OS (servicio) ─── */}
          <div className="px-5 pt-4">
            <div className="grid grid-cols-2 gap-2 p-1 rounded-lg border border-line bg-bg-sunken">
              {([
                { v: 'BIEN', t: 'Orden de Compra', s: 'Bienes · materiales · equipos', pfx: 'OC' },
                { v: 'SERVICIO', t: 'Orden de Servicio', s: 'Servicios · mano de obra · alquiler', pfx: 'OS' },
              ] as const).map((opt) => {
                const active = form.concepto === opt.v;
                return (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setForm({ ...form, concepto: opt.v })}
                    className={cn(
                      'flex flex-col items-start rounded-md px-3.5 py-2.5 text-left transition-colors border',
                      active ? 'bg-bg-elev border-primary shadow-sm' : 'border-transparent hover:bg-bg-elev/60',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className={cn('font-mono text-[10px] font-bold px-1.5 py-0.5 rounded', active ? 'bg-primary text-primary-foreground' : 'bg-bg-elev text-ink-3 border border-line')}>{opt.pfx}</span>
                      <span className={cn('text-[13px] font-semibold', active ? 'text-foreground' : 'text-ink-3')}>{opt.t}</span>
                    </span>
                    <span className="text-[10.5px] text-ink-4 mt-1">{opt.s}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ─── Sección 1 · DATOS COMERCIALES ─── */}
          <SectionHeader>Datos comerciales</SectionHeader>
          <SectionBody>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Fecha emisión">
                <input type="date" value={form.fechaEmision} onChange={(e) => setForm({ ...form, fechaEmision: e.target.value })} className="oc-input" />
              </Field>
              <Field label="Fecha entrega" right="opcional">
                <input type="date" value={form.fechaEntrega} onChange={(e) => setForm({ ...form, fechaEntrega: e.target.value })} className="oc-input" />
              </Field>
              <Field label="Moneda">
                <select value={form.moneda} onChange={(e) => setForm({ ...form, moneda: e.target.value as 'PEN' | 'USD' })} className="oc-input">
                  <option value="PEN">Soles (S/)</option>
                  <option value="USD">Dólares ($)</option>
                </select>
              </Field>
              <Field label="Medio de pago">
                <select value={form.medioPago} onChange={(e) => setForm({ ...form, medioPago: e.target.value })} className="oc-input">
                  {MEDIOS_PAGO.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Forma de pago">
                <select value={form.formaPago} onChange={(e) => setForm({ ...form, formaPago: e.target.value })} className="oc-input">
                  {FORMAS_PAGO.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Cotización (ref.)" right="opcional">
                <input value={form.cotizacion} onChange={(e) => setForm({ ...form, cotizacion: e.target.value })} placeholder="COT-2026-XXXX" className="oc-input" />
              </Field>
            </div>
          </SectionBody>

          {/* ─── Sección 2 · PROVEEDOR ─── */}
          <SectionHeader>
            Proveedor
            <label className="ml-auto flex items-center gap-1.5 text-[10.5px] font-normal text-ink-3 cursor-pointer normal-case tracking-normal">
              <input
                type="checkbox"
                checked={form.sinRuc}
                onChange={(e) => setForm({ ...form, sinRuc: e.target.checked, ruc: e.target.checked ? '' : form.ruc })}
                className="rounded border-line"
              />
              OC sin RUC (proveedor informal)
            </label>
          </SectionHeader>
          <SectionBody>
            <div className="grid grid-cols-[1fr_180px] gap-4">
              <Field
                label="Razón social *"
                right={!form.sinRuc ? 'Puedes elegir frecuente o escribir nuevo' : 'Texto libre (sin RUC)'}
              >
                <div className="relative">
                  <input
                    value={form.proveedorRazonSocial}
                    onChange={(e) => {
                      setForm({ ...form, proveedorRazonSocial: e.target.value });
                      setShowAutocomplete(true);
                    }}
                    onFocus={() => setShowAutocomplete(true)}
                    onBlur={() => setTimeout(() => setShowAutocomplete(false), 150)}
                    placeholder="Buscar o escribir nombre..."
                    className="oc-input"
                  />
                  {!form.sinRuc && showAutocomplete && sugerencias.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 top-full mt-1 max-h-48 overflow-y-auto rounded-md border border-line bg-bg-elev shadow-lg">
                      {sugerencias.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => selectProveedor(p.id)}
                          className="w-full text-left px-3 py-2 text-[11.5px] hover:bg-bg-sunken border-b border-line/40 last:border-b-0"
                        >
                          <div className="font-medium">{p.razonSocial}</div>
                          <div className="font-mono text-[10px] text-ink-3 mt-0.5">{p.ruc ? `RUC ${p.ruc}` : 'Sin RUC · informal'}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </Field>
              <Field label="RUC" right={form.sinRuc ? 'no aplica' : '11 dígitos'}>
                <input
                  value={form.ruc}
                  onChange={(e) => onRucChange(e.target.value)}
                  placeholder={form.sinRuc ? '— sin RUC —' : '20XXXXXXXXX'}
                  disabled={form.sinRuc}
                  className={cn('oc-input font-mono', !form.sinRuc && form.ruc && !/^\d{11}$/.test(form.ruc) && 'border-amber-500')}
                />
              </Field>
            </div>
            <Field label="Dirección">
              <input value={form.proveedorDireccion} onChange={(e) => setForm({ ...form, proveedorDireccion: e.target.value })} placeholder="Av. / Jr. / Calle ..." className="oc-input" />
            </Field>
            {matchedProveedor && (
              <div className="flex items-center gap-1.5 text-[10.5px] text-emerald-600 dark:text-emerald-400 mt-1">
                <Check className="h-3 w-3" />
                Proveedor existente · usaremos sus datos guardados
              </div>
            )}
            {!form.sinRuc && form.ruc.length === 11 && !matchedProveedor && (
              <div className="flex items-center gap-1.5 text-[10.5px] text-amber-700 dark:text-amber-400 mt-1">
                <Sparkles className="h-3 w-3" />
                Nuevo · se creará proveedor al emitir la OC
              </div>
            )}
            {form.sinRuc && (
              <div className="flex items-center gap-1.5 text-[10.5px] text-blue-600 dark:text-blue-400 mt-1">
                <AlertTriangle className="h-3 w-3" />
                OC sin RUC · sólo registro interno · no se podrá facturar electrónicamente
              </div>
            )}
          </SectionBody>

          {/* ─── Sección 3 · ENTREGA Y PROYECTO ─── */}
          <SectionHeader>
            Entrega y proyecto
            <label className="ml-auto flex items-center gap-1.5 text-[10.5px] font-normal text-ink-3 cursor-pointer normal-case tracking-normal">
              <input
                type="checkbox"
                checked={esOficina}
                onChange={(e) => setEsOficina(e.target.checked)}
                className="rounded border-line"
              />
              OC de oficina/empresa (sin proyecto)
            </label>
          </SectionHeader>
          <SectionBody>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Lugar de entrega">
                <input value={form.lugarEntrega} onChange={(e) => setForm({ ...form, lugarEntrega: e.target.value })} className="oc-input" />
              </Field>
              <Field label="Código proyecto" right="ej. PG0005">
                <input
                  value={form.codigoProyecto}
                  onChange={(e) => onCodigoProyectoChange(e.target.value)}
                  placeholder="PG0005"
                  disabled={esOficina}
                  className="oc-input font-mono"
                />
              </Field>
              <Field label={esOficina ? 'Proyecto' : 'Proyecto interno *'} right={esOficina ? 'oficina/empresa' : 'mapeo ERP'}>
                <select value={form.proyectoInternoId} onChange={(e) => onProyectoInternoChange(e.target.value)} disabled={esOficina} className="oc-input">
                  <option value="">{esOficina ? '— Oficina / empresa (MM) —' : '— elegir proyecto —'}</option>
                  {proyectos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.codigo} — {p.nombre.slice(0, 38)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {/* Cotización obligatoria · archivo → NAS */}
            <Field label="Cotización (archivo) *" right="PDF o imagen · obligatoria · va al NAS">
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  onChange={(e) => setCotizacionFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-[11.5px] text-ink-3 file:mr-3 file:h-8 file:rounded-md file:border-0 file:bg-primary file:px-3 file:text-[11.5px] file:font-medium file:text-primary-foreground hover:file:opacity-90"
                />
                {cotizacionFile && <Check className="h-4 w-4 text-emerald-600 shrink-0" />}
              </div>
            </Field>
          </SectionBody>

          {/* ─── Sección 4 · ÍTEMS ─── */}
          <SectionHeader>
            Ítems de la orden
            <button
              type="button"
              onClick={addLinea}
              className="ml-auto inline-flex items-center gap-1 h-6 px-2 rounded border border-line bg-bg-elev text-[10.5px] font-medium text-ink-2 hover:bg-bg-sunken normal-case tracking-normal"
            >
              <Plus className="h-3 w-3" />
              Agregar ítem
            </button>
          </SectionHeader>
          <SectionBody>
            <div className="space-y-2">
              {form.lineas.map((l, i) => {
                const tot = (parseFloat(l.cantidad) || 0) * (parseFloat(l.precioUnitario) || 0);
                return (
                  <div key={i} className="rounded-md border border-line bg-bg-elev p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-mono text-[10.5px] text-ink-3 font-semibold w-10 text-center">
                        {(i + 1).toFixed(2).padStart(4, '0')}
                      </span>
                      <input
                        value={l.descripcion}
                        onChange={(e) => setLinea(i, 'descripcion', e.target.value)}
                        placeholder={esServicio ? 'Descripción del servicio...' : 'Descripción del ítem (producto)...'}
                        className="oc-input flex-1"
                      />
                    </div>
                    <div className="grid grid-cols-[100px_1fr_1fr_1fr_28px] gap-2 items-center pl-12">
                      <Mini label="Unidad">
                        <select value={l.unidad} onChange={(e) => setLinea(i, 'unidad', e.target.value)} className="oc-input-sm font-mono">
                          {UNIDADES_SUNAT.map((u) => (
                            <option key={u.c} value={u.c}>
                              {u.c} · {u.l}
                            </option>
                          ))}
                        </select>
                      </Mini>
                      <Mini label="Cantidad">
                        <input
                          type="number"
                          step="0.0001"
                          value={l.cantidad}
                          onChange={(e) => setLinea(i, 'cantidad', e.target.value)}
                          placeholder="0.00"
                          className="oc-input-sm font-mono text-right"
                        />
                      </Mini>
                      <Mini label={`Precio unit. ${form.moneda === 'PEN' ? 'S/' : '$'}`}>
                        <input
                          type="number"
                          step="0.00001"
                          value={l.precioUnitario}
                          onChange={(e) => setLinea(i, 'precioUnitario', e.target.value)}
                          placeholder="0.00"
                          className="oc-input-sm font-mono text-right"
                        />
                      </Mini>
                      <Mini label="Total línea">
                        <div className="h-7 px-2 flex items-center justify-end rounded border border-line bg-bg-sunken text-[11.5px] font-mono font-semibold tabular-nums">
                          {form.moneda === 'PEN' ? 'S/' : '$'}&nbsp;{tot.toFixed(2)}
                        </div>
                      </Mini>
                      <button
                        type="button"
                        onClick={() => delLinea(i)}
                        disabled={form.lineas.length === 1}
                        className="h-7 w-7 rounded inline-flex items-center justify-center text-ink-3 hover:text-destructive hover:bg-destructive-soft disabled:opacity-30 mt-4"
                        title="Eliminar línea"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionBody>

          {/* ─── Sección 5 · IGV + DETRACCIÓN ─── */}
          <SectionHeader>IGV y detracción</SectionHeader>
          <SectionBody>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Field label="% IGV">
                  <input type="number" step="0.01" value={form.pctIgv} onChange={(e) => setForm({ ...form, pctIgv: e.target.value })} className="oc-input" />
                </Field>
                <label className="flex items-center gap-2 cursor-pointer text-[11.5px]">
                  <input type="checkbox" checked={form.incluyeIgv} onChange={(e) => setForm({ ...form, incluyeIgv: e.target.checked })} className="rounded border-line" />
                  <span>Los precios unitarios ya incluyen IGV</span>
                </label>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-[11.5px] font-medium">
                  <input type="checkbox" checked={form.aplicaDetraccion} onChange={(e) => setForm({ ...form, aplicaDetraccion: e.target.checked })} className="rounded border-line" />
                  <span>Aplica detracción SUNAT</span>
                </label>
                {form.aplicaDetraccion && (
                  <Field label="Tasa detracción">
                    <select value={form.pctDetraccion} onChange={(e) => setForm({ ...form, pctDetraccion: e.target.value })} className="oc-input">
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
          </SectionBody>

          {/* ─── Sección 6 · GESTIÓN Y TÉRMINOS ─── */}
          <SectionHeader>Gestión y términos</SectionHeader>
          <SectionBody>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Gestor email">
                <input value={form.gestorEmail} onChange={(e) => setForm({ ...form, gestorEmail: e.target.value })} placeholder="ejemplo@mmhighmetrik.com" className="oc-input" />
              </Field>
              <Field label="Gestor nombre">
                <input value={form.gestorNombre} onChange={(e) => setForm({ ...form, gestorNombre: e.target.value })} placeholder="Mario A. García Calderón" className="oc-input" />
              </Field>
            </div>
            <Field label="Términos y condiciones">
              <textarea value={form.terminos} onChange={(e) => setForm({ ...form, terminos: e.target.value })} rows={3} className="oc-input resize-y" />
            </Field>
          </SectionBody>
        </div>

        {/* Footer · sticky */}
        <div className="shrink-0 border-t border-line bg-bg-elev px-5 py-3">
          {error && (
            <div className="mb-2 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-[11.5px] text-destructive">
              {error}
            </div>
          )}
          <div className="flex items-center gap-4">
            <div className="flex gap-4 text-[11px]">
              <div>
                <div className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4">Ítems</div>
                <div className="text-[14px] font-bold tabular-nums">{totales.itemsValidos}</div>
              </div>
              <div>
                <div className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4">Total (inc. IGV)</div>
                <div className="text-[14px] font-bold tabular-nums text-primary">{fmtPEN(totales.total)}</div>
              </div>
              {form.aplicaDetraccion && (
                <div>
                  <div className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4">Neto a pagar</div>
                  <div className="text-[14px] font-bold tabular-nums text-emerald-600">{fmtPEN(totales.neto)}</div>
                </div>
              )}
            </div>
            {!isValid && (
              <div className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400 flex-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>
                  Completa {!validProv && 'proveedor + RUC'}{!validProv && (!validProyecto || !validItems || !validCotiz) && ', '}
                  {!validProyecto && 'proyecto'}{!validProyecto && (!validItems || !validCotiz) && ', '}
                  {!validItems && 'al menos 1 ítem'}{!validItems && !validCotiz && ', '}
                  {!validCotiz && 'cotización (archivo)'}
                </span>
              </div>
            )}
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={onClose} className="h-9 px-4 rounded-md border border-line text-[12px] text-ink-2 hover:bg-bg-sunken">
                Cancelar
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={!isValid || createMut.isPending}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Crear {docPrefix} y enviar a aprobación
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Estilos locales para inputs */}
      <style>{`
        .oc-input {
          height: 36px;
          width: 100%;
          padding: 0 10px;
          border-radius: 6px;
          border: 1px solid hsl(var(--line));
          background: hsl(var(--bg-elev));
          font-size: 12.5px;
          outline: none;
          transition: border-color 0.15s;
        }
        .oc-input:focus {
          border-color: hsl(var(--primary));
          box-shadow: 0 0 0 2px hsl(var(--primary) / 0.15);
        }
        .oc-input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .oc-input-sm {
          height: 28px;
          width: 100%;
          padding: 0 8px;
          border-radius: 4px;
          border: 1px solid hsl(var(--line));
          background: hsl(var(--bg-elev));
          font-size: 11.5px;
          outline: none;
        }
        .oc-input-sm:focus {
          border-color: hsl(var(--primary));
        }
        textarea.oc-input {
          height: auto;
          padding: 8px 10px;
          line-height: 1.5;
        }
      `}</style>
    </div>,
    document.body,
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-5 mt-4 flex items-center gap-2 rounded-t-lg border border-b-0 border-line bg-bg-elev px-4 pt-3 pb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 font-bold">
      {children}
    </div>
  );
}

function SectionBody({ children }: { children: React.ReactNode }) {
  return <div className="mx-5 rounded-b-lg border border-t-0 border-line bg-bg-elev px-4 pb-4 pt-2 space-y-3">{children}</div>;
}

function Field({ label, right, children }: { label: string; right?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3 font-semibold">{label}</label>
        {right && <span className="text-[10px] text-ink-4 italic">{right}</span>}
      </div>
      {children}
    </div>
  );
}

function Mini({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[8.5px] uppercase tracking-wider text-ink-4 mb-0.5">{label}</div>
      {children}
    </div>
  );
}
