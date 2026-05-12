import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, Loader2, Plus, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type Requerimiento, api } from '@/lib/api.js';
import { cn, fmtPEN } from '@/lib/utils.js';

type ReqForm = {
  proyectoId: string;
  fecha: string;
  fechaNecesaria: string;
  urgencia: 'baja' | 'media' | 'alta' | 'urgente';
  descripcion: string;
  justificacion: string;
  solicitanteNombre: string;
  montoEstimado: string;
  lineas: Array<{ descripcion: string; unidad: string; cantidad: string; precioReferencial: string }>;
};

const EMPTY_LINEA = { descripcion: '', unidad: 'UND', cantidad: '', precioReferencial: '' };

const URGENCIAS = ['baja', 'media', 'alta', 'urgente'] as const;
const URGENCIA_COLORS: Record<string, string> = {
  baja: 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-300',
  media: 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-300',
  alta: 'bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 border-orange-300',
  urgente: 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-300',
};

const ESTADOS_FILTROS = [
  { k: '', l: 'Todos' },
  { k: 'pendiente_aprobacion', l: 'Pendientes' },
  { k: 'aprobado', l: 'Aprobados' },
  { k: 'cotizando', l: 'Cotizando' },
  { k: 'oc_emitida', l: 'OC emitida' },
  { k: 'rechazado', l: 'Rechazados' },
];

const ESTADO_CHIP: Record<string, string> = {
  borrador: 'gray',
  pendiente_aprobacion: 'amber',
  aprobado: 'green',
  cotizando: 'blue',
  oc_emitida: 'green',
  rechazado: 'red',
};

