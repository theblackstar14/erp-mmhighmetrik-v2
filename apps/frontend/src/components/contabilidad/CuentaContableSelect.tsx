import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type PlanCuentaBusqueda, api } from '@/lib/api.js';
import { cn } from '@/lib/utils.js';

// WS1 · selector de CUENTA CONTABLE manual (Kelly). Autocomplete por código/descripción,
// solo activas, teclado (↑↓ Enter Esc). Emite la fila para que el padre derive el chip CD/GG.
// NO expone CD/GG editable: la clase se deriva de la cuenta, nunca se elige aquí.
export function CuentaContableSelect({
  value, onChange, empresaId, soloHoja, placeholder = 'Buscar cuenta contable…', className,
}: {
  value: string | null;
  onChange: (codigo: string | null, row?: PlanCuentaBusqueda) => void;
  empresaId?: number;
  soloHoja?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0); // índice resaltado (teclado)
  const [debounced, setDebounced] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 180); return () => clearTimeout(t); }, [q]);

  const searchQ = useQuery({
    queryKey: ['plan-buscar', debounced, empresaId, soloHoja],
    queryFn: () => api.contabilidad.searchPlan(debounced, { empresaId, soloHoja }),
    enabled: open,
  });
  const rows = useMemo(() => searchQ.data?.cuentas ?? [], [searchQ.data]);

  // cerrar al click fuera
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const pick = (r: PlanCuentaBusqueda) => { onChange(r.codigo, r); setQ(''); setOpen(false); };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => Math.min(i + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows[hi]) pick(rows[hi]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };
  useEffect(() => { setHi(0); }, [debounced, open]);

  const inputCls = 'h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] outline-none focus:border-primary';

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      {value ? (
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-primary/50 bg-primary/5 text-[12px] font-medium">
            <span className="font-mono">{value}</span>
          </span>
          <button type="button" onClick={() => { onChange(null); setOpen(true); }} className="text-[11px] text-ink-4 hover:text-foreground underline">cambiar</button>
        </div>
      ) : (
        <input
          className={cn(inputCls, 'w-full')}
          placeholder={placeholder}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          autoComplete="off"
        />
      )}
      {open && !value && (
        <div className="absolute z-30 mt-1 w-[320px] max-h-64 overflow-auto rounded-md border border-line bg-bg-elev shadow-lg">
          {searchQ.isLoading && <div className="px-2 py-2 text-[11px] text-ink-4">Buscando…</div>}
          {!searchQ.isLoading && rows.length === 0 && <div className="px-2 py-2 text-[11px] text-ink-4">Sin resultados</div>}
          {rows.map((r, i) => (
            <button
              key={r.codigo}
              type="button"
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(r)}
              className={cn('flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px]', i === hi ? 'bg-primary/10' : 'hover:bg-bg-sunken')}
            >
              <span className="font-mono text-[11px] text-ink-2 w-14 shrink-0">{r.codigo}</span>
              <span className="flex-1 truncate">{r.descripcion}</span>
              {r.esDivisionaria && <span className="text-[9px] px-1 rounded bg-bg-sunken text-ink-4">div</span>}
              {r.clasificable === false && <span className="text-[9px] px-1 rounded bg-bg-sunken text-ink-4">balance</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Deriva el chip CD/GG desde la cuenta elegida (espejo de derivarClase del backend · solo UI).
export function claseDerivadaUI(row: PlanCuentaBusqueda | undefined | null, tieneObra: boolean): 'CD' | 'GG_OBRA' | 'GG_CORP' | null {
  if (!row || row.clasificable === false || row.clasificable == null) return null;
  if (tieneObra) return row.claseObra ?? 'CD';
  return 'GG_CORP';
}
