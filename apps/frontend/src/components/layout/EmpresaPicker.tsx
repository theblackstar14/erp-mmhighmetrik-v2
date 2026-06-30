import type { EmpresaMembresia } from '@/lib/api.js';

const ACCENT = '#1C1C1C';

/** Cuadrado negro redondeado con sigla (MM / MG) · mismo logo del aside/login. */
function LogoSquare({ label, size = 96 }: { label: string; size?: number }) {
  return (
    <div
      className="relative grid place-items-center overflow-hidden font-mono font-bold text-white"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        background: ACCENT,
        fontSize: size * 0.3,
        letterSpacing: '-0.02em',
        boxShadow: '0 1px 0 rgba(255,255,255,.25) inset, 0 8px 24px rgba(0,0,0,.12)',
      }}
    >
      <svg viewBox="0 0 40 40" width={size} height={size} style={{ position: 'absolute', inset: 0 }}>
        <path d="M 8 28 L 14 14 L 20 24 L 26 12 L 32 28" fill="none" stroke="rgba(255,255,255,.20)" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      <span style={{ position: 'relative' }}>{label}</span>
    </div>
  );
}

/** Pantalla en blanco · selector de empresa (admins / usuarios en 2+ empresas). */
export function EmpresaPicker({ empresas, onPick }: { empresas: EmpresaMembresia[]; onPick: (id: number) => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#F7F7F5] animate-fadeIn">
      <div className="w-full max-w-[680px] px-6 text-center">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#8A8F98]">
          MMHIGHMETRIK · Engineers ERP
        </div>
        <h1 className="mb-12 text-[26px] font-semibold tracking-[-0.02em] text-[#0F1115]">Selecciona la empresa</h1>

        <div className="flex flex-wrap items-start justify-center gap-10">
          {empresas.map((e, i) => (
            <button
              key={e.id}
              type="button"
              onClick={() => onPick(e.id)}
              className="group flex w-[210px] flex-col items-center gap-5 rounded-2xl border border-transparent p-6 transition-all duration-200 hover:border-[#E6E6E3] hover:bg-white hover:shadow-[0_14px_44px_rgba(0,0,0,0.09)] active:scale-[0.98] animate-[fadeIn_.5s_ease_both]"
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <div className="transition-transform duration-200 group-hover:-translate-y-0.5">
                <LogoSquare label={e.nombre ?? e.razonSocial.slice(0, 2).toUpperCase()} />
              </div>
              <div className="leading-tight">
                <div className="text-[14.5px] font-semibold text-[#0F1115]">{e.razonSocial}</div>
                <div className="mt-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-[#8A8F98]">{e.rol}</div>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-14 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#B0B4BB]">
          Tu acceso varía según la empresa
        </div>
      </div>
    </div>
  );
}