export function LogisticaRequerimientosPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['logistica-requerimientos'],
    queryFn: () => api.logistica.listRequerimientos(),
  });
  const proyectosQ = useQuery({
    queryKey: ['proyectos-list'],
    queryFn: () => api.proyectos.list(),
  });

  const [showForm, setShowForm] = useState(false);
  const [filterEstado, setFilterEstado] = useState('');
  const [form, setForm] = useState<ReqForm>({
    proyectoId: '',
    fecha: new Date().toISOString().slice(0, 10),
    fechaNecesaria: '',
    urgencia: 'media',
    descripcion: '',
    justificacion: '',
    solicitanteNombre: '',
    montoEstimado: '',
    lineas: [{ ...EMPTY_LINEA }],
  });
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: (payload: Parameters<typeof api.logistica.createRequerimiento>[0]) =>
      api.logistica.createRequerimiento(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logistica-requerimientos'] });
      closeForm();
    },
    onError: (e: Error) => setError(e.message),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Requerimiento> & { rechazadoMotivo?: string } }) =>
      api.logistica.updateRequerimiento(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['logistica-requerimientos'] }),
  });

  const closeForm = () => {
    setShowForm(false);
    setForm({
      proyectoId: '',
      fecha: new Date().toISOString().slice(0, 10),
      fechaNecesaria: '',
      urgencia: 'media',
      descripcion: '',
      justificacion: '',
      solicitanteNombre: '',
      montoEstimado: '',
      lineas: [{ ...EMPTY_LINEA }],
    });
    setError(null);
  };

  const onSave = () => {
    setError(null);
    if (!form.proyectoId || !form.descripcion.trim()) {
      setError('Proyecto y descripción obligatorios');
      return;
    }
    createMut.mutate({
      proyectoId: form.proyectoId,
      fecha: form.fecha,
      fechaNecesaria: form.fechaNecesaria || undefined,
      urgencia: form.urgencia,
      descripcion: form.descripcion.trim(),
      justificacion: form.justificacion.trim() || undefined,
      solicitanteNombre: form.solicitanteNombre.trim() || undefined,
      montoEstimado: form.montoEstimado || undefined,
      lineas: form.lineas
        .filter((l) => l.descripcion.trim())
        .map((l) => ({
          descripcion: l.descripcion.trim(),
          unidad: l.unidad,
          cantidad: l.cantidad,
          precioReferencial: l.precioReferencial || undefined,
        })),
    });
  };

  const addLinea = () => setForm({ ...form, lineas: [...form.lineas, { ...EMPTY_LINEA }] });
  const delLinea = (idx: number) =>
    setForm({ ...form, lineas: form.lineas.filter((_, i) => i !== idx).length ? form.lineas.filter((_, i) => i !== idx) : [{ ...EMPTY_LINEA }] });
  const setLinea = (idx: number, k: keyof typeof EMPTY_LINEA, v: string) =>
    setForm({
      ...form,
      lineas: form.lineas.map((l, i) => (i === idx ? { ...l, [k]: v } : l)),
    });

  const onAprobar = (req: Requerimiento) => {
    if (confirm(`Aprobar ${req.numero}?`)) {
      updateMut.mutate({ id: req.id, data: { estado: 'aprobado' } });
    }
  };
  const onRechazar = (req: Requerimiento) => {
    const motivo = prompt(`Motivo rechazo de ${req.numero}?`);
    if (motivo !== null) {
      updateMut.mutate({ id: req.id, data: { estado: 'rechazado', rechazadoMotivo: motivo } });
    }
  };
  const onCotizando = (req: Requerimiento) => {
    updateMut.mutate({ id: req.id, data: { estado: 'cotizando' } });
  };

  const requerimientos = data?.requerimientos ?? [];
  const proyectos = proyectosQ.data?.proyectos ?? [];
  const proyMap = new Map(proyectos.map((p) => [p.id, p]));

  const filtered = useMemo(() => {
    return requerimientos.filter((r) => !filterEstado || r.estado === filterEstado);
  }, [requerimientos, filterEstado]);

  const stats = useMemo(() => {
    const pendientes = requerimientos.filter((r) => r.estado === 'pendiente_aprobacion').length;
    const urgentes = requerimientos.filter((r) => r.urgencia === 'urgente' && r.estado !== 'rechazado' && r.estado !== 'oc_emitida').length;
    const aprobados = requerimientos.filter((r) => r.estado === 'aprobado' || r.estado === 'cotizando').length;
    return { total: requerimientos.length, pendientes, urgentes, aprobados };
  }, [requerimientos]);

  if (isLoading) return <div className="text-[12px] text-ink-3">Cargando requerimientos...</div>;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Stat lbl="Total" val={String(stats.total)} accent />
        <Stat lbl="Pendientes aprobar" val={String(stats.pendientes)} accent={stats.pendientes > 0 ? 'amber' : undefined} />
        <Stat lbl="Aprobados activos" val={String(stats.aprobados)} accent="green" />
        <Stat lbl="Urgentes" val={String(stats.urgentes)} accent={stats.urgentes > 0 ? 'red' : undefined} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-md border border-line overflow-hidden">
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
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" />
          Nuevo requerimiento
        </button>
      </div>

      {/* Tabla */}
      {filtered.length === 0 ? (
        <div className="rounded-md border border-line bg-bg-elev p-12 text-center">
          <FileText className="mx-auto mb-3 h-8 w-8 text-ink-4" />
          <h3 className="text-[14px] font-semibold mb-1">Sin requerimientos</h3>
          <p className="text-[11.5px] text-ink-3">
            {requerimientos.length === 0 ? 'Crea el primer RQ' : 'Ningún match con filtros'}
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-line bg-bg-elev overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-bg-sunken border-b border-line">
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3">
                <th className="px-3 py-2 w-32">N° REQ</th>
                <th className="px-3 py-2 w-28">Proyecto</th>
                <th className="px-3 py-2">Descripción</th>
                <th className="px-3 py-2 w-32">Solicitante</th>
                <th className="px-3 py-2 w-24">Fecha</th>
                <th className="px-3 py-2 w-20">Urgencia</th>
                <th className="px-3 py-2 w-24 text-right">Monto est.</th>
                <th className="px-3 py-2 w-32">Estado</th>
                <th className="px-3 py-2 w-32">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((r) => {
                const proy = proyMap.get(r.proyectoId);
                return (
                  <tr key={r.id} className="hover:bg-bg-sunken/30">
                    <td className="px-3 py-2 font-mono text-[10.5px] text-primary font-semibold">{r.numero}</td>
                    <td className="px-3 py-2 font-mono text-[10.5px] text-ink-3">{proy?.codigo ?? '—'}</td>
                    <td className="px-3 py-2 truncate max-w-[280px]" title={r.descripcion}>
                      {r.descripcion}
                    </td>
                    <td className="px-3 py-2 text-[10.5px] text-ink-2">{r.solicitanteNombre ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-[10.5px] text-ink-3">{r.fecha}</td>
                    <td className="px-3 py-2">
                      <span className={cn('text-[9.5px] font-semibold px-1.5 py-0.5 rounded border', URGENCIA_COLORS[r.urgencia])}>
                        {r.urgencia}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[10.5px] tabular-nums">
                      {r.montoEstimado ? fmtPEN(Number(r.montoEstimado)) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`chip ${ESTADO_CHIP[r.estado] ?? 'gray'}`}>{r.estado.replace(/_/g, ' ')}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        {r.estado === 'pendiente_aprobacion' && (
                          <>
                            <button
                              type="button"
                              onClick={() => onAprobar(r)}
                              className="h-6 w-6 rounded inline-flex items-center justify-center text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                              title="Aprobar"
                            >
                              <ThumbsUp className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onRechazar(r)}
                              className="h-6 w-6 rounded inline-flex items-center justify-center text-destructive hover:bg-destructive-soft"
                              title="Rechazar"
                            >
                              <ThumbsDown className="h-3 w-3" />
                            </button>
                          </>
                        )}
                        {r.estado === 'aprobado' && (
                          <button
                            type="button"
                            onClick={() => onCotizando(r)}
                            className="h-6 px-2 rounded inline-flex items-center text-[10px] text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                            title="Marcar cotizando"
                          >
                            Cotizar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Nuevo */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => e.target === e.currentTarget && closeForm()}>
          <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-md border border-line bg-bg-elev shadow-xl flex flex-col">
            <div className="flex items-start justify-between border-b border-line px-5 py-4">
              <div>
                <h2 className="text-[15px] font-semibold">Nuevo requerimiento</h2>
                <p className="text-[11px] text-ink-3 mt-0.5">Pedido desde obra · será sometido a aprobación</p>
              </div>
              <button type="button" onClick={closeForm} className="flex h-7 w-7 items-center justify-center rounded text-ink-3 hover:bg-bg-sunken">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-[12px]">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Proyecto *">
                  <select value={form.proyectoId} onChange={(e) => setForm({ ...form, proyectoId: e.target.value })} className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary">
                    <option value="">— elegir —</option>
                    {proyectos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.codigo} · {p.nombre.slice(0, 40)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Urgencia">
                  <select value={form.urgencia} onChange={(e) => setForm({ ...form, urgencia: e.target.value as ReqForm['urgencia'] })} className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary">
                    {URGENCIAS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Fecha solicitud">
                  <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary" />
                </Field>
                <Field label="Necesaria para">
                  <input type="date" value={form.fechaNecesaria} onChange={(e) => setForm({ ...form, fechaNecesaria: e.target.value })} className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary" />
                </Field>
                <Field label="Solicitante (nombre)">
                  <input value={form.solicitanteNombre} onChange={(e) => setForm({ ...form, solicitanteNombre: e.target.value })} placeholder="Ing. Juan Pérez" className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary" />
                </Field>
                <Field label="Monto estimado (S/)">
                  <input
                    type="number"
                    step="0.01"
                    value={form.montoEstimado}
                    onChange={(e) => setForm({ ...form, montoEstimado: e.target.value })}
                    placeholder="5000.00"
                    className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary"
                  />
                </Field>
              </div>
              <Field label="Descripción *">
                <input
                  value={form.descripcion}
                  onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  placeholder='Tuberías PVC SAP 4" · 180 m'
                  className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary"
                />
              </Field>
              <Field label="Justificación">
                <textarea
                  value={form.justificacion}
                  onChange={(e) => setForm({ ...form, justificacion: e.target.value })}
                  rows={2}
                  placeholder="Para instalaciones sanitarias 2do piso"
                  className="w-full px-2 py-1.5 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary"
                />
              </Field>

              {/* Líneas detalle */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4 font-semibold">Líneas detalle</div>
                  <button type="button" onClick={addLinea} className="inline-flex items-center gap-1 text-[10.5px] text-primary hover:underline">
                    <Plus className="h-3 w-3" />
                    Agregar línea
                  </button>
                </div>
                <div className="space-y-1.5">
                  {form.lineas.map((l, i) => (
                    <div key={i} className="grid grid-cols-[1fr_70px_80px_90px_28px] gap-1.5 items-center">
                      <input value={l.descripcion} onChange={(e) => setLinea(i, 'descripcion', e.target.value)} placeholder="Descripción" className="h-8 px-2 rounded border border-line bg-bg-sunken text-[11.5px] outline-none focus:border-primary" />
                      <input value={l.unidad} onChange={(e) => setLinea(i, 'unidad', e.target.value.toUpperCase())} placeholder="UND" className="h-8 px-2 rounded border border-line bg-bg-sunken text-[11.5px] font-mono outline-none focus:border-primary" />
                      <input type="number" step="0.0001" value={l.cantidad} onChange={(e) => setLinea(i, 'cantidad', e.target.value)} placeholder="Cant." className="h-8 px-2 rounded border border-line bg-bg-sunken text-[11.5px] font-mono outline-none focus:border-primary" />
                      <input type="number" step="0.01" value={l.precioReferencial} onChange={(e) => setLinea(i, 'precioReferencial', e.target.value)} placeholder="PU ref" className="h-8 px-2 rounded border border-line bg-bg-sunken text-[11.5px] font-mono outline-none focus:border-primary" />
                      <button type="button" onClick={() => delLinea(i)} className="h-8 w-7 rounded inline-flex items-center justify-center text-ink-3 hover:text-destructive hover:bg-destructive-soft">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {error && <div className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-[12px] text-destructive">{error}</div>}
            </div>

            <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
              <button type="button" onClick={closeForm} className="h-9 px-4 rounded-md border border-line text-[12px] text-ink-2 hover:bg-bg-sunken">
                Cancelar
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={createMut.isPending}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90 disabled:opacity-50"
              >
                {createMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Crear · enviar a aprobación
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ lbl, val, sub, accent }: { lbl: string; val: string; sub?: string; accent?: boolean | 'amber' | 'red' | 'green' }) {
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10.5px] text-ink-3 mb-0.5">{label}</label>
      {children}
    </div>
  );
}
