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

export function fmtDate(s: string | Date | null | undefined): string {
  if (!s) return '—';
  const d = typeof s === 'string' ? new Date(s) : s;
  return d.toLocaleDateString('es-PE');
}
