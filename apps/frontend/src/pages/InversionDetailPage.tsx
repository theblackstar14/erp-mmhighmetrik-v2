import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CheckCircle2, MinusCircle, Pencil, X, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button.js';
import { type Inversion, type InversionRollup, api } from '@/lib/api.js';
import { cn, fmtPEN } from '@/lib/utils.js';

const GGUT_LABEL: Record<string, string> = {
  separado: 'GG+UT separados',
  embebido_cd: 'GG+UT embebidos',
  simple_pct: 'Desglose simple',
};

export function InversionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [editing, setEditing] = useState(false);
  const detail = useQuery({
    queryKey: ['inversion', id],
    queryFn: () => api.inversiones.get(id!),
    enabled: !!id,
  });
  const rollup = useQuery({
    queryKey: ['inversion-rollup', id],
    queryFn: () => api.inversiones.getRollup(id!),
    enabled: !!id,
  });

  if (detail.isLoading) return <div className="text-[13px] text-ink-3">Cargando...</div>;
  if (!detail.data?.inversion) return <div className="text-[13px]">Inversión no encontrada</div>;
  const inv = detail.data.inversion;

  return (
    <div className="space-y-5">
      {editing && <EditarMontosModal inversion={inv} onClose={() => setEditing(false)} />}

      <Link to="/inversiones" className="inline-flex items-center gap-1.5 text-[12px] text-ink-3 hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Inversiones
      </Link>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-ink-3 font-bold">CUI {inv.cui}</span>
            <span className="chip blue">{inv.modalidad}</span>
            {inv.pendienteContrato && <span className="chip amber">Sin contrato</span>}
          </div>
          <h1 className="text-[20px] font-semibold tracking-[-0.02em] leading-tight">{inv.nombre}</h1>
          <p className="mt-0.5 text-[12.5px] text-ink-3">{inv.ubicacion ?? '—'}</p>
        </div>
        <Button variant="outline" onClick={() => setEditing(true)}>
          <Pencil className="h-3.5 w-3.5" /> Editar montos 08-A
        </Button>
      </header>

      {/* Montos 08-A declarados */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MontoCard label="Inversión MEF" valor={inv.montoInversionMef} destacado />
        <MontoCard label="Componentes (obra)" valor={inv.montoComponentes} />
        <MontoCard label="Expediente técnico" valor={inv.montoExpedienteTecnico} />
        <MontoCard label="Supervisión" valor={inv.montoSupervision} />
        <MontoCard label="Gestión" valor={inv.montoGestion} />
        <MontoCard label="Liquidación" valor={inv.montoLiquidacion} />
      </section>

      {/* Rollup */}
      {rollup.data && <RollupSection rollup={rollup.data} />}
    </div>
  );
}

