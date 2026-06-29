import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, History, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { type Partida, api } from '@/lib/api.js';
import { fmtPEN, partidaPresupuesto } from '@/lib/utils.js';

type Props = {
  partida: Partida;
  proyectoId: string;
  initialAvancePct?: number;
  initialRealCost?: number;
  onClose: () => void;
};

export function EditAvanceModal({ partida, proyectoId, initialAvancePct, initialRealCost, onClose }: Props) {
  const qc = useQueryClient();
  const budget = partidaPresupuesto(partida);

  const [avancePct, setAvancePct] = useState(initialAvancePct ?? 0);
  const [realCost, setRealCost] = useState(initialRealCost ?? 0);
  const [nota, setNota] = useState('');
  const [sync, setSync] = useState(true);
  const [error, setError] = useState('');

  const histQ = useQuery({
    queryKey: ['avances', partida.id],
    queryFn: () => api.partidas.listAvances(partida.id),
  });

  const saveMut = useMutation({
    mutationFn: () =>
      api.partidas.createAvance(partida.id, {
        avancePct: Number(avancePct),
        realCost: Number(realCost),
        nota: nota || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['avances', partida.id] });
      qc.invalidateQueries({ queryKey: ['avances-proyecto', proyectoId] });
      qc.invalidateQueries({ queryKey: ['proyecto', proyectoId] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const onPctChange = (v: string) => {
    const n = Math.max(0, Math.min(100, Number.parseFloat(v) || 0));
    setAvancePct(n);
    if (sync) setRealCost(+(budget * (n / 100)).toFixed(2));
  };
  const onRealChange = (v: string) => {
    const n = Math.max(0, Number.parseFloat(v) || 0);
    setRealCost(n);
    if (sync && budget > 0) setAvancePct(+((n / budget) * 100).toFixed(2));
  };

  const saldo = budget - realCost;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-md border border-line bg-bg-elev shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-3">
                {partida.codigo}
              </span>
              {partida.isCritical && <span className="chip red">Crítica</span>}
              {partida.isMilestone && <span className="chip amber">◆ Hito</span>}
            </div>
            <h2 className="text-[14px] font-semibold leading-tight">{partida.nombre}</h2>
            <p className="text-[11px] text-ink-3 mt-0.5">Registrar medición de avance</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-bg-sunken"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* 3 KPI cards */}
          <div className="grid grid-cols-3 gap-2">
            <KpiBox lbl="Presupuesto" val={fmtPEN(budget)} />
            <KpiBox lbl="Real ejecutado" val={fmtPEN(realCost)} accent="text-primary" />
            <KpiBox lbl="Saldo" val={fmtPEN(saldo)} accent={saldo < 0 ? 'text-destructive' : ''} />
          </div>

          {/* Sync toggle */}
          <label className="flex items-center gap-2 cursor-pointer text-[12px] text-ink-2 select-none">
            <input
              type="checkbox"
              checked={sync}
              onChange={(e) => setSync(e.target.checked)}
              className="rounded border-line"
            />
            Sincronizar % con costo (real = presupuesto × %)
          </label>

          {/* % avance */}
          <div>
            <label className="font-mono text-[10px] uppercase tracking-wider text-ink-2 font-medium block mb-1.5">
              % Avance físico
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={avancePct}
              onChange={(e) => onPctChange(e.target.value)}
              className="w-full h-11 rounded-md border border-line bg-bg-elev px-3 text-[16px] font-mono font-bold outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <div className="mt-2 h-1.5 w-full rounded-full bg-bg-sunken overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.min(100, avancePct)}%` }}
              />
            </div>
          </div>

          {/* Real S/ */}
          <div>
            <label className="font-mono text-[10px] uppercase tracking-wider text-ink-2 font-medium block mb-1.5">
              Costo real ejecutado (S/)
            </label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={realCost}
              onChange={(e) => onRealChange(e.target.value)}
              className="w-full h-11 rounded-md border border-line bg-bg-elev px-3 text-[16px] font-mono font-bold outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Nota */}
          <div>
            <label className="font-mono text-[10px] uppercase tracking-wider text-ink-2 font-medium block mb-1.5">
              Nota / observación (opcional)
            </label>
            <input
              type="text"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ej. Vaciado losa nivel 2 completado · 30 m³"
              className="w-full h-9 rounded-md border border-line bg-bg-elev px-3 text-[12.5px] outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Histórico */}
          {histQ.data && histQ.data.avances.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <History className="h-3.5 w-3.5 text-ink-3" />
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-2 font-medium">
                  Histórico ({histQ.data.avances.length})
                </span>
              </div>
              <div className="border border-line rounded-md overflow-hidden">
                {histQ.data.avances.slice(0, 6).map((h) => (
                  <div
                    key={h.id}
                    className="grid grid-cols-[90px_60px_110px_1fr] gap-2 items-center px-3 py-2 text-[11px] border-b border-line last:border-b-0"
                  >
                    <span className="font-mono text-[10px] text-ink-3">
                      <Clock className="inline h-2.5 w-2.5 mr-1" />
                      {new Date(h.fecha).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })}
                    </span>
                    <span className="font-mono text-right font-semibold">{Number(h.avancePct).toFixed(1)}%</span>
                    <span className="font-mono text-right text-primary">{fmtPEN(Number(h.realCost))}</span>
                    <span className="text-ink-3 truncate" title={h.nota ?? ''}>
                      {h.nota ?? '—'}
                    </span>
                  </div>
                ))}
                {histQ.data.avances.length > 6 && (
                  <div className="px-3 py-1.5 text-[10px] text-ink-3 italic text-center">
                    +{histQ.data.avances.length - 6} mediciones más...
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-[12px] text-destructive">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saveMut.isPending}
            className="px-4 py-1.5 rounded-md border border-line text-[12px] text-ink-2 hover:bg-bg-sunken disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90 disabled:opacity-50"
          >
            {saveMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Guardar medición
          </button>
        </div>
      </div>
    </div>
  );
}

function KpiBox({ lbl, val, accent }: { lbl: string; val: string; accent?: string }) {
  return (
    <div className="rounded-md border border-line bg-bg-sunken px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4">{lbl}</div>
      <div className={`mt-0.5 font-mono text-[12px] font-bold tracking-[-0.01em] truncate ${accent ?? ''}`}>
        {val}
      </div>
    </div>
  );
}
