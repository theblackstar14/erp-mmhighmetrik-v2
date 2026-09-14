import { ArrowRight, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setActiveEmpresa } from '@/lib/api.js';
import { useAuthStore } from '@/lib/auth-store.js';

const ACCENT = '#1C1C1C'; // dashboard ink (negro medio)
const ACCENT_GLOW = '#3B5BDB'; // glow sutil con blue v1 para visibilidad sobre dark pane

const PHRASES = [
  { k: 'Plataforma', v: 'Donde la obra y la contabilidad hablan el mismo idioma.' },
  { k: 'Precisión', v: 'De la partida al asiento contable, en un solo flujo.' },
  { k: 'Trazabilidad', v: 'Cada metrado, cada sol, cada decisión — auditados.' },
];

/** Hook · timer global animation t en segundos */
function useAnimationTime() {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf: number;
    const loop = (ts: number) => {
      setT(ts / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return t;
}

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [email, setEmail] = useState('admin@mmhighmetrik.com');
  const [password, setPassword] = useState('admin');
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.login(email, password);
      setActiveEmpresa(null); // fuerza el selector de empresa en cada login (multi-empresa)
      const me = await api.me(); // empresas + permisos + mustChangePassword
      // Trigger exit animation antes de navegar
      setExiting(true);
      setTimeout(() => {
        setSession(me);
        navigate('/');
      }, 450);
    } catch (err) {
      setError((err as Error).message ?? 'Credenciales inválidas');
      setLoading(false);
    }
  };

  return (
    <div
      className={`grid h-screen w-screen grid-cols-1 lg:grid-cols-[1.1fr_1fr] overflow-hidden bg-[#F7F7F5] ${exiting ? 'animate-loginExit' : ''}`}
    >
      {/* ─── Pane izquierdo · branding oscuro animado ─── */}
      <SidePane />

      {/* ─── Pane derecho · form ─── */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[420px]">
          {/* Brand mark */}
          <div className="mb-12 flex items-center gap-3">
            <BrandMark />
            <div className="leading-tight">
              <div className="font-bold text-[15px] tracking-[-0.01em] text-[#0F1115]">MMHIGHMETRIK</div>
              <div className="font-mono text-[10.5px] tracking-[0.12em] text-[#8A8F98] uppercase mt-0.5">
                Engineers ERP
              </div>
            </div>
          </div>

          {/* Heading */}
          <h1 className="text-[28px] font-semibold tracking-[-0.025em] text-[#0F1115] leading-tight">
            Iniciar sesión
          </h1>
          <p className="mt-2 text-[14px] text-[#8A8F98]">
            Ingresá con tus credenciales corporativas
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-5">
            {/* Email */}
            <div>
              <label htmlFor="email" className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#8A8F98] font-medium mb-2 block">
                Email corporativo
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 w-full rounded-[10px] border border-[#E6E6E3] bg-white px-3.5 text-[14.5px] text-[#0F1115] outline-none transition-all placeholder:text-[#8A8F98] focus:border-[#0F1115] focus:shadow-[0_0_0_4px_rgba(15,17,21,0.04)]"
                placeholder="usuario@mmhighmetrik.com"
                required
              />
            </div>

            {/* Password */}
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <label htmlFor="password" className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#8A8F98] font-medium">
                  Contraseña
                </label>
                <button type="button" className="text-[12px] text-[#8A8F98] hover:text-[#0F1115] transition-colors">
                  ¿Olvidaste?
                </button>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 w-full rounded-[10px] border border-[#E6E6E3] bg-white px-3.5 pr-14 text-[14.5px] text-[#0F1115] outline-none transition-all placeholder:text-[#8A8F98] focus:border-[#0F1115] focus:shadow-[0_0_0_4px_rgba(15,17,21,0.04)]"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-mono uppercase tracking-wider text-[#8A8F98] hover:text-[#0F1115]"
                >
                  {showPass ? 'OCULT' : 'VER'}
                </button>
              </div>
            </div>

            {/* Remember */}
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="hidden"
              />
              <span
                className={`grid h-4 w-4 place-items-center rounded border transition-all ${
                  remember ? 'bg-[#0F1115] border-[#0F1115]' : 'border-[#E6E6E3] bg-white'
                }`}
              >
                {remember && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M1.5 5.2 L4 7.5 L8.5 2.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className="text-[13.5px] text-[#3B3F46]">Mantener sesión iniciada</span>
            </label>

            {/* Error */}
            {error && (
              <div className="rounded-[10px] border border-[#D2483F]/30 bg-[#D2483F]/5 px-4 py-3 text-[13px] text-[#D2483F]">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="group flex h-12 w-full items-center justify-center gap-2.5 rounded-[10px] font-semibold text-[14.5px] text-white transition-all disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.995]"
              style={{ background: loading ? '#C7C9CE' : ACCENT }}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Autenticando…</span>
                </>
              ) : (
                <>
                  <span>Continuar</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-12 flex items-center justify-between text-[11.5px] text-[#8A8F98]">
            <div>
              ¿Sin acceso? <span className="text-[#0F1115]">Contacta a tu administrador</span>
            </div>
            <div className="font-mono uppercase tracking-wider">v2.0</div>
          </div>

          {/* Dev hint · solo en desarrollo · nunca en el build de producción */}
          {import.meta.env.DEV && (
            <div className="mt-6 rounded-[10px] bg-[#F0F0EE] border border-[#E6E6E3] px-4 py-3 text-[11px] text-[#3B3F46]">
              <strong>Dev:</strong> admin@mmhighmetrik.com / admin
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Brand Mark · MH logo ─── */
function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <div
      className="relative grid place-items-center overflow-hidden text-white font-mono font-bold"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        background: ACCENT,
        fontSize: size * 0.42,
        letterSpacing: '-0.02em',
        boxShadow: '0 1px 0 rgba(255,255,255,.25) inset, 0 1px 2px rgba(0,0,0,.06)',
      }}
    >
      <svg viewBox="0 0 40 40" width={size} height={size} style={{ position: 'absolute', inset: 0 }}>
        <path d="M 8 28 L 14 14 L 20 24 L 26 12 L 32 28" fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      <span style={{ position: 'relative' }}>MH</span>
    </div>
  );
}

/* ─── Pane izquierdo completo · branding + animaciones ─── */
function SidePane() {
  const t = useAnimationTime();
  const idx = Math.floor(t / 5) % PHRASES.length;
  const phrase = PHRASES[idx]!;

  return (
    <div
      className="relative hidden lg:flex flex-col overflow-hidden text-white"
      style={{ background: 'linear-gradient(160deg, #0B0D12 0%, #11141B 55%, #191D28 100%)' }}
    >
      {/* Glow accent · usa blue v1 para visibilidad sobre dark pane */}
      <div
        className="pointer-events-none absolute top-[-240px] right-[-220px] h-[620px] w-[620px] rounded-full blur-[8px]"
        style={{ background: `radial-gradient(circle, ${ACCENT_GLOW}40 0%, transparent 62%)` }}
      />
      <div
        className="pointer-events-none absolute bottom-[-180px] left-[-140px] h-[440px] w-[440px] rounded-full blur-[12px]"
        style={{ background: `radial-gradient(circle, ${ACCENT_GLOW}22 0%, transparent 65%)` }}
      />

      {/* Topo animado */}
      <TopoLines t={t} />

      {/* Top header */}
      <div className="relative z-10 flex items-center justify-between px-11 py-9">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/55 flex items-center gap-2.5">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: ACCENT_GLOW, boxShadow: `0 0 0 4px ${ACCENT_GLOW}33` }}
          />
          Plataforma v2.0
        </div>
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/55">
          LIMA ·{' '}
          {new Date()
            .toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })
            .toUpperCase()}
        </div>
      </div>

      {/* Centerpiece · seal + quote rotando */}
      <div className="relative z-10 flex flex-1 flex-col justify-center px-14">
        <Seal t={t} />
        <div className="mt-12 max-w-[480px] min-h-[180px]">
          <div
            key={`k-${idx}`}
            className="font-mono text-[11px] uppercase tracking-[0.22em] mb-4 font-medium animate-[fadeIn_.5s_ease_both]"
            style={{ color: ACCENT_GLOW }}
          >
            {phrase.k}
          </div>
          <div
            key={`v-${idx}`}
            className="text-[32px] leading-[1.18] font-medium tracking-[-0.025em] text-white/95 animate-[fadeIn_.6s_ease_both]"
          >
            {phrase.v}
          </div>
        </div>

        {/* Indicator dots */}
        <div className="flex gap-2 mt-9">
          {PHRASES.map((_, i) => (
            <span
              key={i}
              className="h-[3px] rounded transition-all duration-500"
              style={{
                width: i === idx ? 24 : 6,
                background: i === idx ? ACCENT_GLOW : 'rgba(255,255,255,.2)',
              }}
            />
          ))}
        </div>
      </div>

      {/* Bottom footer */}
      <div className="relative z-10 flex items-center justify-between px-14 pb-9">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/40">
          Ingeniería · Contabilidad · Licitaciones
        </div>
        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"
            style={{ boxShadow: '0 0 0 4px rgba(74,222,128,.18)' }}
          />
          <span className="font-mono text-[10.5px] tracking-[0.1em] text-white/55">
            Servicios operativos
          </span>
        </div>
      </div>
    </div>
  );
}

/* ─── Topo lines · animadas con phase = t ─── */
function TopoLines({ t }: { t: number }) {
  const lines = 9;
  return (
    <svg
      viewBox="0 0 600 800"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full opacity-55"
    >
      <defs>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.12)" />
          <stop offset="0.5" stopColor={ACCENT_GLOW} stopOpacity="0.35" />
          <stop offset="1" stopColor="rgba(255,255,255,0.08)" />
        </linearGradient>
      </defs>
      {Array.from({ length: lines }).map((_, i) => {
        const phase = t * 0.3 + i * 0.6;
        const amp = 30 + i * 8;
        const y0 = 80 + i * 70;
        const pts: string[] = [];
        for (let x = -20; x <= 620; x += 20) {
          const y =
            y0 + Math.sin(x / 120 + phase) * amp + Math.cos(x / 70 + phase * 0.7) * (amp * 0.35);
          pts.push(`${x},${y}`);
        }
        return (
          <polyline
            key={i}
            points={pts.join(' ')}
            fill="none"
            stroke={i === Math.floor(lines / 2) ? 'url(#lineGrad)' : 'rgba(255,255,255,0.12)'}
            strokeWidth={i === Math.floor(lines / 2) ? 1.4 : 0.7}
          />
        );
      })}
    </svg>
  );
}

/* ─── Seal · ring rotating slow (usa t del SidePane) ─── */
function Seal({ t }: { t: number }) {
  const rot = (t * 8) % 360;
  const rot2 = (-t * 5) % 360;
  const letters = 'MMHIGHMETRIK · ENGINEERS ERP · ';
  const r = 68;

  return (
    <div className="relative h-[180px] w-[180px]">
      <svg viewBox="-100 -100 200 200" width="180" height="180" className="absolute inset-0" style={{ transform: `rotate(${rot}deg)` }}>
        <defs>
          <path id="ring" d={`M 0,0 m -${r},0 a ${r},${r} 0 1,1 ${r * 2},0 a ${r},${r} 0 1,1 -${r * 2},0`} />
        </defs>
        <circle r={r + 8} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="0.5" />
        <circle r={r - 8} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="0.5" />
        <text fontFamily="JetBrains Mono, monospace" fontSize="8" letterSpacing="4" fill="rgba(255,255,255,.55)">
          <textPath href="#ring" startOffset="0">{letters.repeat(3)}</textPath>
        </text>
      </svg>
      <svg viewBox="-100 -100 200 200" width="180" height="180" className="absolute inset-0" style={{ transform: `rotate(${rot2}deg)` }}>
        {Array.from({ length: 24 }).map((_, i) => {
          const a = (i / 24) * Math.PI * 2;
          const x1 = Math.cos(a) * (r + 18);
          const y1 = Math.sin(a) * (r + 18);
          const x2 = Math.cos(a) * (r + 24);
          const y2 = Math.sin(a) * (r + 24);
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={i % 6 === 0 ? ACCENT_GLOW : 'rgba(255,255,255,.2)'}
              strokeWidth={i % 6 === 0 ? 1.4 : 0.6}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div
          className="grid place-items-center"
          style={{
            width: 84,
            height: 84,
            borderRadius: 20,
            background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT}cc)`,
          }}
        >
          <span className="font-mono font-bold text-white text-[28px] tracking-tight">MH</span>
        </div>
      </div>
    </div>
  );
}
