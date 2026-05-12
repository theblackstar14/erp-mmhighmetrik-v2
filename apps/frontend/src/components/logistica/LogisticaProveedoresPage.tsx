import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Pencil, Plus, Search, Star, Trash2, Truck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type Proveedor, api } from '@/lib/api.js';
import { cn, fmtPEN } from '@/lib/utils.js';

type ProveedorForm = {
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  categoria: string;
  domicilio: string;
  distrito: string;
  departamento: string;
  email: string;
  telefono: string;
  contacto: string;
  contactoCargo: string;
  cuentaBancaria: string;
  cuentaCci: string;
  cuentaDetraccionesBn: string;
  leadTimeDias: string;
  rating: string;
  notas: string;
};

const EMPTY_FORM: ProveedorForm = {
  ruc: '',
  razonSocial: '',
  nombreComercial: '',
  categoria: '',
  domicilio: '',
  distrito: 'Lima',
  departamento: 'Lima',
  email: '',
  telefono: '',
  contacto: '',
  contactoCargo: '',
  cuentaBancaria: '',
  cuentaCci: '',
  cuentaDetraccionesBn: '',
  leadTimeDias: '',
  rating: '',
  notas: '',
};

const CATEGORIAS = [
  'Cemento y áridos',
  'Acero y perfiles',
  'Maquinaria y equipos',
  'Ferretería y EPP',
  'Iluminación · eléctricos',
  'Cables y conductores',
  'Cerámicos y acabados',
  'Madera y carpintería',
  'Tuberías y sanitarios',
  'Pintura y pegamentos',
  'Servicios subcontratos',
  'Otro',
];

