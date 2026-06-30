import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  BookOpen,
  Calculator,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Landmark,
  Lock,
  LockOpen,
  History,
  Plus,
  RotateCcw,
  Scale,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { type AsientoFull, type AuditEvento, type CuentaPlan, type MayorResumenFila, type SombraDiff, api } from '@/lib/api.js';
import { useAuthStore } from '@/lib/auth-store.js';
import { cn, fmtPEN } from '@/lib/utils.js';
import { SkelRows, TabFade } from '@/components/ui/Skeleton.js';

type Tab = 'plan' | 'diario' | 'mayor' | 'bancos' | 'sombra' | 'fiscal' | 'reportes' | 'auditoria';

const hoyPeriodo = () => new Date().toISOString().slice(0, 7);

export function ContabilidadPage() {
  const [tab, setTab] = useState<Tab>('plan');
  const [periodo, setPeriodo] = useState(hoyPeriodo());

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Contabilidad · PCGE 2020</h1>
          <p className="text-[13px] text-ink-3 mt-0.5">Plan contable · libro diario y mayor · fiscal IGV/Renta (MYPE) · asientos automáticos</p>
        </div>
        <label className="flex items-center gap-2">
          <span className="text-[11px] font-mono uppercase tracking-wider text-ink-4">Periodo</span>
          <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="h-9 px-3 rounded-md border border-line bg-bg-elev text-[12.5px]" />
        </label>
      </header>

      <div className="border-b border-line">
        <nav className="flex gap-1 -mb-px overflow-x-auto">
          {([
            ['plan', 'Plan Contable', BookOpen],
            ['diario', 'Libro Diario', FileSpreadsheet],
            ['mayor', 'Libro Mayor', BookOpen],
            ['bancos', 'Bancos y Conciliación', Landmark],
            ['sombra', 'Sombra 104x', Scale],
            ['fiscal', 'Fiscal (IGV / Renta)', Calculator],
            ['reportes', 'Reportes', FileSpreadsheet],
            ['auditoria', 'Auditoría', History],
          ] as const).map(([k, l, Icon]) => (
            <button key={k} onClick={() => setTab(k)}
              className={cn('flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-[12.5px] font-medium border-b-2 transition-colors',
                tab === k ? 'border-primary text-primary' : 'border-transparent text-ink-3 hover:text-foreground hover:border-line-strong')}>
              <Icon className="h-3.5 w-3.5" /> {l}
            </button>
          ))}
        </nav>
      </div>

      <TabFade tabKey={tab}>
        {tab === 'plan' && <PlanTab periodo={periodo} />}
        {tab === 'diario' && <DiarioTab periodo={periodo} />}
        {tab === 'mayor' && <MayorTab periodo={periodo} />}
        {tab === 'bancos' && <BancosTab />}
        {tab === 'sombra' && <SombraTab periodo={periodo} />}
        {tab === 'fiscal' && <FiscalTab periodo={periodo} />}
        {tab === 'reportes' && <ReportesTab periodo={periodo} />}
        {tab === 'auditoria' && <AuditoriaTab periodo={periodo} />}
      </TabFade>
    </div>
  );
}

// ─── Plan Contable ───────────────────────────────────────────
const CLASES: Record<string, string> = {
  '1': 'ACTIVO DISPONIBLE Y EXIGIBLE', '2': 'ACTIVO REALIZABLE', '3': 'ACTIVO INMOVILIZADO',
  '4': 'PASIVO', '5': 'PATRIMONIO', '6': 'GASTOS POR NATURALEZA', '7': 'INGRESOS', '8': 'SALDOS INTERMEDIARIOS', '9': 'ANALÍTICA DE COSTOS',
};