function RollupSection({ rollup }: { rollup: InversionRollup }) {
  return (
    <div className="space-y-4">
      <div
        className={cn(
          'flex items-center gap-2.5 rounded-md px-4 py-3',
          rollup.ok ? 'bg-ok-soft' : 'bg-destructive-soft',
        )}
      >
        {rollup.ok ? (
          <CheckCircle2 className="h-5 w-5 text-ok shrink-0" />
        ) : (
          <XCircle className="h-5 w-5 text-destructive shrink-0" />
        )}
        <div>
          <p className={cn('text-[13px] font-semibold', rollup.ok ? 'text-ok' : 'text-destructive')}>
            {rollup.ok
              ? 'Rollup consolidado · sin discrepancias'
              : `${rollup.discrepancias.length} discrepancia(s) vs montos declarados`}
          </p>
          <p className="text-[11px] text-ink-3 mt-0.5">
            {rollup.totales.colegios} colegio(s) · tolerancia ±{fmtPEN(rollup.epsilon)} · % GG/UT no se consolidan a nivel inversión
          </p>
        </div>
      </div>

      {/* Totales consolidados */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MontoCard label="Σ Costo Directo" valor={rollup.totales.costoDirecto} />
        <MontoCard label="Σ Contractual (obra)" valor={rollup.totales.montoContractual} destacado />
        <MontoCard label="Σ Valor Referencial" valor={rollup.totales.montoReferencial} />
      </section>

      {/* Colegios */}
      <section className="space-y-2.5">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 font-medium">Colegios vinculados</h3>
        {rollup.colegios.length === 0 ? (
          <div className="rounded-md border border-line bg-bg-sunken/40 p-6 text-center text-[12px] text-ink-3">
            Sin colegios vinculados. Vincúlalos desde el wizard de proyectos (campo Inversión).
          </div>
        ) : (
          <div className="rounded-md border border-line overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-bg-sunken/60 text-ink-3">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Código</th>
                  <th className="text-left font-medium px-3 py-2">IE</th>
                  <th className="text-left font-medium px-3 py-2">Estructura</th>
                  <th className="text-right font-medium px-3 py-2">Costo Directo</th>
                  <th className="text-right font-medium px-3 py-2">Contractual</th>
                </tr>
              </thead>
              <tbody>
                {rollup.colegios.map((c) => (
                  <tr key={c.id} className="border-t border-line hover:bg-bg-sunken/30">
                    <td className="px-3 py-2">
                      <Link to={`/proyectos/${c.id}`} className="font-mono font-semibold text-primary hover:underline">
                        {c.codigo}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-ink-3">{c.codigoIe ?? '—'}</td>
                    <td className="px-3 py-2 text-ink-3">{GGUT_LABEL[c.ggUtModo] ?? c.ggUtModo}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtPEN(c.costoDirecto)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtPEN(c.montoContractual)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Comparaciones vs declarado */}
      <section className="space-y-2.5">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 font-medium">Comparaciones vs 08-A / MEF</h3>
        <div className="space-y-2">
          {rollup.comparaciones.map((c) => {
            const icon =
              c.severidad === 'ok' ? <CheckCircle2 className="h-4 w-4 text-ok shrink-0" /> :
              c.severidad === 'error' ? <XCircle className="h-4 w-4 text-destructive shrink-0" /> :
              c.severidad === 'warn' ? <AlertTriangle className="h-4 w-4 text-warn-ink shrink-0" /> :
              <MinusCircle className="h-4 w-4 text-ink-4 shrink-0" />;
            const border = c.severidad === 'error' ? 'border-destructive/30' : c.severidad === 'warn' ? 'border-warn/30' : 'border-line';
            return (
              <div key={c.nombre} className={cn('rounded-md border bg-bg-elev p-3 flex items-start gap-2.5', border)}>
                {icon}
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-medium">{c.descripcion}</p>
                  <div className="mt-1 flex flex-wrap gap-x-6 gap-y-0.5 text-[11px] font-mono tabular-nums text-ink-3">
                    <span>Rollup: <span className="text-foreground">{fmtPEN(c.rollup)}</span></span>
                    <span>Declarado: <span className="text-foreground">{c.declarado != null ? fmtPEN(c.declarado) : '— (cargar 08-A)'}</span></span>
                    {c.diff != null && (
                      <span className={c.ok ? 'text-ink-4' : 'text-destructive'}>Diff: {fmtPEN(c.diff)}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function MontoCard({ label, valor, destacado }: { label: string; valor: string | number | null; destacado?: boolean }) {
  const n = valor == null ? null : Number(valor);
  return (
    <div className={cn('rounded-md border bg-bg-sunken/40 p-3', destacado ? 'border-primary/30' : 'border-line')}>
      <p className="text-[11px] text-ink-3">{label}</p>
      <p className={cn('text-[15px] font-semibold tabular-nums mt-0.5', destacado && 'text-primary')}>
        {n != null ? fmtPEN(n) : '—'}
      </p>
    </div>
  );
}

const MONTO_FIELDS = [
  { key: 'montoInversionMef', label: 'Inversión MEF total' },
  { key: 'montoComponentes', label: 'Componentes (obra)' },
  { key: 'montoExpedienteTecnico', label: 'Expediente técnico' },
  { key: 'montoSupervision', label: 'Supervisión' },
  { key: 'montoGestion', label: 'Gestión' },
  { key: 'montoLiquidacion', label: 'Liquidación' },
] as const;

function EditarMontosModal({ inversion, onClose }: { inversion: Inversion; onClose: () => void }) {
  const qc = useQueryClient();
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(MONTO_FIELDS.map((f) => [f.key, inversion[f.key] != null ? String(inversion[f.key]) : ''])),
  );
  const [error, setError] = useState('');

  const updateMut = useMutation({
    mutationFn: (data: Record<string, number | undefined>) => api.inversiones.update(inversion.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inversion', inversion.id] });
      qc.invalidateQueries({ queryKey: ['inversion-rollup', inversion.id] });
      qc.invalidateQueries({ queryKey: ['inversiones'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const submit = () => {
    const payload: Record<string, number | undefined> = {};
    for (const f of MONTO_FIELDS) {
      const raw = vals[f.key]?.trim();
      if (raw) {
        const n = Number(raw);
        if (Number.isNaN(n) || n < 0) {
          setError(`${f.label}: monto inválido`);
          return;
        }
        payload[f.key] = n;
      }
    }
    setError('');
    updateMut.mutate(payload);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg rounded-md border border-line bg-bg-elev shadow-xl flex flex-col">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold">Editar montos 08-A</h2>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-bg-sunken">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-3">
          {MONTO_FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="block font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4 font-medium mb-1">{f.label}</span>
              <input
                value={vals[f.key] ?? ''}
                onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder="0.00"
                inputMode="decimal"
                className="w-full h-9 rounded-md border border-line bg-bg-elev px-3 text-[12.5px] font-mono tabular-nums outline-none placeholder:text-ink-4 focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </label>
          ))}
        </div>
        {error && <div className="mx-5 mb-3 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-[12px] text-destructive">{error}</div>}
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md border border-line text-[12px] text-ink-2 hover:bg-bg-sunken">
            Cancelar
          </button>
          <Button onClick={submit} disabled={updateMut.isPending}>
            {updateMut.isPending ? 'Guardando...' : 'Guardar montos'}
          </Button>
        </div>
      </div>
    </div>
  );
}