export function LogisticaProveedoresPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['logistica-proveedores'],
    queryFn: () => api.logistica.listProveedores(),
  });

  const [search, setSearch] = useState('');
  const [categoria, setCategoria] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Proveedor | null>(null);
  const [form, setForm] = useState<ProveedorForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: (data: Partial<Proveedor>) => api.logistica.createProveedor(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logistica-proveedores'] });
      closeForm();
    },
    onError: (e: Error) => setError(e.message),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Proveedor> }) =>
      api.logistica.updateProveedor(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logistica-proveedores'] });
      closeForm();
    },
    onError: (e: Error) => setError(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.logistica.deleteProveedor(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['logistica-proveedores'] }),
  });

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (p: Proveedor) => {
    setEditing(p);
    setForm({
      ruc: p.ruc,
      razonSocial: p.razonSocial,
      nombreComercial: p.nombreComercial ?? '',
      categoria: p.categoria ?? '',
      domicilio: p.domicilio ?? '',
      distrito: p.distrito ?? '',
      departamento: p.departamento ?? '',
      email: p.email ?? '',
      telefono: p.telefono ?? '',
      contacto: p.contacto ?? '',
      contactoCargo: p.contactoCargo ?? '',
      cuentaBancaria: p.cuentaBancaria ?? '',
      cuentaCci: p.cuentaCci ?? '',
      cuentaDetraccionesBn: p.cuentaDetraccionesBn ?? '',
      leadTimeDias: p.leadTimeDias?.toString() ?? '',
      rating: p.rating ?? '',
      notas: p.notas ?? '',
    });
    setShowForm(true);
  };

  const onSave = () => {
    setError(null);
    if (!form.ruc.trim() || !form.razonSocial.trim()) {
      setError('RUC y razón social obligatorios');
      return;
    }
    if (!/^\d{11}$/.test(form.ruc.trim())) {
      setError('RUC debe ser 11 dígitos numéricos');
      return;
    }
    const payload: Partial<Proveedor> = {
      ruc: form.ruc.trim(),
      razonSocial: form.razonSocial.trim().toUpperCase(),
      nombreComercial: form.nombreComercial.trim() || null,
      categoria: form.categoria || null,
      domicilio: form.domicilio.trim() || null,
      distrito: form.distrito.trim() || null,
      departamento: form.departamento.trim() || null,
      email: form.email.trim() || null,
      telefono: form.telefono.trim() || null,
      contacto: form.contacto.trim() || null,
      contactoCargo: form.contactoCargo.trim() || null,
      cuentaBancaria: form.cuentaBancaria.trim() || null,
      cuentaCci: form.cuentaCci.trim() || null,
      cuentaDetraccionesBn: form.cuentaDetraccionesBn.trim() || null,
      leadTimeDias: form.leadTimeDias ? Number(form.leadTimeDias) : null,
      rating: form.rating || null,
      notas: form.notas.trim() || null,
    };
    if (editing) updateMut.mutate({ id: editing.id, data: payload });
    else createMut.mutate(payload);
  };

  const proveedores = data?.proveedores ?? [];
  const stats = data?.stats ?? null;

  const filtered = useMemo(() => {
    const ql = search.trim().toLowerCase();
    return proveedores.filter((p) => {
      if (categoria && p.categoria !== categoria) return false;
      if (!ql) return true;
      return (
        p.razonSocial.toLowerCase().includes(ql) ||
        p.ruc.includes(ql) ||
        (p.nombreComercial?.toLowerCase().includes(ql) ?? false) ||
        (p.categoria?.toLowerCase().includes(ql) ?? false)
      );
    });
  }, [proveedores, search, categoria]);

  if (isLoading) return <div className="text-[12px] text-ink-3">Cargando proveedores...</div>;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Stat lbl="Total" val={String(stats?.total ?? 0)} accent />
        <Stat lbl="Con rating ≥ 4★" val={String(stats?.conRating ?? 0)} />
        <Stat lbl="Categorías" val={String(stats?.categorias.length ?? 0)} />
        <Stat lbl="Volumen año" val={fmtPEN(proveedores.reduce((s, p) => s + p.volumenAnual, 0))} sub="Σ OCs emitidas" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-4" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre · RUC · categoría..."
              className="h-9 w-64 rounded-md border border-line bg-bg-elev pl-7 pr-3 text-[12px] outline-none focus:border-primary"
            />
          </div>
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className="h-9 px-2 rounded-md border border-line bg-bg-elev text-[12px] outline-none focus:border-primary"
          >
            <option value="">Todas categorías</option>
            {(stats?.categorias ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" />
          Nuevo proveedor
        </button>
      </div>

      {/* Cards grid */}
      {filtered.length === 0 ? (
        <div className="rounded-md border border-line bg-bg-elev p-12 text-center">
          <Truck className="mx-auto mb-3 h-8 w-8 text-ink-4" />
          <h3 className="text-[14px] font-semibold mb-1">Sin proveedores</h3>
          <p className="text-[11.5px] text-ink-3 mb-4">
            {proveedores.length === 0 ? 'Crea tu primer proveedor para empezar' : 'Ningún match con los filtros'}
          </p>
          {proveedores.length === 0 && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />
              Crear primero
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((p) => (
            <ProveedorCard
              key={p.id}
              p={p}
              onEdit={() => openEdit(p)}
              onDelete={() => {
                if (confirm(`Eliminar ${p.razonSocial}? Si tiene OCs se marcará inactivo.`)) {
                  deleteMut.mutate(p.id);
                }
              }}
            />
          ))}
        </div>
      )}

      {/* Modal CRUD */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => e.target === e.currentTarget && closeForm()}>
          <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-md border border-line bg-bg-elev shadow-xl flex flex-col">
            <div className="flex items-start justify-between border-b border-line px-5 py-4">
              <div>
                <h2 className="text-[15px] font-semibold">
                  {editing ? 'Editar proveedor' : 'Nuevo proveedor'}
                </h2>
                <p className="text-[11px] text-ink-3 mt-0.5">
                  {editing ? `${editing.ruc} · ${editing.razonSocial}` : 'Datos comerciales y bancarios'}
                </p>
              </div>
              <button type="button" onClick={closeForm} className="flex h-7 w-7 items-center justify-center rounded text-ink-3 hover:bg-bg-sunken">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-[12px]">
              {/* Datos básicos */}
              <Section title="Datos básicos">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="RUC *" required>
                    <input
                      value={form.ruc}
                      onChange={(e) => setForm({ ...form, ruc: e.target.value.replace(/\D/g, '').slice(0, 11) })}
                      placeholder="20100030595"
                      disabled={!!editing}
                      className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] font-mono outline-none focus:border-primary disabled:opacity-50"
                    />
                  </Field>
                  <Field label="Categoría">
                    <select value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary">
                      <option value="">— sin categoría —</option>
                      {CATEGORIAS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Razón social *" required>
                  <input
                    value={form.razonSocial}
                    onChange={(e) => setForm({ ...form, razonSocial: e.target.value })}
                    placeholder="UNACEM S.A.A."
                    className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary"
                  />
                </Field>
                <Field label="Nombre comercial">
                  <input
                    value={form.nombreComercial}
                    onChange={(e) => setForm({ ...form, nombreComercial: e.target.value })}
                    placeholder="Si difiere de razón social"
                    className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary"
                  />
                </Field>
              </Section>

              {/* Dirección */}
              <Section title="Dirección">
                <Field label="Domicilio">
                  <input
                    value={form.domicilio}
                    onChange={(e) => setForm({ ...form, domicilio: e.target.value })}
                    placeholder="Av. Atocongo 2440"
                    className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Distrito">
                    <input value={form.distrito} onChange={(e) => setForm({ ...form, distrito: e.target.value })} className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary" />
                  </Field>
                  <Field label="Departamento">
                    <input value={form.departamento} onChange={(e) => setForm({ ...form, departamento: e.target.value })} className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary" />
                  </Field>
                </div>
              </Section>

              {/* Contacto */}
              <Section title="Contacto">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Email">
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="ventas@..."
                      className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary"
                    />
                  </Field>
                  <Field label="Teléfono">
                    <input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} placeholder="987654321" className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary" />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Persona contacto">
                    <input value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} placeholder="Juan Pérez" className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary" />
                  </Field>
                  <Field label="Cargo">
                    <input value={form.contactoCargo} onChange={(e) => setForm({ ...form, contactoCargo: e.target.value })} placeholder="Ejec. Ventas" className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary" />
                  </Field>
                </div>
              </Section>

              {/* Bancos */}
              <Section title="Datos bancarios">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Cuenta bancaria">
                    <input value={form.cuentaBancaria} onChange={(e) => setForm({ ...form, cuentaBancaria: e.target.value })} className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] font-mono outline-none focus:border-primary" />
                  </Field>
                  <Field label="CCI interbancaria">
                    <input value={form.cuentaCci} onChange={(e) => setForm({ ...form, cuentaCci: e.target.value })} className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] font-mono outline-none focus:border-primary" />
                  </Field>
                </div>
                <Field label="Cuenta detracciones BN">
                  <input value={form.cuentaDetraccionesBn} onChange={(e) => setForm({ ...form, cuentaDetraccionesBn: e.target.value })} placeholder="0000-XXXXXXXXXX" className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] font-mono outline-none focus:border-primary" />
                </Field>
              </Section>

              {/* Otros */}
              <Section title="Calificación">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Rating (0-5)">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="5"
                      value={form.rating}
                      onChange={(e) => setForm({ ...form, rating: e.target.value })}
                      placeholder="4.5"
                      className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary"
                    />
                  </Field>
                  <Field label="Lead time (días)">
                    <input
                      type="number"
                      min="0"
                      value={form.leadTimeDias}
                      onChange={(e) => setForm({ ...form, leadTimeDias: e.target.value })}
                      placeholder="3"
                      className="h-8 w-full px-2 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary"
                    />
                  </Field>
                </div>
                <Field label="Notas">
                  <textarea
                    value={form.notas}
                    onChange={(e) => setForm({ ...form, notas: e.target.value })}
                    rows={2}
                    className="w-full px-2 py-1.5 rounded border border-line bg-bg-sunken text-[12px] outline-none focus:border-primary"
                  />
                </Field>
              </Section>

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-[12px] text-destructive">
                  {error}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
              <button type="button" onClick={closeForm} className="h-9 px-4 rounded-md border border-line text-[12px] text-ink-2 hover:bg-bg-sunken">
                Cancelar
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={createMut.isPending || updateMut.isPending}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90 disabled:opacity-50"
              >
                {(createMut.isPending || updateMut.isPending) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {editing ? 'Guardar cambios' : 'Crear proveedor'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProveedorCard({
  p,
  onEdit,
  onDelete,
}: {
  p: Proveedor & { ocCount: number; volumenAnual: number };
  onEdit: () => void;
  onDelete: () => void;
}) {
  const rating = Number(p.rating ?? 0);
  return (
    <div className="rounded-md border border-line bg-bg-elev p-4 hover:border-primary/40 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold leading-tight truncate" title={p.razonSocial}>
            {p.razonSocial}
          </h3>
          <p className="font-mono text-[10px] text-ink-3 mt-0.5">RUC {p.ruc}</p>
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={onEdit} className="text-ink-3 hover:text-primary" title="Editar">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onDelete} className="text-ink-3 hover:text-destructive" title="Eliminar">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {p.categoria && <span className="chip blue text-[9.5px] mb-2 inline-block">{p.categoria}</span>}
      <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-line">
        <MiniStat
          l="Rating"
          v={rating > 0 ? (
            <span className="flex items-center gap-0.5 text-amber-600">
              <Star className="h-3 w-3 fill-current" />
              {rating.toFixed(1)}
            </span>
          ) : (
            <span className="text-ink-4">—</span>
          )}
        />
        <MiniStat l="OCs" v={String(p.ocCount)} />
        <MiniStat l="Volumen" v={p.volumenAnual > 0 ? `S/ ${(p.volumenAnual / 1000).toFixed(0)}K` : '—'} />
        <MiniStat l="Lead" v={p.leadTimeDias ? `${p.leadTimeDias}d` : '—'} />
      </div>
      {(p.contacto || p.telefono) && (
        <div className="mt-3 pt-3 border-t border-line text-[10.5px] text-ink-3 space-y-0.5">
          {p.contacto && <div>👤 {p.contacto}{p.contactoCargo ? ` · ${p.contactoCargo}` : ''}</div>}
          {p.telefono && <div>📞 {p.telefono}</div>}
        </div>
      )}
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

function MiniStat({ l, v }: { l: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[8.5px] uppercase tracking-wider text-ink-4">{l}</div>
      <div className="text-[11px] font-semibold tabular-nums mt-0.5">{v}</div>
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

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10.5px] text-ink-3 mb-0.5">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      {children}
    </div>
  );
}
