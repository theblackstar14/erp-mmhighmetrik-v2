import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api.js';
import { cn } from '@/lib/utils.js';

type Sugerencia = {
  recursoId: string;
  recursoCodigo: string;
  recursoDescripcion: string;
  recursoTipo: string;
  iuCodigo: string | null;
  confianza: number;
  razon: string;
};

export function AutoClasificarModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [stage, setStage] = useState<'loading' | 'preview' | 'applying' | 'done' | 'error'>('loading');
  const [data, setData] = useState<Awaited<ReturnType<typeof api.logistica.autoClasificarPreview>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [aplicados, setAplicados] = useState(0);

  useEffect(() => {
    api.logistica
      .autoClasificarPreview()
      .then((r) => {
        setData(r);
        // Auto-seleccionar las de alta confianza (>= 0.85)
        const initSel = new Set(
          r.sugerencias.filter((s) => s.iuCodigo && s.confianza >= 0.85).map((s) => s.recursoId),
        );
        setSelected(initSel);
        setStage('preview');
      })
      .catch((e: Error) => {
        setError(e.message);
        setStage('error');
      });
  }, []);

  const aplicarMut = useMutation({
    mutationFn: (sugs: Sugerencia[]) =>
      api.logistica.aplicarSugerencias(
        sugs.map((s) => ({ recursoId: s.recursoId, iuCodigo: s.iuCodigo, confianza: s.confianza })),
      ),
    onSuccess: (r) => {
      setAplicados(r.aplicados);
      qc.invalidateQueries({ queryKey: ['logistica-recursos'] });
      qc.invalidateQueries({ queryKey: ['logistica-ius'] });
      setStage('done');
    },
    onError: (e: Error) => {
      setError(e.message);
      setStage('error');
    },
  });

  const toggleSel = (recursoId: string) => {
    const next = new Set(selected);
    if (next.has(recursoId)) next.delete(recursoId);
    else next.add(recursoId);
    setSelected(next);
  };

  const toggleAllAlta = () => {
    if (!data) return;
    const alta = data.sugerencias.filter((s) => s.iuCodigo && s.confianza >= 0.85).map((s) => s.recursoId);
    setSelected(new Set(alta));
  };
  const toggleAllConIu = () => {
    if (!data) return;
    const conIu = data.sugerencias.filter((s) => s.iuCodigo).map((s) => s.recursoId);
    setSelected(new Set(conIu));
  };

  const sugerenciasFiltradas = useMemo(() => {
    if (!data) return [];
    return [...data.sugerencias].sort((a, b) => b.confianza - a.confianza);
  }, [data]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-md border border-line bg-bg-elev shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-line px-5 py-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 font-bold">
                Logística · IA Gemini
              </span>
            </div>
            <h2 className="text-[15px] font-semibold leading-tight">Auto-clasificar recursos con IA</h2>
            <p className="text-[11.5px] text-ink-3 mt-0.5">
              Gemini sugiere IU INEI por cada recurso · revisa y aprueba antes de aplicar
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

        {/* Body */}
        {stage === 'loading' && (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
            <Loader2 className="h-8 w-8 text-primary animate-spin mb-4" />
            <h3 className="text-[14px] font-semibold mb-1">Analizando recursos con Gemini IA...</h3>
            <p className="text-[12px] text-ink-3 max-w-md">
              Puede tardar 30-60s · procesa en lotes de 80 recursos
            </p>
          </div>
        )}

        {stage === 'error' && (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive mb-4" />
            <h3 className="text-[14px] font-semibold mb-1">Error</h3>
            <p className="text-[12px] text-ink-3 max-w-md">{error}</p>
          </div>
        )}

        {stage === 'done' && (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
            <Check className="h-8 w-8 text-emerald-600 mb-4" />
            <h3 className="text-[14px] font-semibold mb-1">{aplicados} recursos clasificados</h3>
            <p className="text-[12px] text-ink-3 max-w-md">
              Marcados con origen `auto_ia` · revisa los de baja confianza en el listado
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 h-9 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90"
            >
              Cerrar
            </button>
          </div>
        )}

        {stage === 'preview' && data && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-4 gap-2 px-5 py-3 border-b border-line bg-bg-sunken/30">
              <MiniStat lbl="Total analizado" val={data.total} />
              <MiniStat lbl="Alta confianza" val={data.altaConfianza} accent="green" sub="≥85%" />
              <MiniStat lbl="Media confianza" val={data.mediaConfianza} accent="amber" sub="60-85%" />
              <MiniStat lbl="Sin match" val={data.sinMatch} accent="gray" sub="< 60%" />
            </div>

            {/* Quick actions */}
            <div className="flex items-center gap-2 px-5 py-2 border-b border-line">
              <span className="text-[11.5px] text-ink-2 mr-2">Seleccionar:</span>
              <button
                type="button"
                onClick={toggleAllAlta}
                className="h-7 px-2.5 rounded-md border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30 text-[11px] text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/50"
              >
                Solo alta confianza
              </button>
              <button
                type="button"
                onClick={toggleAllConIu}
                className="h-7 px-2.5 rounded-md border border-line text-[11px] text-ink-2 hover:bg-bg-sunken"
              >
                Todas con IU
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="h-7 px-2.5 rounded-md border border-line text-[11px] text-ink-2 hover:bg-bg-sunken"
              >
                Ninguna
              </button>
              <span className="ml-auto text-[11.5px] text-ink-3">
                <span className="font-mono font-semibold text-foreground">{selected.size}</span> seleccionadas
              </span>
            </div>

            {/* Lista */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-bg-elev z-10 border-b border-line">
                  <tr className="text-left">
                    <th className="w-8 py-1.5"></th>
                    <th className="py-1.5 font-mono text-[9.5px] uppercase tracking-wider text-ink-4">Recurso</th>
                    <th className="py-1.5 font-mono text-[9.5px] uppercase tracking-wider text-ink-4 w-16">IU</th>
                    <th className="py-1.5 font-mono text-[9.5px] uppercase tracking-wider text-ink-4 w-20">Confianza</th>
                    <th className="py-1.5 font-mono text-[9.5px] uppercase tracking-wider text-ink-4 w-64">Razón Gemini</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/40">
                  {sugerenciasFiltradas.map((s) => {
                    const isSel = selected.has(s.recursoId);
                    const conf = s.confianza ?? 0;
                    const confColor =
                      conf >= 0.85
                        ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                        : conf >= 0.6
                          ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400';
                    const noMatch = !s.iuCodigo;
                    return (
                      <tr
                        key={s.recursoId}
                        className={cn(
                          'hover:bg-bg-sunken/30',
                          isSel && 'bg-primary-soft/30',
                          noMatch && 'opacity-60',
                        )}
                      >
                        <td className="py-1.5">
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => toggleSel(s.recursoId)}
                            disabled={noMatch}
                            className="rounded border-line"
                          />
                        </td>
                        <td className="py-1.5">
                          <div className="font-mono text-[9.5px] text-ink-3">{s.recursoCodigo}</div>
                          <div className="text-[11px] truncate max-w-[300px]" title={s.recursoDescripcion}>
                            {s.recursoDescripcion}
                          </div>
                        </td>
                        <td className="py-1.5">
                          {s.iuCodigo ? (
                            <span className="font-mono text-[10px] bg-primary-soft text-primary-ink px-1.5 py-0.5 rounded font-bold">
                              {s.iuCodigo}
                            </span>
                          ) : (
                            <span className="text-[10px] text-ink-4">—</span>
                          )}
                        </td>
                        <td className="py-1.5">
                          <span className={cn('inline-block px-1.5 py-0.5 rounded text-[9.5px] font-mono tabular-nums', confColor)}>
                            {(conf * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="py-1.5 text-[10.5px] text-ink-3 italic truncate max-w-[260px]" title={s.razon}>
                          {s.razon}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-line px-5 py-3">
              <span className="text-[11px] text-ink-3">
                ⚠ Recursos clasificados por IA tendrán origen <code className="font-mono bg-bg-sunken px-1 rounded">auto_ia</code>
                · revísalos manualmente si confianza &lt; 85%
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={aplicarMut.isPending}
                  className="h-9 px-4 rounded-md border border-line text-[12px] text-ink-2 hover:bg-bg-sunken disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const sugs = data.sugerencias.filter((s) => selected.has(s.recursoId));
                    setStage('applying');
                    aplicarMut.mutate(sugs);
                  }}
                  disabled={selected.size === 0 || aplicarMut.isPending}
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {aplicarMut.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Aplicar {selected.size} sugerencias
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MiniStat({
  lbl,
  val,
  accent,
  sub,
}: {
  lbl: string;
  val: number;
  accent?: 'green' | 'amber' | 'gray';
  sub?: string;
}) {
  const accentClass = {
    green: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-700 dark:text-amber-400',
    gray: 'text-gray-500',
  };
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4">{lbl}</div>
      <div className={cn('text-[16px] font-bold tabular-nums', accent && accentClass[accent])}>{val}</div>
      {sub && <div className="text-[10px] text-ink-3 mt-0.5">{sub}</div>}
    </div>
  );
}
