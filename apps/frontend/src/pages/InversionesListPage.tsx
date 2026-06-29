import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, Plus, Search, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button.js';
import { SkelRows } from '@/components/ui/Skeleton.js';
import { type InversionCreateInput, type ModalidadInversion, api } from '@/lib/api.js';
import { fmtCompact } from '@/lib/utils.js';

const MODALIDAD_LABEL: Record<ModalidadInversion, string> = {
  oxi: 'Obras por Impuestos',
  contrata: 'Contrata',
  administracion_directa: 'Adm. directa',
  app: 'APP',
  nucleo_ejecutor: 'Núcleo ejecutor',
};

export function InversionesListPage() {
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['inversiones'],
    queryFn: () => api.inversiones.list(),
  });

  const inversiones = (data?.inversiones ?? []).filter(
    (i) =>
      !q ||
      i.cui.toLowerCase().includes(q.toLowerCase()) ||
      i.nombre.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-5">
      {showForm && <CrearInversionModal onClose={() => setShowForm(false)} />}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Inversiones</h1>
          <p className="text-[13px] text-ink-3 mt-0.5">
            {inversiones.length} inversión(es) · agrupan colegios bajo un CUI
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4" /> Nueva inversión
        </Button>
      </header>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-4" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por CUI o nombre..."
          className="h-9 w-full rounded-md border border-line bg-bg-elev pl-9 pr-3 text-[13px] outline-none placeholder:text-ink-4 focus:border-primary focus:ring-1 focus:ring-primary"
        />
      </div>

      {isLoading ? (
        <div className="rounded-md border border-line bg-bg-elev"><SkelRows rows={8} /></div>
      ) : inversiones.length === 0 ? (
        <div className="rounded-md border border-line bg-bg-elev p-12 text-center">
          <Layers className="mx-auto h-8 w-8 text-ink-4 mb-3" />
          <p className="text-[13px] text-ink-3">Sin inversiones todavía.</p>
          <Button className="mt-4" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" /> Crear primera inversión
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {inversiones.map((i) => (
            <Link key={i.id} to={`/inversiones/${i.id}`}>
              <div className="h-full rounded-md border border-line bg-bg-elev p-4 transition-all hover:border-primary/40 hover:shadow-md">
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.04em] text-ink-3">
                    CUI {i.cui}
                  </span>
                  <span className="chip blue">{MODALIDAD_LABEL[i.modalidad]}</span>
                  {i.pendienteContrato && <span className="chip amber">Sin contrato</span>}
                </div>
                <h3 className="line-clamp-2 text-[13.5px] font-semibold leading-snug tracking-[-0.005em] mb-1.5">
                  {i.nombre}
                </h3>
                <p className="line-clamp-1 text-[11px] text-ink-3 mb-3">{i.ubicacion ?? '—'}</p>
                <div className="text-[11px]">
                  <p className="text-ink-4">Inversión MEF</p>
                  <p className="font-mono font-semibold text-foreground mt-0.5">
                    {i.montoInversionMef ? fmtCompact(Number(i.montoInversionMef)) : '—'}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CrearInversionModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [cui, setCui] = useState('');
  const [nombre, setNombre] = useState('');
  const [modalidad, setModalidad] = useState<ModalidadInversion>('oxi');
  const [ubicacion, setUbicacion] = useState('');
  const [error, setError] = useState('');

  const createMut = useMutation({
    mutationFn: (data: InversionCreateInput) => api.inversiones.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inversiones'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const submit = () => {
    if (!cui.trim() || nombre.trim().length < 3) {
      setError('CUI y nombre (≥3 caracteres) son obligatorios');
      return;
    }
    setError('');
    createMut.mutate({ cui: cui.trim(), nombre: nombre.trim(), modalidad, ubicacion: ubicacion.trim() || undefined });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-md border border-line bg-bg-elev shadow-xl flex flex-col">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold">Nueva inversión</h2>
            <p className="text-[11px] text-ink-3 mt-0.5">
              Versión liviana · CUI + nombre + modalidad. Los montos 08-A se editan luego.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-bg-sunken"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-[1fr_1.4fr] gap-3">
            <FormField label="CUI *" value={cui} onChange={setCui} placeholder="2355883" mono />
            <label className="block">
              <span className="block font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4 font-medium mb-1">
                Modalidad
              </span>
              <select
                value={modalidad}
                onChange={(e) => setModalidad(e.target.value as ModalidadInversion)}
                className="w-full h-9 rounded-md border border-line bg-bg-elev px-3 text-[12.5px] outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                {Object.entries(MODALIDAD_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <FormField label="Nombre *" value={nombre} onChange={setNombre} placeholder="MEJORAMIENTO DE SERVICIOS EDUCATIVOS..." multiline />
          <FormField label="Ubicación" value={ubicacion} onChange={setUbicacion} placeholder="Cajamarca" />
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-[12px] text-destructive">
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md border border-line text-[12px] text-ink-2 hover:bg-bg-sunken"
          >
            Cancelar
          </button>
          <Button onClick={submit} disabled={createMut.isPending}>
            {createMut.isPending ? 'Creando...' : 'Crear inversión'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  mono,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  multiline?: boolean;
}) {
  return (
    <label className="block">
      <span className="block font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4 font-medium mb-1">
        {label}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="w-full rounded-md border border-line bg-bg-elev px-3 py-2 text-[12.5px] outline-none placeholder:text-ink-4 focus:border-primary focus:ring-1 focus:ring-primary"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full h-9 rounded-md border border-line bg-bg-elev px-3 text-[12.5px] outline-none placeholder:text-ink-4 focus:border-primary focus:ring-1 focus:ring-primary ${mono ? 'font-mono' : ''}`}
        />
      )}
    </label>
  );
}
