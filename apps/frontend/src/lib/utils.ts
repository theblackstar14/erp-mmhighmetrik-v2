import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtPEN(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? Number.parseFloat(n) : (n ?? 0);
  const neg = v < 0;
  const abs = Math.abs(v);
  return (neg ? '-' : '') + 'S/ ' + abs.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1e6) return s + 'S/ ' + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return s + 'S/ ' + (a / 1e3).toFixed(1) + 'K';
  return s + 'S/ ' + a.toFixed(0);
}

/**
 * Lee presupuesto contractual (lo que le corresponde a la empresa = referencial × factor_oferta)
 * Fallback a presupuesto legacy solo si contractual no existe (datos pre-F1.A)
 */
export function partidaPresupuesto(p: { presupuestoContractual?: string | null; presupuesto?: string | null }): number {
  const c = Number(p.presupuestoContractual ?? 0);
  if (c > 0) return c;
  return Number(p.presupuesto ?? 0);
}

/**
 * Precio unitario contractual · null si no hay
 */
export function partidaPrecioUnitario(p: {
  precioUnitarioContractual?: string | null;
  precioUnitario?: string | null;
}): number | null {
  if (p.precioUnitarioContractual) return Number(p.precioUnitarioContractual);
  if (p.precioUnitario) return Number(p.precioUnitario);
  return null;
}

export function fmtDate(s: string | Date | null | undefined): string {
  if (!s) return '—';
  // Force UTC parse · evita off-by-1 (Postgres date sin TZ → JS Date asume UTC)
  const d = typeof s === 'string' ? new Date(`${String(s).slice(0, 10)}T00:00:00Z`) : s;
  return d.toLocaleDateString('es-PE', { timeZone: 'UTC' });
}
