import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api.js';
import { cn, fmtPEN } from '@/lib/utils.js';

const inputCls = 'h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] w-full min-w-0';

export function AdelantosPanel({
  empleadoId,
  empleadoNombre,
}: {
  empleadoId: string;
  empleadoNombre?: string;
}) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const [fecha, setFecha] = useState(today);
  const [montoTotal, setMontoTotal] = useState('');
  const [numCuotas, setNumCuotas] = useState('1');
  const [motivo, setMotivo] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['adelantos', empleadoId],
    queryFn: () => api.oficina.listAdelantosOficina(empleadoId),
  });

  const crear = useMutation({
    mutationFn: () =>
      api.oficina.crearAdelantoOficina({
        empleadoId,
        fecha,
        montoTotal: Number(montoTotal),
        numCuotas: Number(numCuotas),
        motivo: motivo.trim() || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['adelantos', empleadoId] });
      setFecha(today);
      setMontoTotal('');
      setNumCuotas('1');
      setMotivo('');
    },
  });

  const adelantos = data?.adelantos ?? [];
  const canSubmit = Number(montoTotal) > 0 && Number(numCuotas) >= 1 && !crear.isPending;

  return (
    <div className="space-y-4">
      {/* Title */}
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-medium text-foreground">
          Adelantos
          {empleadoNombre ? ` — ${empleadoNombre}` : ''}
        </span>
        <span className="text-[11px] text-ink-4">({adelantos.length})</span>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-[12px] text-ink-4 py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Cargando…
        </div>
      ) : adelantos.length === 0 ? (
        <p className="text-[12px] text-ink-4 py-2">Sin adelantos registrados.</p>
      ) : (
        <div className="rounded-md border border-line bg-bg-elev overflow-hidden">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-line bg-bg-sunken">
                <th className="text-left px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-ink-4">
                  Fecha
                </th>
                <th className="text-right px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-ink-4">
                  Monto
                </th>
                <th className="text-right px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-ink-4">
                  Cuotas
                </th>
                <th className="text-right px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-ink-4">
                  Cuota/mes
                </th>
                <th className="text-right px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-ink-4">
                  Saldo
                </th>
                <th className="text-center px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-ink-4">
                  Estado
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {adelantos.map((a) => (
                <tr key={a.id} className="hover:bg-bg-sunken/50 transition-colors">
                  <td className="px-3 py-2 text-ink-3 font-mono tabular-nums">
                    {a.fecha.slice(0, 10)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {fmtPEN(Number(a.montoTotal))}
                  </td>
                  <td className="px-3 py-2 text-right text-ink-3">{a.numCuotas}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-3">
                    {fmtPEN(a.montoCuota)}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 text-right font-mono tabular-nums font-medium',
                      a.saldoPendiente > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-ink-4',
                    )}
                  >
                    {fmtPEN(a.saldoPendiente)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                        a.estado === 'vigente'
                          ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                          : 'bg-bg-sunken text-ink-4',
                      )}
                    >
                      {a.estado}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create form */}
      <div className="rounded-md border border-line bg-bg-sunken/40 p-3 space-y-3">
        <div className="text-[10px] font-mono uppercase tracking-wider text-ink-4">
          Registrar adelanto
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <label className="block">
            <span className="text-[10.5px] text-ink-4">Fecha</span>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className={cn(inputCls, 'mt-0.5')}
            />
          </label>
          <label className="block">
            <span className="text-[10.5px] text-ink-4">Monto total (S/)</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={montoTotal}
              onChange={(e) => setMontoTotal(e.target.value)}
              placeholder="0.00"
              className={cn(inputCls, 'mt-0.5 font-mono tabular-nums')}
            />
          </label>
          <label className="block">
            <span className="text-[10.5px] text-ink-4">N° cuotas</span>
            <input
              type="number"
              step="1"
              min="1"
              value={numCuotas}
              onChange={(e) => setNumCuotas(e.target.value)}
              className={cn(inputCls, 'mt-0.5')}
            />
          </label>
          <label className="block">
            <span className="text-[10.5px] text-ink-4">Motivo</span>
            <input
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="opcional"
              className={cn(inputCls, 'mt-0.5')}
            />
          </label>
        </div>
        <div className="flex justify-end">
          <button
            onClick={() => crear.mutate()}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {crear.isPending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Guardando…
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                Registrar adelanto
              </>
            )}
          </button>
        </div>
        {crear.isError && (
          <p className="text-[11px] text-red-500">
            Error al registrar: {(crear.error as Error).message}
          </p>
        )}
      </div>
    </div>
  );
}