function PlanTab({ periodo }: { periodo: string }) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [clase, setClase] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['ctb-plan', periodo], queryFn: () => api.contabilidad.getPlan(periodo) });
  const cuentas = data?.cuentas ?? [];

  const q = busca.trim().toLowerCase();
  const filtradas = useMemo(() => cuentas.filter((c) => {
    if (clase && !c.codigo.startsWith(clase)) return false;
    if (!q) return true;
    return c.codigo.includes(q) || c.descripcion.toLowerCase().includes(q);
  }), [cuentas, q, clase]);

  const selCuenta = sel ? cuentas.find((c) => c.codigo === sel) ?? null : null;

  // agrupar por clase pa headers
  let lastClase = '';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="h-3.5 w-3.5 text-ink-4 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cuenta o código..." className="h-8 w-64 pl-8 pr-2 rounded-md border border-line bg-bg-elev text-[12px]" />
        </div>
        <select value={clase} onChange={(e) => setClase(e.target.value)} className="h-8 px-2.5 rounded-md border border-line bg-bg-elev text-[12px]">
          <option value="">Todas las clases</option>
          {Object.entries(CLASES).map(([k, v]) => <option key={k} value={k}>Clase {k} · {v}</option>)}
        </select>
        <span className="text-[11px] text-ink-4">{filtradas.length} cuentas · saldos al {periodo}</span>
        <button onClick={() => setAddOpen(true)} className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90">
          <Plus className="h-3.5 w-3.5" /> Cuenta
        </button>
      </div>

      <div className={cn('grid gap-4', selCuenta ? 'grid-cols-1 lg:grid-cols-[1fr_380px]' : 'grid-cols-1')}>
        <div className="rounded-lg border border-line bg-bg-elev overflow-hidden self-start">
          {isLoading ? <SkelRows rows={6} /> : (
            <table className="w-full text-[12px]">
              <thead className="bg-bg-sunken border-b border-line">
                <tr className="text-left text-[10px] font-mono uppercase tracking-wider text-ink-4">
                  <th className="px-3 py-2 w-28">Código</th>
                  <th className="px-3 py-2">Cuenta</th>
                  <th className="px-3 py-2 w-24">Tipo</th>
                  <th className="px-3 py-2 w-32 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtradas.map((c) => {
                  const cl = c.codigo[0]!;
                  const showHeader = cl !== lastClase && !q;
                  lastClase = cl;
                  return (
                    <CuentaRow key={c.codigo} c={c} showHeader={showHeader} clase={cl} selected={sel === c.codigo} onSelect={() => setSel(sel === c.codigo ? null : c.codigo)} />
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {selCuenta && (
          <CuentaDetallePanel
            cuenta={selCuenta}
            onClose={() => setSel(null)}
            onDeleted={() => { setSel(null); qc.invalidateQueries({ queryKey: ['ctb-plan'] }); }}
          />
        )}
      </div>
      {addOpen && <CuentaModal cuentas={cuentas} onClose={() => setAddOpen(false)} onDone={() => { qc.invalidateQueries({ queryKey: ['ctb-plan'] }); setAddOpen(false); }} />}
    </div>
  );
}

function CuentaRow({ c, showHeader, clase, selected, onSelect }: { c: CuentaPlan; showHeader: boolean; clase: string; selected: boolean; onSelect: () => void }) {
  const tieneMov = c.debe > 0 || c.haber > 0;
  return (
    <>
      {showHeader && (
        <tr className="bg-primary/5">
          <td colSpan={4} className="px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-primary">■ CLASE {clase} · {CLASES[clase]}</td>
        </tr>
      )}
      <tr onClick={onSelect} className={cn('cursor-pointer', selected ? 'bg-primary/10' : 'hover:bg-bg-sunken/30')}>
        <td className="px-3 py-1.5 font-mono tabular-nums" style={{ paddingLeft: `${12 + (c.nivel - 1) * 14}px` }}>
          <span className={cn(c.nivel === 1 ? 'font-bold' : c.nivel === 2 ? 'font-semibold' : 'text-ink-3')}>{c.codigo}</span>
        </td>
        <td className={cn('px-3 py-1.5', c.nivel === 1 ? 'font-semibold' : c.nivel >= 3 && 'text-ink-3')}>{c.descripcion}</td>
        <td className="px-3 py-1.5"><span className="font-mono text-[9.5px] uppercase text-ink-4">{c.tipo}</span></td>
        <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', tieneMov ? 'font-semibold' : 'text-ink-4')}>
          {tieneMov ? fmtPEN(c.saldo) : '—'}
        </td>
      </tr>
    </>
  );
}

// ─── Panel detalle de cuenta (debe/haber/saldo + movimientos · incluye sub-cuentas) ───
function CuentaDetallePanel({ cuenta, onClose, onDeleted }: { cuenta: CuentaPlan; onClose: () => void; onDeleted: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['ctb-mayor', cuenta.codigo],
    queryFn: () => api.contabilidad.getMayor(cuenta.codigo),
  });
  const movs = data?.movimientos ?? [];
  const sinMov = cuenta.debe === 0 && cuenta.haber === 0;
  const deudor = cuenta.saldo >= 0;
  const del = useMutation({
    mutationFn: () => api.contabilidad.deleteCuenta(cuenta.codigo),
    onSuccess: onDeleted,
    onError: (e: Error) => alert(e.message),
  });
  return (
    <div className="rounded-lg border border-line bg-bg-elev p-4 self-start lg:sticky lg:top-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-mono text-[11px] text-ink-4">{cuenta.codigo}</div>
          <h3 className="text-[14px] font-semibold leading-tight">{cuenta.descripcion}</h3>
        </div>
        <button onClick={onClose} className="h-7 w-7 rounded-md border border-line inline-flex items-center justify-center text-ink-3 hover:bg-bg-sunken shrink-0"><X className="h-3.5 w-3.5" /></button>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="rounded-md bg-bg-sunken px-3 py-2.5">
          <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4">Total Debe</div>
          <div className="font-mono text-[14px] font-bold tabular-nums text-primary">{fmtPEN(cuenta.debe)}</div>
        </div>
        <div className="rounded-md bg-bg-sunken px-3 py-2.5">
          <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4">Total Haber</div>
          <div className="font-mono text-[14px] font-bold tabular-nums">{fmtPEN(cuenta.haber)}</div>
        </div>
      </div>
      <div className={cn('rounded-md px-3 py-2.5 mb-3', deudor ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-amber-50 dark:bg-amber-950/30')}>
        <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4">Saldo actual ({deudor ? 'deudor' : 'acreedor'})</div>
        <div className={cn('font-mono text-[16px] font-bold tabular-nums', deudor ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400')}>{fmtPEN(Math.abs(cuenta.saldo))}</div>
      </div>

      <div className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4 mb-1.5">Movimientos ({movs.length})</div>
      {isLoading ? <SkelRows rows={6} />
        : movs.length === 0 ? <div className="text-center py-6 text-[11.5px] text-ink-3">Sin movimientos</div>
        : (
        <div className="max-h-[340px] overflow-y-auto divide-y divide-line -mx-1 px-1">
          {movs.slice().reverse().map((m, i) => {
            const esDebe = m.debe > 0;
            return (
              <div key={i} className="py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-ink-4">{m.fecha}</span>
                  <span className="font-mono text-[10px] text-primary">{m.correlativo}</span>
                </div>
                <div className="text-[11.5px] truncate" title={m.glosa}>{m.glosa}</div>
                <div className={cn('font-mono text-[11.5px] font-semibold tabular-nums', esDebe ? 'text-primary' : 'text-ink-2')}>
                  {esDebe ? 'D' : 'H'} {fmtPEN(esDebe ? m.debe : m.haber)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Eliminar · SOLO divisionarias vacías (typo del contador) · cuentas con historia jamás */}
      {sinMov && cuenta.nivel >= 2 && (
        <button onClick={() => { if (confirm(`¿Eliminar cuenta ${cuenta.codigo}? Solo posible porque no tiene movimientos.`)) del.mutate(); }}
          className="mt-3 w-full inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-line text-[11px] text-ink-4 hover:text-destructive hover:border-destructive/40">
          <Trash2 className="h-3 w-3" /> Eliminar cuenta (sin movimientos)
        </button>
      )}
    </div>
  );
}

function CuentaModal({ cuentas, onClose, onDone }: { cuentas: CuentaPlan[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ codigo: '', descripcion: '', tipo: 'Activo' });
  const [err, setErr] = useState<string | null>(null);
  const padre = f.codigo.length > 2 ? cuentas.find((c) => c.codigo === f.codigo.slice(0, f.codigo.length - 1)) : null;
  const create = useMutation({
    mutationFn: () => api.contabilidad.createCuenta(f),
    onSuccess: onDone,
    onError: (e: Error) => setErr(e.message),
  });
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-xl border border-line bg-bg-elev p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold mb-3">Nueva cuenta / divisionaria</h3>
        <div className="space-y-2.5">
          <label className="block">
            <span className="text-[10.5px] font-mono uppercase tracking-wider text-ink-4">Código (numérico · el padre debe existir)</span>
            <input value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="10411" className="mt-1 h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] w-full font-mono" />
            {padre && <span className="text-[10.5px] text-emerald-600">↳ bajo {padre.codigo} · {padre.descripcion}</span>}
            {f.codigo.length > 2 && !padre && <span className="text-[10.5px] text-amber-600">⚠ padre {f.codigo.slice(0, -1)} no existe</span>}
          </label>
          <label className="block">
            <span className="text-[10.5px] font-mono uppercase tracking-wider text-ink-4">Descripción</span>
            <input value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} placeholder="BCP · Cta corriente MN" className="mt-1 h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] w-full" />
          </label>
          <label className="block">
            <span className="text-[10.5px] font-mono uppercase tracking-wider text-ink-4">Tipo</span>
            <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })} className="mt-1 h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] w-full">
              {['Activo', 'Pasivo', 'Patrimonio', 'Gasto', 'Ingreso', 'Costo'].map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          {err && <div className="text-[11px] text-destructive">{err}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-bg-sunken">Cancelar</button>
            <button disabled={f.codigo.length < 2 || !f.descripcion || create.isPending} onClick={() => create.mutate()} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-50">Crear</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Libro Diario ────────────────────────────────────────────
const ORIGEN_CHIP: Record<string, string> = {
  manual: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  gasto: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  pago_oc: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  valorizacion: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  cobro_valo: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  planilla: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
};

function DiarioTab({ periodo }: { periodo: string }) {
  const qc = useQueryClient();
  const [nuevoOpen, setNuevoOpen] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [soloDescuadre, setSoloDescuadre] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['ctb-asientos', periodo], queryFn: () => api.contabilidad.listAsientos({ periodo }) });
  const cobQ = useQuery({ queryKey: ['ctb-cobertura', periodo], queryFn: () => api.contabilidad.getCobertura(periodo) });
  const asientos = data?.asientos ?? [];
  const stats = data?.stats;
  const cob = cobQ.data;

  // Regla 3 · diferencia global + asientos culpables (defensivo · debería ser siempre 0)
  const registrados = useMemo(() => asientos.filter((a) => a.status === 'registrado'), [asientos]);
  const diferencia = useMemo(() => registrados.reduce((s, a) => s + (a.totalDebe - a.totalHaber), 0), [registrados]);
  const hayDescuadre = Math.abs(diferencia) > 0.01;

  const q = busca.trim().toLowerCase();
  const filtrados = useMemo(() => asientos.filter((a) => {
    if (soloDescuadre && Math.abs(a.totalDebe - a.totalHaber) <= 0.01) return false;
    if (!q) return true;
    return a.glosa.toLowerCase().includes(q) || a.correlativo.toLowerCase().includes(q)
      || (a.docOrigen ?? '').toLowerCase().includes(q) || a.lineas.some((l) => l.cuenta.startsWith(q));
  }), [asientos, q, soloDescuadre]);

  const inval = () => { qc.invalidateQueries({ queryKey: ['ctb-asientos'] }); qc.invalidateQueries({ queryKey: ['ctb-plan'] }); qc.invalidateQueries({ queryKey: ['ctb-cobertura'] }); };
  const generar = useMutation({
    mutationFn: () => api.contabilidad.generar(periodo),
    onSuccess: (r) => {
      const d = r.detalle;
      setGenMsg(`Generados ${r.generados}: ${d.gastos} compras · ${d.pagosOc} pagos OC · ${d.valorizaciones} valos · ${d.cobros} cobros · ${d.planillas} planillas${d.errores.length ? ` · ⚠ ${d.errores.length} errores: ${d.errores.slice(0, 3).join(' | ')}` : ''}`);
      inval();
    },
    onError: (e: Error) => setGenMsg(`Error: ${e.message}`),
  });
  const anular = useMutation({
    mutationFn: (id: string) => api.contabilidad.anularAsiento(id),
    onSuccess: inval,
    onError: (e: Error) => alert(e.message),
  });

  return (
    <div className="space-y-3">
      {/* KPIs · regla 3 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCtb label="Asientos" value={String(stats?.count ?? 0)} tone="info" />
        <KpiCtb label="Total Debe" value={fmtPEN(stats?.totalDebe ?? 0)} tone="info" />
        <KpiCtb label="Total Haber" value={fmtPEN(stats?.totalHaber ?? 0)} tone="warn2" />
        {hayDescuadre ? (
          <button onClick={() => setSoloDescuadre(!soloDescuadre)} className="text-left">
            <KpiCtb label="Diferencia" value={fmtPEN(Math.abs(diferencia))} tone="bad" sub={soloDescuadre ? 'mostrando culpables · click pa quitar' : 'Revisar · click pa filtrar culpables'} />
          </button>
        ) : (
          <KpiCtb label="Diferencia" value="S/ 0.00" tone="ok" sub="✓ cuadrado" />
        )}
      </div>

      {/* Regla 4 · cobertura */}
      {cob && cob.total > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11.5px] text-amber-800 dark:text-amber-300">
          <span>⚠ {cob.total} documento(s) del periodo sin contabilizar:</span>
          <span className="font-mono">{cob.gastos} gastos · {cob.pagosOc} pagos · {cob.valorizaciones} valos · {cob.cobros} cobros · {cob.planillas} planillas</span>
          <button onClick={() => generar.mutate()} disabled={generar.isPending} className="ml-auto h-7 px-2.5 rounded-md bg-amber-600 text-white text-[11px] font-medium hover:opacity-90 disabled:opacity-50">
            {generar.isPending ? 'Generando...' : 'Generar ahora'}
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="h-3.5 w-3.5 text-ink-4 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar glosa, cuenta, doc..." className="h-8 w-64 pl-8 pr-2 rounded-md border border-line bg-bg-elev text-[12px]" />
        </div>
        <span className="text-[11px] text-ink-4">{filtrados.length} de {asientos.length}</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => generar.mutate()} disabled={generar.isPending}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-primary/40 bg-primary/5 text-primary text-[12px] font-medium hover:bg-primary/10 disabled:opacity-50">
            <Sparkles className="h-3.5 w-3.5" /> {generar.isPending ? 'Generando...' : 'Generar automáticos'}
          </button>
          <button onClick={() => setNuevoOpen(true)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90">
            <Plus className="h-3.5 w-3.5" /> Manual
          </button>
          <button onClick={() => alert('Export PLE SUNAT · próximamente')} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-line text-[12px] text-ink-3 hover:bg-bg-sunken" title="Próximamente">
            PLE SUNAT
          </button>
        </div>
      </div>
      {genMsg && <div className="rounded-md border border-line bg-bg-sunken/50 px-3 py-2 text-[11.5px] text-ink-2">{genMsg}</div>}

      <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
        {isLoading ? <SkelRows rows={6} />
          : filtrados.length === 0 ? (
            <div className="text-center py-12 text-[12px] text-ink-3">
              {asientos.length === 0 ? `Sin asientos en ${periodo}` : 'Sin resultados para el filtro'}
              {asientos.length === 0 && <div className="text-[10.5px] text-ink-4 mt-1">Usa "Generar automáticos" (toma gastos, pagos, valorizaciones y planilla del periodo) o crea uno manual</div>}
            </div>
          ) : (
            <div className="divide-y divide-line">
              {filtrados.map((a) => <AsientoRow key={a.id} a={a} onAnular={(id) => { if (confirm('¿Anular asiento?')) anular.mutate(id); }} />)}
            </div>
          )}
      </div>
      {nuevoOpen && <AsientoModal onClose={() => setNuevoOpen(false)} onDone={() => { inval(); setNuevoOpen(false); }} />}
    </div>
  );
}

function KpiCtb({ label, value, tone, sub }: { label: string; value: string; tone: 'info' | 'ok' | 'warn2' | 'bad'; sub?: string }) {
  const border = tone === 'ok' ? 'border-l-emerald-500' : tone === 'bad' ? 'border-l-red-500' : tone === 'warn2' ? 'border-l-amber-500' : 'border-l-primary';
  const txt = tone === 'bad' ? 'text-red-600 dark:text-red-400' : '';
  return (
    <div className={cn('rounded-lg border border-line border-l-[3px] bg-bg-elev p-3.5', border)}>
      <div className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4">{label}</div>
      <div className={cn('mt-1 text-[18px] font-bold font-mono tabular-nums tracking-[-0.02em]', txt)}>{value}</div>
      {sub && <div className={cn('text-[10px] mt-0.5', tone === 'bad' ? 'text-red-500' : 'text-ink-4')}>{sub}</div>}
    </div>
  );
}

function AsientoRow({ a, onAnular }: { a: AsientoFull; onAnular: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const anulado = a.status === 'anulado';
  return (
    <div className={cn(anulado && 'opacity-50')}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-bg-sunken/30">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-ink-4 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-ink-4 shrink-0" />}
        <span className="font-mono text-[10.5px] text-primary font-semibold shrink-0">{a.correlativo}</span>
        <span className="font-mono text-[10.5px] text-ink-4 shrink-0">{a.fecha}</span>
        <span className={cn('text-[9px] font-mono uppercase px-1.5 py-0.5 rounded shrink-0', ORIGEN_CHIP[a.origen] ?? ORIGEN_CHIP.manual)}>{a.origen.replace('_', ' ')}</span>
        {a.docOrigen && <span className="font-mono text-[10px] text-ink-4 shrink-0">{a.docOrigen}</span>}
        <span className="text-[12px] truncate flex-1">{a.glosa}</span>
        {anulado && <span className="text-[9.5px] font-mono text-destructive shrink-0">ANULADO</span>}
        <span className="font-mono text-[11.5px] tabular-nums font-semibold shrink-0">{fmtPEN(a.totalDebe)}</span>
      </button>
      {open && (
        <div className="px-10 pb-2.5">
          <table className="w-full text-[11.5px]">
            <thead><tr className="text-[9.5px] font-mono uppercase tracking-wider text-ink-4 border-b border-line">
              <th className="text-left py-1 w-24">Cuenta</th><th className="text-left py-1">Descripción</th><th className="text-right py-1 w-28">Debe</th><th className="text-right py-1 w-28">Haber</th>
            </tr></thead>
            <tbody>
              {a.lineas.map((l) => (
                <tr key={l.id} className="border-b border-line/50 last:border-0">
                  <td className="py-1 font-mono tabular-nums">{l.cuenta}</td>
                  <td className="py-1 text-ink-3">{l.descripcion ?? '—'}</td>
                  <td className="py-1 text-right font-mono tabular-nums">{Number(l.debe) > 0 ? fmtPEN(Number(l.debe)) : ''}</td>
                  <td className="py-1 text-right font-mono tabular-nums">{Number(l.haber) > 0 ? fmtPEN(Number(l.haber)) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!anulado && (
            <button onClick={() => onAnular(a.id)} className="mt-1.5 text-[10.5px] text-ink-4 hover:text-destructive inline-flex items-center gap-1"><X className="h-3 w-3" /> Anular asiento</button>
          )}
        </div>
      )}
    </div>
  );
}

type LineaForm = { cuenta: string; descripcion: string; debe: string; haber: string };
function AsientoModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const planQ = useQuery({ queryKey: ['ctb-plan-min'], queryFn: () => api.contabilidad.getPlan() });
  const cuentas = planQ.data?.cuentas ?? [];
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [glosa, setGlosa] = useState('');
  const [moneda, setMoneda] = useState('PEN');
  const [tc, setTc] = useState('');
  const [lineas, setLineas] = useState<LineaForm[]>([
    { cuenta: '', descripcion: '', debe: '', haber: '' },
    { cuenta: '', descripcion: '', debe: '', haber: '' },
  ]);
  const [err, setErr] = useState<string | null>(null);

  const setL = (i: number, p: Partial<LineaForm>) => setLineas(lineas.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const totDebe = lineas.reduce((s, l) => s + (parseFloat(l.debe) || 0), 0);
  const totHaber = lineas.reduce((s, l) => s + (parseFloat(l.haber) || 0), 0);
  const cuadra = Math.abs(totDebe - totHaber) < 0.01 && totDebe > 0;

  const create = useMutation({
    mutationFn: () => api.contabilidad.createAsiento({
      fecha, glosa, moneda, tipoCambio: tc ? Number(tc) : null,
      lineas: lineas.filter((l) => l.cuenta && ((parseFloat(l.debe) || 0) > 0 || (parseFloat(l.haber) || 0) > 0))
        .map((l) => ({ cuenta: l.cuenta, descripcion: l.descripcion || null, debe: parseFloat(l.debe) || 0, haber: parseFloat(l.haber) || 0 })),
    }),
    onSuccess: onDone,
    onError: (e: Error) => setErr(e.message),
  });

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 sm:p-6" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-line bg-bg-elev p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold mb-3">Nuevo asiento manual</h3>
        <div className="grid grid-cols-3 gap-2.5 mb-3">
          <label className="block"><span className="text-[10.5px] font-mono uppercase tracking-wider text-ink-4">Fecha</span>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="mt-1 h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] w-full" /></label>
          <label className="block"><span className="text-[10.5px] font-mono uppercase tracking-wider text-ink-4">Moneda</span>
            <select value={moneda} onChange={(e) => setMoneda(e.target.value)} className="mt-1 h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] w-full"><option>PEN</option><option>USD</option></select></label>
          {moneda === 'USD' && (
            <label className="block"><span className="text-[10.5px] font-mono uppercase tracking-wider text-ink-4">T.C.</span>
              <input type="number" step="0.0001" value={tc} onChange={(e) => setTc(e.target.value)} placeholder="3.75" className="mt-1 h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] w-full font-mono" /></label>
          )}
        </div>
        <label className="block mb-3"><span className="text-[10.5px] font-mono uppercase tracking-wider text-ink-4">Glosa</span>
          <input value={glosa} onChange={(e) => setGlosa(e.target.value)} placeholder="Depreciación del mes · ajuste..." className="mt-1 h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] w-full" /></label>

        <div className="space-y-1.5 mb-2">
          <div className="grid grid-cols-[110px_1fr_100px_100px_24px] gap-1.5 text-[9.5px] font-mono uppercase tracking-wider text-ink-4">
            <span>Cuenta</span><span>Descripción</span><span className="text-right">Debe</span><span className="text-right">Haber</span><span />
          </div>
          {lineas.map((l, i) => {
            const c = cuentas.find((x) => x.codigo === l.cuenta);
            return (
              <div key={i} className="grid grid-cols-[110px_1fr_100px_100px_24px] gap-1.5 items-center">
                <div>
                  <input value={l.cuenta} onChange={(e) => setL(i, { cuenta: e.target.value.replace(/\D/g, '') })} placeholder="604" list="ctb-cuentas" className="h-7 px-2 rounded border border-line bg-bg-elev text-[11.5px] w-full font-mono" />
                </div>
                <input value={l.descripcion} onChange={(e) => setL(i, { descripcion: e.target.value })} placeholder={c?.descripcion ?? 'descripción'} className="h-7 px-2 rounded border border-line bg-bg-elev text-[11.5px] w-full" />
                <input type="number" value={l.debe} onChange={(e) => setL(i, { debe: e.target.value, haber: e.target.value ? '' : l.haber })} className="h-7 px-2 rounded border border-line bg-bg-elev text-[11.5px] w-full font-mono text-right" />
                <input type="number" value={l.haber} onChange={(e) => setL(i, { haber: e.target.value, debe: e.target.value ? '' : l.debe })} className="h-7 px-2 rounded border border-line bg-bg-elev text-[11.5px] w-full font-mono text-right" />
                <button onClick={() => setLineas(lineas.length > 2 ? lineas.filter((_, j) => j !== i) : lineas)} className="text-ink-4 hover:text-destructive"><X className="h-3 w-3" /></button>
              </div>
            );
          })}
          <datalist id="ctb-cuentas">
            {cuentas.filter((c) => c.nivel >= 2).map((c) => <option key={c.codigo} value={c.codigo}>{c.descripcion}</option>)}
          </datalist>
          <button onClick={() => setLineas([...lineas, { cuenta: '', descripcion: '', debe: '', haber: '' }])} className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"><Plus className="h-3 w-3" /> línea</button>
        </div>

        <div className="flex items-center justify-between border-t border-line pt-2.5">
          <div className="flex gap-4 text-[11.5px] font-mono tabular-nums">
            <span>Debe {fmtPEN(totDebe)}</span>
            <span>Haber {fmtPEN(totHaber)}</span>
            <span className={cuadra ? 'text-emerald-600' : 'text-amber-600'}>{cuadra ? '✓ cuadrado' : `Δ ${fmtPEN(Math.abs(totDebe - totHaber))}`}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-bg-sunken">Cancelar</button>
            <button disabled={!cuadra || !glosa || create.isPending} onClick={() => create.mutate()} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-50">Registrar asiento</button>
          </div>
        </div>
        {err && <div className="mt-2 text-[11px] text-destructive">{err}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ─── Libro Mayor · resumen por cuenta + modal detalle ────────
function MayorTab({ periodo }: { periodo: string }) {
  const [modo, setModo] = useState<'acum' | 'mes'>('acum');
  const [busca, setBusca] = useState('');
  const [sel, setSel] = useState<MayorResumenFila | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['ctb-mayor-resumen', modo, periodo],
    queryFn: () => api.contabilidad.getMayorResumen(modo === 'mes' ? periodo : undefined),
  });
  const filas = data?.filas ?? [];
  const q = busca.trim().toLowerCase();
  // useMemo · antes re-filtraba todas las cuentas en cada render/tecla (las tabs hermanas ya memoizan)
  const filtradas = useMemo(() => filas.filter((f) => !q || f.cuenta.includes(q) || f.descripcion.toLowerCase().includes(q)), [filas, q]);

  return (
    <div className="space-y-3">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCtb label="Cuentas con movimiento" value={String(data?.totales.cuentas ?? 0)} tone="info" />
        <KpiCtb label="Movimientos totales" value={String(data?.totales.movs ?? 0)} tone="info" />
        <KpiCtb label="Total Debe" value={fmtPEN(data?.totales.debe ?? 0)} tone="info" />
        <KpiCtb label="Total Haber" value={fmtPEN(data?.totales.haber ?? 0)} tone="warn2" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="h-3.5 w-3.5 text-ink-4 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cuenta o descripción..." className="h-8 w-64 pl-8 pr-2 rounded-md border border-line bg-bg-elev text-[12px]" />
        </div>
        <select value={modo} onChange={(e) => setModo(e.target.value as 'acum' | 'mes')} className="h-8 px-2.5 rounded-md border border-line bg-bg-elev text-[12px]">
          <option value="acum">Acumulado todos los meses</option>
          <option value="mes">Solo {periodo} (con saldo inicial)</option>
        </select>
        <span className="text-[11px] text-ink-4">{filtradas.length} cuentas</span>
      </div>

      <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
        {isLoading ? <SkelRows rows={6} /> : (
          <table className="w-full text-[12px]">
            <thead className="bg-bg-sunken border-b border-line">
              <tr className="text-left text-[10px] font-mono uppercase tracking-wider text-ink-4">
                <th className="px-3 py-2 w-20">Código</th><th className="px-3 py-2">Descripción</th>
                <th className="px-3 py-2 w-28 text-right">S. Inicial</th><th className="px-3 py-2 w-32 text-right">Debe</th>
                <th className="px-3 py-2 w-32 text-right">Haber</th><th className="px-3 py-2 w-32 text-right">S. Final</th>
                <th className="px-3 py-2 w-16 text-right">Movs</th><th className="px-2 py-2 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtradas.map((f) => (
                <tr key={f.cuenta} onClick={() => setSel(f)} className="cursor-pointer hover:bg-bg-sunken/30">
                  <td className="px-3 py-2 font-mono font-semibold tabular-nums">{f.cuenta}</td>
                  <td className="px-3 py-2"><div className="text-[11.5px]">{f.descripcion}</div><div className="text-[9.5px] font-mono uppercase text-ink-4">{f.tipo}</div></td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-3">{Math.abs(f.inicial) > 0.004 ? fmtPEN(f.inicial) : '—'}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-primary">{fmtPEN(f.debe)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtPEN(f.haber)}</td>
                  <td className={cn('px-3 py-2 text-right font-mono tabular-nums font-semibold', f.final < 0 && 'text-destructive')}>{fmtPEN(f.final)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-3">{f.movs}</td>
                  <td className="px-2 py-2 text-ink-4"><ChevronRight className="h-3.5 w-3.5" /></td>
                </tr>
              ))}
              {filtradas.length === 0 && <tr><td colSpan={8} className="px-3 py-10 text-center text-[12px] text-ink-3">Sin cuentas con movimiento · genera asientos primero</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {sel && <MayorDetalleModal fila={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

// Modal · movimientos de la cuenta con saldo corrido (como el mockup)
function MayorDetalleModal({ fila, onClose }: { fila: MayorResumenFila; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['ctb-mayor-det', fila.cuenta], queryFn: () => api.contabilidad.getMayor(fila.cuenta) });
  const movs = data?.movimientos ?? [];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm p-4 sm:p-8" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-xl border border-line bg-bg-elev shadow-2xl flex flex-col">
        {/* Header */}
        <div className="shrink-0 border-b border-line px-5 py-3 flex items-start justify-between">
          <div>
            <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-bg-sunken border border-line">{fila.cuenta}</span>
            <div className="text-[14px] font-semibold mt-1">{fila.descripcion}</div>
            <div className="text-[10.5px] text-ink-4">{fila.movs} movimientos · {fila.tipo}</div>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-md border border-line inline-flex items-center justify-center text-ink-3 hover:bg-bg-sunken"><X className="h-4 w-4" /></button>
        </div>
        {/* Totales */}
        <div className="shrink-0 grid grid-cols-4 gap-px bg-line border-b border-line">
          {([['Saldo inicial', fila.inicial, ''], ['Total Debe', fila.debe, 'text-primary'], ['Total Haber', fila.haber, 'text-amber-700 dark:text-amber-400'], ['Saldo final', fila.final, 'text-emerald-700 dark:text-emerald-400']] as const).map(([l, v, cl]) => (
            <div key={l} className="bg-bg-sunken px-4 py-2.5">
              <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4">{l}</div>
              <div className={cn('font-mono text-[13.5px] font-bold tabular-nums', cl)}>{fmtPEN(v)}</div>
            </div>
          ))}
        </div>
        {/* Movimientos · saldo corrido */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? <SkelRows rows={6} /> : (
            <table className="w-full text-[12px]">
              <thead className="bg-bg-sunken border-b border-line sticky top-0">
                <tr className="text-left text-[10px] font-mono uppercase tracking-wider text-ink-4">
                  <th className="px-4 py-2 w-20">Fecha</th><th className="px-3 py-2 w-32">Asiento</th><th className="px-3 py-2 w-28">Doc</th><th className="px-3 py-2">Glosa</th>
                  <th className="px-3 py-2 w-28 text-right">Debe</th><th className="px-3 py-2 w-28 text-right">Haber</th><th className="px-4 py-2 w-28 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {movs.map((m, i) => (
                  <tr key={i} className="hover:bg-bg-sunken/30">
                    <td className="px-4 py-1.5 font-mono text-[10.5px] tabular-nums">{m.fecha.slice(5)}</td>
                    <td className="px-3 py-1.5 font-mono text-[10.5px] text-primary">{m.correlativo}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-ink-4">{m.cuenta !== fila.cuenta ? m.cuenta : ''}</td>
                    <td className="px-3 py-1.5 text-[11.5px] max-w-[240px]"><div className="truncate" title={m.glosa}>{m.glosa}</div>{m.descripcion && <div className="text-[10px] text-ink-4 truncate">{m.descripcion}</div>}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-primary">{m.debe > 0 ? fmtPEN(m.debe) : '—'}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-amber-700 dark:text-amber-400">{m.haber > 0 ? fmtPEN(m.haber) : '—'}</td>
                    <td className="px-4 py-1.5 text-right font-mono tabular-nums font-semibold">{fmtPEN(m.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="shrink-0 border-t border-line px-5 py-2.5 flex justify-end">
          <button onClick={onClose} className="h-8 px-4 rounded-md border border-line text-[12px] hover:bg-bg-sunken">Cerrar</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Bancos y Conciliación ───────────────────────────────────
function BancosTab() {
  const { data, isLoading } = useQuery({ queryKey: ['ctb-conciliacion'], queryFn: () => api.contabilidad.getConciliacion() });
  if (isLoading) return <SkelRows rows={6} />;
  if (!data) return null;
  const cuadra = Math.abs(data.diferencia) < 0.01;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <KpiCtb label="Saldo según libros (101/104/107)" value={fmtPEN(data.saldoContable)} tone="info" sub="asientos registrados" />
        <KpiCtb label="Saldo según tesorería" value={fmtPEN(data.saldoTesoreria)} tone="info" sub="módulo Finanzas · movimientos" />
        {cuadra
          ? <KpiCtb label="Diferencia" value="S/ 0.00" tone="ok" sub="✓ conciliado" />
          : <KpiCtb label="Diferencia" value={fmtPEN(Math.abs(data.diferencia))} tone="bad" sub={data.diferencia > 0 ? 'libros > tesorería' : 'tesorería > libros'} />}
      </div>

      {!cuadra && (
        <div className="rounded-md border border-amber-300/50 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-[11.5px] text-amber-800 dark:text-amber-300 leading-relaxed">
          <b>¿Por qué difieren?</b> Causas típicas: documentos sin contabilizar (genera los asientos del periodo) · movimientos de caja registrados en Finanzas que no corresponden a gastos/valorizaciones (préstamos, transferencias internas → asiento manual) · comisiones bancarias sin registrar. La diferencia se corrige con asientos de ajuste, nunca editando historia.
        </div>
      )}

      {/* Saldos por cuenta bancaria (tesorería) */}
      <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
        <div className="border-b border-line px-4 py-2.5"><h3 className="text-[13px] font-semibold">Cuentas bancarias · saldo tesorería</h3></div>
        <table className="w-full text-[12px]">
          <thead className="bg-bg-sunken border-b border-line">
            <tr className="text-left text-[10px] font-mono uppercase tracking-wider text-ink-4">
              <th className="px-3 py-2">Cuenta</th><th className="px-3 py-2 w-28">Banco</th><th className="px-3 py-2 w-20">Moneda</th>
              <th className="px-3 py-2 w-20 text-right">Movs</th><th className="px-3 py-2 w-32 text-right">Saldo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.cuentas.map((c) => (
              <tr key={c.cuenta.id} className="hover:bg-bg-sunken/30">
                <td className="px-3 py-2"><div className="text-[11.5px] font-medium">{c.cuenta.descripcion ?? c.cuenta.codigo}</div><div className="font-mono text-[10px] text-ink-4">{c.cuenta.codigo}</div></td>
                <td className="px-3 py-2 text-[11px] text-ink-3">{c.cuenta.banco ?? '—'}</td>
                <td className="px-3 py-2"><span className="chip">{c.cuenta.moneda}</span></td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-3">{c.movimientos}</td>
                <td className={cn('px-3 py-2 text-right font-mono tabular-nums font-semibold', c.saldoTesoreria < 0 && 'text-destructive')}>{fmtPEN(c.saldoTesoreria)}</td>
              </tr>
            ))}
            {data.cuentas.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-[12px] text-ink-3">Sin cuentas bancarias · créalas en Finanzas → Tesorería</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-dashed border-line-strong bg-bg-elev p-5 text-center">
        <div className="text-[13px] font-semibold">Conciliación contra extracto bancario</div>
        <div className="text-[11.5px] text-ink-3 mt-1">Importar estado de cuenta (Excel/CSV del banco) → matching automático con movimientos → ajustes con un click</div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-ink-4 mt-2">Próximamente</div>
      </div>

      <p className="text-[10.5px] text-ink-4">Tip: crea divisionarias por banco (ej. 10411 BCP MN, 10412 BCP ME) en el Plan Contable para conciliar cuenta por cuenta.</p>
    </div>
  );
}

// ─── F4.5-PREP · Preparación del flip · readiness GO/NO-GO + dry-run + playbook (read-only · NO ejecuta) ──
const READINESS_TONE = { GO: 'emerald', CONDITIONAL: 'amber', NO_GO: 'red' } as const;
function FlipPrepPanel({ periodo }: { periodo: string }) {
  const [cutover, setCutover] = useState(`${periodo}-01`);
  const [pbOpen, setPbOpen] = useState(false);
  const { data: rd } = useQuery({ queryKey: ['ctb-readiness', periodo], queryFn: () => api.contabilidad.cutoverReadiness(periodo) });
  const dry = useMutation({ mutationFn: (c: string) => api.contabilidad.cutoverDryRun(periodo, c), onError: (e) => alert(`Dry-run falló: ${(e as Error).message}`) });
  const pb = useMutation({ mutationFn: (c: string) => api.contabilidad.cutoverPlaybook(periodo, c), onError: (e) => alert(`Playbook falló: ${(e as Error).message}`) });
  const evaluar = () => { dry.mutate(cutover); pb.mutate(cutover); setPbOpen(true); };
  const tone = rd ? READINESS_TONE[rd.resultado] : 'amber';
  const d = dry.data;
  const nivelTone = d?.recomendacion.nivel === 'seguro' ? 'text-emerald-600' : d?.recomendacion.nivel === 'imposible' ? 'text-destructive' : 'text-amber-600';
  return (
    <div className="rounded-lg border border-violet-300/40 bg-violet-50/40 dark:bg-violet-950/20 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <Scale className="h-4 w-4 text-violet-600" />
        <h3 className="text-[13px] font-semibold">Preparación del flip (F4.5)</h3>
        <span className="text-[10.5px] text-ink-4">read-only · NO ejecuta · F4.5 bloqueado hasta GO explícito</span>
      </div>
      <div className="px-4 py-3 space-y-3">
        {/* Readiness GO/NO-GO */}
        {rd && (
          <div className={cn('rounded-md border px-3 py-2',
            tone === 'emerald' && 'border-emerald-300/50 bg-emerald-50 dark:bg-emerald-950/30',
            tone === 'amber' && 'border-amber-300/50 bg-amber-50 dark:bg-amber-950/30',
            tone === 'red' && 'border-red-400/60 bg-red-50 dark:bg-red-950/30')}>
            <div className="text-[13px] font-bold mb-1">Readiness: <span className={cn(tone === 'emerald' && 'text-emerald-700 dark:text-emerald-400', tone === 'amber' && 'text-amber-700 dark:text-amber-400', tone === 'red' && 'text-red-700 dark:text-red-400')}>{rd.resultado}</span></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
              {rd.criterios.map((c) => (
                <div key={c.criterio} className="flex items-baseline gap-1.5 text-[10.5px]">
                  <span className={cn('font-mono', c.ok ? 'text-emerald-600' : c.hard ? 'text-destructive font-bold' : 'text-amber-600')}>{c.ok ? '✓' : c.hard ? '✗' : '!'}</span>
                  <span className="font-mono text-ink-3">{c.criterio}</span>
                  <span className="text-ink-4 truncate">· {c.detalle}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Dry-run */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11.5px] text-ink-3">Dry-run del flip con cutover:</span>
          <input type="date" value={cutover} onChange={(e) => setCutover(e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1 text-[12px] font-mono" />
          <button onClick={evaluar} disabled={dry.isPending || pb.isPending}
            className="rounded-md border border-violet-400/50 text-violet-700 dark:text-violet-300 px-2.5 py-1 text-[11px] font-medium hover:bg-violet-500/10 disabled:opacity-50">
            {dry.isPending ? 'Evaluando…' : 'Evaluar flip (dry-run)'}
          </button>
        </div>
        {d && (
          <div className="space-y-2">
            <div className="text-[12px]">Recomendación: <b className={nivelTone}>{d.recomendacion.nivel.toUpperCase()}</b> · riesgo operacional: <b>{d.riesgoOperacional}</b></div>
            {d.recomendacion.razones.map((r, i) => <div key={i} className="text-[10.5px] text-ink-4">· {r}</div>)}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10.5px] font-mono">
              <div className="rounded border border-line px-2 py-1">legacy a anular: <b className={d.resumenOwnership.legacyCajaAsientosAAnular ? 'text-destructive' : 'text-emerald-600'}>{d.resumenOwnership.legacyCajaAsientosAAnular}</b></div>
              <div className="rounded border border-line px-2 py-1">movs toman 104x: <b>{d.resumenOwnership.movimientosQueTomanOwnership}</b></div>
              <div className="rounded border border-line px-2 py-1">movs sin cuenta: <b className={d.resumenOwnership.movimientosSinCuenta104x ? 'text-amber-600' : ''}>{d.resumenOwnership.movimientosSinCuenta104x}</b></div>
              <div className="rounded border border-line px-2 py-1">huérfanos: <b className={d.resumenOwnership.docsHuerfanos ? 'text-destructive' : 'text-emerald-600'}>{d.resumenOwnership.docsHuerfanos}</b></div>
            </div>
            <div>
              <div className="text-[11px] font-semibold mt-1">Smoke post-flip (proyectado)</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
                {d.postFlipSmoke.map((c) => (
                  <div key={c.check} className="flex items-baseline gap-1.5 text-[10.5px]">
                    <span className={cn('font-mono', c.ok ? 'text-emerald-600' : 'text-destructive font-bold')}>{c.ok ? '✓' : '✗'}</span>
                    <span className="font-mono text-ink-3">{c.check}</span><span className="text-ink-4 truncate">· {c.detalle}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {/* Playbook */}
        {pb.data && (
          <div className="rounded-md border border-line">
            <button onClick={() => setPbOpen((o) => !o)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-sunken/40">
              <span className="text-[12px] font-semibold">Playbook operativo</span>
              <span className="text-[10px] text-ink-4">{pb.data.duracionEstimada} · {pb.data.ejecutor}</span>
              {pbOpen ? <ChevronDown className="h-4 w-4 ml-auto text-ink-4" /> : <ChevronRight className="h-4 w-4 ml-auto text-ink-4" />}
            </button>
            {pbOpen && (
              <div className="border-t border-line px-3 py-2 space-y-2 text-[10.5px]">
                {pb.data.procedimiento.map((f, i) => (
                  <div key={i}><b>{f.fase}</b><ol className="list-decimal pl-4 text-ink-3">{f.pasos.map((p, j) => <li key={j}>{p}</li>)}</ol></div>
                ))}
                <div className="rounded border border-red-400/40 bg-red-50/50 dark:bg-red-950/20 px-2 py-1.5">
                  <b className="text-destructive">ABORT inmediato:</b>
                  <ul className="text-ink-3">{pb.data.abortConditions.hardStops.map((h, i) => <li key={i}>· {h}</li>)}</ul>
                  <div className="mt-1 text-ink-4">rojo: {pb.data.abortConditions.ventanasTolerancia.rojo}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── F4.6 · WATCHDOG · semáforo global de readiness del flip (dashboard operacional) ──
const SEMAFORO = {
  verde: { box: 'border-emerald-300/60 bg-emerald-50 dark:bg-emerald-950/30', dot: 'bg-emerald-500', txt: 'text-emerald-700 dark:text-emerald-400', label: 'VERDE' },
  amarillo: { box: 'border-amber-300/60 bg-amber-50 dark:bg-amber-950/30', dot: 'bg-amber-500', txt: 'text-amber-700 dark:text-amber-400', label: 'AMARILLO' },
  rojo: { box: 'border-red-400/60 bg-red-50 dark:bg-red-950/30', dot: 'bg-red-500', txt: 'text-red-700 dark:text-red-400', label: 'ROJO' },
} as const;
function WatchdogPanel({ periodo }: { periodo: string }) {
  const { data } = useQuery({ queryKey: ['ctb-watchdog', periodo], queryFn: () => api.contabilidad.getWatchdog(periodo) });
  const smoke = useMutation({ mutationFn: () => api.contabilidad.runSmoke(periodo), onError: (e) => alert(`Smoke falló: ${(e as Error).message}`) });
  if (!data) return null;
  const s = SEMAFORO[data.estadoGlobal];
  const tendIco = (t: string) => (t === 'mejorando' ? '↘ mejorando' : t === 'empeorando' ? '↗ EMPEORANDO' : t === 'estable' ? '→ estable' : '· sin datos');
  return (
    <div className={cn('rounded-lg border-2 px-4 py-3.5', s.box)}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className={cn('h-3.5 w-3.5 rounded-full animate-pulse', s.dot)} />
          <Activity className={cn('h-5 w-5', s.txt)} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold">Estado transición 104x</span>
              <span className={cn('text-[12px] font-bold font-mono', s.txt)}>{s.label}</span>
            </div>
            <span className="text-[11px] text-ink-4">periodo {periodo} · riesgo de flip: <b className={s.txt}>{data.riesgoFlip.nivel.toUpperCase()}</b></span>
          </div>
        </div>
        <button onClick={() => smoke.mutate()} disabled={smoke.isPending}
          className="rounded-md border border-line bg-bg px-2.5 py-1 text-[11px] font-medium hover:bg-bg-sunken disabled:opacity-50">
          {smoke.isPending ? 'Corriendo smoke…' : smoke.data ? `Smoke ${smoke.data.pasaron}/${smoke.data.total}${smoke.data.ok ? ' ✓' : ' ✗'}` : 'Correr smoke'}
        </button>
      </div>
      {data.razones.length > 0 && (
        <ul className="mt-2.5 space-y-0.5">
          {data.razones.map((r, i) => <li key={i} className="text-[11.5px] text-ink-2">• {r}</li>)}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] font-mono text-ink-4">
        <span>diff: {tendIco(data.tendenciaDiff)}</span>
        <span>ownership: {tendIco(data.tendenciaOwnership)}</span>
        <span>movSinCuenta: {tendIco(data.tendenciaMovSinCuenta)}</span>
        <span>invariantes: {data.invariantes.ok ? '✓' : `✗ ${data.invariantes.rotos.join(',')}`}</span>
        <span>snapshots: {data.snapshotsCount}{data.snapshotsFaltantes ? ' (falta hoy)' : ''}</span>
        {data.cerradoConCambios && <span className="text-destructive font-bold">⚠ cerrado-con-cambios</span>}
      </div>
      {data.recomendaciones.length > 0 && (
        <div className="mt-2 border-t border-line/60 pt-2 space-y-0.5">
          {data.recomendaciones.map((r, i) => <div key={i} className="text-[11px] text-ink-3">→ {r}</div>)}
        </div>
      )}
    </div>
  );
}

// ─── F4.6 · Plan de rollback (read-only · cómo deshacer cada paso) ──
function RollbackPanel() {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ['ctb-rollback'], queryFn: () => api.contabilidad.getRollbackPlan(), enabled: open });
  return (
    <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-bg-sunken/40">
        <RotateCcw className="h-4 w-4 text-ink-3" />
        <h3 className="text-[13px] font-semibold">Plan de rollback</h3>
        <span className="text-[10.5px] text-ink-4">read-only · cómo deshacer cada paso de la transición</span>
        {open ? <ChevronDown className="h-4 w-4 ml-auto text-ink-4" /> : <ChevronRight className="h-4 w-4 ml-auto text-ink-4" />}
      </button>
      {open && data && (
        <div className="border-t border-line px-4 py-3 space-y-3 text-[11.5px]">
          <div className="font-mono text-[10.5px] text-ink-4">
            estado actual: cutover={data.estadoActual.cutover ?? 'null'} · parallel={String(data.estadoActual.parallel)} · {data.estadoActual.flipeado ? 'FLIPEADO' : 'sin flipear'}
          </div>
          {data.escenarios.map((e, i) => (
            <div key={i} className="rounded-md border border-line bg-bg-sunken/30 px-3 py-2">
              <div className="font-semibold">{e.titulo} <span className="text-[10px] font-normal text-ink-4">· {e.reversible ? 'reversible' : 'irreversible'} · audit: {e.auditado}</span></div>
              <div className="text-[10.5px] text-ink-4 italic mb-1">{e.cuando}</div>
              <ol className="list-decimal pl-4 space-y-0.5 text-ink-2">{e.pasos.map((p, j) => <li key={j}>{p}</li>)}</ol>
            </div>
          ))}
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <div className="font-semibold text-emerald-700 dark:text-emerald-400 mb-1">NO revertir</div>
              <ul className="space-y-0.5 text-ink-3">{data.noRevertir.map((x, i) => <li key={i}>· {x}</li>)}</ul>
            </div>
            <div>
              <div className="font-semibold text-destructive mb-1">Riesgos</div>
              <ul className="space-y-0.5 text-ink-3">{data.riesgos.map((x, i) => <li key={i}>· {x}</li>)}</ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── F4.1 · Panel de transición de ownership 104x (estado parallel/cutover + control admin) ──
function TransicionPanel() {
  const qc = useQueryClient();
  const isAdmin = useAuthStore((s) => s.can)('contabilidad', 'edicion');
  const { data } = useQuery({ queryKey: ['ctb-config'], queryFn: () => api.contabilidad.getConfig() });
  const mut = useMutation({
    mutationFn: (body: { cutover?: string | null; parallel?: boolean; comentario?: string }) => api.contabilidad.updateConfig(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ctb-config'] }); qc.invalidateQueries({ queryKey: ['ctb-sombra'] }); },
    onError: (e) => alert(`No se pudo actualizar la config: ${(e as Error).message}`),
  });
  if (!data) return null;
  const flipped = data.cutover !== null;
  const setCutover = () => {
    const v = window.prompt('Fecha de CUTOVER 104x (YYYY-MM-DD) · vacío = null (inerte, legacy manda):', data.cutover ?? '');
    if (v === null) return; // canceló
    const val = v.trim();
    if (val !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(val)) { alert('Formato inválido · usa YYYY-MM-DD o vacío'); return; }
    if (val !== '' && !window.confirm(`Vas a fijar el CUTOVER en ${val}. Desde esa fecha el 104x lo posee MOVIMIENTOS y legacy queda congelado. Reversible (puedes volver a null). ¿Confirmar?`)) return;
    mut.mutate({ cutover: val === '' ? null : val, comentario: `set cutover=${val || 'null'} desde UI` });
  };
  return (
    <div className={cn('rounded-lg border px-4 py-3', flipped ? 'border-violet-300/50 bg-violet-50 dark:bg-violet-950/30' : 'border-line bg-bg-elev')}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <Landmark className="h-4 w-4 text-ink-3" />
          <span className="text-[12px] font-semibold">Transición ownership 104x</span>
          <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold', data.parallel ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'bg-bg-sunken text-ink-4')}>
            PARALLEL {data.parallel ? 'ON' : 'OFF'}
          </span>
          <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold', flipped ? 'bg-violet-500/15 text-violet-700 dark:text-violet-400' : 'bg-bg-sunken text-ink-4')}>
            CUTOVER {data.cutover ?? 'null (inerte · legacy manda)'}
          </span>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => mut.mutate({ parallel: !data.parallel, comentario: `parallel=${!data.parallel} desde UI` })}
              disabled={mut.isPending}
              className="rounded-md border border-line px-2.5 py-1 text-[11px] font-medium hover:bg-bg-sunken disabled:opacity-50">
              {data.parallel ? 'Desactivar' : 'Activar'} PARALLEL
            </button>
            <button
              onClick={setCutover}
              disabled={mut.isPending}
              className="rounded-md border border-violet-400/50 text-violet-700 dark:text-violet-300 px-2.5 py-1 text-[11px] font-medium hover:bg-violet-500/10 disabled:opacity-50">
              Fijar CUTOVER…
            </button>
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[10.5px] text-ink-4">
        {data.parallel
          ? 'Vigilancia formal activa: el pre-cierre bloquea con diffs/gaps (override solo con motivo auditado). No mueve ownership.'
          : 'Vigilancia off: el pre-cierre solo informa. Activa PARALLEL para endurecer antes del cutover.'}
        {data.meta.parallel?.actualizadoPor && <span className="ml-1 font-mono">· últ. cambio: {data.meta.parallel.actualizadoPor}</span>}
      </p>
    </div>
  );
}

// ─── F4.4 · Invariantes (smoke de integridad · warnings visibles · anti-regresión) ──
function InvariantesPanel({ periodo }: { periodo: string }) {
  const { data } = useQuery({ queryKey: ['ctb-invariantes', periodo], queryFn: () => api.contabilidad.getInvariantes(periodo) });
  if (!data) return null;
  return (
    <div className={cn('rounded-lg border px-4 py-3', data.ok ? 'border-emerald-300/50 bg-emerald-50 dark:bg-emerald-950/30' : 'border-red-400/60 bg-red-50 dark:bg-red-950/30')}>
      <div className="flex items-center gap-2 mb-1.5">
        <Scale className={cn('h-4 w-4', data.ok ? 'text-emerald-600' : 'text-destructive')} />
        <span className="text-[12px] font-semibold">{data.ok ? '✓ Invariantes OK' : '⚠ INVARIANTE ROTO — revisar'}</span>
        <span className="text-[10.5px] text-ink-4">· integridad estructural del 104x (read-only)</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
        {data.checks.map((c) => (
          <div key={c.check} className="flex items-baseline gap-1.5 text-[11px]">
            <span className={cn('font-mono', c.ok ? 'text-emerald-600' : 'text-destructive font-bold')}>{c.ok ? '✓' : '✗'}</span>
            <span className="font-mono text-ink-3">{c.check}</span>
            <span className="text-ink-4 truncate">· {c.detalle}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── F4.3 · Simulador de cutover (read-only · "¿qué pasaría si el cutover fuera X?") ──
function SimuladorPanel({ periodo }: { periodo: string }) {
  const [fecha, setFecha] = useState(`${periodo}-01`);
  const [sim, setSim] = useState<import('@/lib/api.js').CutoverSimulacion | null>(null);
  const m = useMutation({
    mutationFn: (f: string) => api.contabilidad.simularCutover(periodo, f),
    onSuccess: (d) => setSim(d),
    onError: (e) => alert(`No se pudo simular: ${(e as Error).message}`),
  });
  const tone = sim?.recomendacion.nivel === 'seguro' ? 'emerald' : sim?.recomendacion.nivel === 'riesgoso' ? 'amber' : 'red';
  return (
    <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <Scale className="h-4 w-4 text-ink-3" />
        <h3 className="text-[13px] font-semibold">Simular CUTOVER</h3>
        <span className="text-[10.5px] text-ink-4">read-only · no mueve config ni asientos</span>
      </div>
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11.5px] text-ink-3">Si el cutover fuera:</span>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
            className="rounded-md border border-line bg-bg px-2 py-1 text-[12px] font-mono" />
          <button onClick={() => m.mutate(fecha)} disabled={m.isPending}
            className="rounded-md border border-line px-2.5 py-1 text-[11px] font-medium hover:bg-bg-sunken disabled:opacity-50">
            {m.isPending ? 'Simulando…' : 'Simular'}
          </button>
        </div>
        {sim && (
          <div className="space-y-2">
            <div className={cn('rounded-md border px-3 py-2 text-[11.5px]',
              tone === 'emerald' && 'border-emerald-300/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300',
              tone === 'amber' && 'border-amber-300/50 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300',
              tone === 'red' && 'border-red-400/60 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300')}>
              <b className="uppercase">{sim.recomendacion.nivel}</b> · cutover {sim.cutoverSimulado} · {sim.recomendacion.motivo}
            </div>
            <div className="flex gap-4 text-[11px] font-mono text-ink-3 flex-wrap">
              <span>diff: <b className={Math.abs(sim.diff) < 0.05 ? 'text-emerald-600' : 'text-destructive'}>{fmtPEN(sim.diff)}</b></span>
              <span>huérfanos: <b className={sim.docsAfectados.huerfanos.length ? 'text-destructive' : ''}>{sim.docsAfectados.huerfanos.length}</b></span>
              <span>conflictos: <b className={sim.docsAfectados.conflictos.length ? 'text-destructive' : ''}>{sim.docsAfectados.conflictos.length}</b></span>
              <span>esperados: {sim.docsAfectados.esperados.length}</span>
              <span>ownership±: <b className={sim.resumen.ownershipAmbiguo ? 'text-destructive' : ''}>{sim.resumen.ownershipAmbiguo}</b></span>
            </div>
            {sim.docsAfectados.huerfanos.length > 0 && (
              <div className="text-[10.5px] text-destructive">Huérfanos (se perdería el evento): <span className="font-mono">{sim.docsAfectados.huerfanos.map((d) => d.doc).join(', ')}</span></div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── F4.2 · Tendencia histórica de estabilidad pre-cutover (snapshots · read-only) ──
function TendenciaPanel({ periodo }: { periodo: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['ctb-trend', periodo], queryFn: () => api.contabilidad.getCutoverTrend(periodo) });
  const cap = useMutation({
    mutationFn: () => api.contabilidad.captureCutoverSnapshot(periodo),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ctb-trend', periodo] }); },
    onError: (e) => alert(`No se pudo capturar: ${(e as Error).message}`),
  });
  const snaps = data?.snapshots ?? [];
  return (
    <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-ink-3" />
          <h3 className="text-[13px] font-semibold">Tendencia de estabilidad · {periodo}</h3>
          <span className="text-[10.5px] text-ink-4">({snaps.length} snapshot{snaps.length === 1 ? '' : 's'} · 1/día bajo PARALLEL)</span>
        </div>
        <button onClick={() => cap.mutate()} disabled={cap.isPending}
          className="rounded-md border border-line px-2.5 py-1 text-[11px] font-medium hover:bg-bg-sunken disabled:opacity-50">
          {cap.isPending ? 'Capturando…' : 'Capturar ahora'}
        </button>
      </div>
      {snaps.length === 0 ? (
        <div className="px-4 py-6 text-center text-[12px] text-ink-3">Sin snapshots aún. Se capturan automáticamente al ver Sombra/pre-cierre con PARALLEL activo, o pulsa «Capturar ahora».</div>
      ) : (
        <table className="w-full text-[12px]">
          <thead className="bg-bg-sunken border-b border-line">
            <tr className="text-left text-[10px] font-mono uppercase tracking-wider text-ink-4">
              <th className="px-3 py-2">Fecha</th><th className="px-3 py-2 text-right">Diff</th><th className="px-3 py-2 text-right">realDiffs</th>
              <th className="px-3 py-2 text-right">ownership±</th><th className="px-3 py-2 text-right">mov s/cuenta</th><th className="px-3 py-2 text-right">concil pend</th><th className="px-3 py-2 text-center">listo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {snaps.map((s) => {
              const ok = s.realDiffsCount === 0 && s.ownershipAmbiguo === 0;
              return (
                <tr key={s.id} className="hover:bg-bg-sunken/30">
                  <td className="px-3 py-1.5 font-mono text-[11px]">{s.fechaSnapshot}</td>
                  <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', Math.abs(Number(s.diff)) < 0.05 ? 'text-emerald-600' : 'text-destructive')}>{fmtPEN(Number(s.diff))}</td>
                  <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', s.realDiffsCount > 0 && 'text-destructive font-semibold')}>{s.realDiffsCount}</td>
                  <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', s.ownershipAmbiguo > 0 && 'text-destructive font-semibold')}>{s.ownershipAmbiguo}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{s.movimientosSinCuenta}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{s.conciliacionPendiente}</td>
                  <td className="px-3 py-1.5 text-center">{s.listoParaFlip ? '✓' : ok ? '~' : '✗'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── F3-B · Reporte Sombra 104x (legacy vs movimientos · readiness del flip CUTOVER) ──
function SombraTab({ periodo }: { periodo: string }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ['ctb-sombra', periodo], queryFn: () => api.contabilidad.getReporteSombra(periodo) });
  if (isLoading) return <SkelRows rows={6} />;
  if (isError || !data) return <div className="rounded-md border border-line bg-bg-elev px-4 py-8 text-center text-[12px] text-ink-3">No se pudo cargar el reporte sombra.</div>;
  const { oficial, meta, resumen, config } = data;
  const cuadra = Math.abs(oficial.diff) < 0.05;
  return (
    <div className="space-y-4">
      {/* F4.6 · WATCHDOG · semáforo global "¿listos para flip?" (dashboard operacional) */}
      <WatchdogPanel periodo={periodo} />
      {/* F4.5-PREP · readiness GO/NO-GO + dry-run + playbook del flip (read-only · NO ejecuta) */}
      <FlipPrepPanel periodo={periodo} />
      {/* F4.1 · estado + control de la transición de ownership 104x */}
      <TransicionPanel />
      {/* F4.4 · invariantes (anti-regresión · warnings visibles) */}
      <InvariantesPanel periodo={periodo} />
      {/* F4.3 · simulador de cutover (read-only) */}
      <SimuladorPanel periodo={periodo} />
      {/* F4.2 · tendencia histórica de estabilidad pre-cutover */}
      <TendenciaPanel periodo={periodo} />
      {/* F4.6 · plan de rollback (read-only) */}
      <RollbackPanel />
      {/* Veredicto del flip */}
      <div className={cn('rounded-lg border px-4 py-3 flex items-start gap-3',
        resumen.listoParaFlip ? 'border-emerald-300/50 bg-emerald-50 dark:bg-emerald-950/30' : 'border-amber-300/50 bg-amber-50 dark:bg-amber-950/30')}>
        <Scale className={cn('h-5 w-5 mt-0.5 shrink-0', resumen.listoParaFlip ? 'text-emerald-600' : 'text-amber-600')} />
        <div className="text-[12px] leading-relaxed">
          <b>{resumen.listoParaFlip ? '✓ Listo para flipear el CUTOVER' : 'Aún NO listo para flipear'}</b> · periodo {periodo}.
          {resumen.listoParaFlip
            ? ' Legacy y movimientos cuadran a nivel documento, sin diferencias reales ni gaps de config. Confirmar con varios ciclos en paralelo antes de mover el cutover.'
            : ` Pendientes: ${resumen.realDiffsCount} diferencias reales · ${resumen.ownershipAmbiguo} doble-ownership · ${resumen.cuentasSin104x} cuentas sin 104x · ${resumen.movimientosSinCuenta} movimientos sin cuenta.`}
          <span className="block mt-1 text-[10.5px] text-ink-4 font-mono">
            cutover: {meta.cutover ?? 'null (inerte)'} · eval: {meta.evalCutover} · parallelRun: {String(meta.parallelRun)} · este reporte es READ-ONLY (no escribe ni mueve el cutover)
          </span>
        </div>
      </div>

      {/* Comparación oficial (neto, scope legacy = doc-linked) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <KpiCtb label="Neto 104x · legacy (1041)" value={fmtPEN(oficial.legacyNeto)} tone="info" sub="asientos pago_oc / cobro_valo del periodo" />
        <KpiCtb label="Neto 104x · movimientos" value={fmtPEN(oficial.movimientosNeto)} tone="info" sub="recálculo pasada · solo doc-linked (scope legacy)" />
        {cuadra
          ? <KpiCtb label="Diferencia" value="S/ 0.00" tone="ok" sub="✓ cuadra (±0.05)" />
          : <KpiCtb label="Diferencia" value={fmtPEN(oficial.diff)} tone="bad" sub="legacy − movimientos" />}
      </div>
      <p className="text-[10.5px] text-ink-4">
        Comparación a nivel <b>scope legacy</b> (solo OC/valos que el motor legacy también asienta). Flujos solo-movimiento (aportes, préstamos, transferencias, gastos en efectivo) suman
        <b> {fmtPEN(meta.movimientosNetoTotal)}</b> en 104x y son legítimos — no entran al diff oficial. Legacy mete todo el banco en 1041 (no distingue cuenta).
      </p>

      {/* Diferencias REALES (bloquean) */}
      <DiffTable
        title="Diferencias reales (bloquean el flip)"
        tone="bad"
        rows={data.realDiffs}
        empty="✓ Sin diferencias reales — cada evento de caja legacy tiene su movimiento espejo y cuadra."
      />

      {/* Config gaps (bloquean) */}
      {(config.cuentasSin104x.length > 0 || config.movimientosSinCuenta.length > 0 || config.naturalezaSinCuenta.length > 0 || config.docLinkFaltante.length > 0) && (
        <div className="rounded-lg border border-amber-300/50 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-[11.5px] text-amber-800 dark:text-amber-300 space-y-1.5">
          <b>Configuración pendiente (bloquea el flip):</b>
          {config.cuentasSin104x.length > 0 && <div>· Cuentas bancarias sin 104x: <span className="font-mono">{config.cuentasSin104x.join(', ')}</span> → asigna la subcuenta en Finanzas → Tesorería.</div>}
          {config.movimientosSinCuenta.length > 0 && <div>· Movimientos sin cuenta bancaria asignada (captura parcial): <span className="font-mono">{config.movimientosSinCuenta.join(', ')}</span> → edita el movimiento y asígnale su cuenta.</div>}
          {config.naturalezaSinCuenta.length > 0 && <div>· Movimientos sueltos sin cuenta inferible (naturaleza): <span className="font-mono">{config.naturalezaSinCuenta.join(', ')}</span>.</div>}
          {config.docLinkFaltante.length > 0 && <div>· Movimientos pago/cobro sin documento enlazado: <span className="font-mono">{config.docLinkFaltante.join(', ')}</span>.</div>}
        </div>
      )}

      {/* Temporales (informan, no bloquean) */}
      {data.temporales.length > 0 && (
        <DiffTable title="Temporales (informan · no bloquean)" tone="info" rows={data.temporales} empty="" />
      )}

      {/* Desglose por cuenta 104x (informativo) */}
      <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
        <div className="border-b border-line px-4 py-2.5"><h3 className="text-[13px] font-semibold">Movimientos por cuenta 104x · periodo (informativo)</h3></div>
        <table className="w-full text-[12px]">
          <thead className="bg-bg-sunken border-b border-line">
            <tr className="text-left text-[10px] font-mono uppercase tracking-wider text-ink-4">
              <th className="px-3 py-2">Cuenta 104x</th><th className="px-3 py-2 w-32 text-right">Ingresos</th><th className="px-3 py-2 w-32 text-right">Egresos</th><th className="px-3 py-2 w-32 text-right">Neto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.porCuenta104x.map((c) => (
              <tr key={c.cuenta} className="hover:bg-bg-sunken/30">
                <td className="px-3 py-2 font-mono text-[11.5px]">{c.cuenta}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-600">{fmtPEN(c.ingresos)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-destructive">{fmtPEN(c.egresos)}</td>
                <td className={cn('px-3 py-2 text-right font-mono tabular-nums font-semibold', c.neto < 0 && 'text-destructive')}>{fmtPEN(c.neto)}</td>
              </tr>
            ))}
            {data.porCuenta104x.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-[12px] text-ink-3">Sin movimientos con 104x en el periodo.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DiffTable({ title, tone, rows, empty }: { title: string; tone: 'bad' | 'info'; rows: SombraDiff[]; empty: string }) {
  if (rows.length === 0) {
    if (!empty) return null;
    return <div className="rounded-md border border-emerald-300/40 bg-emerald-50/60 dark:bg-emerald-950/20 px-4 py-2.5 text-[11.5px] text-emerald-700 dark:text-emerald-400">{empty}</div>;
  }
  return (
    <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
      <div className={cn('border-b border-line px-4 py-2.5 flex items-center justify-between', tone === 'bad' && 'bg-red-50/60 dark:bg-red-950/20')}>
        <h3 className="text-[13px] font-semibold">{title}</h3><span className="text-[11px] text-ink-4">{rows.length}</span>
      </div>
      <table className="w-full text-[12px]">
        <thead className="bg-bg-sunken border-b border-line">
          <tr className="text-left text-[10px] font-mono uppercase tracking-wider text-ink-4">
            <th className="px-3 py-2 w-40">Tipo</th><th className="px-3 py-2">Documento</th>
            <th className="px-3 py-2 w-28 text-right">Legacy</th><th className="px-3 py-2 w-28 text-right">Movimiento</th><th className="px-3 py-2">Detalle</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.docId + r.tipo} className="hover:bg-bg-sunken/30">
              <td className="px-3 py-2"><span className={cn('chip', tone === 'bad' && 'text-destructive')}>{r.tipo}</span></td>
              <td className="px-3 py-2 text-[11.5px]">{r.doc}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-3">{fmtPEN(r.legacyMonto)}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-3">{fmtPEN(r.movMonto)}</td>
              <td className="px-3 py-2 text-[11px] text-ink-3">{r.detalle}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── H2.3 · Auditoría (audit_log visible · read-only) ──────────
const ACCIONES = ['', 'create', 'anular', 'hard_delete', 'delete', 'pago_oc', 'cobro_valo', 'update_104x', 'generar', 'cerrar_periodo', 'reabrir_periodo'];
function AuditoriaTab({ periodo }: { periodo: string }) {
  const [scope, setScope] = useState<'periodo' | 'all'>('periodo');
  const [accion, setAccion] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['ctb-audit', periodo, scope, accion],
    queryFn: () => api.contabilidad.getAuditLog({ periodo: scope === 'periodo' ? periodo : undefined, action: accion || undefined }),
  });
  const eventos = data?.eventos ?? [];
  const resumen = (e: AuditEvento) => {
    const c = e.changes;
    if (c?.motivo) return `motivo: ${c.motivo}`;
    const a = c?.after as Record<string, unknown> | undefined;
    if (a) return Object.entries(a).slice(0, 3).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v).slice(0, 30) : String(v)}`).join(' · ');
    return '—';
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-line overflow-hidden text-[12px]">
          <button onClick={() => setScope('periodo')} className={cn('px-3 py-1.5', scope === 'periodo' ? 'bg-primary text-primary-foreground' : 'hover:bg-bg-sunken')}>Periodo {periodo}</button>
          <button onClick={() => setScope('all')} className={cn('px-3 py-1.5 border-l border-line', scope === 'all' ? 'bg-primary text-primary-foreground' : 'hover:bg-bg-sunken')}>Todo</button>
        </div>
        <select value={accion} onChange={(e) => setAccion(e.target.value)} className="h-8 px-2.5 rounded-md border border-line bg-bg-elev text-[12px]">
          {ACCIONES.map((a) => <option key={a} value={a}>{a || 'Todas las acciones'}</option>)}
        </select>
        <span className="text-[11px] text-ink-4">{eventos.length} eventos · trazabilidad usuario → movimiento → asiento → cierre</span>
      </div>
      <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
        {isLoading ? <SkelRows rows={8} /> : (
          <table className="w-full text-[12px]">
            <thead className="bg-bg-sunken border-b border-line">
              <tr className="text-left text-[10px] font-mono uppercase tracking-wider text-ink-4">
                <th className="px-3 py-2 w-36">Fecha</th><th className="px-3 py-2 w-40">Actor</th><th className="px-3 py-2 w-32">Acción</th>
                <th className="px-3 py-2 w-28">Entidad</th><th className="px-3 py-2">Resumen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {eventos.map((e) => (
                <tr key={e.id} className="hover:bg-bg-sunken/30">
                  <td className="px-3 py-2 font-mono text-[10.5px] text-ink-3">{new Date(e.createdAt).toLocaleString('es-PE')}</td>
                  <td className="px-3 py-2 text-[11px]">{e.userNombres ?? e.userEmail ?? <span className="text-ink-4">sistema</span>}</td>
                  <td className="px-3 py-2"><span className={cn('chip', /anular|delete/.test(e.action) && 'text-destructive', /cerrar|reabrir/.test(e.action) && 'text-amber-600')}>{e.action}</span></td>
                  <td className="px-3 py-2 text-[11px] text-ink-3">{e.entityType ?? '—'}</td>
                  <td className="px-3 py-2 text-[11px] text-ink-3 max-w-[360px] truncate" title={resumen(e)}>{resumen(e)}</td>
                </tr>
              ))}
              {eventos.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-[12px] text-ink-3">Sin eventos de auditoría {scope === 'periodo' ? `en ${periodo}` : ''}.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-[10.5px] text-ink-4">Read-only · cada mutación contable/caja (crear, anular, pagar, cobrar, cerrar, reabrir, cambiar 104x) deja rastro inmutable con actor, antes/después y motivo.</p>
    </div>
  );
}

// ─── Fiscal ──────────────────────────────────────────────────
function FiscalTab({ periodo }: { periodo: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['ctb-fiscal', periodo], queryFn: () => api.contabilidad.getFiscal(periodo) });
  if (isLoading) return <SkelRows rows={6} />;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-line bg-bg-elev p-4">
          <h3 className="text-[13px] font-semibold mb-3">IGV · {periodo}</h3>
          <div className="space-y-2 text-[12.5px]">
            <Row k="Débito fiscal (ventas)" v={fmtPEN(data.igv.debito)} />
            <Row k="Crédito fiscal (compras)" v={`− ${fmtPEN(data.igv.credito)}`} />
            <div className="border-t border-line pt-2">
              {data.igv.aPagar > 0
                ? <Row k="IGV a pagar" v={fmtPEN(data.igv.aPagar)} bold tone="warn" />
                : <Row k="Saldo a favor" v={fmtPEN(data.igv.saldoFavor)} bold tone="ok" />}
            </div>
          </div>
          <p className="text-[10.5px] text-ink-4 mt-3">Calculado de los asientos registrados del periodo (cuenta 40111). Genera los asientos automáticos primero.</p>
        </div>
        <div className="rounded-lg border border-line bg-bg-elev p-4">
          <h3 className="text-[13px] font-semibold mb-3">Renta · pago a cuenta · {periodo}</h3>
          <div className="space-y-2 text-[12.5px]">
            <Row k="Ingresos netos devengados (70x)" v={fmtPEN(data.renta.ingresosNetos)} />
            <Row k="Tasa" v="1%" />
            <div className="border-t border-line pt-2">
              <Row k="Pago a cuenta" v={fmtPEN(data.renta.pagoCuenta)} bold tone="warn" />
            </div>
          </div>
          <p className="text-[10.5px] text-ink-4 mt-3">{data.renta.regimen} · al superar 300 UIT de ingresos anuales pasa a 1.5%/coeficiente (lo ajustamos cuando aplique).</p>
        </div>
      </div>
      <div className="rounded-lg border border-dashed border-line-strong bg-bg-elev p-5 text-center text-[11.5px] text-ink-3">
        Detracciones · percepciones · retenciones → se incorporan con la conciliación bancaria (próximamente)
      </div>
    </div>
  );
}

function Row({ k, v, bold, tone }: { k: string; v: string; bold?: boolean; tone?: 'ok' | 'warn' }) {
  return (
    <div className="flex items-center justify-between">
      <span className={cn('text-ink-3', bold && 'font-semibold text-foreground')}>{k}</span>
      <span className={cn('font-mono tabular-nums', bold && 'font-bold text-[14px]', tone === 'ok' && 'text-emerald-600', tone === 'warn' && 'text-amber-600')}>{v}</span>
    </div>
  );
}

// ─── Reportes ────────────────────────────────────────────────
function ReportesTab({ periodo }: { periodo: string }) {
  const qc = useQueryClient();
  const email = useAuthStore((s) => s.user?.email ?? '');
  const balQ = useQuery({ queryKey: ['ctb-balance', periodo], queryFn: () => api.contabilidad.getBalance(periodo) });
  const perQ = useQuery({ queryKey: ['ctb-periodos'], queryFn: () => api.contabilidad.listPeriodos() });
  const periodoRow = perQ.data?.periodos.find((p) => p.periodo === periodo);
  const cerrado = periodoRow?.estado === 'cerrado';

  const cerrar = useMutation({
    mutationFn: (force?: boolean) => api.contabilidad.cerrarPeriodo(periodo, { email, force }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ctb-periodos'] }),
    onError: (e: Error) => {
      // Regla 5 · gate: docs sin contabilizar → ofrecer forzar
      if (confirm(`${e.message}\n\n¿Cerrar de todas formas (forzar)?`)) cerrar.mutate(true);
    },
  });
  const reabrir = useMutation({ mutationFn: (motivo: string) => api.contabilidad.reabrirPeriodo(periodo, motivo), onSuccess: () => qc.invalidateQueries({ queryKey: ['ctb-periodos'] }) });
  const meta = (periodoRow?.cierreMeta ?? null) as { diff?: number; asientosCount?: number; hash?: string } | null;

  return (
    <div className="space-y-4">
      {/* Cierre de periodo */}
      <div className="rounded-lg border border-line bg-bg-elev p-4 flex flex-wrap items-center gap-3">
        {cerrado ? <Lock className="h-4 w-4 text-amber-600" /> : <LockOpen className="h-4 w-4 text-emerald-600" />}
        <div className="flex-1 min-w-[200px]">
          <div className="text-[13px] font-semibold">Periodo {periodo} · {cerrado ? 'CERRADO' : 'abierto'}</div>
          <div className="text-[10.5px] text-ink-4">Cierra y <b>congela</b> filas del mes (movimientos/gastos/asientos). Reapertura exige motivo y queda auditada.</div>
          {cerrado && meta && <div className="text-[10px] font-mono text-ink-4 mt-1">snapshot · {meta.asientosCount ?? '?'} asientos · diff {typeof meta.diff === 'number' ? fmtPEN(meta.diff) : '—'} · hash {String(meta.hash ?? '').slice(0, 12)}…</div>}
        </div>
        {cerrado
          ? <button onClick={() => { const m = window.prompt(`Motivo de reapertura de ${periodo} (obligatorio):`)?.trim(); if (m) reabrir.mutate(m); }} className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-bg-sunken">Reabrir</button>
          : <button onClick={() => { if (confirm(`¿Cerrar periodo ${periodo}? Se congelarán las filas del mes. (Si hay bloqueos de integridad se ofrecerá forzar.)`)) cerrar.mutate(undefined); }} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium">Cerrar periodo</button>}
      </div>

      {/* Balance de comprobación */}
      <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
        <div className="border-b border-line px-4 py-2.5"><h3 className="text-[13px] font-semibold">Balance de comprobación · acumulado al {periodo}</h3></div>
        {balQ.isLoading ? <SkelRows rows={6} /> : (
          <table className="w-full text-[12px]">
            <thead className="bg-bg-sunken border-b border-line">
              <tr className="text-left text-[10px] font-mono uppercase tracking-wider text-ink-4">
                <th className="px-3 py-2 w-16">Cta</th><th className="px-3 py-2">Descripción</th>
                <th className="px-3 py-2 text-right w-28">Debe</th><th className="px-3 py-2 text-right w-28">Haber</th>
                <th className="px-3 py-2 text-right w-28">S. Deudor</th><th className="px-3 py-2 text-right w-28">S. Acreedor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(balQ.data?.filas ?? []).map((f) => (
                <tr key={f.codigo} className="hover:bg-bg-sunken/30">
                  <td className="px-3 py-1.5 font-mono font-semibold">{f.codigo}</td>
                  <td className="px-3 py-1.5">{f.descripcion}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtPEN(f.debe)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtPEN(f.haber)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{f.saldoDeudor > 0 ? fmtPEN(f.saldoDeudor) : ''}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{f.saldoAcreedor > 0 ? fmtPEN(f.saldoAcreedor) : ''}</td>
                </tr>
              ))}
              {(balQ.data?.filas.length ?? 0) === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-ink-3">Sin movimientos · genera asientos primero</td></tr>}
            </tbody>
            {balQ.data && balQ.data.filas.length > 0 && (
              <tfoot><tr className="bg-bg-sunken border-t border-line font-semibold">
                <td colSpan={2} className="px-3 py-2 text-[11px]">TOTALES</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtPEN(balQ.data.totales.debe)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtPEN(balQ.data.totales.haber)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtPEN(balQ.data.totales.saldoDeudor)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtPEN(balQ.data.totales.saldoAcreedor)}</td>
              </tr></tfoot>
            )}
          </table>
        )}
      </div>

      <PleExport periodo={periodo} />
    </div>
  );
}

// PLE SUNAT · descarga de libros electrónicos TXT (C5)
function PleExport({ periodo }: { periodo: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['ctb-ple', periodo], queryFn: () => api.contabilidad.pleResumen(periodo) });
  const LIBROS: { key: '8.1' | '14.1' | '5.1' | '6.1'; etiqueta: string }[] = [
    { key: '8.1', etiqueta: '8.1 · Registro de Compras' },
    { key: '14.1', etiqueta: '14.1 · Registro de Ventas' },
    { key: '5.1', etiqueta: '5.1 · Libro Diario' },
    { key: '6.1', etiqueta: '6.1 · Libro Mayor' },
  ];
  return (
    <div className="rounded-lg border border-line bg-bg-elev p-4">
      <div className="flex items-center gap-2 mb-3">
        <Download className="h-4 w-4 text-ink-3" />
        <h3 className="text-[13px] font-semibold">Export PLE SUNAT · libros electrónicos {periodo}</h3>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {LIBROS.map(({ key, etiqueta }) => {
          const filas = data?.libros[key]?.filas ?? 0;
          const vacio = filas === 0;
          return (
            <a
              key={key}
              href={vacio ? undefined : api.contabilidad.pleUrl(periodo, key)}
              className={cn('rounded-md border border-line p-3 flex flex-col gap-1 transition-colors',
                vacio ? 'opacity-50 pointer-events-none' : 'hover:bg-bg-sunken hover:border-primary/40 cursor-pointer')}
            >
              <span className="text-[12px] font-medium">{etiqueta}</span>
              <span className="text-[10.5px] text-ink-4">{isLoading ? '…' : `${filas} ${filas === 1 ? 'línea' : 'líneas'}`}</span>
              {!vacio && <span className="text-[10px] text-primary inline-flex items-center gap-1"><Download className="h-3 w-3" /> Descargar TXT</span>}
            </a>
          );
        })}
      </div>
      <p className="text-[10px] text-ink-4 mt-3 leading-relaxed">
        Estructura PLE 5.x (RS 286-2009 y modificatorias). <b>Validar contra el PLE del contador</b> antes de presentar.
        Ventas usa serie/número placeholder (<span className="font-mono">F001-N°valo</span>) hasta capturar la factura electrónica real. Diario/Mayor toman los asientos en estado <span className="font-mono">registrado</span> del periodo.
      </p>
    </div>
  );
}
