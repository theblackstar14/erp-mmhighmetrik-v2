import { createPortal } from 'react-dom';

// Overlay de "procesando → hecho" · spinner que se transforma en check (estilo v1).
// Reusado al emitir OC/OS y al registrar movimientos.
export function EmittingOverlay({ done, titulo, subtitulo, refLabel }: { done: boolean; titulo: string; subtitulo?: string; refLabel?: string }) {
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 animate-backdropIn">
      <div className="w-[360px] rounded-xl border border-line bg-bg-elev shadow-2xl overflow-hidden animate-modalPop">
        <div className="px-7 py-10 text-center">
          <div className="relative mx-auto mb-5 flex h-[88px] w-[88px] items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-ok-soft blur-xl transition-opacity duration-500" style={{ opacity: done ? 0.9 : 0.4 }} />
            {!done ? (
              <div className="oc-spinner relative z-[1]" />
            ) : (
              <svg width="72" height="72" viewBox="0 0 100 100" className="relative z-[1]">
                <circle className="oc-check-circle" cx="50" cy="50" r="42" fill="none" stroke="hsl(var(--ok))" strokeWidth="2.5" strokeLinecap="round" />
                <path className="oc-check-path" d="M32 50L45 63L68 35" fill="none" stroke="hsl(var(--ok))" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <div className="text-[15px] font-bold tracking-[-0.01em]">{titulo}</div>
          {refLabel && <div className="font-mono text-[11px] text-ink-3 mt-1">{refLabel}</div>}
          {subtitulo && <div className="text-[11px] text-ink-3 mt-1">{subtitulo}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
