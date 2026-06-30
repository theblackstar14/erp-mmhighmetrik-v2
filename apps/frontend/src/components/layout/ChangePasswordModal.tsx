import { Loader2, Lock } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api.js';
import { useAuthStore } from '@/lib/auth-store.js';

/** Cambio de clave · forced=true (primer login, sin cerrar) o desde el menú (con cerrar). */
export function ChangePasswordModal({ forced = false, onClose }: { forced?: boolean; onClose?: () => void }) {
  const reload = useAuthStore((s) => s.reload);
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [rep, setRep] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nueva.length < 8) return setErr('La clave nueva debe tener mínimo 8 caracteres');
    if (nueva !== rep) return setErr('Las claves nuevas no coinciden');
    setLoading(true);
    setErr('');
    try {
      await api.cambiarPassword(actual, nueva);
      await reload();
      setOk(true);
      setTimeout(() => onClose?.(), 700);
    } catch (e2) {
      setErr((e2 as Error).message ?? 'No se pudo cambiar la clave');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 backdrop-blur-sm animate-fadeIn" onMouseDown={() => !forced && onClose?.()}>
      <div className="w-full max-w-[400px] rounded-2xl border border-line bg-bg-elev p-6 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-bg-sunken">
            <Lock className="h-4 w-4 text-ink-2" />
          </div>
          <div>
            <div className="text-[14px] font-semibold">Cambiar contraseña</div>
            {forced && <div className="text-[11.5px] text-ink-3">Debes cambiar tu clave temporal para continuar</div>}
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <Field label="Clave actual" type="password" value={actual} onChange={setActual} autoFocus />
          <Field label="Clave nueva (mín. 8)" type="password" value={nueva} onChange={setNueva} />
          <Field label="Repetir clave nueva" type="password" value={rep} onChange={setRep} />

          {err && <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">{err}</div>}
          {ok && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[12.5px] text-emerald-600">Clave actualizada ✓</div>}

          <div className="flex gap-2 pt-1">
            {!forced && (
              <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-line py-2 text-[13px] hover:bg-bg-sunken">
                Cancelar
              </button>
            )}
            <button type="submit" disabled={loading || ok} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-ink-1 py-2 text-[13px] font-medium text-white disabled:opacity-60">
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Cambiar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, type, value, onChange, autoFocus }: { label: string; type: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">{label}</span>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-lg border border-line bg-bg px-3 text-[13.5px] outline-none focus:border-ink-2"
        required
      />
    </label>
  );
}
