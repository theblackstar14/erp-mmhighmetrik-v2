import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Check,
  Download,
  Plus,
  Receipt,
  Search,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { type FinanzasResumen, type MovimientoInput, type GastoInput, type ConciliacionResumen, type PartidaConcil, type PlanCuentaBusqueda, type CpeBorrador, type CajaRow, type CuentaBancaria, type ProvisionRow, type CostosObra, type ExtractoLineaUI, api } from '@/lib/api.js';
import { cn, fmtPEN } from '@/lib/utils.js';
import { CuentaContableSelect, claseDerivadaUI } from '@/components/contabilidad/CuentaContableSelect.js';
import { invalidateResumen } from '@/lib/invalidate.js';
import { NATURALEZAS_CONTABLES } from '@erp/shared';
import { FinanzasTab } from '@/components/proyectos/tabs/FinanzasTab.js';

import { Skel, SkelCards, SkelRows, TabFade } from '@/components/ui/Skeleton.js';
import { EmittingOverlay } from '@/components/ui/EmittingOverlay.js';

const FlujoCajaView = lazy(() => import('./FlujoCajaView.js'));

// Consolidación 6 tabs: tab = dominio, segmento interno = vista (mockup finanzas-tabs-consolidado)
type Sub = 'resumen' | 'compras' | 'ventas' | 'caja' | 'conciliacion' | 'reportes';

const mesLabel = (m: string | null) => {
  if (!m) return '—';
  const [y = '', mm = ''] = m.split('-');
  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
  return `${meses[Number(mm) - 1] ?? mm} '${y.slice(2)}`;
};

export function FinanzasPage() {
  const [filtro, setFiltro] = useState<string>('todos');
  const [sub, setSub] = useState<Sub>('resumen');
  const [hubVista, setHubVista] = useState<string | null>(null); // deep-link del inbox al segmento de un hub
  const [movOpen, setMovOpen] = useState(false);
  const [movV2Open, setMovV2Open] = useState(false); // F5.3 · formulario del mockup en beta (paralelo al actual)
  const onJump = (s: Sub, vista?: string) => { setSub(s); setHubVista(vista ?? null); };

  const proyectosQ = useQuery({ queryKey: ['proyectos-list'], queryFn: () => api.proyectos.list() });
  const proyectos = proyectosQ.data?.proyectos ?? [];

  const resumenQ = useQuery({
    queryKey: ['finanzas-resumen', filtro],
    queryFn: () => api.finanzas.getResumen(filtro),
  });
  const r = resumenQ.data;

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Finanzas</h1>
          <p className="text-[13px] text-ink-3 mt-0.5">Caja real · cuentas por cobrar/pagar · garantías · por obra o consolidado</p>
        </div>
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-ink-3" />
          <select
            className="h-9 px-3 rounded-md border border-line bg-bg-elev text-[12.5px] w-full sm:w-[260px] max-w-full truncate"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
          >
            <option value="todos">Todos los proyectos</option>
            {proyectos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.codigo} · {p.nombre.length > 42 ? `${p.nombre.slice(0, 42)}…` : p.nombre}
              </option>
            ))}
          </select>
          {/* F5.4 · SWAP aprobado: el formulario del mockup es el principal; el clásico queda de respaldo temporal */}
          <button
            onClick={() => setMovV2Open(true)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> Registrar movimiento
          </button>
          <button
            onClick={() => setMovOpen(true)}
            title="Formulario anterior · respaldo temporal mientras se estabiliza el nuevo"
            className="h-9 px-2 rounded-md text-[10.5px] text-ink-4 hover:text-ink-2 hover:bg-bg-sunken"
          >
            clásico
          </button>
        </div>
      </header>

      {/* Sub-tabs */}
      <div className="border-b border-line">
        <nav className="flex gap-1 -mb-px">
          {([
            ['resumen', 'Resumen'],
            ['compras', 'Compras'],
            ['ventas', 'Ventas'],
            ['caja', 'Caja y bancos'],
            ['conciliacion', 'Conciliación'],
            ['reportes', 'Reportes'],
          ] as const).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setSub(k)}
              className={cn(
                'whitespace-nowrap px-3 py-2 text-[12.5px] font-medium border-b-2 transition-colors',
                sub === k ? 'border-primary text-primary' : 'border-transparent text-ink-3 hover:text-foreground hover:border-line-strong',
              )}
            >
              {l}
            </button>
          ))}
        </nav>
      </div>

      <TabFade tabKey={sub}>
        {sub === 'resumen' && (
          <div className="space-y-5">
            <ResumenView r={r} loading={resumenQ.isLoading} onJump={onJump} />
            {/* Flujo de caja absorbido: era una tab entera, ahora es la sección gráfica del resumen */}
            <div>
              <h2 className="text-[13px] font-semibold mb-2">Flujo de caja</h2>
              <Suspense fallback={<Skel className="h-[420px] w-full" />}>
                <FlujoCajaView proyectoId={filtro} />
              </Suspense>
            </div>
          </div>
        )}
        {sub === 'compras' && <ComprasHub key={hubVista ?? ''} proyectoId={filtro} proyectos={proyectos} initialVista={hubVista === 'bandeja' ? 'bandeja' : 'registro'} />}
        {sub === 'ventas' && <VentasView proyectoId={filtro} />}
        {sub === 'caja' && <CajaBancosHub proyectoId={filtro} proyectos={proyectos} />}
        {sub === 'conciliacion' && <ConciliacionView proyectos={proyectos} defaultProyecto={filtro} />}
        {sub === 'reportes' && <ReportesView r={r} />}
      </TabFade>

      {movOpen && <MovModal proyectos={proyectos} defaultProyecto={filtro} onClose={() => setMovOpen(false)} />}
      {movV2Open && <MovModalV2 proyectos={proyectos} defaultProyecto={filtro} onClose={() => setMovV2Open(false)} />}
    </div>
  );
}

// ─── Resumen view ────────────────────────────────────────────
function ResumenView({ r, loading, onJump }: { r: FinanzasResumen | undefined; loading: boolean; onJump: (sub: Sub, vista?: string) => void }) {
  if (loading) return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2.5">{Array.from({ length: 7 }).map((_, i) => <Skel key={i} className="h-[68px] w-full" />)}</div>
      <SkelCards count={3} />
    </div>
  );
  if (!r) return null;
  const v2 = r.resumenV2;
  const ing = r.kpis.ingresosMes, eg = r.kpis.egresosMes;
  const utilidad = ing - eg;
  const margen = ing > 0 ? (utilidad / ing) * 100 : 0;
  // delta vs mes anterior desde el flujo mensual (último = mes actual)
  const prev = r.flujoMensual.at(-2);
  const delta = (act: number, ant: number | undefined) => (ant && ant > 0 ? ((act - ant) / ant) * 100 : null);
  const dIng = delta(ing, prev?.ingresos);
  const dEg = delta(eg, prev?.egresos);
  const fmtDelta = (d: number | null, buenoArriba: boolean) => d == null ? null : (
    <span className={cn('font-semibold', (d >= 0) === buenoArriba ? 'text-emerald-600' : 'text-rose-600')}>{d >= 0 ? '▲' : '▼'} {Math.abs(d).toFixed(0)}%</span>
  );
  const heroes: { lbl: string; val: string; det: React.ReactNode; color: keyof typeof ACENTO; spark?: number[] }[] = [
    { lbl: 'Ingresos del mes', val: fmtPEN(ing), det: <>{fmtDelta(dIng, true)} {dIng != null ? 'vs mes anterior' : mesLabel(r.mesActual)}</>, color: 'emerald', spark: r.flujoMensual.map((m) => m.ingresos) },
    { lbl: 'Gastos del mes', val: fmtPEN(eg), det: <>{fmtDelta(dEg, false)} {dEg != null ? 'vs mes anterior' : 'planilla + compras'}</>, color: 'rose', spark: r.flujoMensual.map((m) => m.egresos) },
    { lbl: 'Resultado del mes', val: fmtPEN(utilidad), det: <>margen <b>{margen.toFixed(1)}%</b></>, color: utilidad >= 0 ? 'emerald' : 'rose' },
    { lbl: 'Por cobrar', val: fmtPEN(v2.aging.cxc.total), det: v2.aging.cxc.v30 + v2.aging.cxc.mas30 > 0 ? <span className="text-rose-600">{fmtPEN(v2.aging.cxc.v30 + v2.aging.cxc.mas30)} vencido</span> : 'todo corriente', color: 'blue' },
    { lbl: 'Por pagar', val: fmtPEN(v2.aging.cxp.total), det: v2.accion.cxpPorVencer7.n > 0 ? <>{fmtPEN(v2.accion.cxpPorVencer7.monto)} vence en 7 días</> : 'sin vencimientos próximos', color: 'amber' },
    { lbl: 'Posición de caja', val: fmtPEN(r.tesoreria.totalCaja), det: <>{r.tesoreria.cuentas.length} cuentas</>, color: 'blue' },
  ];
  const inbox: { tono: string; titulo: string; detalle: string; btn: string; jump: () => void }[] = [];
  if (v2.accion.detraccionesPendientes.n > 0)
    inbox.push({ tono: 'bg-destructive', titulo: `${v2.accion.detraccionesPendientes.n} detracción(es) sin constancia de depósito`, detalle: `${fmtPEN(v2.accion.detraccionesPendientes.monto)} · el crédito fiscal queda diferido`, btn: 'Completar', jump: () => onJump('compras', 'registro') });
  if (v2.accion.cxpPorVencer7.n > 0)
    inbox.push({ tono: 'bg-destructive', titulo: `${v2.accion.cxpPorVencer7.n} factura(s) por pagar vencen en 7 días`, detalle: v2.accion.cxpPorVencer7.items.map((i) => `${i.tercero ?? ''} ${i.doc} (${fmtPEN(i.saldo)})`).join(' · '), btn: 'Pagar', jump: () => onJump('caja') });
  if (v2.accion.valosSinComprobante.n > 0)
    inbox.push({ tono: 'bg-warn', titulo: `${v2.accion.valosSinComprobante.n} valorización(es) sin comprobante`, detalle: `${v2.accion.valosSinComprobante.items.map((i) => `VAL-${i.numero} ${i.proyectoCodigo ?? ''}`).join(' · ')} · sin serie/número el 14.1 sale con placeholder`, btn: 'Registrar', jump: () => onJump('ventas') });
  if (v2.accion.bandejaCpe > 0)
    inbox.push({ tono: 'bg-violet-600', titulo: `${v2.accion.bandejaCpe} XML en la bandeja CPE`, detalle: 'falta asignarles cuenta y destino', btn: 'Bandeja', jump: () => onJump('compras', 'bandeja') });
  if (v2.accion.cajasPorRendir.n > 0)
    inbox.push({ tono: 'bg-warn', titulo: `${v2.accion.cajasPorRendir.n} caja(s) con saldo por rendir`, detalle: `${v2.accion.cajasPorRendir.items.map((c) => `${c.codigo} ${c.encargado} (${fmtPEN(c.saldo)})`).join(' · ')}`, btn: 'Cajas', jump: () => onJump('caja') });
  if (v2.accion.conciliacionPendiente > 0)
    inbox.push({ tono: 'bg-primary', titulo: `${v2.accion.conciliacionPendiente} línea(s) de extracto sin conciliar`, detalle: 'match por N° de operación', btn: 'Conciliar', jump: () => onJump('conciliacion') });
  const urgentes = inbox.filter((i) => i.tono === 'bg-destructive').length;
  const p30 = v2.proyeccion.hoy + v2.proyeccion.d30.cobros - v2.proyeccion.d30.pagos;
  const p60 = v2.proyeccion.hoy + v2.proyeccion.d60.cobros - v2.proyeccion.d60.pagos;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
        {heroes.map((k) => (
          <div key={k.lbl} className={cn('relative rounded-md border border-line border-t-2 bg-bg-elev px-3 py-2.5', ACENTO[k.color].border)}>
            <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-4 truncate">{k.lbl}</div>
            <div className={cn('mt-1 text-[16px] font-bold font-mono tabular-nums tracking-[-0.02em] leading-tight', ACENTO[k.color].text)}>{k.val}</div>
            <div className="text-[10px] text-ink-4 mt-0.5 truncate">{k.det}</div>
            {k.spark && <Sparkline data={k.spark} className={cn('absolute right-2 top-2.5 opacity-90', ACENTO[k.color].text)} />}
          </div>
        ))}
      </div>

      {/* columnas balanceadas: izq = inbox + utilidad · der = proyección + aging + tesorería (sin huecos) */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 items-start">
        <div className="space-y-4">
        {/* Inbox: qué requiere acción hoy · cada fila salta a resolverlo */}
        <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
            <b className="text-[12.5px]">Requiere acción</b>
            <span className="font-mono text-[11px] text-ink-4">{inbox.length} pendiente(s)</span>
            <span className="flex-1" />
            {urgentes > 0 && <span className="chip bg-destructive-soft text-destructive">{urgentes} urgente(s)</span>}
          </div>
          {inbox.length === 0
            ? <div className="px-3.5 py-6 text-center text-[12px] text-ink-3">Nada pendiente · todo al día</div>
            : inbox.map((i) => (
              <div key={i.titulo} className="flex items-center gap-2.5 px-3.5 py-2 border-b border-line last:border-0">
                <span className={cn('h-[7px] w-[7px] rounded-full shrink-0', i.tono)} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold truncate">{i.titulo}</div>
                  <div className="text-[11px] text-ink-4 truncate">{i.detalle}</div>
                </div>
                <button onClick={i.jump} className="h-[26px] px-2.5 rounded-md border border-line text-[11px] font-medium hover:bg-bg-sunken shrink-0">{i.btn} →</button>
              </div>
            ))}
        </div>

        {/* Utilidad por proyecto · la vista de Mario */}
        <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
          <div className="border-b border-line px-3.5 py-2.5"><b className="text-[12.5px]">Utilidad por proyecto</b> <span className="font-mono text-[10.5px] text-ink-4">valorizado − gastado (base sin IGV)</span></div>
          {v2.utilidadPorProyecto.length === 0 ? <div className="px-3.5 py-6 text-center text-[12px] text-ink-3">Sin proyectos con movimiento</div> : (
            <table className="w-full">
              <thead><tr className="border-b border-line bg-bg-sunken">{['Obra', 'Valorizado', 'Gastado', 'Margen'].map((h, i) => <th key={h} className={cn('px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-wider text-ink-4', i > 0 ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
              <tbody>
                {v2.utilidadPorProyecto.map((u) => (
                  <tr key={u.proyectoId} className="border-b border-line last:border-0">
                    <td className="px-3 py-1.5"><span className="font-mono text-[11px]">{u.proyectoCodigo ?? '—'}</span><div className="text-[10px] text-ink-4 max-w-[180px] truncate">{u.proyectoNombre ?? ''}</div></td>
                    <td className="px-3 py-1.5 font-mono text-[11px] tabular-nums text-right">{fmtPEN(u.valorizado)}</td>
                    <td className="px-3 py-1.5 font-mono text-[11px] tabular-nums text-right text-ink-3">{fmtPEN(u.gastado)}</td>
                    <td className={cn('px-3 py-1.5 font-mono text-[11px] tabular-nums text-right font-semibold', u.margenPct == null ? 'text-ink-4' : u.margenPct >= 0 ? 'text-emerald-700' : 'text-rose-600')}>{u.margenPct != null ? `${(u.margenPct * 100).toFixed(1)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        </div>

        <div className="space-y-4">
          {/* Proyección: aritmética del sub-mayor por vencimiento, no forecast */}
          <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
            <div className="border-b border-line px-3.5 py-2.5"><b className="text-[12.5px]">Proyección de caja</b> <span className="font-mono text-[10.5px] text-ink-4">saldo + CxC − CxP por vencimiento</span></div>
            <div className="grid grid-cols-3 divide-x divide-line">
              {[
                { h: 'Hoy', n: v2.proyeccion.hoy, rows: null },
                { h: 'A 30 días', n: p30, rows: v2.proyeccion.d30 },
                { h: 'A 60 días', n: p60, rows: v2.proyeccion.d60 },
              ].map((c) => (
                <div key={c.h} className="px-3 py-2.5">
                  <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-4">{c.h}</div>
                  <div className={cn('font-mono text-[14px] font-bold tabular-nums mt-0.5', c.n >= v2.proyeccion.hoy ? 'text-emerald-700' : 'text-rose-600')}>{fmtPEN(c.n)}</div>
                  {c.rows && (
                    <div className="text-[10px] text-ink-4 mt-1 space-y-px font-mono tabular-nums">
                      <div>+ {fmtPEN(c.rows.cobros)}</div>
                      <div>− {fmtPEN(c.rows.pagos)}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          {/* Aging CxC / CxP */}
          <div className="rounded-lg border border-line bg-bg-elev px-3.5 py-3">
            <b className="text-[12.5px]">Antigüedad de saldos</b>
            <AgingBar label="Por cobrar" a={v2.aging.cxc} />
            <AgingBar label="Por pagar" a={v2.aging.cxp} />
            <div className="flex gap-3 mt-2 text-[10px] text-ink-3">
              <span><i className="inline-block h-2 w-2 rounded-[2px] bg-emerald-600 mr-1" />Corriente</span>
              <span><i className="inline-block h-2 w-2 rounded-[2px] bg-warn mr-1" />1-30 vencido</span>
              <span><i className="inline-block h-2 w-2 rounded-[2px] bg-rose-600 mr-1" />+30 vencido</span>
            </div>
          </div>
          {/* Tesorería compacta · el detalle vive en Caja y bancos */}
          <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
            <div className="flex items-center border-b border-line px-3.5 py-2.5"><b className="text-[12.5px]">Tesorería</b><span className="flex-1" /><button onClick={() => onJump('caja')} className="text-[11px] text-primary hover:underline">Caja y bancos →</button></div>
            <table className="w-full">
              <tbody>
                {r.tesoreria.cuentas.map((c) => (
                  <tr key={c.cuenta.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-1.5 font-mono text-[11px] text-ink-3">{c.cuenta.cuentaContable ?? '—'}</td>
                    <td className="px-3 py-1.5 text-[11.5px] max-w-[200px] truncate">{c.cuenta.descripcion ?? c.cuenta.codigo}</td>
                    <td className={cn('px-3 py-1.5 font-mono text-[11.5px] tabular-nums text-right font-semibold', c.saldo < 0 && 'text-rose-600')}>{fmtPEN(c.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// mini tendencia 6 meses · usa currentColor del contenedor
function Sparkline({ data, className }: { data: number[]; className?: string }) {
  const pts = data.slice(-6);
  if (pts.length < 2) return null;
  const max = Math.max(...pts, 1);
  const xy = pts.map((v, i) => `${(i / (pts.length - 1)) * 48},${18 - (v / max) * 16}`).join(' ');
  return <svg width="48" height="20" viewBox="0 0 48 20" className={className}><polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={xy} /></svg>;
}

function AgingBar({ label, a }: { label: string; a: { corriente: number; v30: number; mas30: number; total: number } }) {
  const pct = (n: number) => (a.total > 0 ? (n / a.total) * 100 : 0);
  return (
    <div className="mt-2">
      <div className="flex justify-between text-[11px] text-ink-3"><span>{label}</span><span className="font-mono tabular-nums">{fmtPEN(a.total)}</span></div>
      <div className="flex h-[9px] rounded-[5px] overflow-hidden mt-1 bg-bg-sunken">
        <div className="bg-emerald-600" style={{ width: `${pct(a.corriente)}%` }} />
        <div className="bg-warn" style={{ width: `${pct(a.v30)}%` }} />
        <div className="bg-rose-600" style={{ width: `${pct(a.mas30)}%` }} />
      </div>
    </div>
  );
}

// Acentos suaves (tono 600, legibles en blanco · sin el amarillo neón del v1)
const ACENTO = {
  blue: { dot: 'bg-primary', border: 'border-t-primary', text: 'text-primary' },
  emerald: { dot: 'bg-emerald-600', border: 'border-t-emerald-600', text: 'text-emerald-600' },
  rose: { dot: 'bg-rose-600', border: 'border-t-rose-600', text: 'text-rose-600' },
  amber: { dot: 'bg-amber-600', border: 'border-t-amber-600', text: 'text-amber-700' },
  violet: { dot: 'bg-violet-600', border: 'border-t-violet-600', text: 'text-violet-600' },
} satisfies Record<string, { dot: string; border: string; text: string }>;

// ─── Gastos de oficina (presupuesto editable vs ejecutado) ───
const PAL = ['#3b82f6', '#f59e0b', '#8b5cf6', '#14b8a6', '#ef4444', '#10b981', '#ec4899', '#06b6d4'];
function GastosOficinaCard({ r }: { r: FinanzasResumen }) {
  const qc = useQueryClient();
  const go = r.gastosOficina;
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState(String(go.presupuesto ?? ''));
  const save = useMutation({
    mutationFn: () => api.finanzas.setPresupuestoOficina(go.mes!, Number(val) || 0),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['finanzas-resumen'] }); setEdit(false); },
  });
  const pct = go.presupuesto && go.presupuesto > 0 ? Math.min(1, go.ejecutado / go.presupuesto) : null;
  const saldo = go.presupuesto != null ? go.presupuesto - go.ejecutado : null;
  return (
    <div className="rounded-lg border border-line border-t-2 border-t-amber-600 bg-bg-elev p-4 flex flex-col">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[11px] font-mono uppercase tracking-wider text-ink-4">Gastos de oficina</h3>
        <span className="text-[10.5px] text-ink-4">{go.mes ? mesLabel(go.mes) : '—'}</span>
      </div>
      {/* Presupuesto editable + barra */}
      <div className="flex items-center justify-between text-[11.5px] mb-1">
        <span className="text-ink-3">Presupuesto:{' '}
          {edit ? (
            <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} type="number" className="h-6 w-24 px-1.5 rounded border border-line bg-bg-elev text-[11.5px]" />
          ) : (
            <button onClick={() => { setVal(String(go.presupuesto ?? '')); setEdit(true); }} className="font-mono font-semibold text-foreground hover:text-primary" disabled={!go.mes}>
              {go.presupuesto != null ? fmtPEN(go.presupuesto) : 'fijar tope'}
            </button>
          )}
        </span>
        {edit ? (
          <span className="flex gap-1">
            <button onClick={() => save.mutate()} disabled={save.isPending} className="text-[10.5px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground">OK</button>
            <button onClick={() => setEdit(false)} className="text-[10.5px] px-1.5 py-0.5 rounded border border-line">✕</button>
          </span>
        ) : pct != null ? (
          <span className="font-mono font-semibold tabular-nums">{Math.round(pct * 100)}%</span>
        ) : null}
      </div>
      {pct != null && (
        <div className="h-1.5 rounded-full bg-bg-sunken overflow-hidden mb-2">
          <div className={cn('h-full rounded-full', pct >= 1 ? 'bg-rose-600' : 'bg-amber-600')} style={{ width: `${pct * 100}%` }} />
        </div>
      )}
      <div className="text-[11px] text-ink-3 mb-2">Ejecutado: <span className="font-mono font-semibold text-foreground">{fmtPEN(go.ejecutado)}</span></div>
      {/* Categorías */}
      <div className="space-y-1.5 flex-1">
        {go.porCategoria.length === 0 ? (
          <div className="text-center py-4 text-[11px] text-ink-3">Sin gastos de oficina este mes</div>
        ) : go.porCategoria.slice(0, 6).map((c, i) => (
          <div key={c.categoria} className="flex items-center gap-2 text-[11.5px]">
            <i className="h-2 w-2 rounded-sm shrink-0" style={{ background: PAL[i % PAL.length] }} />
            <span className="truncate flex-1">{c.categoria}</span>
            <span className="font-mono tabular-nums">{fmtPEN(c.monto)}</span>
            <span className="font-mono tabular-nums text-ink-4 w-8 text-right">{Math.round(c.pct * 100)}%</span>
          </div>
        ))}
      </div>
      {saldo != null && (
        <div className="mt-2 pt-2 border-t border-line flex items-center justify-between text-[11px]">
          <span className="text-ink-3">Saldo presupuesto</span>
          <span className={cn('font-mono font-semibold tabular-nums', saldo >= 0 ? 'text-ok' : 'text-warn-ink')}>{fmtPEN(saldo)}</span>
        </div>
      )}
    </div>
  );
}

// F3 · asignar sub-cuenta PCGE 104x a una cuenta bancaria (prerequisito del flip de movimientos)
function Cuenta104xEditor({ cuenta }: { cuenta: { id: string; cuentaContable: string | null } }) {
  const qc = useQueryClient();
  const [val, setVal] = useState(cuenta.cuentaContable ?? '');
  const mut = useMutation({
    mutationFn: () => api.finanzas.updateCuenta(cuenta.id, { cuentaContable: val }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cuentas'] }); qc.invalidateQueries({ queryKey: ['finanzas-resumen'] }); },
  });
  const dirty = (val.trim() || null) !== (cuenta.cuentaContable ?? null);
  return (
    <div className="mt-2 pt-2 border-t border-dashed border-line flex items-center gap-1.5">
      <span className="text-[9px] font-mono uppercase tracking-wider text-ink-4 shrink-0">cuenta 104x</span>
      <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="104101" onKeyDown={(e) => { if (e.key === 'Enter' && dirty) mut.mutate(); }}
        className={cn('h-6 w-24 px-1.5 rounded border bg-bg-elev text-[10.5px] font-mono outline-none', cuenta.cuentaContable ? 'border-line' : 'border-amber-500/60')} />
      {dirty
        ? <button onClick={() => mut.mutate()} disabled={mut.isPending} className="text-[10px] text-primary font-medium hover:underline disabled:opacity-50">{mut.isPending ? '…' : 'guardar'}</button>
        : !cuenta.cuentaContable && <span className="text-[9px] text-amber-600">falta</span>}
    </div>
  );
}

// ─── Tesorería ───────────────────────────────────────────────
function Tesoreria({ r }: { r: FinanzasResumen }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  return (
    <section>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {r.tesoreria.cuentas.map((s) => (
          <div key={s.cuenta.id} className="rounded-lg border border-line border-t-2 border-t-primary bg-bg-elev p-3.5">
            <div className="flex items-center gap-2.5">
              <span className="h-9 w-9 shrink-0 rounded-md bg-primary/10 text-primary inline-flex items-center justify-center font-mono text-[10px] font-bold">{(s.cuenta.banco ?? s.cuenta.codigo ?? 'CTA').slice(0, 4).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium truncate">{s.cuenta.descripcion ?? s.cuenta.banco ?? s.cuenta.codigo}</div>
                <div className="text-[10px] text-ink-4 font-mono truncate">{s.cuenta.codigo} · {s.cuenta.moneda}</div>
              </div>
            </div>
            <div className={cn('mt-2.5 text-[19px] font-bold font-mono tabular-nums tracking-[-0.02em] leading-none', s.saldo >= 0 ? 'text-foreground' : 'text-destructive')}>{fmtPEN(s.saldo)}</div>
            <div className="mt-2 pt-2 border-t border-dashed border-line flex items-center justify-between text-[10.5px] font-mono">
              <span><span className="text-ink-4 not-italic">ing </span><span className="text-ok font-semibold">+{fmtPEN(s.ingresos)}</span></span>
              <span><span className="text-ink-4">egr </span><span className="text-rose-600 font-semibold">−{fmtPEN(s.egresos)}</span></span>
            </div>
            <Cuenta104xEditor cuenta={s.cuenta} />
          </div>
        ))}
        <button
          onClick={() => setAddOpen(true)}
          className="rounded-lg border border-dashed border-line-strong p-3.5 flex flex-col items-center justify-center gap-1 text-ink-4 hover:text-foreground hover:border-primary transition-colors min-h-[120px]"
        >
          <Plus className="h-5 w-5" />
          <span className="text-[12px] font-medium">Agregar cuenta</span>
          <span className="text-[10.5px]">banco o efectivo</span>
        </button>
      </div>
      {addOpen && <CuentaModal onClose={() => setAddOpen(false)} onDone={() => { qc.invalidateQueries({ queryKey: ['finanzas-resumen'] }); qc.invalidateQueries({ queryKey: ['cuentas'] }); setAddOpen(false); }} />}
    </section>
  );
}


// ─── Garantías ───────────────────────────────────────────────
function Garantias({ r }: { r: FinanzasResumen }) {
  const hoy = new Date();
  const diasHasta = (d: string | null) => {
    if (!d) return null;
    return Math.round((new Date(d).getTime() - hoy.getTime()) / 86400000);
  };
  const urgentes = r.garantias.filter((g) => { const d = diasHasta(g.vigenciaHasta); return d != null && d <= 30; }).length;
  return (
    <div className="rounded-lg border border-line border-t-2 border-t-rose-600 bg-bg-elev p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] font-mono uppercase tracking-wider text-ink-4 flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> {r.garantias.length} cartas fianza · {fmtPEN(r.totals.garantias)}</h3>
        {urgentes > 0 && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{urgentes} vencen en ≤30 días</span>}
      </div>
      {r.garantias.length === 0 ? (
        <div className="text-center py-8 text-[11.5px] text-ink-3 leading-relaxed">
          Sin cartas fianza registradas
          <div className="text-[10.5px] text-ink-4 mt-1">Regístralas en la pestaña Contractual del proyecto</div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {r.garantias.map((g) => {
            const dias = diasHasta(g.vigenciaHasta);
            const alerta = dias != null && dias <= 30;
            const urgColor = dias == null ? 'border-l-line' : dias <= 15 ? 'border-l-rose-600' : dias <= 30 ? 'border-l-amber-600' : 'border-l-emerald-600';
            return (
              <div key={g.id} className={cn('flex items-center gap-2 text-[12px] py-1.5 pl-2 border-l-2 border-b border-b-line last:border-b-0', urgColor)}>
                <div className="min-w-0 flex-1">
                  <div className="font-medium capitalize truncate">{g.tipo.replace(/_/g, ' ')}</div>
                  <div className="text-[10.5px] text-ink-4 truncate">{g.proyectoNombre ?? g.proyectoCodigo ?? '—'} · {g.banco ?? '—'}</div>
                </div>
                {dias != null && (
                  <span className={cn('text-[10px] font-mono px-1.5 py-0.5 rounded', alerta ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700')}>
                    {dias < 0 ? 'vencida' : `${dias}d`}
                  </span>
                )}
                <span className="font-mono tabular-nums font-semibold w-24 text-right">{fmtPEN(g.monto)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Paginador compartido · 10/pág con ‹ › (mismo patrón que Gastos)
function Pager({ page, totalPages, count, per, onPage }: { page: number; totalPages: number; count: number; per: number; onPage: (p: number) => void }) {
  return (
    <div className="border-t border-line pt-2 mt-1.5 flex items-center justify-between text-[11px] text-ink-3">
      <span>{count === 0 ? '0' : `${page * per + 1}–${Math.min(count, (page + 1) * per)}`} de {count}</span>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button disabled={page === 0} onClick={() => onPage(page - 1)} className="h-6 px-2 rounded border border-line disabled:opacity-40 hover:bg-bg-sunken">‹</button>
          <span className="px-1.5 font-mono">{page + 1}/{totalPages}</span>
          <button disabled={page >= totalPages - 1} onClick={() => onPage(page + 1)} className="h-6 px-2 rounded border border-line disabled:opacity-40 hover:bg-bg-sunken">›</button>
        </div>
      )}
    </div>
  );
}

// ─── Movimientos / Gastos globales ───────────────────────────
function GlobalLedger({ proyectoId, proyectos, kind }: { proyectoId: string; proyectos: { id: string; codigo: string; nombre: string }[]; kind: 'movimientos' | 'gastos' }) {
  const isMov = kind === 'movimientos';
  const movQ = useQuery({ queryKey: ['mov-global', proyectoId], queryFn: () => api.finanzas.listMovimientosGlobal(proyectoId), enabled: isMov });
  const gasQ = useQuery({ queryKey: ['gas-global', proyectoId], queryFn: () => api.finanzas.listGastosGlobal(proyectoId), enabled: !isMov });
  const pm = useMemo(() => new Map(proyectos.map((p) => [p.id, p.codigo])), [proyectos]);
  const [busca, setBusca] = useState('');
  const [filt, setFilt] = useState<'todos' | 'Ingreso' | 'Egreso'>('todos');
  const [gastoSel, setGastoSel] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [anio, setAnio] = useState('');
  const [mes, setMes] = useState('');
  const PAGE = isMov ? 10 : 50;

  // Memoizar derivados · antes se filtraba/ordenaba todo el array en cada tecla/render (lag con miles de filas)
  const q = busca.trim().toLowerCase();
  const movs = useMemo(() => {
    const all = movQ.data?.movimientos ?? [];
    return all.filter((m) => {
      if (filt !== 'todos' && m.tipoMovimiento !== filt) return false;
      if (!q) return true;
      return [m.descripcion, m.clienteNombre, m.numero, m.serie, m.fuenteMovimiento].some((x) => String(x ?? '').toLowerCase().includes(q));
    });
  }, [movQ.data, filt, q]);
  const gastosAll = gasQ.data?.gastos ?? [];
  const anios = useMemo(() => [...new Set(gastosAll.map((g) => String(g.fecha).slice(0, 4)))].sort().reverse(), [gastosAll]);
  const gastosFilt = useMemo(() => gastosAll.filter((g) => {
    if (anio && String(g.fecha).slice(0, 4) !== anio) return false;
    if (mes && String(g.fecha).slice(5, 7) !== mes) return false;
    if (!q) return true;
    return [g.proveedorRazon, g.descripcionItem, g.tipoGasto, g.serie, g.numero, g.proyectoId ? pm.get(g.proyectoId) : ''].some((x) => String(x ?? '').toLowerCase().includes(q));
  }), [gastosAll, anio, mes, q, pm]);

  if (isMov) {
    const all = movQ.data?.movimientos ?? [];
    const st = movQ.data?.stats;
    const movTotalPages = Math.max(1, Math.ceil(movs.length / PAGE));
    const movPageSafe = Math.min(page, movTotalPages - 1);
    const movsPage = movs.slice(movPageSafe * PAGE, movPageSafe * PAGE + PAGE);
    const csv = () => {
      const head = ['Fecha', 'Tipo', 'Comprobante', 'Concepto', 'Contraparte', 'Proyecto', 'Monto'];
      const lines = movs.map((m) => [
        m.fecha, m.tipoMovimiento, [m.tipoComprobante, [m.serie, m.numero].filter(Boolean).join('-')].filter(Boolean).join(' '),
        (m.descripcion ?? '').replace(/[\n;]/g, ' '), m.clienteNombre ?? '', (m.proyectoId ? pm.get(m.proyectoId) ?? '' : ''),
        (m.tipoMovimiento === 'Ingreso' ? '' : '-') + Number(m.monto).toFixed(2),
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'));
      const blob = new Blob(['﻿' + [head.join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `movimientos_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    };
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Kpi label="Ingresos" value={fmtPEN(st?.ingresos ?? 0)} icon={<ArrowUpRight className="h-4 w-4" />} tone="ok" />
          <Kpi label="Egresos" value={fmtPEN(st?.egresos ?? 0)} icon={<ArrowDownRight className="h-4 w-4" />} tone="warn" />
          <Kpi label="Neto" value={fmtPEN(st?.neto ?? 0)} icon={<Wallet className="h-4 w-4" />} tone="info" />
        </div>
        <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
          {/* toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
            <h3 className="text-[13px] font-semibold mr-auto">Movimientos <span className="text-ink-4 font-normal">{movs.length} de {all.length}</span></h3>
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-ink-4 absolute left-2 top-1/2 -translate-y-1/2" />
              <input value={busca} onChange={(e) => { setBusca(e.target.value); setPage(0); }} placeholder="Buscar concepto, contraparte..." className="h-8 pl-7 pr-2 rounded-md border border-line bg-bg-elev text-[12px] w-56" />
            </div>
            <div className="inline-flex rounded-md border border-line p-0.5 bg-bg-sunken">
              {(['todos', 'Ingreso', 'Egreso'] as const).map((k) => (
                <button key={k} onClick={() => { setFilt(k); setPage(0); }} className={cn('h-7 px-2.5 rounded-[5px] text-[11.5px] font-medium capitalize transition-colors', filt === k ? 'bg-bg-elev text-foreground shadow-sm' : 'text-ink-3 hover:text-foreground')}>{k === 'todos' ? 'Todos' : k + 's'}</button>
              ))}
            </div>
            <button onClick={csv} disabled={movs.length === 0} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-line text-[11.5px] font-medium hover:bg-bg-sunken disabled:opacity-40"><Download className="h-3.5 w-3.5" /> CSV</button>
          </div>
          {movQ.isLoading ? <SkelRows rows={6} />
            : movs.length === 0 ? <div className="text-center py-8 text-[12px] text-ink-3">{all.length === 0 ? 'Sin movimientos' : 'Sin resultados para el filtro'}</div>
            : (
            <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-line bg-bg-sunken">{['Fecha', 'Tipo', 'Comprobante', 'Concepto', 'Contraparte', 'Obra', 'Monto'].map((h, i) => <th key={i} className={cn('px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-4', i === 6 ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
                <tbody>
                  {movsPage.map((m) => {
                    const ing = m.tipoMovimiento === 'Ingreso';
                    const comp = [m.serie, m.numero].filter(Boolean).join('-');
                    return (
                      <tr key={m.id} className={cn('border-b border-line hover:bg-bg-sunken/30', m.anulado && 'opacity-50 line-through')}>
                        <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums whitespace-nowrap">{m.fecha}</td>
                        <td className="px-3 py-1.5"><span className={cn('inline-flex items-center gap-0.5 text-[10.5px] font-medium px-1.5 py-0.5 rounded', m.anulado ? 'bg-bg-sunken text-ink-4' : ing ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>{m.anulado ? 'Anulado' : ing ? 'Ingreso' : 'Egreso'}</span></td>
                        <td className="px-3 py-1.5 text-[11px] text-ink-3 whitespace-nowrap">{comp || '—'}</td>
                        <td className="px-3 py-1.5 text-[11.5px] max-w-[240px] truncate">{m.descripcion ?? '—'}<div className="text-[10px] text-ink-4">{m.fuenteMovimiento ?? ''}</div></td>
                        <td className="px-3 py-1.5 text-[11.5px] text-ink-3 max-w-[150px] truncate">{m.clienteNombre ?? '—'}</td>
                        <td className="px-3 py-1.5 text-[11px] font-mono text-ink-3">{m.proyectoId ? pm.get(m.proyectoId) ?? '—' : 'Oficina'}</td>
                        <td className={cn('px-3 py-1.5 text-[11px] font-mono tabular-nums text-right font-semibold whitespace-nowrap', ing ? 'text-ok' : 'text-warn-ink')}>{ing ? '+' : '−'}{fmtPEN(Number(m.monto))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-3"><Pager page={movPageSafe} totalPages={movTotalPages} count={movs.length} per={PAGE} onPage={setPage} /></div>
            </>
          )}
        </div>
      </div>
    );
  }

  const st = gasQ.data?.stats;
  const totalPages = Math.max(1, Math.ceil(gastosFilt.length / PAGE));
  const pageSafe = Math.min(page, totalPages - 1);
  const gastos = gastosFilt.slice(pageSafe * PAGE, pageSafe * PAGE + PAGE);
  const csvGastos = () => {
    const head = ['Fecha', 'Obra', 'Proveedor', 'RUC', 'Comprobante', 'Tipo', 'Cuenta', 'Descripción', 'Subtotal', 'IGV', 'Total', 'Saldo', 'Estado'];
    const lines = gastosFilt.map((g) => [g.fecha, g.proyectoId ? pm.get(g.proyectoId) ?? '' : '', g.proveedorRazon ?? '', g.proveedorRuc ?? '', [g.serie, g.numero].filter(Boolean).join('-'), g.tipoGasto ?? '', g.cuentaContable ?? '', (g.descripcionItem ?? '').replace(/[\n;]/g, ' '), Number(g.subtotal).toFixed(2), Number(g.igv).toFixed(2), Number(g.total).toFixed(2), g.saldoPendiente != null ? Number(g.saldoPendiente).toFixed(2) : '', g.estadoPago ?? ''].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'));
    const blob = new Blob(['﻿' + [head.join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `gastos_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Σ Total (c/IGV)" value={fmtPEN(st?.totalGeneral ?? 0)} icon={<Receipt className="h-4 w-4" />} tone="warn" />
        <Kpi label="Σ Subtotal (s/IGV)" value={fmtPEN(st?.subtotalGeneral ?? 0)} icon={<Receipt className="h-4 w-4" />} />
        <Kpi label="Registros" value={String(st?.count ?? 0)} icon={<Receipt className="h-4 w-4" />} />
      </div>
      <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <h3 className="text-[13px] font-semibold mr-auto">Compras y gastos <span className="text-ink-4 font-normal">{gastosFilt.length}{(q || anio || mes) ? ` de ${gastosAll.length}` : ''}</span></h3>
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-ink-4 absolute left-2 top-1/2 -translate-y-1/2" />
            <input value={busca} onChange={(e) => { setBusca(e.target.value); setPage(0); }} placeholder="Buscar proveedor, descripción, comprobante..." className="h-8 pl-7 pr-2 rounded-md border border-line bg-bg-elev text-[12px] w-56" />
          </div>
          <select value={anio} onChange={(e) => { setAnio(e.target.value); setPage(0); }} className="h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px]">
            <option value="">Año</option>
            {anios.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={mes} onChange={(e) => { setMes(e.target.value); setPage(0); }} className="h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px]">
            <option value="">Mes</option>
            {['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((m, i) => <option key={m} value={m}>{['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'][i]}</option>)}
          </select>
          <button onClick={csvGastos} disabled={gastosFilt.length === 0} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-line text-[11.5px] font-medium hover:bg-bg-sunken disabled:opacity-40"><Download className="h-3.5 w-3.5" /> CSV</button>
        </div>
        {gasQ.isLoading ? <SkelRows rows={8} />
          : gastosFilt.length === 0 ? <div className="text-center py-8 text-[12px] text-ink-3">{gastosAll.length === 0 ? 'Sin gastos' : 'Sin resultados para la búsqueda'}</div>
          : (
          <>
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-line bg-bg-sunken">{['Fecha', 'Obra', 'Proveedor', 'Comprob.', 'Cuenta', 'Descripción', 'Total', 'Saldo', 'Estado'].map((h, i) => <th key={i} className={cn('px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-4', i === 6 || i === 7 ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
            <tbody>
              {gastos.map((g) => (
                <tr key={g.id} onClick={() => setGastoSel(g.id)} className="border-b border-line hover:bg-bg-sunken/30 cursor-pointer">
                  <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums whitespace-nowrap">{g.fecha}</td>
                  <td className="px-3 py-1.5 text-[11px] font-mono text-ink-3">{g.proyectoId ? pm.get(g.proyectoId) ?? '—' : '—'}</td>
                  <td className="px-3 py-1.5 text-[11.5px] max-w-[160px] truncate">{g.proveedorRazon ?? '—'}<div className="text-[10px] text-ink-4">{g.tipoGasto ?? ''}</div></td>
                  <td className="px-3 py-1.5 text-[11px] font-mono text-ink-3 whitespace-nowrap">{[g.serie, g.numero].filter(Boolean).join('-') || '—'}</td>
                  <td className="px-3 py-1.5 text-[11px] font-mono">{g.cuentaContable ?? <span className="text-warn-ink">s/cuenta</span>}</td>
                  <td className="px-3 py-1.5 text-[11.5px] max-w-[180px] truncate text-ink-3">{g.descripcionItem ?? '—'}</td>
                  <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums text-right font-semibold">{fmtPEN(Number(g.total))}</td>
                  <td className={cn('px-3 py-1.5 text-[11px] font-mono tabular-nums text-right', Number(g.saldoPendiente ?? 0) > 0 ? 'text-rose-600' : 'text-ink-4')}>{g.saldoPendiente != null ? fmtPEN(Number(g.saldoPendiente)) : '—'}</td>
                  <td className="px-3 py-1.5">{g.estadoPago
                    ? <span className={cn('text-[10.5px] font-medium px-1.5 py-0.5 rounded', g.estadoPago === 'pagado' ? 'bg-emerald-50 text-emerald-700' : g.estadoPago === 'parcial' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700')}>{g.estadoPago}</span>
                    : <span className="text-[10.5px] text-ink-4">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="border-t border-line px-3 py-2 bg-bg-sunken/30 flex items-center justify-between text-[11px] text-ink-3">
            <span>{pageSafe * PAGE + 1}–{Math.min(gastosFilt.length, (pageSafe + 1) * PAGE)} de {gastosFilt.length}</span>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button disabled={pageSafe === 0} onClick={() => setPage(pageSafe - 1)} className="h-6 px-2 rounded border border-line disabled:opacity-40 hover:bg-bg-sunken">‹</button>
                <span className="px-1.5 font-mono">{pageSafe + 1}/{totalPages}</span>
                <button disabled={pageSafe >= totalPages - 1} onClick={() => setPage(pageSafe + 1)} className="h-6 px-2 rounded border border-line disabled:opacity-40 hover:bg-bg-sunken">›</button>
              </div>
            )}
          </div>
          </>
        )}
      </div>
      <p className="text-[10.5px] text-ink-4">Click en una compra para ver sus ítems de inventario + valuación. Para registrar con detalle usa el módulo por obra.</p>
      {gastoSel && <GastoItemsModal gastoId={gastoSel} onClose={() => setGastoSel(null)} />}
    </div>
  );
}

// ─── Consolidación · segmento interno (tab = dominio, segmento = vista) ──
function SegTabs<T extends string>({ value, onChange, opts }: { value: T; onChange: (v: T) => void; opts: readonly { v: T; l: string; n?: number }[] }) {
  return (
    <div className="inline-flex rounded-md border border-line p-0.5 bg-bg-sunken">
      {opts.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)}
          className={cn('h-8 px-3 rounded-[5px] text-[11.5px] font-medium transition-colors inline-flex items-center gap-1.5',
            value === o.v ? 'bg-bg-elev text-foreground shadow-sm' : 'text-ink-3 hover:text-foreground')}>
          {o.l}
          {o.n != null && o.n > 0 && <span className="font-mono text-[9.5px] px-1 rounded bg-warn-soft text-warn-ink">{o.n}</span>}
        </button>
      ))}
    </div>
  );
}

// ─── Tab Compras · segmentos: Registro · Bandeja CPE ──
// El segmento "Órdenes por aprobar/pagar" murió: la aprobación de OC vive en Logística
// (su casa natural) y el pago vive en Registrar movimiento con aplicaciones (F2.2).
function ComprasHub({ proyectoId, proyectos, initialVista = 'registro' }: { proyectoId: string; proyectos: { id: string; codigo: string; nombre: string }[]; initialVista?: 'registro' | 'bandeja' | 'provisiones' }) {
  const [vista, setVista] = useState<'registro' | 'bandeja' | 'provisiones'>(initialVista);
  const bandejaQ = useQuery({ queryKey: ['cpe-bandeja'], queryFn: () => api.cpe.listBandeja() });
  const provQ = useQuery({ queryKey: ['provisiones-48'], queryFn: () => api.contabilidad.listProvisiones() });
  const pendientes = bandejaQ.data?.borradores.length ?? 0;
  const abiertas = provQ.data?.totales.abiertas ?? 0;
  return (
    <div className="space-y-3">
      <SegTabs value={vista} onChange={setVista} opts={[
        { v: 'registro', l: 'Registro' },
        { v: 'bandeja', l: 'Bandeja CPE', n: pendientes },
        { v: 'provisiones', l: 'Provisiones 48', n: abiertas },
      ] as const} />
      {vista === 'registro' && <GlobalLedger proyectoId={proyectoId} proyectos={proyectos} kind="gastos" />}
      {vista === 'bandeja' && <BandejaCpeView proyectos={proyectos} />}
      {vista === 'provisiones' && <ProvisionesView />}
    </div>
  );
}

// ─── F3.4 · Provisiones 48 · «reviso a quién pagué y cuántas facturas me faltan» ──
// Pago sin factura = egreso (Movimiento financiero → "Pago sin factura") contra la 4811.
// Al registrar la compra del tercero, Extornar limpia 4212/4811 y salda la CxP con el pago original.
function ProvisionesView() {
  const q = useQuery({ queryKey: ['provisiones-48'], queryFn: () => api.contabilidad.listProvisiones() });
  const provisiones = q.data?.provisiones ?? [];
  const tot = q.data?.totales;
  const [verTodas, setVerTodas] = useState(false);
  const [extornar, setExtornar] = useState<ProvisionRow | null>(null);
  const filas = verTodas ? provisiones : provisiones.filter((p) => p.estado === 'abierta');
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-line bg-bg-elev px-3 py-2 text-[11.5px] text-ink-2">
        Pagaste sin factura: regístralo como <b>Egreso → Movimiento financiero → «Pago sin factura (provisión 48)»</b>.
        Cuando llegue el comprobante, registra la compra y usa <b>Extornar</b>: la 48 se limpia y la factura queda pagada con ese mismo pago.
      </div>
      <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <h3 className="text-[13px] font-semibold">Provisiones {verTodas ? '' : 'abiertas '}
            <span className="text-ink-4 font-normal">{filas.length}{tot ? ` · ${fmtPEN(tot.montoAbierto)} por sustentar` : ''}</span>
          </h3>
          <div className="flex-1" />
          <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-ink-3">
            <input type="checkbox" checked={verTodas} onChange={(e) => setVerTodas(e.target.checked)} className="rounded border-line" /> ver extornadas
          </label>
        </div>
        {q.isLoading ? <SkelRows rows={4} />
          : filas.length === 0 ? <div className="text-center py-8 text-[12px] text-ink-3">Sin provisiones {verTodas ? '' : 'abiertas'} · la 4811 está limpia</div>
          : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-line bg-bg-sunken">{['Fecha', 'Tercero', 'Detalle', 'Banco / N° op', 'Monto', 'Estado', ''].map((h, i) => <th key={i} className={cn('px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-4', i === 4 ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
              <tbody>
                {filas.map((p) => (
                  <tr key={p.movimientoId} className="border-b border-line/40 last:border-0 hover:bg-bg-sunken/50">
                    <td className="px-3 py-2 font-mono text-[11px]">{p.fecha}</td>
                    <td className="px-3 py-2 text-[12px] font-medium">{p.tercero ?? '— sin tercero'}</td>
                    <td className="px-3 py-2 text-[11.5px] text-ink-2 max-w-[260px] truncate">{p.descripcion ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-ink-3">{[p.cuentaBanco, p.numOperacion].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-[12px]">{fmtPEN(p.monto)}</td>
                    <td className="px-3 py-2">
                      {p.estado === 'abierta'
                        ? <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-medium bg-amber-50 text-amber-700">Espera factura{!p.asentada && ' · sin asentar'}</span>
                        : <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-medium bg-emerald-50 text-emerald-700" title={p.extorno?.docOrigen ?? ''}>Extornada · {p.extorno?.asiento}</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {p.estado === 'abierta' && <button onClick={() => setExtornar(p)} className="rounded-md border border-line px-2 py-1 text-[11px] font-semibold hover:bg-bg-sunken">Extornar</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {extornar && <ExtornarProvisionModal provision={extornar} onClose={() => setExtornar(null)} />}
    </div>
  );
}

function ExtornarProvisionModal({ provision, onClose }: { provision: ProvisionRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [term, setTerm] = useState(provision.tercero ?? '');
  const [gastoId, setGastoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const docsQ = useQuery({
    queryKey: ['docs-pend', 'cxp', term],
    queryFn: () => api.finanzas.listDocumentosPendientes('cxp', term),
    enabled: term.trim().length >= 3,
  });
  // solo compras (gasto) con saldo: el extorno cancela su CxP con el pago provisionado
  const docs = (docsQ.data?.documentos ?? []).filter((d) => d.docOrigenTipo === 'gasto' && d.docOrigenId && Number(d.saldoPendiente) > 0);
  const mut = useMutation({
    mutationFn: () => api.contabilidad.extornarProvision(provision.movimientoId, gastoId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['provisiones-48'] });
      qc.invalidateQueries({ queryKey: ['gas-global'] });
      qc.invalidateQueries({ queryKey: ['docs-pend'] });
      invalidateResumen(qc);
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-backdropIn" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg rounded-xl border border-line bg-bg-elev shadow-2xl animate-modalPop">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <h2 className="text-[15px] font-bold">Extornar provisión 48</h2>
            <div className="text-[11px] text-ink-3">{provision.tercero ?? 's/tercero'} · {fmtPEN(provision.monto)} · pagado el {provision.fecha}</div>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-md inline-flex items-center justify-center text-ink-3 hover:bg-bg-sunken"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Buscar la compra registrada (RUC o razón social)">
            <input className={inputCls} value={term} onChange={(e) => { setTerm(e.target.value); setGastoId(null); }} placeholder="RUC o nombre del proveedor" />
          </Field>
          {term.trim().length >= 3 && (
            docsQ.isLoading ? <div className="text-[11.5px] text-ink-3 py-2">Buscando facturas…</div>
            : docs.length === 0 ? <div className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11.5px] text-amber-700">Ese tercero no tiene compras con saldo. Registra primero la factura en Compras → Registro y vuelve a extornar.</div>
            : (
            <div className="rounded-md border border-line divide-y divide-line/40 max-h-52 overflow-y-auto">
              {docs.map((d) => (
                <label key={d.id} className={cn('flex items-center gap-2.5 px-3 py-2 cursor-pointer text-[11.5px]', gastoId === d.docOrigenId && 'bg-primary/5')}>
                  <input type="radio" name="doc-extorno" checked={gastoId === d.docOrigenId} onChange={() => setGastoId(d.docOrigenId)} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{d.terceroRazon ?? d.terceroRuc}</div>
                    <div className="font-mono text-[10px] text-ink-3">{[d.docSerie, d.docNumero].filter(Boolean).join('-') || 's/n'} · emitida {d.fechaEmision}</div>
                  </div>
                  <div className="font-mono text-[11.5px]">saldo {fmtPEN(Number(d.saldoPendiente))}</div>
                </label>
              ))}
            </div>
          ))}
          <div className="rounded-md bg-bg-sunken/60 border border-line px-3 py-2 text-[10.5px] text-ink-3">
            El extorno asienta <span className="font-mono">Debe 4212 / Haber 4811</span> en el periodo de la factura y aplica el pago original a la CxP: la compra queda pagada sin registrar un pago nuevo.
          </div>
          {error && <div className="rounded-md border border-rose-300/60 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-[11.5px] text-rose-700">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button onClick={onClose} className="rounded-md border border-line px-3 py-1.5 text-[12px] hover:bg-bg-sunken">Cancelar</button>
          <button disabled={!gastoId || mut.isPending} onClick={() => { setError(null); mut.mutate(); }}
            className={cn('rounded-md px-3 py-1.5 text-[12px] font-semibold text-white bg-violet-600 hover:bg-violet-700', (!gastoId || mut.isPending) && 'opacity-50 pointer-events-none')}>
            {mut.isPending ? 'Extornando…' : 'Extornar provisión'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── F2.3 · Bandeja CPE · XML masivo → borradores → completar (cuenta + destino) o descartar ──
const TIPO_CPE_LABEL: Record<string, string> = { '01': 'Factura', '03': 'Boleta', '07': 'Nota de Crédito', '08': 'Nota de Débito' };
const CLASIF_CHIP: Record<string, { l: string; c: string }> = {
  factura: { l: 'Borrador de compra', c: 'bg-red-50 text-red-700' },
  boleta: { l: 'Gasto con boleta · no entra al RCE', c: 'bg-amber-50 text-amber-700' },
  nc: { l: 'Nota de crédito', c: 'bg-violet-50 text-violet-700' },
  nd: { l: 'Nota de débito', c: 'bg-violet-50 text-violet-700' },
  venta: { l: 'Venta emitida', c: 'bg-emerald-50 text-emerald-700' },
};

function BandejaCpeView({ proyectos }: { proyectos: { id: string; codigo: string; nombre: string }[] }) {
  const qc = useQueryClient();
  // sin filtro de rol: las VENTAS también se muestran (chip propio, sin Completar hasta F3.1) —
  // si no, un XML emitido por MM entra a la tabla pero queda invisible.
  const q = useQuery({ queryKey: ['cpe-bandeja'], queryFn: () => api.cpe.listBandeja() });
  const borradores = q.data?.borradores ?? [];
  const [subiendo, setSubiendo] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [completar, setCompletar] = useState<CpeBorrador | null>(null);
  const [completarVenta, setCompletarVenta] = useState<CpeBorrador | null>(null);
  const inval = () => { qc.invalidateQueries({ queryKey: ['cpe-bandeja'] }); qc.invalidateQueries({ queryKey: ['gas-global'] }); };
  const subir = async (files: FileList | null) => {
    if (!files?.length) return;
    setSubiendo(true); setResultado(null);
    try {
      const r = await api.cpe.subirBandeja([...files]);
      const detalles = r.resultados.filter((x) => x.estado !== 'nuevo').map((x) => `${x.archivo}: ${x.estado}${x.error ? ` (${x.error})` : ''}`);
      setResultado(`${r.resumen.nuevos} nuevo(s) en bandeja${r.resumen.rechazados ? ` · ${r.resumen.rechazados} no entraron: ${detalles.join(' · ')}` : ''}`);
      inval();
    } catch (e) {
      setResultado((e as Error).message);
    } finally {
      setSubiendo(false);
    }
  };
  const descartar = useMutation({
    mutationFn: (id: string) => api.cpe.descartar(id),
    onSuccess: () => inval(),
  });
  return (
    <div className="space-y-3">
      <label className={cn('block rounded-lg border-2 border-dashed border-line-strong bg-bg-sunken px-4 py-6 text-center cursor-pointer hover:bg-bg-elev transition-colors', subiendo && 'opacity-60 pointer-events-none')}>
        <input type="file" accept=".xml" multiple className="hidden" onChange={(e) => { subir(e.target.files); e.target.value = ''; }} />
        <div className="text-[13px] font-semibold">{subiendo ? 'Leyendo XML…' : 'Suelta aquí los XML o haz click para elegirlos'}</div>
        <div className="text-[11.5px] text-ink-3 mt-0.5">Facturas → borrador de compra · Boletas → gasto (no entran al RCE) · NC → vincula el documento · duplicados se rechazan</div>
      </label>
      {resultado && <div className="rounded-md border border-line bg-bg-elev px-3 py-2 text-[11.5px] text-ink-2">{resultado}</div>}
      <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <h3 className="text-[13px] font-semibold">Borradores pendientes <span className="text-ink-4 font-normal">{borradores.length}</span></h3>
        </div>
        {q.isLoading ? <SkelRows rows={4} />
          : borradores.length === 0 ? <div className="text-center py-8 text-[12px] text-ink-3">Bandeja vacía · sube los XML del buzón SOL o del proveedor</div>
          : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-line bg-bg-sunken">{['Comprobante', 'Emisor', 'Emisión', 'Total', 'Detracción', 'Clasificación', ''].map((h, i) => <th key={i} className={cn('px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-4', i === 3 || i === 4 ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
              <tbody>
                {borradores.map((b) => (
                  <tr key={b.id} className="border-b border-line hover:bg-bg-sunken/30">
                    <td className="px-3 py-1.5 text-[11px] font-mono whitespace-nowrap">{TIPO_CPE_LABEL[b.tipoCpe ?? ''] ?? b.tipoCpe} {[b.serie, b.numero].filter(Boolean).join('-')}</td>
                    <td className="px-3 py-1.5 text-[11.5px] max-w-[220px] truncate">{b.emisorRazon ?? b.emisorRuc ?? '—'}<div className="font-mono text-[10px] text-ink-4">{b.emisorRuc ?? ''}</div></td>
                    <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums whitespace-nowrap">{b.fechaEmision ?? '—'}</td>
                    <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums text-right font-semibold">{b.total != null ? fmtPEN(Number(b.total)) : '—'} <span className="text-[9.5px] text-ink-4">{b.moneda !== 'PEN' ? b.moneda : ''}</span></td>
                    <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums text-right text-amber-700">{b.payload.detraccion ? fmtPEN(b.payload.detraccion.monto) : '—'}</td>
                    <td className="px-3 py-1.5"><span className={cn('text-[10.5px] font-medium px-1.5 py-0.5 rounded', CLASIF_CHIP[b.clasificacion]?.c)}>{CLASIF_CHIP[b.clasificacion]?.l ?? b.clasificacion}</span></td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-right">
                      <button onClick={() => (b.rol === 'compra' ? setCompletar(b) : setCompletarVenta(b))} className="h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:opacity-90 mr-1.5">Completar</button>
                      <button onClick={() => { if (confirm(`¿Descartar ${b.serie}-${b.numero}?`)) descartar.mutate(b.id); }} className="h-7 px-2 rounded-md border border-line text-[11px] text-ink-3 hover:bg-bg-sunken">Descartar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {completar && <CompletarCpeModal borrador={completar} proyectos={proyectos} onClose={() => setCompletar(null)} onDone={() => { setCompletar(null); inval(); }} />}
      {completarVenta && <VentaModal borrador={completarVenta} onClose={() => { setCompletarVenta(null); inval(); }} />}
    </div>
  );
}

// ─── F2.3 · Completar borrador CPE → compra registrada (cuenta manual de Kelly + destino) ──
function CompletarCpeModal({ borrador: b, proyectos, onClose, onDone }: { borrador: CpeBorrador; proyectos: { id: string; codigo: string; nombre: string }[]; onClose: () => void; onDone: () => void }) {
  const [proyectoId, setProyectoId] = useState('');
  const [tipoGasto, setTipoGasto] = useState('Compra Materiales');
  const [cuenta, setCuenta] = useState<string | null>(null);
  // F3.5 · Kelly decide el periodo de anotación (crédito 12 meses) y el destino del crédito fiscal
  const [periodoContable, setPeriodoContable] = useState((b.fechaEmision ?? new Date().toISOString()).slice(0, 7));
  const [destinoCredito, setDestinoCredito] = useState<'DG' | 'DGNG' | 'DNG'>('DG');
  const [error, setError] = useState<string | null>(null);
  const p = b.payload;
  const registrar = useMutation({
    mutationFn: async () => {
      const { gasto } = await api.finanzas.createGastoGlobal({
        fecha: b.fechaEmision ?? new Date().toISOString().slice(0, 10),
        proyectoId: proyectoId || null,
        proveedorRuc: b.emisorRuc, proveedorRazon: b.emisorRazon,
        tipoComprobante: TIPO_CPE_LABEL[b.tipoCpe ?? ''] ?? 'Factura',
        serie: b.serie, numero: b.numero, moneda: b.moneda,
        // F3.5 fix · la NC se guarda con total POSITIVO: aplicar() y el motor (asiento invertido) lo esperan así
        subtotal: p.totales.valorVenta, igv: p.totales.igv, total: p.totales.total,
        tipoGasto, destino: proyectoId ? 'proyecto' : 'corporativo',
        cuentaContable: cuenta, cuentaContableOrigen: cuenta ? 'USUARIO' : null,
        periodoContable, destinoCredito,
        fechaVencimiento: p.fechaVencimiento ?? null,
        lineas: p.lineas.length
          ? p.lineas.map((l) => ({
              descripcion: l.descripcion, unidad: l.unidad, cantidad: l.cantidad || 1,
              valorUnitario: l.valorUnitario ?? (l.cantidad ? l.valorVenta / l.cantidad : l.valorVenta),
              afectacionIgv: l.afectacionIgv ?? '10', cuentaContable: cuenta,
            }))
          : undefined,
        detraccion: p.detraccion ? { codigo: p.detraccion.codigo, montoDeclarado: p.detraccion.monto } : null,
        ...(b.clasificacion === 'nc' && p.modifica ? { docModifica: { serie: p.modifica.serieNumero.split('-')[0] ?? '', numero: p.modifica.serieNumero.split('-').slice(1).join('-') } } : {}),
      } as GastoInput & { proyectoId?: string | null; docModifica?: { serie: string; numero: string } });
      if (gasto) await api.cpe.marcarRegistrado(b.id, { gastoId: gasto.id });
    },
    onSuccess: onDone,
    onError: (e: Error) => setError(e.message),
  });
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-backdropIn" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-xl max-h-[88vh] overflow-hidden rounded-xl border border-line bg-bg-elev shadow-2xl flex flex-col animate-modalPop">
        <div className="shrink-0 flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <h2 className="text-[15px] font-bold">Completar {TIPO_CPE_LABEL[b.tipoCpe ?? ''] ?? 'CPE'} {b.serie}-{b.numero}</h2>
            <p className="text-[11px] text-ink-4">{b.emisorRazon ?? b.emisorRuc} · {fmtPEN(Number(b.total ?? 0))} · {p.lineas.length} línea(s) del XML</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-md inline-flex items-center justify-center text-ink-3 hover:bg-bg-sunken"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3.5 bg-bg-sunken/40">
          <SecBox title="Lo que Kelly asigna · el resto viene del XML">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Proyecto / destino">
                <select className="h-9 w-full px-2.5 rounded-md border border-line bg-bg-elev text-[12px]" value={proyectoId} onChange={(e) => setProyectoId(e.target.value)}>
                  <option value="">Oficina / general</option>
                  {proyectos.map((pr) => <option key={pr.id} value={pr.id}>{pr.codigo} · {pr.nombre.slice(0, 38)}</option>)}
                </select>
              </Field>
              <Field label="Tipo de gasto">
                <select className="h-9 w-full px-2.5 rounded-md border border-line bg-bg-elev text-[12px]" value={tipoGasto} onChange={(e) => setTipoGasto(e.target.value)}>
                  {TIPOS_GASTO.map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Cuenta contable · manual">
              <CuentaContableSelect value={cuenta} onChange={(cod) => setCuenta(cod)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Periodo de anotación (RCE)">
                <input type="month" className="h-9 w-full px-2.5 rounded-md border border-line bg-bg-elev text-[12px]" value={periodoContable} onChange={(e) => setPeriodoContable(e.target.value)} />
              </Field>
              <Field label="Destino del crédito fiscal">
                <select className="h-9 w-full px-2.5 rounded-md border border-line bg-bg-elev text-[12px]" value={destinoCredito} onChange={(e) => setDestinoCredito(e.target.value as 'DG' | 'DGNG' | 'DNG')}>
                  <option value="DG">DG · operaciones gravadas</option>
                  <option value="DGNG">DGNG · mixtas (prorrata)</option>
                  <option value="DNG">DNG · no gravadas (IGV al costo)</option>
                </select>
              </Field>
            </div>
            {periodoContable !== (b.fechaEmision ?? '').slice(0, 7) && <div className="text-[11.5px] text-amber-700">Anotación en {periodoContable}, distinta del mes de emisión: el crédito fiscal se toma en ese periodo (límite 12 meses).</div>}
            {p.detraccion && <div className="text-[11.5px] text-amber-700">Detracción {p.detraccion.codigo} · {p.detraccion.porcentaje}% = {fmtPEN(p.detraccion.monto)} (leída del XML · sin constancia el crédito queda diferido)</div>}
            {b.clasificacion === 'boleta' && <div className="text-[11.5px] text-amber-700">Boleta: se registra como gasto, no entra al Registro de Compras ni da crédito fiscal.</div>}
            {b.clasificacion === 'nc' && p.modifica && <div className="text-[11.5px] text-violet-600">Nota de crédito de {p.modifica.serieNumero}: al registrarla devuelve el saldo a esa factura.</div>}
          </SecBox>
          <SecBox title={`Detalle del XML · ${p.lineas.length} línea(s)`}>
            <div className="max-h-44 overflow-y-auto rounded-md border border-line">
              <table className="w-full">
                <tbody>
                  {p.lineas.slice(0, 30).map((l, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      <td className="px-2.5 py-1 text-[11px] max-w-[260px] truncate">{l.descripcion}</td>
                      <td className="px-2.5 py-1 text-[10.5px] font-mono text-ink-3 text-right whitespace-nowrap">{l.cantidad} {l.unidad ?? ''}</td>
                      <td className="px-2.5 py-1 text-[11px] font-mono tabular-nums text-right">{fmtPEN(l.valorVenta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SecBox>
        </div>
        <div className="shrink-0 border-t border-line bg-bg-elev px-5 py-3">
          {error && <div className="mb-2 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-1.5 text-[11.5px] text-destructive">{error}</div>}
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-ink-3 mr-auto">Se registra: compra con {p.lineas.length || 1} línea(s), CxP{p.detraccion ? ' y detracción' : ''}.</span>
            <button onClick={onClose} className="h-9 px-4 rounded-md border border-line text-[12px] hover:bg-bg-sunken">Cancelar</button>
            <button disabled={registrar.isPending} onClick={() => { setError(null); registrar.mutate(); }} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90 disabled:opacity-50">
              <Check className="h-3.5 w-3.5" /> {registrar.isPending ? 'Registrando…' : 'Registrar compra'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Tab Caja y bancos · segmentos: Libro por cuenta · Todos los movimientos · Cuentas (+ Cajas en F3.2) ──
function CajaBancosHub({ proyectoId, proyectos }: { proyectoId: string; proyectos: { id: string; codigo: string; nombre: string }[] }) {
  const [vista, setVista] = useState<'cuenta' | 'todos' | 'cajas' | 'cuentas'>('cuenta');
  const cajasQ = useQuery({ queryKey: ['cajas'], queryFn: () => api.finanzas.listCajas() });
  const abiertas = (cajasQ.data?.cajas ?? []).filter((c) => c.estado === 'abierta').length;
  return (
    <div className="space-y-3">
      <SegTabs value={vista} onChange={setVista} opts={[
        { v: 'cuenta', l: 'Libro por cuenta' },
        { v: 'todos', l: 'Todos los movimientos' },
        { v: 'cajas', l: 'Cajas y rendiciones', n: abiertas },
        { v: 'cuentas', l: 'Cuentas' },
      ] as const} />
      {vista === 'cuenta' && <BancosView />}
      {vista === 'todos' && <GlobalLedger proyectoId={proyectoId} proyectos={proyectos} kind="movimientos" />}
      {vista === 'cajas' && <CajasView proyectos={proyectos} />}
      {vista === 'cuentas' && <TesoreriaConfig />}
    </div>
  );
}

// ─── F3.2 · Cajas por proyecto · entregado contra rendido, cruzado con el N° de operación ──
function CajasView({ proyectos }: { proyectos: { id: string; codigo: string; nombre: string }[] }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cajas'], queryFn: () => api.finanzas.listCajas() });
  const cuentasQ = useQuery({ queryKey: ['cuentas'], queryFn: () => api.finanzas.listCuentas() });
  const bancos = (cuentasQ.data?.cuentas ?? []).filter((c) => c.activo && c.tipo !== 'caja');
  const cajas = q.data?.cajas ?? [];
  const [nueva, setNueva] = useState(false);
  const [cerrar, setCerrar] = useState<CajaRow | null>(null);
  const inval = () => { qc.invalidateQueries({ queryKey: ['cajas'] }); qc.invalidateQueries({ queryKey: ['cuentas'] }); qc.invalidateQueries({ queryKey: ['mov-global'] }); invalidateResumen(qc); };
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <h3 className="text-[13px] font-semibold mr-auto">Cajas <span className="text-ink-4 font-normal">{cajas.length}</span></h3>
          <button onClick={() => setNueva(true)} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium hover:opacity-90"><Plus className="h-3.5 w-3.5" /> Nueva entrega</button>
        </div>
        {q.isLoading ? <SkelRows rows={4} />
          : cajas.length === 0 ? <div className="text-center py-8 text-[12px] text-ink-3">Sin cajas · la entrega sale del banco con su N° de operación y queda cruzada</div>
          : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-line bg-bg-sunken">{['Caja', 'Proyecto', 'Encargado', 'Apertura', 'Entregado', 'Rendido', 'Saldo', 'Docs', 'Estado', ''].map((h, i) => <th key={i} className={cn('px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-4', i >= 4 && i <= 7 ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
              <tbody>
                {cajas.map((c) => (
                  <tr key={c.id} className="border-b border-line hover:bg-bg-sunken/30">
                    <td className="px-3 py-1.5 text-[11px] font-mono">{c.codigo}</td>
                    <td className="px-3 py-1.5 text-[11px] font-mono text-ink-3">{c.proyectoCodigo ?? '—'}</td>
                    <td className="px-3 py-1.5 text-[11.5px] max-w-[160px] truncate">{c.encargado}</td>
                    <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums">{c.fechaApertura}</td>
                    <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums text-right">{fmtPEN(c.entregado)}</td>
                    <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums text-right text-ink-3">{fmtPEN(c.rendido)}</td>
                    <td className={cn('px-3 py-1.5 text-[11px] font-mono tabular-nums text-right font-semibold', c.saldo > 0.004 ? 'text-amber-700' : c.saldo < -0.004 ? 'text-rose-600' : 'text-ink-4')}>{fmtPEN(c.saldo)}</td>
                    <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums text-right text-ink-3">{c.docs}</td>
                    <td className="px-3 py-1.5"><span className={cn('text-[10.5px] font-medium px-1.5 py-0.5 rounded', c.estado === 'abierta' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700')}>{c.estado === 'abierta' ? 'Abierta' : 'Cerrada'}</span></td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-right">
                      {c.estado === 'abierta' && <button onClick={() => setCerrar(c)} className="h-7 px-2 rounded-md border border-line text-[11px] text-ink-2 hover:bg-bg-sunken">Cerrar</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-[10.5px] text-ink-4">Los gastos de la caja se registran con "Registrar movimiento" eligiendo la caja en "Sale de" (jalan facturas del proveedor igual que un banco). El libro de cada caja vive en "Libro por cuenta".</p>
      {nueva && <NuevaCajaModal proyectos={proyectos} bancos={bancos} onClose={() => setNueva(false)} onDone={() => { setNueva(false); inval(); }} />}
      {cerrar && <CerrarCajaModal caja={cerrar} bancos={bancos} onClose={() => setCerrar(null)} onDone={() => { setCerrar(null); inval(); }} />}
    </div>
  );
}

function NuevaCajaModal({ proyectos, bancos, onClose, onDone }: { proyectos: { id: string; codigo: string; nombre: string }[]; bancos: CuentaBancaria[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ proyectoId: '', encargado: '', monto: '', cuentaOrigenId: bancos[0]?.id ?? '', numOperacion: '', fecha: new Date().toISOString().slice(0, 10), notas: '' });
  const set = (x: Partial<typeof f>) => setF((s) => ({ ...s, ...x }));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.finanzas.createCaja({ proyectoId: f.proyectoId, encargado: f.encargado.trim(), monto: parseFloat(f.monto), cuentaOrigenId: f.cuentaOrigenId, numOperacion: f.numOperacion.trim(), fecha: f.fecha, notas: f.notas || null }),
    onSuccess: onDone,
    onError: (e: Error) => setError(e.message),
  });
  const valid = f.proyectoId && f.encargado.trim().length >= 2 && (parseFloat(f.monto) || 0) > 0 && f.cuentaOrigenId && f.numOperacion.trim();
  const inputCls = 'h-9 w-full px-2.5 rounded-md border border-line bg-bg-elev text-[12px]';
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-backdropIn" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-xl border border-line bg-bg-elev shadow-2xl animate-modalPop overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div><h2 className="text-[15px] font-bold">Nueva entrega a rendir</h2><p className="text-[11px] cuenta text-ink-4">Sale del banco con su N° de operación · queda cruzada con la caja</p></div>
          <button onClick={onClose} className="h-8 w-8 rounded-md inline-flex items-center justify-center text-ink-3 hover:bg-bg-sunken"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3 bg-bg-sunken/40">
          <Field label="Proyecto · obligatorio"><select className={inputCls} value={f.proyectoId} onChange={(e) => set({ proyectoId: e.target.value })}><option value="">Elegir…</option>{proyectos.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre.slice(0, 36)}</option>)}</select></Field>
          <Field label="Encargado"><input className={inputCls} value={f.encargado} onChange={(e) => set({ encargado: e.target.value })} placeholder="Andrea García" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Monto entregado"><input className={cn(inputCls, 'font-mono')} type="number" step="0.01" value={f.monto} onChange={(e) => set({ monto: e.target.value })} placeholder="0.00" /></Field>
            <Field label="Fecha"><input className={inputCls} type="date" value={f.fecha} onChange={(e) => set({ fecha: e.target.value })} /></Field>
          </div>
          <Field label="Sale de"><select className={inputCls} value={f.cuentaOrigenId} onChange={(e) => set({ cuentaOrigenId: e.target.value })}>{bancos.map((b) => <option key={b.id} value={b.id}>{b.cuentaContable ? `${b.cuentaContable} · ` : ''}{b.descripcion ?? b.codigo}</option>)}</select></Field>
          <Field label="N° de operación · obligatorio"><input className={cn(inputCls, 'font-mono')} value={f.numOperacion} onChange={(e) => set({ numOperacion: e.target.value })} placeholder="5404001" /></Field>
        </div>
        <div className="border-t border-line px-5 py-3">
          {error && <div className="mb-2 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-1.5 text-[11.5px] text-destructive">{error}</div>}
          <div className="flex items-center gap-3 justify-end">
            <button onClick={onClose} className="h-9 px-4 rounded-md border border-line text-[12px] hover:bg-bg-sunken">Cancelar</button>
            <button disabled={!valid || save.isPending} onClick={() => { setError(null); save.mutate(); }} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90 disabled:opacity-50"><Check className="h-3.5 w-3.5" /> {save.isPending ? 'Abriendo…' : 'Abrir caja'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CerrarCajaModal({ caja, bancos, onClose, onDone }: { caja: CajaRow; bancos: CuentaBancaria[]; onClose: () => void; onDone: () => void }) {
  const conSaldo = caja.saldo > 0.004;
  const [f, setF] = useState({ fecha: new Date().toISOString().slice(0, 10), cuentaDestinoId: bancos[0]?.id ?? '', numOperacion: '' });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.finanzas.cerrarCaja(caja.id, { fecha: f.fecha, devolucion: conSaldo ? { cuentaDestinoId: f.cuentaDestinoId, numOperacion: f.numOperacion.trim() } : null }),
    onSuccess: onDone,
    onError: (e: Error) => setError(e.message),
  });
  const valid = !conSaldo || (f.cuentaDestinoId && f.numOperacion.trim());
  const inputCls = 'h-9 w-full px-2.5 rounded-md border border-line bg-bg-elev text-[12px]';
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-backdropIn" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-xl border border-line bg-bg-elev shadow-2xl animate-modalPop overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div><h2 className="text-[15px] font-bold">Cerrar {caja.codigo}</h2><p className="text-[11px] text-ink-4">Entregado {fmtPEN(caja.entregado)} · rendido {fmtPEN(caja.rendido)} · saldo <b className="font-mono">{fmtPEN(caja.saldo)}</b></p></div>
          <button onClick={onClose} className="h-8 w-8 rounded-md inline-flex items-center justify-center text-ink-3 hover:bg-bg-sunken"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3 bg-bg-sunken/40">
          <Field label="Fecha de cierre"><input className={inputCls} type="date" value={f.fecha} onChange={(e) => setF((s) => ({ ...s, fecha: e.target.value }))} /></Field>
          {conSaldo ? (
            <>
              <div className="text-[11.5px] text-amber-700">El saldo de {fmtPEN(caja.saldo)} se devuelve al banco (o regístralo antes como gasto desde la caja).</div>
              <Field label="Devolver a"><select className={inputCls} value={f.cuentaDestinoId} onChange={(e) => setF((s) => ({ ...s, cuentaDestinoId: e.target.value }))}>{bancos.map((b) => <option key={b.id} value={b.id}>{b.cuentaContable ? `${b.cuentaContable} · ` : ''}{b.descripcion ?? b.codigo}</option>)}</select></Field>
              <Field label="N° de operación de la devolución"><input className={cn(inputCls, 'font-mono')} value={f.numOperacion} onChange={(e) => setF((s) => ({ ...s, numOperacion: e.target.value }))} placeholder="5404099" /></Field>
            </>
          ) : (
            <div className="text-[11.5px] text-emerald-700">Saldo en cero: la caja se cierra y su cuenta se desactiva.</div>
          )}
        </div>
        <div className="border-t border-line px-5 py-3">
          {error && <div className="mb-2 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-1.5 text-[11.5px] text-destructive">{error}</div>}
          <div className="flex items-center gap-3 justify-end">
            <button onClick={onClose} className="h-9 px-4 rounded-md border border-line text-[12px] hover:bg-bg-sunken">Cancelar</button>
            <button disabled={!valid || save.isPending} onClick={() => { setError(null); save.mutate(); }} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90 disabled:opacity-50"><Check className="h-3.5 w-3.5" /> {save.isPending ? 'Cerrando…' : 'Cerrar caja'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Cards de tesorería (mudadas del Resumen v1): agregar cuenta + asignar divisionaria 104x
function TesoreriaConfig() {
  const q = useQuery({ queryKey: ['finanzas-resumen', 'todos'], queryFn: () => api.finanzas.getResumen('todos') });
  if (q.isLoading) return <SkelCards count={3} />;
  if (!q.data) return null;
  return <Tesoreria r={q.data} />;
}

// ─── F2.1 · Registro de ventas (valorizaciones con comprobante) ──
function VentasView({ proyectoId }: { proyectoId: string }) {
  const q = useQuery({ queryKey: ['ventas-global', proyectoId], queryFn: () => api.finanzas.listVentas(proyectoId) });
  const ventas = q.data?.ventas ?? [];
  const st = q.data?.stats;
  const [nueva, setNueva] = useState(false);
  const csv = () => {
    const head = ['Emisión', 'Obra', 'Valo', 'Comprobante', 'Cuenta', 'Base', 'IGV', 'Total', 'Detracción', 'Retención', 'Estado'];
    const lines = ventas.map((v) => [v.fechaEmision, v.proyectoCodigo ?? '', `VAL-${v.numero}`, [v.comprobanteSerie, v.comprobanteNumero].filter(Boolean).join('-'), v.cuentaContable ?? '', Number(v.base).toFixed(2), Number(v.igv).toFixed(2), v.total.toFixed(2), v.detraccion != null ? v.detraccion.toFixed(2) : '', v.retencion ? Number(v.retencion).toFixed(2) : '', v.status].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'));
    const blob = new Blob(['﻿' + [head.join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ventas_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Facturado" value={fmtPEN(st?.total ?? 0)} icon={<Receipt className="h-4 w-4" />} tone="ok" sub={`${st?.count ?? 0} valorizaciones`} />
        <Kpi label="Por cobrar" value={fmtPEN(st?.porCobrar ?? 0)} icon={<ArrowUpRight className="h-4 w-4" />} tone="info" />
        <Kpi label="Detracción retenida" value={fmtPEN(st?.detraccion ?? 0)} icon={<ShieldCheck className="h-4 w-4" />} tone="warn" sub="cliente deposita al BN" />
        <Kpi label="Retención de garantía" value={fmtPEN(st?.retencion ?? 0)} icon={<ShieldCheck className="h-4 w-4" />} sub="cuenta 12122" />
      </div>
      <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <h3 className="text-[13px] font-semibold mr-auto">Registro de ventas <span className="text-ink-4 font-normal">{ventas.length}</span></h3>
          <button onClick={csv} disabled={ventas.length === 0} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-line text-[11.5px] font-medium hover:bg-bg-sunken disabled:opacity-40"><Download className="h-3.5 w-3.5" /> CSV</button>
          <button onClick={() => setNueva(true)} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium hover:opacity-90"><Plus className="h-3.5 w-3.5" /> Nueva venta</button>
        </div>
        {q.isLoading ? <SkelRows rows={6} />
          : ventas.length === 0 ? <div className="text-center py-8 text-[12px] text-ink-3">Sin ventas registradas · las valorizaciones facturadas aparecen aquí</div>
          : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-line bg-bg-sunken">{['Emisión', 'Obra', 'Valo', 'Comprobante', 'Cuenta', 'Base', 'IGV', 'Total', 'Detracción', 'Ret. garantía', 'Estado'].map((h, i) => <th key={i} className={cn('px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-4', i >= 5 && i <= 9 ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
              <tbody>
                {ventas.map((v) => (
                  <tr key={v.id} className="border-b border-line hover:bg-bg-sunken/30">
                    <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums whitespace-nowrap">{String(v.fechaEmision).slice(0, 10)}</td>
                    <td className="px-3 py-1.5 text-[11px] font-mono text-ink-3">{v.proyectoCodigo ?? '—'}</td>
                    <td className="px-3 py-1.5 text-[11px] font-mono">VAL-{String(v.numero).padStart(2, '0')}</td>
                    <td className="px-3 py-1.5 text-[11px] font-mono whitespace-nowrap">{[v.comprobanteSerie, v.comprobanteNumero].filter(Boolean).join('-') || <span className="text-warn-ink">sin comprobante</span>}</td>
                    <td className="px-3 py-1.5 text-[11px] font-mono text-ink-3">{v.cuentaContable ?? '7041'}</td>
                    <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums text-right">{fmtPEN(Number(v.base))}</td>
                    <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums text-right text-ink-3">{fmtPEN(Number(v.igv))}</td>
                    <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums text-right font-semibold">{fmtPEN(v.total)}</td>
                    <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums text-right text-amber-700">{v.detraccion != null ? fmtPEN(v.detraccion) : '—'}</td>
                    <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums text-right text-ink-3">{Number(v.retencion ?? 0) > 0 ? fmtPEN(Number(v.retencion)) : '—'}</td>
                    <td className="px-3 py-1.5"><span className={cn('text-[10.5px] font-medium px-1.5 py-0.5 rounded', v.cobrada ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{v.cobrada ? 'Cobrada' : v.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-[10.5px] text-ink-4">Registro 14.1 · valorizaciones facturadas + ventas standalone (contrato / adicional / directa). El cobro se registra en Caja y bancos aplicando a la factura.</p>
      {nueva && <VentaModal onClose={() => setNueva(false)} />}
    </div>
  );
}

// ─── F3.1 · Nueva venta standalone (factura ya emitida · alimenta 14.1/RVIE con serie real) ──
function VentaModal({ onClose, borrador }: { onClose: () => void; borrador?: CpeBorrador }) {
  const qc = useQueryClient();
  const proyectosQ = useQuery({ queryKey: ['proyectos-list'], queryFn: () => api.proyectos.list() });
  const proyectos = proyectosQ.data?.proyectos ?? [];
  const p = borrador?.payload;
  const [f, setF] = useState({
    clienteRuc: p?.cliente?.numero ?? '',
    clienteRazon: p?.cliente?.razonSocial ?? '',
    tipoCpe: (borrador?.tipoCpe ?? '01') as '01' | '03' | '07' | '08',
    serie: borrador?.serie ?? '', numero: borrador?.numero ?? '',
    fechaEmision: borrador?.fechaEmision ?? new Date().toISOString().slice(0, 10),
    fechaVencimiento: p?.fechaVencimiento ?? '',
    base: p ? String(p.totales.valorVenta) : '',
    proyectoId: '', numContrato: '',
    formaPago: (p?.formaPago ?? 'Contado') as 'Contado' | 'Credito',
    retencion3: (p?.retencion?.monto ?? 0) > 0, comprobanteRetencion: '',
    detraccionCodigo: p?.detraccion?.codigo ?? '',
    docModSerie: p?.modifica?.serieNumero?.split('-')[0] ?? '', docModNumero: p?.modifica?.serieNumero?.split('-').slice(1).join('-') ?? '',
    descripcion: p?.lineas?.[0]?.descripcion ?? '',
  });
  const set = (x: Partial<typeof f>) => setF((s) => ({ ...s, ...x }));
  const [cuenta, setCuenta] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esNc = f.tipoCpe === '07';
  const base = parseFloat(f.base) || 0;
  const igv = Math.round(base * 18) / 100;
  const total = Math.round((base + igv) * 100) / 100;
  const retencion = f.retencion3 ? Math.round(total * 3) / 100 : 0;
  const save = useMutation({
    mutationFn: async () => {
      const { venta } = await api.finanzas.createVenta({
        clienteRuc: f.clienteRuc || null, clienteRazon: f.clienteRazon || null,
        tipoCpe: f.tipoCpe, serie: f.serie, numero: f.numero,
        fechaEmision: f.fechaEmision, fechaVencimiento: f.fechaVencimiento || null,
        base, igv, total,
        cuentaContable: cuenta, cuentaContableOrigen: cuenta ? 'USUARIO' : null,
        origenTipo: f.numContrato ? 'contrato' : 'directa', numContrato: f.numContrato || null,
        proyectoId: f.proyectoId || null,
        formaPago: f.formaPago,
        cuotas: f.formaPago === 'Credito' && f.fechaVencimiento ? [{ monto: Math.round((total - retencion) * 100) / 100, vence: f.fechaVencimiento }] : null,
        retencionIgv: retencion, comprobanteRetencion: f.comprobanteRetencion || null,
        // montoDeclarado: lo que dice el XML · si difiere del calculado con la tabla vigente, queda la evidencia
        detraccion: f.detraccionCodigo ? { codigo: f.detraccionCodigo, montoDeclarado: p?.detraccion?.codigo === f.detraccionCodigo ? p.detraccion.monto : null } : null,
        docModifica: esNc && f.docModSerie ? { serie: f.docModSerie, numero: f.docModNumero } : null,
        motivoNota: esNc ? '01' : null,
        lineas: p?.lineas?.length ? p.lineas.map((l) => ({ descripcion: l.descripcion, cantidad: l.cantidad || 1, unidad: l.unidad, valorVenta: l.valorVenta, igv: l.igv })) : null,
        descripcion: f.descripcion || null,
      });
      if (borrador) await api.cpe.marcarRegistrado(borrador.id, { ventaId: venta.id });
      return venta;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ventas-global'] });
      qc.invalidateQueries({ queryKey: ['cpe-bandeja'] });
      invalidateResumen(qc);
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });
  const valid = f.serie.trim() && f.numero.trim() && f.fechaEmision && base > 0 && (!esNc || f.docModSerie.trim());
  const inputCls = 'h-9 w-full px-2.5 rounded-md border border-line bg-bg-elev text-[12px]';
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-backdropIn" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-xl max-h-[88vh] overflow-hidden rounded-xl border border-line bg-bg-elev shadow-2xl flex flex-col animate-modalPop">
        <div className="shrink-0 flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <h2 className="text-[15px] font-bold">{borrador ? `Completar venta ${borrador.serie}-${borrador.numero}` : 'Registrar venta'}</h2>
            <p className="text-[11px] text-ink-4">Factura ya emitida · alimenta el 14.1/RVIE con serie y número reales</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-md inline-flex items-center justify-center text-ink-3 hover:bg-bg-sunken"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3.5 bg-bg-sunken/40">
          <SecBox title="Documento">
            <div className="grid grid-cols-[1fr_90px_110px] gap-3">
              <Field label="Tipo"><select className={inputCls} value={f.tipoCpe} onChange={(e) => set({ tipoCpe: e.target.value as typeof f.tipoCpe })} disabled={!!borrador}><option value="01">01 · Factura</option><option value="03">03 · Boleta</option><option value="07">07 · Nota de crédito</option><option value="08">08 · Nota de débito</option></select></Field>
              <Field label="Serie"><input className={cn(inputCls, 'font-mono')} value={f.serie} onChange={(e) => set({ serie: e.target.value })} disabled={!!borrador} placeholder="E001" /></Field>
              <Field label="Número"><input className={cn(inputCls, 'font-mono')} value={f.numero} onChange={(e) => set({ numero: e.target.value })} disabled={!!borrador} placeholder="52" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Emisión"><input className={inputCls} type="date" value={f.fechaEmision} onChange={(e) => set({ fechaEmision: e.target.value })} /></Field>
              <Field label="Vencimiento" right="si es crédito"><input className={inputCls} type="date" value={f.fechaVencimiento ?? ''} onChange={(e) => set({ fechaVencimiento: e.target.value })} /></Field>
            </div>
            {esNc && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Modifica · serie"><input className={cn(inputCls, 'font-mono')} value={f.docModSerie} onChange={(e) => set({ docModSerie: e.target.value })} placeholder="E001" /></Field>
                <Field label="Modifica · número"><input className={cn(inputCls, 'font-mono')} value={f.docModNumero} onChange={(e) => set({ docModNumero: e.target.value })} placeholder="52" /></Field>
              </div>
            )}
          </SecBox>
          <SecBox title="Cliente y destino">
            <div className="grid grid-cols-[130px_1fr] gap-3">
              <Field label="RUC"><input className={cn(inputCls, 'font-mono')} value={f.clienteRuc} onChange={(e) => set({ clienteRuc: e.target.value.replace(/\D/g, '') })} maxLength={11} /></Field>
              <Field label="Razón social"><input className={inputCls} value={f.clienteRazon} onChange={(e) => set({ clienteRazon: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Proyecto" right="opcional"><select className={inputCls} value={f.proyectoId} onChange={(e) => set({ proyectoId: e.target.value })}><option value="">Sin proyecto</option>{proyectos.map((pr) => <option key={pr.id} value={pr.id}>{pr.codigo} · {pr.nombre.slice(0, 34)}</option>)}</select></Field>
              <Field label="N° contrato" right="documento no condicional"><input className={cn(inputCls, 'font-mono')} value={f.numContrato} onChange={(e) => set({ numContrato: e.target.value })} placeholder="CT-2026-004" /></Field>
            </div>
            <Field label="Cuenta de ingreso · manual" right="default 7041"><CuentaContableSelect value={cuenta} onChange={(c) => setCuenta(c)} /></Field>
          </SecBox>
          <SecBox title="Montos y tributos">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Base (sin IGV)"><input className={cn(inputCls, 'font-mono')} type="number" step="0.01" value={f.base} onChange={(e) => set({ base: e.target.value })} /></Field>
              <Field label="IGV 18%"><div className={cn(inputCls, 'font-mono flex items-center text-ink-3')}>{igv.toFixed(2)}</div></Field>
              <Field label="Total"><div className={cn(inputCls, 'font-mono flex items-center font-bold')}>{total.toFixed(2)}</div></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Detracción · código" right={p?.detraccion ? `del XML · ${p.detraccion.porcentaje}%` : 'vacío = no sujeta'}><input className={cn(inputCls, 'font-mono')} value={f.detraccionCodigo} onChange={(e) => set({ detraccionCodigo: e.target.value.replace(/\D/g, '').slice(0, 3) })} placeholder="030" /></Field>
              <Field label="Forma de pago · RVIE"><div className="flex gap-2 h-9 items-center">
                {(['Contado', 'Credito'] as const).map((m) => (
                  <button key={m} type="button" onClick={() => set({ formaPago: m })} className={cn('flex-1 h-9 rounded-md border text-[11.5px] font-medium', f.formaPago === m ? 'border-primary bg-primary/5 text-primary' : 'border-line text-ink-3 hover:bg-bg-sunken')}>{m}</button>
                ))}</div></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer text-[11.5px] h-9"><input type="checkbox" checked={f.retencion3} onChange={(e) => set({ retencion3: e.target.checked })} className="rounded border-line" /> Cliente agente · retiene IGV 3%{retencion > 0 ? ` · −${fmtPEN(retencion)}` : ''}</label>
              {f.retencion3 && <Field label="Comprobante de retención" right="→ 40114"><input className={cn(inputCls, 'font-mono')} value={f.comprobanteRetencion} onChange={(e) => set({ comprobanteRetencion: e.target.value })} placeholder="R001-0045" /></Field>}
            </div>
            {(retencion > 0 || f.detraccionCodigo) && <div className="text-[11px] text-ink-3">Neto a cobrar estimado: <span className="font-mono font-semibold text-foreground">{fmtPEN(total - retencion - (p?.detraccion?.monto ?? 0))}</span>{f.detraccionCodigo && !p?.detraccion ? ' (menos la detracción que calcule el sistema)' : ''}</div>}
            <Field label="Descripción" right="opcional"><input className={inputCls} value={f.descripcion} onChange={(e) => set({ descripcion: e.target.value })} /></Field>
          </SecBox>
        </div>
        <div className="shrink-0 border-t border-line bg-bg-elev px-5 py-3">
          {error && <div className="mb-2 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-1.5 text-[11.5px] text-destructive">{error}</div>}
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-ink-3 mr-auto">Se registra: venta en el 14.1, CxC {esNc ? '(la NC devuelve saldo a la factura)' : `de ${fmtPEN(total)}`}{f.detraccionCodigo ? ' y detracción' : ''}.</span>
            <button onClick={onClose} className="h-9 px-4 rounded-md border border-line text-[12px] hover:bg-bg-sunken">Cancelar</button>
            <button disabled={!valid || save.isPending} onClick={() => { setError(null); save.mutate(); }} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90 disabled:opacity-50">
              <Check className="h-3.5 w-3.5" /> {save.isPending ? 'Registrando…' : 'Registrar venta'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── F2.1 · Libro banco por cuenta (N° de operación · cargo/abono) ──
function BancosView() {
  const cuentasQ = useQuery({ queryKey: ['cuentas'], queryFn: () => api.finanzas.listCuentas() });
  const movQ = useQuery({ queryKey: ['mov-global', 'todos'], queryFn: () => api.finanzas.listMovimientosGlobal() });
  const cuentas = (cuentasQ.data?.cuentas ?? []).filter((c) => c.activo);
  const [cuentaSel, setCuentaSel] = useState<string>('');
  const cuentaId = cuentaSel || cuentas[0]?.id || '';
  const cuenta = cuentas.find((c) => c.id === cuentaId);
  const [page, setPage] = useState(0);
  const PAGE = 15;
  const movs = useMemo(() => (movQ.data?.movimientos ?? []).filter((m) => m.cuentaId === cuentaId), [movQ.data, cuentaId]);
  const cargos = movs.filter((m) => m.tipoMovimiento === 'Egreso').reduce((s, m) => s + Number(m.monto), 0);
  const abonos = movs.filter((m) => m.tipoMovimiento === 'Ingreso').reduce((s, m) => s + Number(m.monto), 0);
  const totalPages = Math.max(1, Math.ceil(movs.length / PAGE));
  const pageSafe = Math.min(page, totalPages - 1);
  const movsPage = movs.slice(pageSafe * PAGE, pageSafe * PAGE + PAGE);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Abonos" value={fmtPEN(abonos)} icon={<ArrowUpRight className="h-4 w-4" />} tone="ok" />
        <Kpi label="Cargos" value={fmtPEN(cargos)} icon={<ArrowDownRight className="h-4 w-4" />} tone="warn" />
        <Kpi label="Saldo del libro" value={fmtPEN(abonos - cargos)} icon={<Wallet className="h-4 w-4" />} tone="info" sub={cuenta ? `${cuenta.cuentaContable ?? 'sin cuenta contable'}` : undefined} />
      </div>
      <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <h3 className="text-[13px] font-semibold mr-auto">Libro banco <span className="text-ink-4 font-normal">{movs.length} movimientos</span></h3>
          <select value={cuentaId} onChange={(e) => { setCuentaSel(e.target.value); setPage(0); }} className="h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] max-w-[320px]">
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.cuentaContable ? `${c.cuentaContable} · ` : ''}{c.banco ?? ''} {c.codigo} · {c.descripcion ?? ''}</option>)}
          </select>
        </div>
        {movQ.isLoading || cuentasQ.isLoading ? <SkelRows rows={8} />
          : movs.length === 0 ? <div className="text-center py-8 text-[12px] text-ink-3">Sin movimientos en esta cuenta</div>
          : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-line bg-bg-sunken">{['Fecha', 'Descripción', 'N° operación', 'Comprobante', 'Contraparte', 'Cargo', 'Abono'].map((h, i) => <th key={i} className={cn('px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-4', i >= 5 ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
              <tbody>
                {movsPage.map((m) => {
                  const ing = m.tipoMovimiento === 'Ingreso';
                  return (
                    <tr key={m.id} className="border-b border-line hover:bg-bg-sunken/30">
                      <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums whitespace-nowrap">{m.fecha}</td>
                      <td className="px-3 py-1.5 text-[11.5px] max-w-[240px] truncate">{m.descripcion ?? m.fuenteMovimiento ?? '—'}</td>
                      <td className="px-3 py-1.5 text-[11px] font-mono">{m.numOperacion ?? <span className="text-warn-ink">—</span>}</td>
                      <td className="px-3 py-1.5 text-[11px] font-mono text-ink-3 whitespace-nowrap">{[m.serie, m.numero].filter(Boolean).join('-') || '—'}</td>
                      <td className="px-3 py-1.5 text-[11.5px] text-ink-3 max-w-[150px] truncate">{m.clienteNombre ?? '—'}</td>
                      <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums text-right text-warn-ink">{!ing ? fmtPEN(Number(m.monto)) : ''}</td>
                      <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums text-right text-ok">{ing ? fmtPEN(Number(m.monto)) : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-3"><Pager page={pageSafe} totalPages={totalPages} count={movs.length} per={PAGE} onPage={setPage} /></div>
          </>
        )}
      </div>
      <p className="text-[10.5px] text-ink-4">El N° de operación es obligatorio para conciliar contra el extracto · cada salida apunta a su documento, caja o glosa.</p>
    </div>
  );
}

// ─── Modales ─────────────────────────────────────────────────
function CuentaModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ codigo: '', banco: '', moneda: 'PEN', descripcion: '' });
  const create = useMutation({ mutationFn: () => api.finanzas.createCuenta(f), onSuccess: onDone });
  return (
    <Modal title="Agregar cuenta" onClose={onClose}>
      <div className="space-y-2.5">
        <Field label="Descripción"><input className={inputCls} placeholder="Cuenta Corriente Principal" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></Field>
        <Field label="N° de cuenta / código"><input className={inputCls} placeholder="194-9927833-0-39 · REND-KELY" value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Banco"><input className={inputCls} placeholder="BCP · BBVA · efectivo" value={f.banco} onChange={(e) => setF({ ...f, banco: e.target.value })} /></Field>
          <Field label="Moneda"><select className={inputCls} value={f.moneda} onChange={(e) => setF({ ...f, moneda: e.target.value })}><option>PEN</option><option>USD</option></select></Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-bg-sunken">Cancelar</button>
          <button disabled={!f.codigo || create.isPending} onClick={() => create.mutate()} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-50">{create.isPending ? 'Guardando...' : 'Crear cuenta'}</button>
        </div>
      </div>
    </Modal>
  );
}

type MovTipo = 'Ingreso' | 'Egreso' | 'Bancario';
const SUBTIPOS_BANC = ['Transferencia entre cuentas', 'Comisión bancaria', 'ITF', 'Mantenimiento', 'Otros'];
// Catálogos canónicos (deben coincidir con la plantilla maestra · TiposDocumento / TiposGasto)
const TIPOS_COMP = ['Factura', 'Boleta', 'Recibo por Honorarios', 'Nota de Crédito', 'Sin Comprobante', 'Contrato', 'Invoice', 'Recibo de servicios'];
const DETRAC_PCT = [{ v: '4', l: '4% · Construcción' }, { v: '10', l: '10% · Servicios diversos' }, { v: '12', l: '12% · Intermediación' }, { v: '1.5', l: '1.5% · Comisión mercantil' }];
const TIPOS_GASTO = [
  'Compra Materiales', 'Servicio Terceros', 'Movilidad', 'Viáticos', 'Seguro', 'Servicios básicos',
  'Comisión', 'Planilla', 'Cliente', 'Socio', 'Varios', 'Impuestos', 'Mantenimiento', 'Devolucion',
  'Gasto Bancario', 'Herramientas', 'Maquinaria y equipo', 'EPPS', 'Abono de cliente', 'Prestamo otorgado',
  'Prestamo recibido', 'Gasto Administrativo', 'Combustible', 'Otros', 'Alquileres', 'Utiles de oficina', 'Nota de Credito',
];
const TIPOS_INVENTARIABLES = new Set(['Herramientas', 'Maquinaria y equipo', 'EPPS']);

// ─── F5.2 · saldo de obra por bolsa (CD y GG) · compartido V1/V2 ──────────────
// Muestra "queda" de cada bolsa, resalta la que el gasto afecta; GG solo tiene tope
// propio cuando el contrato lo separa (ggUtModo separado), si no va dentro del CD.
function excedenteBolsa(c: CostosObra | undefined, clase: string | null, monto: number): number {
  if (!c || !(monto > 0)) return 0;
  if (clase === 'GG_OBRA') {
    if (c.ggObra.presupuesto == null) return 0; // GG embebido en el CD · sin tope propio
    return Math.max(0, Math.round((monto - (c.ggObra.presupuesto - c.ggObra.ejecutado)) * 100) / 100);
  }
  // default CD (clase aún no derivada = el destino típico del gasto de obra)
  return Math.max(0, Math.round((monto - (c.cd.presupuesto - c.cd.ejecutado)) * 100) / 100);
}

function SaldoObraBox({ c, clase }: { c: CostosObra; clase: 'CD' | 'GG_OBRA' | 'GG_CORP' | null }) {
  const cdQueda = c.cd.presupuesto - c.cd.ejecutado;
  const ggQueda = c.ggObra.presupuesto != null ? c.ggObra.presupuesto - c.ggObra.ejecutado : null;
  const afectaCd = clase == null || clase === 'CD';
  const afectaGg = clase === 'GG_OBRA';
  return (
    <div className="mt-2 rounded-md bg-bg-sunken/60 border border-line p-2 text-[10.5px] space-y-0.5">
      <div className="flex items-center justify-between font-semibold text-ink-2"><span>Saldo de esta obra</span><span className="text-ink-4 font-normal">presupuesto − ejecutado</span></div>
      <div className={cn('flex justify-between', afectaCd && 'font-semibold')}>
        <span>CD{afectaCd ? ' ← este gasto' : ''} · ejecutado {fmtPEN(c.cd.ejecutado)} de {fmtPEN(c.cd.presupuesto)}</span>
        <span className={cn('font-mono font-semibold', cdQueda < 0 ? 'text-rose-600' : 'text-emerald-600')}>queda {fmtPEN(cdQueda)}</span>
      </div>
      <div className={cn('flex justify-between', afectaGg && 'font-semibold')}>
        {ggQueda != null ? (
          <>
            <span>GG obra{afectaGg ? ' ← este gasto' : ''} · ejecutado {fmtPEN(c.ggObra.ejecutado)} de {fmtPEN(c.ggObra.presupuesto!)}</span>
            <span className={cn('font-mono font-semibold', ggQueda < 0 ? 'text-rose-600' : 'text-emerald-600')}>queda {fmtPEN(ggQueda)}</span>
          </>
        ) : (
          <>
            <span>GG obra{afectaGg ? ' ← este gasto' : ''} · ejecutado {fmtPEN(c.ggObra.ejecutado)}</span>
            <span className="text-ink-4">GG dentro del CD · sin tope propio</span>
          </>
        )}
      </div>
      <div className="flex justify-between text-ink-3"><span>Resultado de obra a hoy</span><span className="font-mono">{fmtPEN(c.resultadoObra)}</span></div>
    </div>
  );
}

// ═══ F5.3 · MovModalV2 · formulario del mockup (confirmado por Kelly/Mario) · BETA en paralelo ═══
// Steps Documento/Proveedor/Detalle/Tributos/Pago/Destino + sidebar Totales/Se registra.
// Cubre compra y gasto completos (líneas con partida+cuenta, detracción por código con constancia,
// retención tipada, período de anotación, destino del crédito, pago parcial, RUC lookup, OC 3-way).
// Bancario/Ingreso: campos básicos (las aplicaciones a facturas siguen en el clásico hasta el swap).
const TIPOS_CPE_COMPRA = [
  ['01', '01 · Factura'], ['03', '03 · Boleta'], ['07', '07 · Nota de crédito'], ['08', '08 · Nota de débito'],
  ['02', '02 · Recibo por honorarios'], ['00', '00 · Sin comprobante'],
] as const;
const TIPO_CPE_NOMBRE: Record<string, string> = { '01': 'Factura', '03': 'Boleta', '07': 'Nota de Crédito', '08': 'Nota de Débito', '02': 'Recibo por Honorarios', '00': 'Sin comprobante' };

type MovV2Prefill = {
  // F6 · «Registrar desde extracto»: la línea del banco precarga el formulario y elige la entrada
  entrada?: 'compra' | 'gasto' | 'pago' | 'bancario' | 'ingreso';
  fecha?: string; monto?: number; numOperacion?: string | null; cuentaId?: string | null; descripcion?: string | null;
};

function MovModalV2({ proyectos, defaultProyecto, onClose, prefill, onRegistrado }: {
  proyectos: { id: string; codigo: string; nombre: string }[]; defaultProyecto: string; onClose: () => void;
  prefill?: MovV2Prefill;
  onRegistrado?: (movimientoId: string | null) => void; // F6 · para auto-conciliar la línea del extracto
}) {
  const qc = useQueryClient();
  const hoy = new Date().toISOString().slice(0, 10);
  type Entrada = 'compra' | 'gasto' | 'pago' | 'bancario' | 'ingreso';
  const [entrada, setEntrada] = useState<Entrada>(prefill?.entrada ?? 'compra');
  const esCompraGasto = entrada === 'compra' || entrada === 'gasto';
  const esPagoIngreso = entrada === 'pago' || entrada === 'ingreso';

  // ── Documento ──
  const [doc, setDoc] = useState({ tipo: '01', serie: '', numero: '', fechaEmision: hoy, fechaVencimiento: '', periodoContable: hoy.slice(0, 7), moneda: 'PEN', tipoCambio: '', modSerie: '', modNumero: '' });
  const dset = (p: Partial<typeof doc>) => setDoc((s) => ({ ...s, ...p }));
  const esNC = doc.tipo === '07';
  const esBoleta = doc.tipo === '03';
  const sinCpe = entrada === 'gasto' || doc.tipo === '00';
  // ── Proveedor ──
  const [prov, setProv] = useState({ ruc: '', razon: '', estadoSunat: '', condicionSunat: '', fuente: '' });
  const [rucBuscando, setRucBuscando] = useState(false);
  const [cuentaSug, setCuentaSug] = useState<string | null>(null);
  // ── Detalle por líneas ──
  type LineaV2 = { descripcion: string; unidad: string; cantidad: string; pu: string; partidaId: string; cuenta: string; inv: boolean };
  const lineaVacia: LineaV2 = { descripcion: '', unidad: 'UND', cantidad: '1', pu: '', partidaId: '', cuenta: '', inv: false };
  const [lineas, setLineas] = useState<LineaV2[]>([{ ...lineaVacia }]);
  const lset = (i: number, p: Partial<LineaV2>) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const [aplicaIgv, setAplicaIgv] = useState(true);
  // ── Tributos ──
  const [trib, setTrib] = useState({ detCodigo: '', constNumero: '', constFecha: '', destinoCredito: 'DG' as 'DG' | 'DGNG' | 'DNG', retencion: 'no' as 'no' | 'igv3' | 'renta4ta', percepcion: false });
  const tset = (p: Partial<typeof trib>) => setTrib((s) => ({ ...s, ...p }));
  // ── Pago ──
  const [pago, setPago] = useState({ estado: 'pendiente' as 'pagado' | 'parcial' | 'pendiente', importe: '', cuentaId: '', numOperacion: '', fecha: hoy });
  const pset = (p: Partial<typeof pago>) => setPago((s) => ({ ...s, ...p }));
  // ── Destino ──
  const [proyectoId, setProyectoId] = useState(defaultProyecto === 'todos' ? '' : defaultProyecto);
  const [tipoGasto, setTipoGasto] = useState('Compra Materiales');
  const [sobrecostoOk, setSobrecostoOk] = useState(false);
  const [glosa, setGlosa] = useState('');
  // F5.4 · prorrateo (solo entrada Gasto: un comprobante repartido chocaría con el dedup de compras)
  const [prorratear, setProrratear] = useState(false);
  const [reparto, setReparto] = useState<{ proyectoId: string; monto: string }[]>([{ proyectoId: '', monto: '' }, { proyectoId: '', monto: '' }]);
  const repartoObras = useMemo(() => [...new Set(reparto.map((r) => r.proyectoId).filter(Boolean))], [reparto]);
  const repartoCostosQ = useQueries({ queries: (prorratear ? repartoObras : []).map((pid) => ({ queryKey: ['costos-obra', pid], queryFn: () => api.proyectos.getCostosObra(pid) })) });
  const costosPorObra = useMemo(() => {
    const m = new Map<string, CostosObra>();
    repartoObras.forEach((pid, i) => { const d = repartoCostosQ[i]?.data; if (d) m.set(pid, d); });
    return m;
  }, [repartoObras, repartoCostosQ]);
  // ── Pago / Bancario / Ingreso ──
  const [bi, setBi] = useState({
    fecha: prefill?.fecha ?? hoy,
    monto: prefill?.monto != null ? String(Math.abs(prefill.monto)) : '',
    cuentaId: prefill?.cuentaId ?? '', cuentaDestinoId: '',
    numOperacion: prefill?.numOperacion ?? '', ruc: '', contraparte: '',
    descripcion: prefill?.descripcion ?? '',
  });
  const biset = (p: Partial<typeof bi>) => setBi((s) => ({ ...s, ...p }));
  // F5.4 · swap: aplicaciones a facturas (F2.2), provisión 48 y cuenta contra manual viven ahora en V2
  const [aplicSel, setAplicSel] = useState<Record<string, string>>({});
  const [pago48, setPago48] = useState(false); // pago sin factura → 4811
  const [cuentaContra, setCuentaContra] = useState<string | null>(null); // cuenta contra manual (Kelly)
  const pendTerm = /^\d{11}$/.test(bi.ruc) ? bi.ruc : bi.contraparte;
  const pendQ = useQuery({
    queryKey: ['docs-pend', entrada === 'ingreso' ? 'cxc' : 'cxp', pendTerm],
    queryFn: () => api.finanzas.listDocumentosPendientes(entrada === 'ingreso' ? 'cxc' : 'cxp', pendTerm),
    enabled: esPagoIngreso && pendTerm.trim().length >= 3,
  });
  const docsPend = pendQ.data?.documentos ?? [];
  const apList = Object.entries(aplicSel).map(([documentoPendienteId, m]) => ({ documentoPendienteId, monto: parseFloat(m) || 0 })).filter((a) => a.monto > 0);
  const totalAplicado = apList.reduce((s, a) => s + a.monto, 0);

  const [error, setError] = useState<string | null>(null);
  const [emitting, setEmitting] = useState(false);
  const [emitDone, setEmitDone] = useState(false);

  // ── catálogos ──
  const cuentasQ = useQuery({ queryKey: ['cuentas'], queryFn: () => api.finanzas.listCuentas() });
  const cuentas = (cuentasQ.data?.cuentas ?? []).filter((c) => c.activo !== false);
  const detQ = useQuery({ queryKey: ['detracciones', doc.fechaEmision], queryFn: () => api.catalogos.getDetracciones(doc.fechaEmision), enabled: esCompraGasto });
  const partidasQ = useQuery({ queryKey: ['partidas', proyectoId], queryFn: () => api.proyectos.listPartidas(proyectoId), enabled: !!proyectoId && esCompraGasto });
  const partidas = partidasQ.data?.partidas ?? [];
  const costosQ = useQuery({ queryKey: ['costos-obra', proyectoId], queryFn: () => api.proyectos.getCostosObra(proyectoId), enabled: !!proyectoId && esCompraGasto });
  // duplicados: los rechaza el backend (409 por RUC+serie+número) · sin pre-chequeo local

  // ── OC 3-way (idéntica precarga que V1, pero las líneas entran EDITABLES al detalle) ──
  const [ocSel, setOcSel] = useState('');
  const [ocNumero, setOcNumero] = useState('');
  const ocsQ = useQuery({ queryKey: ['ocs-abiertas'], queryFn: () => api.logistica.listOcs(), enabled: esCompraGasto });
  const ocsAbiertas = useMemo(
    () => (ocsQ.data?.ordenes ?? []).filter((o) => ['aprobada', 'emitida', 'en_transito', 'entregada'].includes(o.estado) && !o.gastoId),
    [ocsQ.data],
  );
  const elegirOc = async (id: string) => {
    setOcSel(id);
    if (!id) { setOcNumero(''); return; }
    const d = await api.logistica.getOc(id);
    setOcNumero(d.oc.numero);
    setProv((s) => ({ ...s, ruc: d.proveedor?.ruc ?? s.ruc, razon: d.proveedor?.razonSocial ?? s.razon, fuente: 'oc' }));
    dset({ moneda: d.oc.moneda, tipoCambio: d.oc.tipoCambio ? String(Number(d.oc.tipoCambio)) : doc.tipoCambio });
    if (d.oc.proyectoId) setProyectoId(d.oc.proyectoId);
    if (d.oc.aplicaDetraccion && d.oc.pctDetraccion) {
      const match = (detQ.data?.tasas ?? []).find((t) => Math.abs(t.porcentaje - Number(d.oc.pctDetraccion)) < 0.01);
      if (match) tset({ detCodigo: match.codigo });
    }
    if (d.lineas.length) {
      setLineas(d.lineas.map((l) => ({
        descripcion: l.descripcion, unidad: l.unidad, cantidad: String(Number(l.cantidad)),
        pu: String(d.oc.incluyeIgv ? Math.round((Number(l.precioUnitario) / 1.18) * 10000) / 10000 : Number(l.precioUnitario)),
        partidaId: '', cuenta: '', inv: false,
      })));
    }
  };

  // ── RUC lookup (solo sin OC ligada) ──
  const buscarRuc = async (ruc: string) => {
    if (ocSel || !/^\d{11}$/.test(ruc)) return;
    setRucBuscando(true);
    try {
      const r = await api.catalogos.getRuc(ruc);
      setProv((s) => ({ ...s, razon: r.razonSocial, estadoSunat: r.estadoSunat ?? '', condicionSunat: r.condicionSunat ?? '', fuente: r.fuente }));
      const { cuenta } = await api.contabilidad.sugerirCuenta({ proveedorRuc: ruc, tipoGasto });
      if (cuenta) setCuentaSug(cuenta);
    } catch {
      setProv((s) => ({ ...s, fuente: 'no-encontrado' }));
    } finally {
      setRucBuscando(false);
    }
  };

  // ── TC (misma mecánica V1) ──
  const [tcMsg, setTcMsg] = useState<string | null>(null);
  const [tcBuscando, setTcBuscando] = useState(false);
  useEffect(() => {
    if (doc.moneda === 'PEN') { setTcMsg(null); return; }
    let vivo = true;
    api.catalogos.getTipoCambio(doc.fechaEmision, doc.moneda)
      .then((r) => { if (!vivo) return; setDoc((s) => ({ ...s, tipoCambio: String(r.venta) })); setTcMsg(r.diasAtras > 0 ? `TC del ${r.fecha}` : null); })
      .catch(() => { if (vivo) setTcMsg('Sin TC · botón SUNAT o escríbelo'); });
    return () => { vivo = false; };
  }, [doc.moneda, doc.fechaEmision]);
  const traerTc = async () => {
    setTcBuscando(true); setTcMsg(null);
    try { const r = await api.catalogos.fetchTcSunat(doc.fechaEmision); setDoc((s) => ({ ...s, tipoCambio: String(r.venta) })); }
    catch (e) { setTcMsg((e as Error).message); }
    finally { setTcBuscando(false); }
  };

  // ── totales derivados ──
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const lineasCalc = lineas
    .map((l) => ({ ...l, importe: r2((parseFloat(l.cantidad) || 0) * (parseFloat(l.pu) || 0)) }))
    .filter((l) => l.descripcion.trim() && l.importe > 0);
  const valorVenta = r2(lineasCalc.reduce((s, l) => s + l.importe, 0));
  const igv = aplicaIgv ? r2(valorVenta * 0.18) : 0;
  const total = r2(valorVenta + igv);
  const detTasa = trib.detCodigo ? (detQ.data?.tasas ?? []).find((t) => t.codigo === trib.detCodigo) : null;
  const detAplica = !!detTasa && total >= (detTasa.montoMinimo || 700) && !esNC && !sinCpe;
  const detMonto = detAplica ? Math.round(total * detTasa!.porcentaje / 100) : 0; // entero, como el BN
  const retMonto = trib.retencion === 'igv3' ? r2(total * 0.03) : trib.retencion === 'renta4ta' ? r2(valorVenta * 0.08) : 0;
  const percMonto = trib.percepcion ? r2(total * 0.02) : 0;
  const netoPagar = r2(total - detMonto - retMonto + percMonto);
  const pagadoNum = pago.estado === 'pagado' ? netoPagar : pago.estado === 'parcial' ? (parseFloat(pago.importe) || 0) : 0;
  const saldoCxP = r2(netoPagar - pagadoNum);
  const invCount = lineasCalc.filter((l) => l.inv).length;

  // ── sobrecosto (bolsa CD por defecto · la clase fina la deriva el motor por cuenta) ──
  const excede = proyectoId && esCompraGasto && !esNC && !prorratear ? excedenteBolsa(costosQ.data, 'CD', total) : 0;
  const excedeProrrateo = prorratear ? reparto.reduce((s, r) => s + excedenteBolsa(costosPorObra.get(r.proyectoId), 'CD', parseFloat(r.monto) || 0), 0) : 0;
  const repartoValido = !prorratear || (() => {
    const rows = reparto.filter((r) => r.proyectoId && (parseFloat(r.monto) || 0) > 0);
    const suma = rows.reduce((s, r) => s + parseFloat(r.monto), 0);
    return rows.length >= 2 && Math.abs(total - suma) < 0.01;
  })();

  // ── validez por sección (steps) ──
  const okDoc = sinCpe || (!!doc.serie.trim() && !!doc.numero.trim() && (!esNC || (!!doc.modSerie && !!doc.modNumero)));
  const okProv = sinCpe ? !!prov.razon.trim() : /^\d{11}$/.test(prov.ruc) && !!prov.razon.trim();
  const okDet = lineasCalc.length > 0;
  const okTrib = !detAplica || !!trib.detCodigo;
  const okPago = pago.estado === 'pendiente' || (!!pago.cuentaId && !!pago.numOperacion.trim() && (pago.estado !== 'parcial' || pagadoNum > 0));
  const okDest = true;
  const tcOk = doc.moneda === 'PEN' || parseFloat(doc.tipoCambio) > 0;
  const aplicOk = totalAplicado <= (parseFloat(bi.monto) || 0) + 0.005; // lo aplicado no excede el pago/cobro
  const okTodo = esCompraGasto
    ? okDoc && okProv && okDet && okPago && tcOk && repartoValido && !(prorratear && pago.estado === 'parcial')
      && (excede + excedeProrrateo <= 0 || sobrecostoOk)
    : parseFloat(bi.monto) > 0 && !!bi.cuentaId && aplicOk
      && (entrada === 'bancario' ? !!bi.cuentaDestinoId && bi.cuentaDestinoId !== bi.cuentaId : !!bi.contraparte.trim());

  const registrar = useMutation({
    mutationFn: async () => {
      if (!esCompraGasto) {
        const monto = parseFloat(bi.monto) || 0;
        // F5.4 · pago/cobro con aplicaciones (F2.2) + provisión 48 + cuenta contra manual (del clásico)
        const contraManual = entrada === 'pago' && pago48 ? '4811' : cuentaContra;
        const r = await api.finanzas.createMovimientoGlobal({
          fecha: bi.fecha, tipoMovimiento: entrada === 'ingreso' ? 'Ingreso' : 'Egreso', proyectoId: proyectoId || null,
          cuentaId: bi.cuentaId || null, cuentaDestinoId: entrada === 'bancario' ? bi.cuentaDestinoId || null : null,
          subtipo: entrada === 'bancario' ? 'Transferencia entre cuentas' : null,
          naturalezaContable: entrada === 'bancario' ? 'TRANSFERENCIA' : entrada === 'ingreso' ? 'OTRO_INGRESO' : 'GASTO_OPERATIVO',
          clienteNombre: bi.contraparte || null, monto, subtotal: monto, igv: 0,
          numOperacion: bi.numOperacion || null, descripcion: bi.descripcion || null,
          ...(contraManual ? { cuentaContable: contraManual, cuentaContableOrigen: 'USUARIO' as const } : {}),
          aplicaciones: apList.length && !pago48 ? apList : undefined,
        });
        return r.movimiento.id as string; // F6 · para conciliar la línea del extracto
      }
      // F5.4 · prorrateo (solo Gasto sin comprobante): N gastos ligados por la referencia de operación
      if (entrada === 'gasto' && prorratear) {
        const rows = reparto.filter((r) => r.proyectoId && (parseFloat(r.monto) || 0) > 0);
        const opRef = pago.numOperacion || `PRORR-${Date.now().toString(36).toUpperCase()}`;
        for (const row of rows) {
          const totalRow = parseFloat(row.monto);
          const baseRow = aplicaIgv ? r2(totalRow / 1.18) : totalRow;
          const { gasto } = await api.finanzas.createGastoGlobal({
            fecha: doc.fechaEmision, proyectoId: row.proyectoId,
            proveedorRuc: prov.ruc || null, proveedorRazon: prov.razon || null,
            tipoComprobante: 'Sin comprobante', moneda: doc.moneda,
            tipoCambio: doc.moneda !== 'PEN' ? parseFloat(doc.tipoCambio) || null : null,
            subtotal: baseRow, igv: r2(totalRow - baseRow), total: totalRow,
            tipoGasto, destino: 'proyecto',
            descripcionItem: `${glosa || lineasCalc[0]?.descripcion || tipoGasto} · prorrateo ${opRef}`.slice(0, 250),
            cuentaContable: lineasCalc[0]?.cuenta || cuentaSug || null,
            cuentaContableOrigen: lineasCalc[0]?.cuenta ? 'USUARIO' : cuentaSug ? 'SUGERIDO' : null,
          });
          if (pago.estado === 'pagado' && gasto) {
            await api.finanzas.createMovimientoGlobal({
              fecha: pago.fecha, tipoMovimiento: 'Egreso', proyectoId: row.proyectoId, cuentaId: pago.cuentaId,
              monto: totalRow, subtotal: baseRow, igv: r2(totalRow - baseRow),
              clienteNombre: prov.razon || null, numOperacion: opRef, gastoId: gasto.id,
            });
          }
        }
        return;
      }
      const payload: GastoInput & { proyectoId?: string | null; docModifica?: { serie: string; numero: string } } = {
        fecha: doc.fechaEmision,
        proyectoId: proyectoId || null,
        proveedorRuc: prov.ruc || null,
        proveedorRazon: prov.razon || null,
        tipoComprobante: TIPO_CPE_NOMBRE[doc.tipo] ?? 'Factura',
        serie: sinCpe ? null : doc.serie || null,
        numero: sinCpe ? null : doc.numero || null,
        moneda: doc.moneda,
        tipoCambio: doc.moneda !== 'PEN' ? parseFloat(doc.tipoCambio) || null : null,
        subtotal: valorVenta, igv, total,
        tipoGasto,
        destino: proyectoId ? 'proyecto' : 'corporativo',
        cuentaContable: lineasCalc[0]?.cuenta || cuentaSug || null,
        cuentaContableOrigen: lineasCalc[0]?.cuenta ? 'USUARIO' : cuentaSug ? 'SUGERIDO' : null,
        periodoContable: doc.periodoContable || null,
        destinoCredito: trib.destinoCredito,
        fechaVencimiento: doc.fechaVencimiento || null,
        ordenCompraId: ocSel || null,
        descripcionItem: glosa || lineasCalc[0]?.descripcion || null,
        lineas: lineasCalc.map((l) => ({
          descripcion: l.descripcion, unidad: l.unidad || null, cantidad: parseFloat(l.cantidad) || 1,
          valorUnitario: parseFloat(l.pu) || 0, afectacionIgv: aplicaIgv ? '10' : '20',
          cuentaContable: l.cuenta || cuentaSug || null, partidaId: l.partidaId || null, aInventario: l.inv,
        })),
        detraccion: detAplica && trib.detCodigo
          ? { codigo: trib.detCodigo, constanciaNumero: trib.constNumero || null, fechaDeposito: trib.constFecha || null }
          : null,
        ...(trib.retencion !== 'no' && retMonto > 0 ? { retencion: { tipo: trib.retencion, monto: retMonto } } : {}),
        ...(percMonto > 0 ? { percepcion: percMonto } : {}),
        ...(esNC && doc.modSerie ? { docModifica: { serie: doc.modSerie, numero: doc.modNumero } } : {}),
      } as GastoInput & { proyectoId?: string | null; docModifica?: { serie: string; numero: string }; retencion?: { tipo: string; monto: number }; percepcion?: number };
      const { gasto } = await api.finanzas.createGastoGlobal(payload);
      if (pagadoNum > 0 && gasto && !esNC) {
        const rm = await api.finanzas.createMovimientoGlobal({
          fecha: pago.fecha, tipoMovimiento: 'Egreso', proyectoId: proyectoId || null,
          cuentaId: pago.cuentaId, monto: pagadoNum, subtotal: pagadoNum, igv: 0,
          moneda: doc.moneda, tipoCambio: doc.moneda !== 'PEN' ? parseFloat(doc.tipoCambio) || null : null,
          clienteNombre: prov.razon || null, numOperacion: pago.numOperacion || null,
          gastoId: gasto.id, descripcion: `Pago ${sinCpe ? 'gasto' : `${doc.serie}-${doc.numero}`} · ${prov.razon}`.slice(0, 250),
        });
        return rm.movimiento.id as string;
      }
      return null;
    },
    onSuccess: (movId) => {
      onRegistrado?.((movId as string | null | undefined) ?? null); // F6 · auto-concilia la línea del extracto
      setEmitDone(true);
      setTimeout(() => {
        invalidateResumen(qc);
        qc.invalidateQueries({ queryKey: ['gas-global'] });
        qc.invalidateQueries({ queryKey: ['mov-global'] });
        qc.invalidateQueries({ queryKey: ['costos-obra'] });
        onClose();
      }, 950);
    },
    onError: (e: Error) => { setEmitting(false); setEmitDone(false); setError(e.message); },
  });

  const irA = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const Step = ({ id, ok, label }: { id: string; ok: boolean; label: string }) => (
    <button type="button" onClick={() => irA(id)} className={cn('inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide', ok ? 'text-emerald-600' : 'text-amber-600')}>
      <span className={cn('inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] text-white', ok ? 'bg-emerald-500' : 'bg-amber-500')}>{ok ? '✓' : '!'}</span>{label}
    </button>
  );

  if (emitting) return <EmittingOverlay done={emitDone} titulo={emitDone ? 'Registrado' : 'Registrando…'} subtitulo={emitDone ? 'Actualizando…' : pagadoNum > 0 ? 'Compra + pago' : 'Guardando'} />;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-backdropIn" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-5xl max-h-[92vh] overflow-hidden rounded-xl border border-line bg-bg-elev shadow-2xl flex flex-col animate-modalPop">
        <div className="shrink-0 flex items-center justify-between border-b border-line px-5 py-3">
          <div>
            <h2 className="text-[16px] font-bold tracking-[-0.01em]">Registrar {entrada === 'compra' ? 'compra' : entrada === 'gasto' ? 'gasto' : entrada === 'pago' ? 'pago' : entrada === 'bancario' ? 'operación bancaria' : 'ingreso'}</h2>
            {esCompraGasto && (
              <div className="mt-1 flex items-center gap-2.5">
                <Step id="v2-doc" ok={okDoc} label="Documento" /><span className="text-ink-4">/</span>
                <Step id="v2-prov" ok={okProv} label="Proveedor" /><span className="text-ink-4">/</span>
                <Step id="v2-det" ok={okDet} label={`Detalle · ${lineasCalc.length}`} /><span className="text-ink-4">/</span>
                <Step id="v2-trib" ok={okTrib} label="Tributos" /><span className="text-ink-4">/</span>
                <Step id="v2-pago" ok={okPago} label="Pago" /><span className="text-ink-4">/</span>
                <Step id="v2-dest" ok={okDest} label="Destino" />
              </div>
            )}
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-md inline-flex items-center justify-center text-ink-3 hover:bg-bg-sunken"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto bg-bg-sunken/40">
          <div className="grid grid-cols-[1fr_250px] gap-4 p-5 items-start">
            <div className="space-y-3.5 min-w-0">
              {/* Entradas */}
              <div className="grid grid-cols-5 gap-2">
                {([['compra', 'Compra', 'Con comprobante · RCE y SIRE'], ['gasto', 'Gasto', 'Sin comprobante fiscal'], ['pago', 'Pago', 'Deuda registrada · provisión 48'], ['bancario', 'Bancario', 'Transferencia entre cuentas'], ['ingreso', 'Ingreso', 'Cobro · aplica a facturas']] as const).map(([v, l, s]) => (
                  <button key={v} type="button" onClick={() => setEntrada(v)}
                    className={cn('rounded-lg border-2 p-2 text-left transition-colors', entrada === v ? 'border-primary bg-primary/5' : 'border-line hover:bg-bg-elev')}>
                    <div className="text-[12px] font-bold">{l}</div>
                    <div className="text-[9.5px] text-ink-4 leading-tight">{s}</div>
                  </button>
                ))}
              </div>

              {!esCompraGasto && (
                <SecBox title={entrada === 'bancario' ? 'Operación bancaria' : entrada === 'pago' ? 'Pago · cancela deuda registrada o provisiona (48)' : 'Ingreso / cobro'}>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Fecha"><input type="date" className={inputCls} value={bi.fecha} onChange={(e) => biset({ fecha: e.target.value })} /></Field>
                    <Field label={entrada === 'ingreso' ? 'Entra a' : 'Sale de'}><select className={inputCls} value={bi.cuentaId} onChange={(e) => biset({ cuentaId: e.target.value })}><option value="">— cuenta —</option>{cuentas.map((c) => <option key={c.id} value={c.id}>{c.descripcion ?? c.codigo}</option>)}</select></Field>
                    {entrada === 'bancario'
                      ? <Field label="Cuenta destino"><select className={inputCls} value={bi.cuentaDestinoId} onChange={(e) => biset({ cuentaDestinoId: e.target.value })}><option value="">— destino —</option>{cuentas.filter((c) => c.id !== bi.cuentaId).map((c) => <option key={c.id} value={c.id}>{c.descripcion ?? c.codigo}</option>)}</select></Field>
                      : <Field label="Monto"><input type="number" step="0.01" className={cn(inputCls, 'font-mono')} value={bi.monto} onChange={(e) => biset({ monto: e.target.value })} /></Field>}
                    {entrada === 'bancario' && <Field label="Monto"><input type="number" step="0.01" className={cn(inputCls, 'font-mono')} value={bi.monto} onChange={(e) => biset({ monto: e.target.value })} /></Field>}
                    {esPagoIngreso && <>
                      <Field label="RUC" right="jala facturas pendientes"><input className={cn(inputCls, 'font-mono')} maxLength={11} value={bi.ruc} onChange={(e) => biset({ ruc: e.target.value.replace(/\D/g, '') })} placeholder="20XXXXXXXXX" /></Field>
                      <Field label={entrada === 'ingreso' ? 'Cliente *' : 'Proveedor / tercero *'}><input className={inputCls} value={bi.contraparte} onChange={(e) => biset({ contraparte: e.target.value })} placeholder="razón social" /></Field>
                    </>}
                    <Field label="N° operación"><input className={cn(inputCls, 'font-mono')} value={bi.numOperacion} onChange={(e) => biset({ numOperacion: e.target.value })} /></Field>
                    <Field label="Descripción"><input className={inputCls} value={bi.descripcion} onChange={(e) => biset({ descripcion: e.target.value })} /></Field>
                  </div>
                  {entrada === 'pago' && (
                    <label className="flex items-start gap-2 cursor-pointer rounded-md border border-line p-2.5 text-[11.5px] hover:bg-bg-sunken/50">
                      <input type="checkbox" checked={pago48} onChange={(e) => { setPago48(e.target.checked); if (e.target.checked) setAplicSel({}); }} className="mt-0.5 rounded border-line" />
                      <span><span className="font-semibold">Pago sin factura · provisión 48</span>
                        <span className="block text-[10px] text-ink-4">Carga la 4811 · cuando llegue el comprobante se extorna desde Compras → Provisiones 48.</span></span>
                    </label>
                  )}
                  {esPagoIngreso && !pago48 && (
                    <Field label="Cuenta contra · manual" right="opcional · si no, la infiere el sistema">
                      <CuentaContableSelect value={cuentaContra} onChange={(cod) => setCuentaContra(cod)} />
                    </Field>
                  )}
                  {/* F2.2 · facturas pendientes del tercero → aplicar el pago/cobro */}
                  {esPagoIngreso && !pago48 && pendTerm.trim().length >= 3 && (
                    docsPend.length === 0 ? <div className="text-[10.5px] text-ink-4">Sin facturas {entrada === 'ingreso' ? 'por cobrar' : 'por pagar'} de ese tercero.</div> : (
                    <div className="rounded-md border border-line divide-y divide-line/40 max-h-44 overflow-y-auto">
                      {docsPend.map((d) => (
                        <div key={d.id} className="flex items-center gap-2.5 px-3 py-1.5 text-[11.5px]">
                          <div className="flex-1 min-w-0">
                            <span className="font-mono">{[d.docSerie, d.docNumero].filter(Boolean).join('-') || 's/n'}</span>
                            <span className="text-ink-3"> · {d.terceroRazon ?? d.terceroRuc} · saldo </span>
                            <span className="font-mono">{fmtPEN(Number(d.saldoPendiente))}</span>
                          </div>
                          <input type="number" step="0.01" className={cn(inputCls, 'h-7 w-24 font-mono text-right')} placeholder="0.00"
                            value={aplicSel[d.id] ?? ''} onChange={(e) => setAplicSel((s) => ({ ...s, [d.id]: e.target.value }))} />
                          <button type="button" className="text-[10px] text-primary hover:underline" onClick={() => setAplicSel((s) => ({ ...s, [d.id]: String(Math.min(Number(d.saldoPendiente), parseFloat(bi.monto) || Number(d.saldoPendiente))) }))}>todo</button>
                        </div>
                      ))}
                      <div className={cn('px-3 py-1.5 text-[10.5px] font-mono text-right', totalAplicado > (parseFloat(bi.monto) || 0) + 0.005 ? 'text-rose-600 font-semibold' : 'text-ink-3')}>
                        aplicado {fmtPEN(totalAplicado)} de {fmtPEN(parseFloat(bi.monto) || 0)}
                      </div>
                    </div>
                  ))}
                </SecBox>
              )}

              {esCompraGasto && (<>
              <SecBox title="Documento" id="v2-doc">
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Tipo"><select className={inputCls} value={doc.tipo} onChange={(e) => dset({ tipo: e.target.value })} disabled={entrada === 'gasto'}>{TIPOS_CPE_COMPRA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
                  <Field label="Serie"><input className={cn(inputCls, 'font-mono')} value={doc.serie} onChange={(e) => dset({ serie: e.target.value })} disabled={sinCpe} placeholder="F001" /></Field>
                  <Field label="Número"><input className={cn(inputCls, 'font-mono')} value={doc.numero} onChange={(e) => dset({ numero: e.target.value })} disabled={sinCpe} placeholder="00123" /></Field>
                  <Field label="Fecha de emisión"><input type="date" className={inputCls} value={doc.fechaEmision} onChange={(e) => dset({ fechaEmision: e.target.value })} /></Field>
                  <Field label="Vencimiento"><input type="date" className={inputCls} value={doc.fechaVencimiento} onChange={(e) => dset({ fechaVencimiento: e.target.value })} /></Field>
                  <Field label="Periodo contable" right="≠ emisión · hasta 12 meses"><input type="month" className={inputCls} value={doc.periodoContable} onChange={(e) => dset({ periodoContable: e.target.value })} /></Field>
                  <Field label="Moneda / TC" right={tcMsg ?? undefined}>
                    <div className="flex gap-1.5">
                      <select className={cn(inputCls, 'w-[70px]')} value={doc.moneda} onChange={(e) => dset({ moneda: e.target.value })}><option>PEN</option><option>USD</option></select>
                      {doc.moneda !== 'PEN' && <>
                        <input type="number" step="0.0001" className={cn(inputCls, 'font-mono flex-1', !tcOk && 'border-amber-500')} value={doc.tipoCambio} onChange={(e) => dset({ tipoCambio: e.target.value })} placeholder="3.7500" />
                        <button type="button" disabled={tcBuscando} onClick={traerTc} className="shrink-0 px-2 rounded-md border border-line text-[10.5px] hover:bg-bg-sunken disabled:opacity-50">{tcBuscando ? '…' : 'SUNAT'}</button>
                      </>}
                    </div>
                  </Field>
                  <Field label="Documento que modifica" right="si es NC o ND">
                    <div className="flex gap-1.5">
                      <input className={cn(inputCls, 'font-mono w-20')} value={doc.modSerie} onChange={(e) => dset({ modSerie: e.target.value })} disabled={!esNC && doc.tipo !== '08'} placeholder="F001" />
                      <input className={cn(inputCls, 'font-mono flex-1')} value={doc.modNumero} onChange={(e) => dset({ modNumero: e.target.value })} disabled={!esNC && doc.tipo !== '08'} placeholder="00098" />
                    </div>
                  </Field>
                  <Field label="Orden de compra" right="jala sus líneas al detalle">
                    <select className={inputCls} value={ocSel} onChange={(e) => elegirOc(e.target.value)}>
                      <option value="">— sin OC —</option>
                      {ocsAbiertas.map((o) => <option key={o.id} value={o.id}>{o.numero} · {(o.proveedor?.razonSocial ?? '').slice(0, 26)}</option>)}
                    </select>
                  </Field>
                </div>
                {esBoleta && <div className="mt-2 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11px] text-amber-700">Boleta: no entra al Registro de Compras ni da crédito fiscal (el IGV va al costo). Se guarda como gasto con documento.</div>}
              </SecBox>

              <SecBox title="Proveedor" id="v2-prov">
                <div className="grid grid-cols-3 gap-3">
                  <Field label="RUC" right={rucBuscando ? 'buscando…' : prov.fuente === 'sunat' ? 'de SUNAT' : prov.fuente === 'maestro' ? 'del maestro' : prov.fuente === 'no-encontrado' ? 'no encontrado' : undefined}>
                    <input className={cn(inputCls, 'font-mono')} value={prov.ruc} maxLength={11}
                      onChange={(e) => setProv((s) => ({ ...s, ruc: e.target.value.replace(/\D/g, '') }))}
                      onBlur={(e) => buscarRuc(e.target.value)} disabled={!!ocSel} placeholder="20XXXXXXXXX" />
                  </Field>
                  <Field label="Razón social *" right={ocSel ? `de la ${ocNumero}` : undefined}>
                    <input className={inputCls} value={prov.razon} onChange={(e) => setProv((s) => ({ ...s, razon: e.target.value }))} disabled={!!ocSel} />
                  </Field>
                  <Field label="Estado SUNAT">
                    <div className="flex items-center h-9">
                      {prov.estadoSunat
                        ? <span className={cn('rounded px-1.5 py-0.5 text-[10.5px] font-medium', /activo/i.test(prov.estadoSunat) ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>{prov.estadoSunat}{prov.condicionSunat ? ` · ${prov.condicionSunat}` : ''}</span>
                        : <span className="text-[10.5px] text-ink-4">—</span>}
                    </div>
                  </Field>
                </div>
                {cuentaSug && <div className="mt-1 text-[10.5px] text-amber-600">Cuenta sugerida {cuentaSug} (última usada con este proveedor) · se aplica a las líneas sin cuenta.</div>}
              </SecBox>

              <SecBox title="Detalle por línea · cuenta contable manual por línea" id="v2-det">
                <div className="overflow-x-auto rounded-md border border-line">
                  <table className="w-full">
                    <thead><tr className="border-b border-line bg-bg-sunken">{['Descripción', 'Und.', 'Cant.', 'P. unit.', 'Partida', 'Cuenta', '→INV', 'Importe', ''].map((h, i) => <th key={i} className={cn('px-2 py-1.5 font-mono text-[9.5px] uppercase tracking-wider text-ink-4', i === 2 || i === 3 || i === 7 ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
                    <tbody>
                      {lineas.map((l, i) => (
                        <tr key={i} className={cn('border-b border-line/40 last:border-0', l.inv && 'bg-amber-500/5')}>
                          <td className="p-1"><input className={cn(inputCls, 'h-8 min-w-[190px]')} value={l.descripcion} onChange={(e) => lset(i, { descripcion: e.target.value })} placeholder="descripción" /></td>
                          <td className="p-1"><input className={cn(inputCls, 'h-8 w-14 font-mono')} value={l.unidad} onChange={(e) => lset(i, { unidad: e.target.value })} /></td>
                          <td className="p-1"><input type="number" step="0.01" className={cn(inputCls, 'h-8 w-16 font-mono text-right')} value={l.cantidad} onChange={(e) => lset(i, { cantidad: e.target.value })} /></td>
                          <td className="p-1"><input type="number" step="0.0001" className={cn(inputCls, 'h-8 w-20 font-mono text-right')} value={l.pu} onChange={(e) => lset(i, { pu: e.target.value })} placeholder="0.00" /></td>
                          <td className="p-1">
                            <select className={cn(inputCls, 'h-8 max-w-[150px]')} value={l.partidaId} onChange={(e) => lset(i, { partidaId: e.target.value })} disabled={!proyectoId}>
                              <option value="">{proyectoId ? '— partida —' : 'sin obra'}</option>
                              {partidas.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre.slice(0, 24)}</option>)}
                            </select>
                          </td>
                          <td className="p-1"><input className={cn(inputCls, 'h-8 w-20 font-mono')} value={l.cuenta} onChange={(e) => lset(i, { cuenta: e.target.value })} placeholder={cuentaSug ?? '60x'} /></td>
                          <td className="p-1 text-center"><input type="checkbox" checked={l.inv} onChange={(e) => lset(i, { inv: e.target.checked })} className="rounded border-line" /></td>
                          <td className="p-1 text-right font-mono text-[11.5px] whitespace-nowrap">{fmtPEN(r2((parseFloat(l.cantidad) || 0) * (parseFloat(l.pu) || 0)))}</td>
                          <td className="p-1">{lineas.length > 1 && <button type="button" onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))} className="text-ink-4 hover:text-rose-600"><X className="h-3.5 w-3.5" /></button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button type="button" onClick={() => setLineas((ls) => [...ls, { ...lineaVacia }])} className="rounded-md border border-dashed border-line-strong px-2.5 py-1 text-[11px] hover:bg-bg-sunken">+ Agregar línea</button>
                  {lineas.some((l) => l.cuenta) && <button type="button" onClick={() => { const c = lineas.find((l) => l.cuenta)?.cuenta ?? ''; setLineas((ls) => ls.map((l) => ({ ...l, cuenta: l.cuenta || c }))); }} className="rounded-md border border-line px-2.5 py-1 text-[11px] hover:bg-bg-sunken">Aplicar la cuenta a todas</button>}
                  <label className="ml-auto flex items-center gap-1.5 cursor-pointer text-[11px]"><input type="checkbox" checked={aplicaIgv} onChange={(e) => setAplicaIgv(e.target.checked)} className="rounded border-line" /> Afecto a IGV 18%</label>
                </div>
                {invCount > 0 && <div className="mt-2 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 text-[10.5px] text-amber-700">{invCount} línea(s) entran a inventario como borrador "por completar".</div>}
              </SecBox>

              {!sinCpe && !esNC && (
              <SecBox title="Tributos y retenciones" id="v2-trib">
                <div className="grid grid-cols-[1fr_170px] gap-3">
                  <Field label="Código de detracción" right="catálogo vigente">
                    <select className={inputCls} value={trib.detCodigo} onChange={(e) => tset({ detCodigo: e.target.value })}>
                      <option value="">No sujeta a detracción</option>
                      {(detQ.data?.tasas ?? []).map((t) => <option key={t.codigo} value={t.codigo}>{t.codigo} · {t.descripcion.slice(0, 52)} · {t.porcentaje}%</option>)}
                    </select>
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Tasa"><div className={cn(inputCls, 'flex items-center font-mono text-ink-3')}>{detTasa ? `${detTasa.porcentaje}%` : '—'}</div></Field>
                    <Field label="Monto"><div className={cn(inputCls, 'flex items-center font-mono text-ink-3')}>{detMonto || '—'}</div></Field>
                  </div>
                </div>
                {detTasa && !detAplica && total > 0 && <div className="text-[10.5px] text-ink-4">Total {fmtPEN(total)} bajo el mínimo de {fmtPEN(detTasa.montoMinimo || 700)} · no corresponde detracción.</div>}
                {detAplica && (
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="N° de constancia" right="vacía = crédito diferido"><input className={cn(inputCls, 'font-mono', !trib.constNumero && 'border-amber-400')} value={trib.constNumero} onChange={(e) => tset({ constNumero: e.target.value })} placeholder="2026-000418" /></Field>
                    <Field label="Fecha de depósito"><input type="date" className={inputCls} value={trib.constFecha} onChange={(e) => tset({ constFecha: e.target.value })} /></Field>
                    <Field label="Crédito fiscal"><div className={cn(inputCls, 'flex items-center font-mono text-[11px]', trib.constNumero ? 'text-emerald-600' : 'text-amber-600')}>{fmtPEN(igv)} · {trib.constNumero ? 'usable' : 'diferido'}</div></Field>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Destino del crédito fiscal" right="columnas del SIRE">
                    <select className={inputCls} value={trib.destinoCredito} onChange={(e) => tset({ destinoCredito: e.target.value as 'DG' | 'DGNG' | 'DNG' })}>
                      <option value="DG">DG · operaciones gravadas</option>
                      <option value="DGNG">DGNG · mixtas</option>
                      <option value="DNG">DNG · no gravadas (IGV al costo)</option>
                    </select>
                  </Field>
                  <Field label="Retención">
                    <select className={inputCls} value={trib.retencion} onChange={(e) => tset({ retencion: e.target.value as 'no' | 'igv3' | 'renta4ta' })}>
                      <option value="no">No aplica</option>
                      <option value="igv3">IGV 3% (agente)</option>
                      <option value="renta4ta">Renta 4ta 8% (RxH)</option>
                    </select>
                  </Field>
                  <Field label="Percepción IGV 2%">
                    <label className="flex items-center gap-1.5 h-9 cursor-pointer text-[11.5px]"><input type="checkbox" checked={trib.percepcion} onChange={(e) => tset({ percepcion: e.target.checked })} className="rounded border-line" /> Aplica</label>
                  </Field>
                </div>
              </SecBox>
              )}

              {!esNC && (
              <SecBox title="Pago · parcial permitido" id="v2-pago">
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Estado">
                    <div className="flex gap-1.5">
                      {(['pagado', 'parcial', 'pendiente'] as const).map((e) => (
                        <button key={e} type="button" onClick={() => pset({ estado: e })} className={cn('flex-1 rounded-md border py-1.5 text-[11px] capitalize', pago.estado === e ? 'border-primary bg-primary/5 font-semibold' : 'border-line hover:bg-bg-sunken')}>{e}</button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Importe pagado"><input type="number" step="0.01" className={cn(inputCls, 'font-mono')} value={pago.estado === 'pagado' ? String(netoPagar) : pago.estado === 'pendiente' ? '' : pago.importe} onChange={(e) => pset({ importe: e.target.value })} disabled={pago.estado !== 'parcial'} placeholder="0.00" /></Field>
                  <Field label="Saldo pendiente" right="→ cuenta 42"><div className={cn(inputCls, 'flex items-center font-mono font-semibold', saldoCxP > 0 ? 'text-rose-600' : 'text-emerald-600')}>{fmtPEN(saldoCxP)}</div></Field>
                </div>
                {pago.estado !== 'pendiente' && (
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Sale de"><select className={inputCls} value={pago.cuentaId} onChange={(e) => pset({ cuentaId: e.target.value })}><option value="">— cuenta —</option>{cuentas.map((c) => <option key={c.id} value={c.id}>{c.descripcion ?? c.codigo}</option>)}</select></Field>
                    <Field label="N° de operación *"><input className={cn(inputCls, 'font-mono')} value={pago.numOperacion} onChange={(e) => pset({ numOperacion: e.target.value })} placeholder="5401882" /></Field>
                    <Field label="Fecha de pago" right="≠ emisión permitida"><input type="date" className={inputCls} value={pago.fecha} onChange={(e) => pset({ fecha: e.target.value })} /></Field>
                  </div>
                )}
              </SecBox>
              )}

              <SecBox title="Destino" id="v2-dest">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Proyecto"><select className={inputCls} value={proyectoId} onChange={(e) => setProyectoId(e.target.value)}><option value="">Oficina / general</option>{proyectos.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre.slice(0, 34)}</option>)}</select></Field>
                  <Field label="Tipo de gasto"><select className={inputCls} value={tipoGasto} onChange={(e) => setTipoGasto(e.target.value)}>{TIPOS_GASTO.map((t) => <option key={t}>{t}</option>)}</select></Field>
                </div>
                <Field label="Glosa / descripción"><input className={inputCls} value={glosa} onChange={(e) => setGlosa(e.target.value)} placeholder="opcional · aparece en el libro y el asiento" /></Field>
                {entrada === 'gasto' && (
                  <label className="flex items-center gap-1.5 cursor-pointer text-[11.5px]"><input type="checkbox" checked={prorratear} onChange={(e) => setProrratear(e.target.checked)} className="rounded border-line" /> Repartir entre varias obras (prorrateo)</label>
                )}
                {entrada === 'gasto' && prorratear && (
                  <div className="rounded-md border border-line p-2 space-y-1.5">
                    {reparto.map((row, i) => {
                      const cRow = row.proyectoId ? costosPorObra.get(row.proyectoId) : undefined;
                      const quedaRow = cRow ? cRow.cd.presupuesto - cRow.cd.ejecutado : null;
                      const excedeRow = excedenteBolsa(cRow, 'CD', parseFloat(row.monto) || 0);
                      return (
                        <div key={i} className="flex items-center gap-1.5">
                          <select className={cn(inputCls, 'flex-1 min-w-0')} value={row.proyectoId} onChange={(e) => setReparto((rs) => rs.map((x, j) => (j === i ? { ...x, proyectoId: e.target.value } : x)))}>
                            <option value="">— obra —</option>
                            {proyectos.map((p) => <option key={p.id} value={p.id}>{p.codigo}</option>)}
                          </select>
                          {quedaRow != null && <span className={cn('shrink-0 font-mono text-[10px]', excedeRow > 0 ? 'text-rose-600 font-semibold' : 'text-ink-3')}>queda {fmtPEN(quedaRow)}</span>}
                          <input className={cn(inputCls, 'w-24 text-right font-mono', excedeRow > 0 && 'border-rose-500')} type="number" step="0.01" placeholder="0.00" value={row.monto} onChange={(e) => setReparto((rs) => rs.map((x, j) => (j === i ? { ...x, monto: e.target.value } : x)))} />
                          {reparto.length > 2 && <button type="button" onClick={() => setReparto((rs) => rs.filter((_, j) => j !== i))} className="text-ink-4 hover:text-rose-600"><X className="h-3.5 w-3.5" /></button>}
                        </div>
                      );
                    })}
                    <div className="flex items-center justify-between text-[10.5px]">
                      <button type="button" onClick={() => setReparto((rs) => [...rs, { proyectoId: '', monto: '' }])} className="text-primary hover:underline">+ Agregar obra</button>
                      {(() => { const suma = reparto.reduce((s, r) => s + (parseFloat(r.monto) || 0), 0); const dif = total - suma; return (
                        <span className={cn('font-mono', Math.abs(dif) < 0.01 ? 'text-emerald-600' : 'text-amber-600')}>Σ {fmtPEN(suma)} de {fmtPEN(total)}{Math.abs(dif) >= 0.01 ? ` · falta ${fmtPEN(dif)}` : ' ✓'}</span>
                      ); })()}
                    </div>
                  </div>
                )}
                {proyectoId && !prorratear && costosQ.data && <SaldoObraBox c={costosQ.data} clase={null} />}
                {excede + excedeProrrateo > 0 && (
                  <div className="rounded-md border border-rose-300/60 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-[11.5px] text-rose-700 space-y-1">
                    <div className="font-semibold">Sobrecosto: +{fmtPEN(excede + excedeProrrateo)} sobre el saldo CD</div>
                    <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={sobrecostoOk} onChange={(e) => setSobrecostoOk(e.target.checked)} className="rounded border-line" /> Registrar sobrecosto igual · entra a los costos reales</label>
                  </div>
                )}
              </SecBox>
              </>)}
            </div>

            {/* Sidebar */}
            <div className="space-y-3 sticky top-0">
              {esCompraGasto && (<>
              <div className="rounded-lg border border-line bg-bg-elev p-3">
                <div className="text-[10px] font-mono uppercase tracking-wider text-ink-4 mb-2">Totales</div>
                <div className="space-y-1 text-[11.5px]">
                  <div className="flex justify-between"><span className="text-ink-3">Valor de venta</span><span className="font-mono">{fmtPEN(valorVenta)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-3">IGV 18% · auto</span><span className="font-mono">{fmtPEN(igv)}</span></div>
                  <div className="border-t border-line my-1" />
                  <div className="flex justify-between font-semibold"><span>Total comprobante</span><span className="font-mono">{fmtPEN(total)}</span></div>
                  {detMonto > 0 && <div className="flex justify-between text-amber-700"><span>Detracción {detTasa?.porcentaje}%</span><span className="font-mono">−{fmtPEN(detMonto)}</span></div>}
                  {retMonto > 0 && <div className="flex justify-between text-amber-700"><span>Retención</span><span className="font-mono">−{fmtPEN(retMonto)}</span></div>}
                  {percMonto > 0 && <div className="flex justify-between text-amber-700"><span>Percepción 2%</span><span className="font-mono">+{fmtPEN(percMonto)}</span></div>}
                  <div className="flex justify-between font-semibold text-emerald-700"><span>Neto a pagar</span><span className="font-mono">{fmtPEN(netoPagar)}</span></div>
                  {pagadoNum > 0 && <><div className="border-t border-line my-1" />
                    <div className="flex justify-between"><span className="text-ink-3">Pagado</span><span className="font-mono">{fmtPEN(pagadoNum)}</span></div>
                    <div className="flex justify-between text-rose-600 font-semibold"><span>Saldo</span><span className="font-mono">{fmtPEN(saldoCxP)}</span></div></>}
                </div>
              </div>
              <div className="rounded-lg border border-line bg-bg-elev p-3">
                <div className="text-[10px] font-mono uppercase tracking-wider text-ink-4 mb-2">Se registra</div>
                <ul className="space-y-1 text-[10.5px] text-ink-2 list-disc pl-4">
                  <li>{esBoleta || sinCpe ? 'Gasto (no entra al RCE)' : esNC ? 'NC aplicada a la factura original' : `Compra en el Registro (anotación ${doc.periodoContable})`}</li>
                  <li>{lineasCalc.length} línea(s) con cuenta propia{invCount ? ` · ${invCount} a inventario` : ''}</li>
                  {!esNC && <li>CxP {fmtPEN(saldoCxP)} {saldoCxP > 0 ? 'pendiente' : 'saldada'}</li>}
                  {detMonto > 0 && <li>Detracción {trib.constNumero ? 'depositada' : 'PENDIENTE de constancia'}</li>}
                  {pagadoNum > 0 && !esNC && <li>Movimiento de pago ({pago.fecha})</li>}
                  {doc.moneda !== 'PEN' && <li>USD al TC {doc.tipoCambio || '—'} · dif. de cambio automática al pagar</li>}
                </ul>
              </div>
              </>)}
              {error && <div className="rounded-md border border-rose-300/60 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-[11px] text-rose-700">{error}</div>}
            </div>
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-3 border-t border-line bg-bg-elev px-5 py-3">
          <span className="text-[11px] text-ink-3 mr-auto">{esCompraGasto ? `${entrada === 'compra' ? 'Compra' : 'Gasto'} · ${lineasCalc.length} línea(s) · ${fmtPEN(total)}` : 'Movimiento de caja'}</span>
          <button onClick={onClose} className="h-9 px-4 rounded-md border border-line text-[12px] hover:bg-bg-sunken">Cancelar</button>
          <button disabled={!okTodo || registrar.isPending} onClick={() => { setError(null); setEmitting(true); registrar.mutate(); }}
            className={cn('inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90', (!okTodo || registrar.isPending) && 'opacity-50 pointer-events-none')}>
            <Check className="h-3.5 w-3.5" /> Registrar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MovModal({ proyectos, defaultProyecto, onClose }: { proyectos: { id: string; codigo: string; nombre: string }[]; defaultProyecto: string; onClose: () => void }) {
  const qc = useQueryClient();
  const cuentasQ = useQuery({ queryKey: ['cuentas'], queryFn: () => api.finanzas.listCuentas() });
  const provQ = useQuery({ queryKey: ['logistica-proveedores'], queryFn: () => api.logistica.listProveedores() });
  const cuentas = cuentasQ.data?.cuentas ?? [];
  const proveedores = provQ.data?.proveedores ?? [];

  const [tipo, setTipo] = useState<MovTipo>('Egreso');
  const [proyectoId, setProyectoId] = useState(defaultProyecto === 'todos' ? '' : defaultProyecto);
  // ponytail: UI-only por ahora — esGasto/estadoPago/clasificación aún no se envían al backend
  const [esGasto, setEsGasto] = useState(true);
  // F3.4 · pago sin factura → provisión 48 (cuenta contra 4811 · se extorna al llegar el comprobante)
  const [sinFactura, setSinFactura] = useState(false);
  const [estadoPago, setEstadoPago] = useState<'pagado' | 'pendiente'>('pagado');
  const [tipoGasto, setTipoGasto] = useState('Compra Materiales');
  const [inventariable, setInventariable] = useState(false);
  // WS1 · cuenta contable MANUAL (Kelly) · CD/GG se deriva de ella (chip, no editable)
  const [cuentaContable, setCuentaContable] = useState<string | null>(null);
  const [cuentaRow, setCuentaRow] = useState<PlanCuentaBusqueda | undefined>();
  const [cuentaSugerida, setCuentaSugerida] = useState(false); // prefill por proveedor → origen SUGERIDO
  const prefillCuenta = async (ruc: string) => {
    if (!ruc.trim() || cuentaContable) return;
    const { cuenta } = await api.contabilidad.sugerirCuenta({ proveedorRuc: ruc.trim(), tipoGasto });
    if (!cuenta) return;
    const { cuentas } = await api.contabilidad.searchPlan(cuenta);
    setCuentaContable(cuenta); setCuentaRow(cuentas.find((c) => c.codigo === cuenta)); setCuentaSugerida(true);
  };
  // F2.2 · aplicar el pago/cobro a facturas pendientes del tercero (docId → monto a aplicar)
  const [aplicSel, setAplicSel] = useState<Record<string, string>>({});
  // F3.7 · 3-way match: elegir la OC precarga proveedor/proyecto/montos/detracción y sus líneas
  const [ocSel, setOcSel] = useState('');
  const [ocDetalle, setOcDetalle] = useState<Awaited<ReturnType<typeof api.logistica.getOc>> | null>(null);
  // Prorrateo · repartir un gasto compartido entre varias obras (montos manuales)
  const [prorratear, setProrratear] = useState(false);
  const [reparto, setReparto] = useState<{ proyectoId: string; monto: string }[]>([{ proyectoId: '', monto: '' }, { proyectoId: '', monto: '' }]);
  const costosObraQ = useQuery({ queryKey: ['costos-obra', proyectoId], queryFn: () => api.proyectos.getCostosObra(proyectoId), enabled: !!proyectoId && esGasto && tipo === 'Egreso' });
  // F5.2 · saldo por obra del prorrateo (una query por obra elegida) + sobrecosto con confirmación
  const [sobrecostoOk, setSobrecostoOk] = useState(false);
  const repartoObras = useMemo(() => [...new Set(reparto.map((r) => r.proyectoId).filter(Boolean))], [reparto]);
  const repartoCostosQ = useQueries({
    queries: (prorratear ? repartoObras : []).map((pid) => ({ queryKey: ['costos-obra', pid], queryFn: () => api.proyectos.getCostosObra(pid) })),
  });
  const costosPorObra = useMemo(() => {
    const m = new Map<string, CostosObra>();
    repartoObras.forEach((pid, i) => { const d = repartoCostosQ[i]?.data; if (d) m.set(pid, d); });
    return m;
  }, [repartoObras, repartoCostosQ]);
  const [showAuto, setShowAuto] = useState(false);
  const [emitting, setEmitting] = useState(false);
  const [emitDone, setEmitDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    fecha: new Date().toISOString().slice(0, 10),
    fechaVencimiento: '',
    subtipo: 'Materiales',
    naturalezaContable: 'GASTO_OPERATIVO',
    tipoComprobante: 'Factura',
    serie: '', numero: '',
    tipoDoc: 'RUC', docNumero: '', contraparte: '',
    cuentaId: '', cuentaDestinoId: '',
    moneda: 'PEN',
    tipoCambio: '', // F3.6 · TC venta del día (auto de la tabla / SUNAT · editable)
    subtotal: '',
    aplicaIgv: true, incluyeIgv: false,
    aplicaDetraccion: false, detraccionPct: '4',
    aplicaRetencion: false, retencionPct: '3',
    estado: 'Pendiente',
    numOperacion: '',
    descripcion: '',
  });
  const set = (p: Partial<typeof f>) => setF((s) => ({ ...s, ...p }));

  // F3.6 · TC del día: prefill de la tabla local; botón consulta SUNAT y lo guarda; siempre editable
  const [tcBuscando, setTcBuscando] = useState(false);
  const [tcMsg, setTcMsg] = useState<string | null>(null);
  const traerTc = async () => {
    setTcBuscando(true); setTcMsg(null);
    try {
      const r = await api.catalogos.fetchTcSunat(f.fecha);
      setF((s) => ({ ...s, tipoCambio: String(r.venta) }));
    } catch (e) {
      setTcMsg((e as Error).message);
    } finally {
      setTcBuscando(false);
    }
  };
  useEffect(() => {
    if (f.moneda === 'PEN') { setTcMsg(null); return; }
    let vivo = true;
    api.catalogos.getTipoCambio(f.fecha, f.moneda)
      .then((r) => { if (!vivo) return; setF((s) => ({ ...s, tipoCambio: String(r.venta) })); setTcMsg(r.diasAtras > 0 ? `TC del ${r.fecha} (${r.diasAtras} día(s) atrás)` : null); })
      .catch(() => { if (vivo) setTcMsg('Sin TC en la tabla · botón SUNAT o escríbelo'); });
    return () => { vivo = false; };
  }, [f.moneda, f.fecha]);

  // F3.7 · OCs comprometidas sin factura (3-way): aprobada/emitida/en tránsito/entregada, sin gasto ligado
  const ocsQ = useQuery({ queryKey: ['ocs-abiertas'], queryFn: () => api.logistica.listOcs(), enabled: tipo === 'Egreso' && esGasto });
  const ocsAbiertas = useMemo(
    () => (ocsQ.data?.ordenes ?? []).filter((o) => ['aprobada', 'emitida', 'en_transito', 'entregada'].includes(o.estado) && !o.gastoId),
    [ocsQ.data],
  );
  const elegirOc = async (id: string) => {
    setOcSel(id);
    if (!id) { setOcDetalle(null); return; }
    const d = await api.logistica.getOc(id);
    setOcDetalle(d);
    const oc = d.oc;
    set({
      contraparte: d.proveedor?.razonSocial ?? f.contraparte,
      docNumero: d.proveedor?.ruc ?? f.docNumero,
      tipoDoc: 'RUC',
      subtotal: String(Number(oc.subtotalSinIgv)),
      aplicaIgv: Number(oc.igv) > 0, incluyeIgv: false,
      moneda: oc.moneda,
      tipoCambio: oc.tipoCambio ? String(Number(oc.tipoCambio)) : f.tipoCambio,
      aplicaDetraccion: oc.aplicaDetraccion,
      detraccionPct: oc.pctDetraccion ? String(Number(oc.pctDetraccion)) : f.detraccionPct,
    });
    if (oc.proyectoId) setProyectoId(oc.proyectoId);
    if (d.proveedor?.ruc) prefillCuenta(d.proveedor.ruc);
  };
  // las líneas de la OC entran al detalle SOLO si la factura cuadra con la OC (si difiere, va sin líneas)
  const ocCuadra = !!ocDetalle && ocDetalle.lineas.length > 0 && Math.abs((parseFloat(f.subtotal) || 0) - Number(ocDetalle.oc.subtotalSinIgv)) < 0.01;

  const isBanc = tipo === 'Bancario';
  const isIngreso = tipo === 'Ingreso';
  const esTransfer = isBanc && f.subtipo === 'Transferencia entre cuentas';
  const accent = isIngreso ? 'emerald' : isBanc ? 'blue' : 'rose';
  const accentBtn = isIngreso ? 'bg-emerald-600' : isBanc ? 'bg-primary' : 'bg-rose-600';

  // cálculo IGV / detracción / retención
  const sub = parseFloat(f.subtotal) || 0;
  let base = sub, igv = 0, totalComp = sub;
  if (!isBanc && f.aplicaIgv) {
    if (f.incluyeIgv) { totalComp = sub; base = sub / 1.18; igv = totalComp - base; }
    else { base = sub; igv = sub * 0.18; totalComp = sub * 1.18; }
  }
  const detrac = !isBanc && f.aplicaDetraccion ? totalComp * (parseFloat(f.detraccionPct) / 100) : 0;
  const retenc = !isBanc && f.aplicaRetencion ? totalComp * (parseFloat(f.retencionPct) / 100) : 0;
  const neto = totalComp - detrac - retenc;

  // proveedores sugeridos (egreso)
  const sugerencias = useMemo(() => {
    if (isIngreso || isBanc || !f.contraparte.trim()) return [];
    const ql = f.contraparte.toLowerCase();
    return proveedores.filter((p) => p.razonSocial.toLowerCase().includes(ql) || (p.ruc?.includes(ql) ?? false)).slice(0, 6);
  }, [f.contraparte, isIngreso, isBanc, proveedores]);

  const esGastoEgreso = tipo === 'Egreso' && esGasto;

  // F2.2 · el proveedor/cliente jala sus facturas pendientes (pago/cobro suelto, no gasto nuevo).
  // El RUC manda sobre el nombre: la razón social del maestro puede diferir de la del documento.
  const pendTerm = f.tipoDoc === 'RUC' && /^\d{11}$/.test(f.docNumero) ? f.docNumero : f.contraparte;
  const muestraPendientes = !isBanc && !esGastoEgreso && pendTerm.trim().length >= 3;
  const pendQ = useQuery({
    queryKey: ['docs-pend', isIngreso ? 'cxc' : 'cxp', pendTerm],
    queryFn: () => api.finanzas.listDocumentosPendientes(isIngreso ? 'cxc' : 'cxp', pendTerm),
    enabled: muestraPendientes,
  });
  const docsPend = pendQ.data?.documentos ?? [];
  const apList = Object.entries(aplicSel)
    .map(([documentoPendienteId, m]) => ({ documentoPendienteId, monto: parseFloat(m) || 0 }))
    .filter((a) => a.monto > 0);
  const totalAplicado = apList.reduce((s, a) => s + a.monto, 0);

  const buildMov = (gastoId?: string): MovimientoInput & { proyectoId?: string | null } => ({
    fecha: f.fecha,
    tipoMovimiento: isBanc ? 'Egreso' : tipo,
    proyectoId: proyectoId || null,
    cuentaId: f.cuentaId || null,
    cuentaDestinoId: esTransfer ? f.cuentaDestinoId || null : null,
    subtipo: f.subtipo || null,
    naturalezaContable: isBanc ? 'TRANSFERENCIA' : f.naturalezaContable || null,
    clienteNombre: f.contraparte || null,
    tipoComprobante: isBanc ? null : f.tipoComprobante,
    serie: isBanc ? null : f.serie || null,
    numero: isBanc ? null : f.numero || null,
    moneda: f.moneda,
    tipoCambio: f.moneda !== 'PEN' ? parseFloat(f.tipoCambio) || null : null, // F3.6
    monto: isBanc ? sub : totalComp,
    subtotal: isBanc ? sub : base,
    igv: isBanc ? 0 : igv,
    detraccion: detrac,
    retencion: retenc,
    fechaVencimiento: f.fechaVencimiento || null,
    estado: f.estado || null,
    numOperacion: f.numOperacion || null,
    descripcion: f.descripcion || null,
    gastoId: gastoId ?? null,
    aplicaciones: !gastoId && apList.length ? apList : undefined, // F2.2 · pago suelto aplicado a documentos
    // F3.4 · pago sin factura → el motor asienta Debe 4811 / Haber banco (provisión abierta)
    ...(tipo === 'Egreso' && !esGasto && sinFactura ? { cuentaContable: '4811', cuentaContableOrigen: 'USUARIO' as const } : {}),
  });

  const create = useMutation({
    mutationFn: async () => {
      // Egreso "gasto/compra" → crea gasto (costo devengado) + resolverClase; si está pagado, además el movimiento de caja linkeado.
      if (esGastoEgreso) {
        // Prorrateo · reparte el gasto compartido en N gastos (uno por obra), ligados por la operación
        if (prorratear) {
          const rows = reparto.filter((r) => r.proyectoId && (parseFloat(r.monto) || 0) > 0);
          const opRef = f.numOperacion || `PRORR-${Date.now().toString(36).toUpperCase()}`;
          for (const row of rows) {
            const totalRow = parseFloat(row.monto);
            const baseRow = f.aplicaIgv ? totalRow / 1.18 : totalRow;
            const igvRow = totalRow - baseRow;
            const { gasto: gp } = await api.finanzas.createGastoGlobal({
              fecha: f.fecha, proyectoId: row.proyectoId, proveedorRuc: f.docNumero || null, proveedorRazon: f.contraparte || null,
              tipoComprobante: f.tipoComprobante, serie: f.serie || null, numero: f.numero || null, moneda: f.moneda, tipoCambio: f.moneda !== 'PEN' ? parseFloat(f.tipoCambio) || null : null, cuentaId: f.cuentaId || null,
              descripcionItem: `${f.descripcion || f.subtipo || ''} · prorrateo ${opRef}`.trim(), subtotal: baseRow, igv: igvRow, total: totalRow,
              tipoGasto, inventariable: false, destino: 'proyecto',
              cuentaContable: cuentaContable ?? null, cuentaContableOrigen: cuentaContable ? (cuentaSugerida ? 'SUGERIDO' : 'USUARIO') : null,
            });
            if (estadoPago === 'pagado' && gp) await api.finanzas.createMovimientoGlobal({ ...buildMov(gp.id), proyectoId: row.proyectoId, monto: totalRow, subtotal: baseRow, igv: igvRow, numOperacion: opRef });
          }
          return;
        }
        const gastoPayload: GastoInput & { proyectoId?: string | null } = {
          fecha: f.fecha,
          proyectoId: proyectoId || null,
          proveedorRuc: f.docNumero || null,
          proveedorRazon: f.contraparte || null,
          tipoComprobante: f.tipoComprobante,
          serie: f.serie || null,
          numero: f.numero || null,
          moneda: f.moneda,
          tipoCambio: f.moneda !== 'PEN' ? parseFloat(f.tipoCambio) || null : null, // F3.6
          cuentaId: f.cuentaId || null,
          descripcionItem: f.descripcion || f.subtipo || null,
          subtotal: base,
          igv,
          total: totalComp,
          tipoGasto,
          inventariable,
          destino: proyectoId ? 'proyecto' : 'corporativo',
          // WS1 · CD/GG ya no es input; se deriva de la cuenta. Enviamos la cuenta manual si Kelly la eligió.
          cuentaContable: cuentaContable ?? null,
          cuentaContableOrigen: cuentaContable ? (cuentaSugerida ? 'SUGERIDO' : 'USUARIO') : null,
          // F3.7 · 3-way: la compra devenga contra la OC; sus líneas entran solo si los totales cuadran
          ordenCompraId: ocSel || null,
          lineas: ocCuadra && ocDetalle
            ? ocDetalle.lineas.map((l) => ({
                descripcion: l.descripcion, unidad: l.unidad, cantidad: Number(l.cantidad),
                valorUnitario: ocDetalle.oc.incluyeIgv ? Number(l.precioUnitario) / 1.18 : Number(l.precioUnitario),
                afectacionIgv: '10', cuentaContable: cuentaContable ?? null,
              }))
            : undefined,
        };
        const { gasto } = await api.finanzas.createGastoGlobal(gastoPayload);
        // pendiente = solo gasto (cuenta por pagar); pagado = además movimiento de caja linkeado
        if (estadoPago === 'pagado' && gasto) await api.finanzas.createMovimientoGlobal(buildMov(gasto.id));
        return;
      }
      return api.finanzas.createMovimientoGlobal(buildMov());
    },
    onSuccess: () => {
      setEmitDone(true);
      setTimeout(() => {
        invalidateResumen(qc);
        qc.invalidateQueries({ queryKey: ['mov-global'] });
        qc.invalidateQueries({ queryKey: ['gas-global'] });
        qc.invalidateQueries({ queryKey: ['costos-obra'] });
        qc.invalidateQueries({ queryKey: ['cuentas'] });
        onClose();
      }, 950);
    },
    onError: (e: Error) => { setEmitting(false); setEmitDone(false); setError(e.message); },
  });

  const validDoc = isBanc || (f.tipoDoc === 'RUC' ? /^\d{11}$/.test(f.docNumero) : f.tipoDoc === 'DNI' ? /^\d{8}$/.test(f.docNumero) : f.docNumero.length >= 6) || !f.docNumero;
  // en prorrateo: cada fila con obra+monto>0 y la suma debe igualar el total
  const repartoValido = !prorratear || (() => { const rows = reparto.filter((r) => r.proyectoId && (parseFloat(r.monto) || 0) > 0); const suma = rows.reduce((s, r) => s + parseFloat(r.monto), 0); return rows.length >= 2 && Math.abs(totalComp - suma) < 0.01; })();
  // F2.1 · si la operación genera movimiento de caja (todo salvo gasto pendiente), la cuenta de
  // origen es obligatoria: sin ella el motor 104x no puede asentar (huérfanos de prorrateo 2026-08).
  const creaMovimiento = isBanc || !esGastoEgreso || estadoPago === 'pagado';
  const aplicOk = totalAplicado <= totalComp + 0.005; // F2.2 · lo aplicado no excede el pago
  const tcOk = f.moneda === 'PEN' || parseFloat(f.tipoCambio) > 0; // F3.6 · USD exige TC
  // F5.2 · sobrecosto: el gasto excede la bolsa (CD/GG) de su(s) obra(s) → exige confirmación explícita
  const claseGasto = esGastoEgreso ? (claseDerivadaUI(cuentaRow, true) ?? 'CD') : null;
  const sobrecostos: { codigo: string; excede: number }[] = !esGastoEgreso ? [] : prorratear
    ? reparto.filter((r) => r.proyectoId && (parseFloat(r.monto) || 0) > 0)
        .map((r) => ({ codigo: proyectos.find((p) => p.id === r.proyectoId)?.codigo ?? '?', excede: excedenteBolsa(costosPorObra.get(r.proyectoId), claseGasto, parseFloat(r.monto) || 0) }))
        .filter((x) => x.excede > 0)
    : proyectoId && excedenteBolsa(costosObraQ.data, claseGasto, totalComp) > 0
      ? [{ codigo: proyectos.find((p) => p.id === proyectoId)?.codigo ?? 'obra', excede: excedenteBolsa(costosObraQ.data, claseGasto, totalComp) }]
      : [];
  const sobrecostoBloquea = sobrecostos.length > 0 && !sobrecostoOk;
  const isValid = sub > 0 && f.fecha && repartoValido && aplicOk && tcOk && !sobrecostoBloquea && (!creaMovimiento || !!f.cuentaId) && (isBanc ? (f.cuentaId && (!esTransfer || (f.cuentaDestinoId && f.cuentaDestinoId !== f.cuentaId))) : (f.contraparte.trim() && validDoc));

  const onSave = () => {
    setError(null);
    if (!isValid) { setError(sobrecostoBloquea ? 'El gasto excede el saldo de la obra: marca "Registrar sobrecosto" para continuar' : !tcOk ? `Moneda ${f.moneda}: falta el tipo de cambio (botón TC SUNAT o escríbelo)` : creaMovimiento && !f.cuentaId ? 'Indica la cuenta de la que sale o a la que entra el dinero' : isBanc ? 'Completa cuenta(s) y monto' : 'Completa contraparte, monto y documento válido'); return; }
    setEmitting(true); setEmitDone(false); create.mutate();
  };

  const TIPO_LABEL = isBanc ? 'Operación bancaria' : isIngreso ? 'Ingreso' : 'Egreso';
  if (emitting) {
    return <EmittingOverlay done={emitDone} titulo={emitDone ? 'Movimiento registrado' : `Registrando ${TIPO_LABEL.toLowerCase()}…`} subtitulo={emitDone ? 'Actualizando caja...' : esTransfer ? 'Generando egreso + ingreso' : 'Guardando movimiento'} />;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-backdropIn" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl max-h-[88vh] overflow-hidden rounded-xl border border-line bg-bg-elev shadow-2xl flex flex-col animate-modalPop">
        <div className="shrink-0 flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[16px] font-bold tracking-[-0.01em]">Nuevo movimiento financiero</h2>
          <button onClick={onClose} className="h-8 w-8 rounded-md inline-flex items-center justify-center text-ink-3 hover:bg-bg-sunken"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3.5 bg-bg-sunken/40">
          {/* Toggle tipo */}
          <div className="grid grid-cols-3 gap-2">
            {([['Ingreso', '↑ Ingreso', 'emerald'], ['Egreso', '↓ Egreso', 'rose'], ['Bancario', '⇄ Bancario', 'blue']] as const).map(([t, l, c]) => (
              <button key={t} onClick={() => { setTipo(t); set({ estado: t === 'Ingreso' ? 'Por cobrar' : t === 'Egreso' ? 'Pendiente' : 'Completada', aplicaIgv: t !== 'Bancario', cuentaId: '', cuentaDestinoId: '', subtipo: t === 'Bancario' ? 'Transferencia entre cuentas' : 'Materiales', naturalezaContable: t === 'Ingreso' ? 'OTRO_INGRESO' : t === 'Egreso' ? 'GASTO_OPERATIVO' : 'TRANSFERENCIA' }); }}
                className={cn('rounded-lg border-2 py-2.5 text-[13px] font-bold transition-colors',
                  tipo === t ? (c === 'emerald' ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40' : c === 'rose' ? 'border-rose-600 bg-rose-50 text-rose-700 dark:bg-rose-950/40' : 'border-primary bg-primary/10 text-primary') : 'border-line text-ink-3 hover:bg-bg-elev')}>
                {l}
              </button>
            ))}
          </div>

          {/* ¿Qué tipo de egreso? — solo Egreso. Gasto/compra despliega clasificación CD/GG */}
          {tipo === 'Egreso' && (
            <SecBox title="¿Qué tipo de egreso?">
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setEsGasto(true)}
                  className={cn('rounded-md border p-2 text-left text-[11.5px] transition-colors', esGasto ? 'border-rose-600 bg-rose-50 dark:bg-rose-950/40' : 'border-line hover:bg-bg-sunken')}>
                  <div className="font-semibold">Gasto o compra</div>
                  <div className="text-[10px] text-ink-4">Costo de obra u oficina · clasifica CD/GG</div>
                </button>
                <button type="button" onClick={() => setEsGasto(false)}
                  className={cn('rounded-md border p-2 text-left text-[11.5px] transition-colors', !esGasto ? 'border-rose-600 bg-rose-50 dark:bg-rose-950/40' : 'border-line hover:bg-bg-sunken')}>
                  <div className="font-semibold">Movimiento financiero</div>
                  <div className="text-[10px] text-ink-4">Préstamo, pago de deuda ya registrada, impuesto provisionado</div>
                </button>
              </div>
              {!esGasto && (
                <label className="mt-3 flex items-start gap-2 cursor-pointer rounded-md border border-line p-2.5 text-[11.5px] hover:bg-bg-sunken/50">
                  <input type="checkbox" checked={sinFactura} onChange={(e) => setSinFactura(e.target.checked)} className="mt-0.5 rounded border-line" />
                  <span>
                    <span className="font-semibold">Pago sin factura · provisión 48</span>
                    <span className="block text-[10px] text-ink-4">El pago carga la cuenta 4811. Cuando llegue el comprobante, regístralo en Compras y extórnalo desde Compras → Provisiones 48.</span>
                  </span>
                </label>
              )}
              {esGasto && (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Tipo de gasto"><select className={inputCls} value={tipoGasto} onChange={(e) => { setTipoGasto(e.target.value); setInventariable(TIPOS_INVENTARIABLES.has(e.target.value)); }}>{TIPOS_GASTO.map((t) => <option key={t}>{t}</option>)}</select></Field>
                    <Field label="Estado de pago"><div className="flex gap-2">
                      {(['pagado', 'pendiente'] as const).map((e) => (
                        <button key={e} type="button" onClick={() => setEstadoPago(e)}
                          className={cn('flex-1 rounded-md border py-1.5 text-[11.5px] capitalize transition-colors', estadoPago === e ? 'border-primary bg-primary/5 font-semibold' : 'border-line hover:bg-bg-sunken')}>{e}</button>
                      ))}
                    </div></Field>
                  </div>
                  {/* F3.7 · 3-way match: la OC comprometida precarga proveedor/proyecto/montos/detracción */}
                  {ocsAbiertas.length > 0 && (
                    <Field label="Orden de compra · opcional (3-way match)">
                      <select className={inputCls} value={ocSel} onChange={(e) => elegirOc(e.target.value)}>
                        <option value="">— sin OC —</option>
                        {ocsAbiertas.map((o) => <option key={o.id} value={o.id}>{o.numero} · {(o.proveedor?.razonSocial ?? 's/proveedor').slice(0, 32)} · {o.moneda === 'USD' ? '$' : 'S/'} {Number(o.total).toFixed(2)}</option>)}
                      </select>
                    </Field>
                  )}
                  {ocDetalle && (() => {
                    const ocTotal = Number(ocDetalle.oc.total);
                    const dif = totalComp - ocTotal;
                    const cuadraTot = Math.abs(dif) < 0.01;
                    return (
                      <div className={cn('rounded-md border px-3 py-2 text-[11px]', cuadraTot ? 'border-emerald-300/60 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700' : 'border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 text-amber-700')}>
                        OC {ocDetalle.oc.numero}: {fmtPEN(ocTotal)} · factura: {fmtPEN(totalComp)} · {cuadraTot ? 'cuadra ✓' : `difiere ${fmtPEN(dif)}`}
                        <span className="block text-[10px] opacity-80">{ocCuadra ? `${ocDetalle.lineas.length} línea(s) de la OC entran al detalle de la compra` : ocDetalle.lineas.length === 0 ? 'la OC no tiene detalle de líneas: la compra se registra con los totales' : 'los totales difieren: la compra se registra ligada a la OC pero sin su detalle de líneas'}</span>
                      </div>
                    );
                  })()}
                  {/* WS1 · cuenta contable MANUAL (Kelly) + chip CD/GG DERIVADO (no editable) */}
                  <div>
                    <div className="text-[10px] text-ink-4 mb-1">Cuenta contable</div>
                    <div className="flex items-center gap-2">
                      <CuentaContableSelect value={cuentaContable} onChange={(codigo, row) => { setCuentaContable(codigo); setCuentaRow(row); setCuentaSugerida(false); }} />
                      {(() => { const chip = claseDerivadaUI(cuentaRow, !!proyectoId); return chip
                        ? <span className="inline-flex items-center text-[11px] px-2 h-6 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" title="Clase derivada de la cuenta · no editable">{chip}</span>
                        : cuentaContable ? <span className="text-[10px] text-ink-4">cuenta de balance (sin clase)</span>
                        : <span className="text-[10px] text-ink-4">opcional · si no eliges, el sistema la infiere</span>; })()}
                      {cuentaSugerida && cuentaContable && <span className="text-[10px] text-amber-600" title="Última cuenta usada con este proveedor · confírmala o cámbiala">sugerida</span>}
                    </div>
                  </div>
                  {proyectoId && !prorratear && costosObraQ.data && <SaldoObraBox c={costosObraQ.data} clase={claseGasto} />}
                  <label className="flex items-center gap-1.5 cursor-pointer text-[11.5px]"><input type="checkbox" checked={prorratear} onChange={(e) => setProrratear(e.target.checked)} className="rounded border-line" /> Repartir entre varias obras (prorrateo)</label>
                  {prorratear && (
                    <div className="rounded-md border border-line p-2 space-y-1.5">
                      {reparto.map((row, i) => {
                        // F5.2 · queda de la bolsa (CD/GG según la cuenta) de la obra elegida + excedente
                        const cRow = row.proyectoId ? costosPorObra.get(row.proyectoId) : undefined;
                        const quedaRow = cRow ? (claseGasto === 'GG_OBRA' && cRow.ggObra.presupuesto != null ? cRow.ggObra.presupuesto - cRow.ggObra.ejecutado : cRow.cd.presupuesto - cRow.cd.ejecutado) : null;
                        const excedeRow = excedenteBolsa(cRow, claseGasto, parseFloat(row.monto) || 0);
                        return (
                        <div key={i} className="flex items-center gap-1.5">
                          <select className={cn(inputCls, 'flex-1 min-w-0')} value={row.proyectoId} onChange={(e) => setReparto((rs) => rs.map((x, j) => (j === i ? { ...x, proyectoId: e.target.value } : x)))}>
                            <option value="">— obra —</option>
                            {proyectos.map((p) => <option key={p.id} value={p.id}>{p.codigo}</option>)}
                          </select>
                          {quedaRow != null && <span className={cn('shrink-0 font-mono text-[10px]', excedeRow > 0 ? 'text-rose-600 font-semibold' : quedaRow < 0 ? 'text-rose-600' : 'text-ink-3')} title={`saldo ${claseGasto === 'GG_OBRA' ? 'GG' : 'CD'} de la obra`}>queda {fmtPEN(quedaRow)}</span>}
                          <input className={cn(inputCls, 'w-24 text-right font-mono', excedeRow > 0 && 'border-rose-500')} type="number" step="0.01" placeholder="0.00" value={row.monto} onChange={(e) => setReparto((rs) => rs.map((x, j) => (j === i ? { ...x, monto: e.target.value } : x)))} />
                          {reparto.length > 2 && <button type="button" onClick={() => setReparto((rs) => rs.filter((_, j) => j !== i))} className="text-ink-4 hover:text-rose-600"><X className="h-3.5 w-3.5" /></button>}
                        </div>
                        );
                      })}
                      <div className="flex items-center justify-between text-[10.5px]">
                        <button type="button" onClick={() => setReparto((rs) => [...rs, { proyectoId: '', monto: '' }])} className="text-primary hover:underline">+ Agregar obra</button>
                        {(() => { const suma = reparto.reduce((s, r) => s + (parseFloat(r.monto) || 0), 0); const dif = totalComp - suma; return (
                          <span className={cn('font-mono', Math.abs(dif) < 0.01 ? 'text-emerald-600' : 'text-amber-600')}>Σ {fmtPEN(suma)} de {fmtPEN(totalComp)}{Math.abs(dif) >= 0.01 ? ` · falta ${fmtPEN(dif)}` : ' ✓'}</span>
                        ); })()}
                      </div>
                    </div>
                  )}
                  {/* F5.2 · sobrecosto: exige confirmación explícita (la realidad se registra, pero consciente) */}
                  {sobrecostos.length > 0 && (
                    <div className="rounded-md border border-rose-300/60 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-[11.5px] text-rose-700 space-y-1">
                      <div className="font-semibold">Sobrecosto sobre el saldo {claseGasto === 'GG_OBRA' ? 'GG' : 'CD'}: {sobrecostos.map((s) => `${s.codigo} +${fmtPEN(s.excede)}`).join(' · ')}</div>
                      <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={sobrecostoOk} onChange={(e) => setSobrecostoOk(e.target.checked)} className="rounded border-line" /> Registrar sobrecosto igual · entra a los costos reales de la obra</label>
                    </div>
                  )}
                  {!prorratear && <label className="flex items-center gap-1.5 cursor-pointer text-[11.5px]"><input type="checkbox" checked={inventariable} onChange={(e) => setInventariable(e.target.checked)} className="rounded border-line" /> Registrar en inventario</label>}
                </div>
              )}
            </SecBox>
          )}

          {isBanc ? (
            <SecBox title="Operación bancaria">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Subtipo"><select className={inputCls} value={f.subtipo} onChange={(e) => set({ subtipo: e.target.value })}>{SUBTIPOS_BANC.map((s) => <option key={s}>{s}</option>)}</select></Field>
                <Field label="Estado"><select className={inputCls} value={f.estado} onChange={(e) => set({ estado: e.target.value })}>{['Completada', 'En proceso', 'Rechazada'].map((s) => <option key={s}>{s}</option>)}</select></Field>
                <Field label={esTransfer ? 'Cuenta origen' : 'Cuenta'}><select className={inputCls} value={f.cuentaId} onChange={(e) => set({ cuentaId: e.target.value })}><option value="">— cuenta —</option>{cuentas.map((c) => <option key={c.id} value={c.id}>{c.descripcion ?? c.codigo}</option>)}</select></Field>
                {esTransfer && <Field label="Cuenta destino" right={f.cuentaDestinoId === f.cuentaId && f.cuentaDestinoId ? 'debe ser distinta' : undefined}><select className={cn(inputCls, f.cuentaDestinoId === f.cuentaId && f.cuentaDestinoId && 'border-rose-500')} value={f.cuentaDestinoId} onChange={(e) => set({ cuentaDestinoId: e.target.value })}><option value="">— destino —</option>{cuentas.filter((c) => c.id !== f.cuentaId).map((c) => <option key={c.id} value={c.id}>{c.descripcion ?? c.codigo}</option>)}</select></Field>}
                <Field label="Monto"><input className={cn(inputCls, 'font-mono')} type="number" step="0.01" value={f.subtotal} onChange={(e) => set({ subtotal: e.target.value })} placeholder="0.00" /></Field>
                <Field label="Fecha"><input className={inputCls} type="date" value={f.fecha} onChange={(e) => set({ fecha: e.target.value })} /></Field>
                <Field label="N° operación / referencia"><input className={cn(inputCls, 'font-mono')} value={f.numOperacion} onChange={(e) => set({ numOperacion: e.target.value })} placeholder="TRF-BCP-000..." /></Field>
              </div>
            </SecBox>
          ) : (
            <>
              <SecBox title="Clasificación">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Proyecto"><select className={inputCls} value={proyectoId} onChange={(e) => setProyectoId(e.target.value)}><option value="">Oficina / general</option>{proyectos.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre.slice(0, 30)}</option>)}</select></Field>
                  <Field label="Naturaleza contable"><select className={inputCls} value={f.naturalezaContable} onChange={(e) => set({ naturalezaContable: e.target.value })}>{Object.entries(NATURALEZAS_CONTABLES).filter(([, v]) => (isIngreso ? v.tipo === 'ingreso' : v.tipo === 'egreso')).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
                  <Field label="Subtipo / etiqueta"><input className={inputCls} value={f.subtipo} onChange={(e) => set({ subtipo: e.target.value })} placeholder="detalle libre · ej: combustible camioneta" /></Field>
                  <Field label="Tipo comprobante"><select className={inputCls} value={f.tipoComprobante} onChange={(e) => set({ tipoComprobante: e.target.value })}>{TIPOS_COMP.map((t) => <option key={t}>{t}</option>)}</select></Field>
                  <div className="grid grid-cols-[90px_1fr] gap-2">
                    <Field label="Serie"><input className={cn(inputCls, 'font-mono')} value={f.serie} onChange={(e) => set({ serie: e.target.value })} placeholder="F001" /></Field>
                    <Field label="Número"><input className={cn(inputCls, 'font-mono')} value={f.numero} onChange={(e) => set({ numero: e.target.value })} placeholder="00012" /></Field>
                  </div>
                </div>
              </SecBox>

              <SecBox title={isIngreso ? 'Cliente' : 'Proveedor'}>
                <div className="grid grid-cols-[110px_1fr] gap-3">
                  <Field label="Tipo doc"><select className={inputCls} value={f.tipoDoc} onChange={(e) => set({ tipoDoc: e.target.value })}><option>RUC</option><option>DNI</option><option>CE</option></select></Field>
                  <Field label={`N° ${f.tipoDoc}`} right={f.tipoDoc === 'RUC' ? '11 dígitos' : '8 dígitos'}><input className={cn(inputCls, 'font-mono', f.docNumero && !validDoc && 'border-rose-500')} value={f.docNumero} onChange={(e) => set({ docNumero: e.target.value.replace(/\D/g, '') })} onBlur={(e) => { if (esGastoEgreso && f.tipoDoc === 'RUC') prefillCuenta(e.target.value); }} maxLength={f.tipoDoc === 'RUC' ? 11 : 8} placeholder={f.tipoDoc === 'RUC' ? '20XXXXXXXXX' : '12345678'} /></Field>
                </div>
                <Field label="Nombre / Razón social *">
                  <div className="relative">
                    <input className={inputCls} value={f.contraparte} onChange={(e) => { set({ contraparte: e.target.value }); setShowAuto(true); }} onFocus={() => setShowAuto(true)} onBlur={() => setTimeout(() => setShowAuto(false), 150)} placeholder="Buscar o escribir..." />
                    {showAuto && sugerencias.length > 0 && (
                      <div className="absolute z-10 left-0 right-0 top-full mt-1 max-h-44 overflow-y-auto rounded-md border border-line bg-bg-elev shadow-lg">
                        {sugerencias.map((p) => (
                          <button key={p.id} type="button" onClick={() => { set({ contraparte: p.razonSocial, docNumero: p.ruc ?? '', tipoDoc: p.ruc ? 'RUC' : 'DNI' }); setShowAuto(false); if (p.ruc) prefillCuenta(p.ruc); }} className="w-full text-left px-3 py-2 text-[11.5px] hover:bg-bg-sunken border-b border-line/40 last:border-0">
                            <div className="font-medium">{p.razonSocial}</div><div className="font-mono text-[10px] text-ink-3">{p.ruc ? `RUC ${p.ruc}` : 'Sin RUC'}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </Field>
              </SecBox>

              {muestraPendientes && (docsPend.length > 0 || pendQ.isLoading) && (
                <SecBox title={`Facturas pendientes de ${isIngreso ? 'cobro' : 'pago'} · jaladas del tercero`}>
                  {pendQ.isLoading ? <div className="text-[11.5px] text-ink-3 py-2">Buscando documentos…</div> : (
                    <>
                      <div className="rounded-md border border-line overflow-hidden">
                        <table className="w-full">
                          <thead><tr className="border-b border-line bg-bg-sunken">{['Documento', 'Vence', 'Saldo', 'Aplicar'].map((h, i) => <th key={i} className={cn('px-2.5 py-1.5 font-mono text-[9.5px] uppercase tracking-wider text-ink-4', i >= 2 ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
                          <tbody>
                            {docsPend.map((d) => {
                              const saldo = Number(d.saldoPendiente);
                              const val = aplicSel[d.id] ?? '';
                              return (
                                <tr key={d.id} className="border-b border-line last:border-0">
                                  <td className="px-2.5 py-1.5 text-[11px]">
                                    <span className="font-mono">{[d.docSerie, d.docNumero].filter(Boolean).join('-') || 's/n'}</span>
                                    <div className="text-[10px] text-ink-4 max-w-[180px] truncate">{d.terceroRazon ?? d.terceroRuc ?? ''}{d.estado === 'parcial' ? ' · parcial' : ''}</div>
                                  </td>
                                  <td className="px-2.5 py-1.5 text-[10.5px] font-mono text-ink-3">{d.fechaVenc ?? '—'}</td>
                                  <td className="px-2.5 py-1.5 text-[11px] font-mono tabular-nums text-right text-rose-600">{fmtPEN(saldo)}</td>
                                  <td className="px-2.5 py-1.5 text-right">
                                    <div className="inline-flex items-center gap-1">
                                      <input type="number" step="0.01" min="0" max={saldo} value={val}
                                        onChange={(e) => setAplicSel((s) => ({ ...s, [d.id]: e.target.value }))}
                                        className="h-7 w-[92px] px-2 rounded border border-line bg-bg-elev text-[11px] font-mono text-right" placeholder="0.00" />
                                      <button type="button" title="Aplicar todo el saldo" onClick={() => setAplicSel((s) => ({ ...s, [d.id]: saldo.toFixed(2) }))}
                                        className="h-7 px-1.5 rounded border border-line text-[10px] text-ink-3 hover:bg-bg-sunken">max</button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className={cn('mt-2 text-[11px]', totalAplicado > totalComp + 0.005 ? 'text-rose-600 font-medium' : 'text-ink-3')}>
                        Aplicado <span className="font-mono font-semibold">{fmtPEN(totalAplicado)}</span> de <span className="font-mono">{fmtPEN(totalComp)}</span>
                        {totalAplicado > totalComp + 0.005 ? ' · excede el monto del movimiento' : totalAplicado > 0 ? ` · el saldo de cada factura baja al registrar` : ' · opcional: deja en 0 para un movimiento sin documento'}
                      </div>
                    </>
                  )}
                </SecBox>
              )}

              <SecBox title="Montos">
                <div className="grid grid-cols-4 gap-3">
                  <Field label="Moneda"><select className={inputCls} value={f.moneda} onChange={(e) => set({ moneda: e.target.value })}><option value="PEN">S/ PEN</option><option value="USD">$ USD</option></select></Field>
                  <Field label={f.incluyeIgv ? 'Monto (c/IGV)' : 'Subtotal (s/IGV)'}><input className={cn(inputCls, 'font-mono')} type="number" step="0.01" value={f.subtotal} onChange={(e) => set({ subtotal: e.target.value })} placeholder="0.00" /></Field>
                  <Field label="IGV (18%)"><div className={cn(inputCls, 'font-mono flex items-center text-ink-3', !f.aplicaIgv && 'opacity-50')}>{igv.toFixed(2)}</div></Field>
                  <Field label={isIngreso ? 'Total a cobrar' : 'Total comprob.'}><div className={cn(inputCls, 'font-mono flex items-center font-bold', accent === 'emerald' ? 'text-emerald-600' : 'text-rose-600')}>{totalComp.toFixed(2)}</div></Field>
                </div>
                {/* F3.6 · USD: TC venta SUNAT del día (auto de la tabla, botón trae de SUNAT, editable) */}
                {f.moneda !== 'PEN' && (
                  <div className="mt-2 flex items-end gap-2">
                    <Field label={`TC venta ${f.moneda}→PEN`}>
                      <input className={cn(inputCls, 'font-mono w-28', !(parseFloat(f.tipoCambio) > 0) && 'border-amber-500')} type="number" step="0.0001" value={f.tipoCambio} onChange={(e) => set({ tipoCambio: e.target.value })} placeholder="3.7500" />
                    </Field>
                    <button type="button" disabled={tcBuscando} onClick={traerTc} className="h-9 px-3 rounded-md border border-line text-[11.5px] hover:bg-bg-sunken disabled:opacity-50">{tcBuscando ? 'Buscando…' : 'TC SUNAT'}</button>
                    {parseFloat(f.tipoCambio) > 0 && <span className="text-[11px] text-ink-3 pb-2.5 font-mono">= {fmtPEN(totalComp * parseFloat(f.tipoCambio))}</span>}
                    {tcMsg && <span className="text-[10.5px] text-amber-600 pb-2.5">{tcMsg}</span>}
                  </div>
                )}
                <div className="flex flex-wrap gap-x-5 gap-y-2 mt-2 text-[11.5px]">
                  <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={f.aplicaIgv} onChange={(e) => set({ aplicaIgv: e.target.checked })} className="rounded border-line" /> Afecto a IGV</label>
                  <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={f.incluyeIgv} disabled={!f.aplicaIgv} onChange={(e) => set({ incluyeIgv: e.target.checked })} className="rounded border-line" /> El monto ya incluye IGV</label>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div>
                    <label className="flex items-center gap-1.5 cursor-pointer text-[11.5px]"><input type="checkbox" checked={f.aplicaDetraccion} onChange={(e) => set({ aplicaDetraccion: e.target.checked })} className="rounded border-line" /> Detracción{detrac > 0 ? ` · −${fmtPEN(detrac)}` : ''}</label>
                    {f.aplicaDetraccion && <select className={cn(inputCls, 'mt-1.5')} value={f.detraccionPct} onChange={(e) => set({ detraccionPct: e.target.value })}>{DETRAC_PCT.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}</select>}
                  </div>
                  <div>
                    <label className="flex items-center gap-1.5 cursor-pointer text-[11.5px]"><input type="checkbox" checked={f.aplicaRetencion} onChange={(e) => set({ aplicaRetencion: e.target.checked })} className="rounded border-line" /> Retención{retenc > 0 ? ` · −${fmtPEN(retenc)}` : ''}</label>
                    {f.aplicaRetencion && <select className={cn(inputCls, 'mt-1.5')} value={f.retencionPct} onChange={(e) => set({ retencionPct: e.target.value })}><option value="3">3% · Retención IGV</option><option value="8">8% · Honorarios 4ta</option></select>}
                  </div>
                </div>
                {(detrac > 0 || retenc > 0) && <div className="mt-2 text-[11px] text-ink-3">Neto {isIngreso ? 'a recibir' : 'a pagar al proveedor'}: <span className="font-mono font-semibold text-foreground">{fmtPEN(neto)}</span></div>}
              </SecBox>

              <SecBox title="Fechas y estado">
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Fecha emisión"><input className={inputCls} type="date" value={f.fecha} onChange={(e) => set({ fecha: e.target.value })} /></Field>
                  <Field label="Vencimiento" right="opcional"><input className={inputCls} type="date" value={f.fechaVencimiento} onChange={(e) => set({ fechaVencimiento: e.target.value })} /></Field>
                  <Field label="Estado"><select className={inputCls} value={f.estado} onChange={(e) => set({ estado: e.target.value })}>{(isIngreso ? ['Por cobrar', 'Cobrada', 'Vencida', 'Anulada'] : ['Pendiente', 'Pagada', 'Anulada']).map((s) => <option key={s}>{s}</option>)}</select></Field>
                </div>
                <Field label="Cuenta (caja afectada)" right="opcional"><select className={inputCls} value={f.cuentaId} onChange={(e) => set({ cuentaId: e.target.value })}><option value="">— sin cuenta —</option>{cuentas.map((c) => <option key={c.id} value={c.id}>{c.descripcion ?? c.codigo}</option>)}</select></Field>
              </SecBox>

              <SecBox title="Descripción">
                <textarea className={cn(inputCls, 'h-auto py-2 resize-y')} rows={2} value={f.descripcion} onChange={(e) => set({ descripcion: e.target.value })} placeholder="Detalle, referencias, observaciones..." />
              </SecBox>
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-line bg-bg-elev px-5 py-3">
          {error && <div className="mb-2 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-1.5 text-[11.5px] text-destructive">{error}</div>}
          <div className="flex items-center gap-3">
            <div className="text-[11px] text-ink-3 mr-auto">
              {isValid ? <>Total: <span className={cn('font-mono font-bold', accent === 'emerald' ? 'text-emerald-600' : accent === 'rose' ? 'text-rose-600' : 'text-primary')}>{fmtPEN(isBanc ? sub : neto)}</span></>
                : <span className="text-amber-700 dark:text-amber-400 inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> {isBanc ? 'Completa cuenta(s) y monto' : 'Completa contraparte, monto y documento'}</span>}
            </div>
            <button onClick={onClose} className="h-9 px-4 rounded-md border border-line text-[12px] hover:bg-bg-sunken">Cancelar</button>
            <button disabled={!isValid} onClick={onSave} className={cn('inline-flex items-center gap-1.5 h-9 px-4 rounded-md text-white text-[12px] font-medium hover:opacity-90 disabled:opacity-50', accentBtn)}>
              <Check className="h-3.5 w-3.5" /> Registrar {isIngreso ? 'ingreso' : isBanc ? 'operación' : 'egreso'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SecBox({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <div id={id} className="rounded-lg border border-line bg-bg-elev p-3.5 scroll-mt-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-4 font-bold mb-2.5">{title}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

// FX-4 · Compra → sus ítems de inventario + valuación
function GastoItemsModal({ gastoId, onClose }: { gastoId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['gasto-items', gastoId], queryFn: () => api.finanzas.gastoItems(gastoId) });
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm p-4 sm:p-6" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-xl border border-line bg-bg-elev p-5 shadow-xl">
        {isLoading || !data ? <div className="text-center py-10 text-[12px] text-ink-3">Cargando...</div> : (
          <>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-[15px] font-semibold">{data.gasto.proveedorRazon ?? 'Compra'}</h3>
                <p className="text-[11px] text-ink-4 mt-0.5">{data.gasto.tipoComprobante} {data.gasto.serie}-{data.gasto.numero} · {data.gasto.fecha}</p>
              </div>
              <button onClick={onClose} className="h-7 w-7 rounded-md border border-line inline-flex items-center justify-center text-ink-3 hover:bg-bg-sunken"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3 text-[11.5px]">
              <div><div className="text-ink-4 text-[9.5px] uppercase">Total factura</div><div className="font-mono font-semibold">{fmtPEN(data.valuacion.facturaTotal)}</div></div>
              <div><div className="text-ink-4 text-[9.5px] uppercase">Inventariable</div><div className="font-mono font-semibold">{fmtPEN(data.valuacion.inventariable)}</div></div>
              <div><div className="text-ink-4 text-[9.5px] uppercase">Diferencia</div><div className={cn('font-mono font-semibold', Math.abs(data.valuacion.diferencia) > 0.5 ? 'text-amber-600' : 'text-emerald-600')}>{fmtPEN(data.valuacion.diferencia)}</div></div>
            </div>
            {data.items.length === 0 ? (
              <div className="text-center py-6 text-[11.5px] text-ink-3">Esta compra no tiene ítems de inventario ligados (servicio, flete, o no inventariable)</div>
            ) : (
              <table className="w-full text-[11.5px]">
                <thead><tr className="border-b border-line text-[9.5px] font-mono uppercase text-ink-4"><th className="text-left py-1">Ítem</th><th className="text-left py-1">Categoría</th><th className="text-right py-1">Cant</th><th className="text-right py-1">V.unit</th><th className="text-right py-1">Total</th></tr></thead>
                <tbody>
                  {data.items.map((it) => (
                    <tr key={it.id} className="border-b border-line/50 last:border-0">
                      <td className="py-1 max-w-[220px] truncate">{it.descripcionItem}</td>
                      <td className="py-1 text-ink-3">{it.categoria ?? '—'}</td>
                      <td className="py-1 text-right font-mono tabular-nums">{Number(it.cantidad)}</td>
                      <td className="py-1 text-right font-mono tabular-nums">{fmtPEN(Number(it.valorUnitario))}</td>
                      <td className="py-1 text-right font-mono tabular-nums font-semibold">{fmtPEN(Number(it.cantidad) * Number(it.valorUnitario))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─── Primitivos ──────────────────────────────────────────────
const inputCls = 'h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] w-full';

// ─── Reportes financieros (A2/A4/A5) · tabla genérica + Excel ──
const REPS: { id: string; label: string; filtros: ('anio' | 'mes')[] }[] = [
  { id: 'cuentas-cobrar', label: 'Cuentas por cobrar', filtros: [] },
  { id: 'detracciones', label: 'Detracciones SUNAT', filtros: ['anio', 'mes'] },
  { id: 'utilidad', label: 'Utilidad por proyecto', filtros: ['anio'] },
];

function ReportesView({ r }: { r?: FinanzasResumen }) {
  const [tipo, setTipo] = useState('cuentas-cobrar');
  const [anio, setAnio] = useState('');
  const [mes, setMes] = useState('');
  const cfg = REPS.find((x) => x.id === tipo) ?? REPS[0]!;
  const params = { anio: cfg.filtros.includes('anio') ? anio : '', mes: cfg.filtros.includes('mes') ? mes : '' };
  const q = useQuery({ queryKey: ['reporte', tipo, params.anio, params.mes], queryFn: () => api.reportes.get(tipo, params) });
  const rep = q.data;
  const numCols = new Set((rep?.data[0] ?? []).map((c, i) => (typeof c === 'number' ? i : -1)).filter((i) => i >= 0));
  const fmtCell = (c: string | number) => (typeof c === 'number' ? c.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : c);

  return (
    <div className="space-y-4">
      {/* F3.3 · el reporte "libre" de Kelly: cualquier cuenta → auxiliar por tercero */}
      <AnalisisCuenta />

      <div className="flex flex-wrap items-center gap-2">
        {REPS.map((x) => (
          <button key={x.id} onClick={() => setTipo(x.id)} className={cn('h-8 px-3 rounded-md text-[12px] font-medium border', tipo === x.id ? 'bg-primary text-primary-foreground border-primary' : 'border-line text-ink-2 hover:bg-bg-sunken')}>{x.label}</button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {cfg.filtros.includes('anio') && <input value={anio} onChange={(e) => setAnio(e.target.value)} placeholder="Año" className="h-8 w-20 rounded-md border border-line bg-bg-elev px-2 text-[12px]" />}
          {cfg.filtros.includes('mes') && <input value={mes} onChange={(e) => setMes(e.target.value)} placeholder="Mes" className="h-8 w-16 rounded-md border border-line bg-bg-elev px-2 text-[12px]" />}
          <a href={api.reportes.xlsxUrl(tipo, params)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90"><Download className="h-3.5 w-3.5" /> Excel</a>
          <a href={api.reportes.plantillaUrl({ anio: cfg.filtros.includes('anio') ? anio : '' })} title="Exporta Compras + Flujo Cuentas + Inventario en el formato del Excel maestro" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-line text-[12px] font-medium text-ink-2 hover:bg-bg-sunken"><Download className="h-3.5 w-3.5" /> Plantilla MM</a>
        </div>
      </div>

      <div className="rounded-md border border-line bg-bg-elev overflow-hidden">
        {q.isLoading ? (
          <div className="p-8 text-center text-[12px] text-ink-3">Cargando…</div>
        ) : q.isError ? (
          <div className="p-6 text-[12px] text-destructive">{(q.error as Error).message}</div>
        ) : !rep || rep.data.length === 0 ? (
          <div className="p-8 text-center text-[12px] text-ink-3">Sin datos para los filtros</div>
        ) : (
          <>
            <div className="border-b border-line px-4 py-2.5">
              <h3 className="text-[13px] font-semibold">{rep.titulo}</h3>
              {rep.nota && <p className="text-[11px] text-ink-4 mt-0.5">{rep.nota}</p>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-line bg-bg-sunken">
                    {rep.headers.map((h, i) => <th key={i} className={cn('px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-4', numCols.has(i) ? 'text-right' : 'text-left')}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rep.data.map((row, ri) => (
                    <tr key={ri} className="border-b border-line/60 hover:bg-bg-sunken/40">
                      {row.map((c, ci) => <td key={ci} className={cn('px-3 py-1.5', numCols.has(ci) ? 'text-right font-mono tabular-nums' : 'text-left')}>{fmtCell(c)}</td>)}
                    </tr>
                  ))}
                  {rep.footer && (
                    <tr className="border-t-2 border-line bg-bg-sunken/40 font-semibold">
                      {rep.footer.map((c, ci) => <td key={ci} className={cn('px-3 py-2', numCols.has(ci) ? 'text-right font-mono tabular-nums' : 'text-left')}>{fmtCell(c)}</td>)}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* mudados del Resumen v2: control documental y presupuestal, no decisión diaria */}
      {r && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <GastosOficinaCard r={r} />
          <div className="space-y-3">
            <Garantias r={r} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── F3.3 · Análisis de cuenta · auxiliar por tercero con aging ──
function AnalisisCuenta() {
  const [cuenta, setCuenta] = useState<string | null>(null);
  const proyectosQ = useQuery({ queryKey: ['proyectos-list'], queryFn: () => api.proyectos.list() });
  const [proyectoId, setProyectoId] = useState('todos');
  const q = useQuery({
    queryKey: ['auxiliar', cuenta, proyectoId],
    queryFn: () => api.contabilidad.getAuxiliar(cuenta!, { proyectoId }),
    enabled: !!cuenta,
  });
  const r = q.data;
  const csv = () => {
    if (!r) return;
    const head = r.modo === 'documentos'
      ? ['Tercero', 'RUC', 'Corriente', '1-30', '31-60', '61-90', '+90', 'Saldo', 'Docs']
      : ['Tercero', 'RUC', 'Debe', 'Haber', 'Saldo', 'Movs'];
    const lines = r.modo === 'documentos'
      ? r.filas.map((f) => [f.tercero, f.ruc ?? '', f.corriente.toFixed(2), f.d30.toFixed(2), f.d60.toFixed(2), f.d90.toFixed(2), f.mas90.toFixed(2), f.saldo.toFixed(2), f.docs])
      : r.filas.map((f) => [f.tercero, f.ruc ?? '', f.debe.toFixed(2), f.haber.toFixed(2), f.saldo.toFixed(2), f.movs]);
    const blob = new Blob(['﻿' + [head.join(';'), ...lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `auxiliar_${r.cuenta}_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const num = (n: number, dim = false) => <span className={cn('font-mono tabular-nums', dim && n === 0 && 'text-ink-4')}>{fmtPEN(n)}</span>;
  return (
    <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <h3 className="text-[13px] font-semibold">Análisis de cuenta</h3>
        <span className="text-[10.5px] font-mono text-ink-4">elige la cuenta · el sistema desagrega por tercero</span>
        <span className="flex-1" />
        <div className="w-[290px]"><CuentaContableSelect value={cuenta} onChange={(c) => setCuenta(c)} /></div>
        <select value={proyectoId} onChange={(e) => setProyectoId(e.target.value)} className="h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] max-w-[190px]">
          <option value="todos">Todos los proyectos</option>
          {(proyectosQ.data?.proyectos ?? []).map((p) => <option key={p.id} value={p.id}>{p.codigo}</option>)}
        </select>
        <button onClick={csv} disabled={!r || r.filas.length === 0} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-line text-[11.5px] font-medium hover:bg-bg-sunken disabled:opacity-40"><Download className="h-3.5 w-3.5" /> Excel plano</button>
      </div>
      {!cuenta ? <div className="px-3.5 py-6 text-center text-[12px] text-ink-3">Busca una cuenta (4212, 1212, 45, 63…) — si es cuenta control del sub-mayor sale con aging por vencimiento; si no, el mayor por contraparte.</div>
        : q.isLoading ? <SkelRows rows={4} />
        : !r || r.filas.length === 0 ? <div className="px-3.5 py-6 text-center text-[12px] text-ink-3">Sin saldos ni movimientos para la cuenta {cuenta}</div>
        : r.modo === 'documentos' ? (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-line bg-bg-sunken">{['Tercero', 'RUC', 'Corriente', '1-30', '31-60', '61-90', '+90', 'Saldo', 'Docs'].map((h, i) => <th key={h} className={cn('px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-4', i >= 2 ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
            <tbody>
              {r.filas.map((f) => (
                <tr key={f.tercero + (f.ruc ?? '')} className="border-b border-line hover:bg-bg-sunken/30">
                  <td className="px-3 py-1.5 text-[11.5px] max-w-[220px] truncate">{f.tercero}</td>
                  <td className="px-3 py-1.5 text-[11px] font-mono text-ink-3">{f.ruc ?? '—'}</td>
                  <td className="px-3 py-1.5 text-[11px] text-right">{num(f.corriente, true)}</td>
                  <td className="px-3 py-1.5 text-[11px] text-right text-amber-700">{num(f.d30, true)}</td>
                  <td className="px-3 py-1.5 text-[11px] text-right text-amber-700">{num(f.d60, true)}</td>
                  <td className="px-3 py-1.5 text-[11px] text-right text-rose-600">{num(f.d90, true)}</td>
                  <td className="px-3 py-1.5 text-[11px] text-right text-rose-600">{num(f.mas90, true)}</td>
                  <td className="px-3 py-1.5 text-[11px] text-right font-semibold">{num(f.saldo)}</td>
                  <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums text-right text-ink-3">{f.docs}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-line bg-bg-sunken/40 font-semibold">
                <td className="px-3 py-2 text-[11.5px]" colSpan={2}>Total · {r.filas.length} tercero(s)</td>
                <td className="px-3 py-2 text-[11px] text-right">{num(r.totales.corriente)}</td>
                <td className="px-3 py-2 text-[11px] text-right">{num(r.totales.d30)}</td>
                <td className="px-3 py-2 text-[11px] text-right">{num(r.totales.d60)}</td>
                <td className="px-3 py-2 text-[11px] text-right">{num(r.totales.d90)}</td>
                <td className="px-3 py-2 text-[11px] text-right">{num(r.totales.mas90)}</td>
                <td className="px-3 py-2 text-[11px] text-right">{num(r.totales.saldo)}</td>
                <td className="px-3 py-2 text-[11px] font-mono tabular-nums text-right">{r.totales.docs}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-line bg-bg-sunken">{['Tercero', 'RUC', 'Debe', 'Haber', 'Saldo', 'Movs'].map((h, i) => <th key={h} className={cn('px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-4', i >= 2 ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
            <tbody>
              {r.filas.slice(0, 60).map((f) => (
                <tr key={f.tercero + (f.ruc ?? '')} className="border-b border-line hover:bg-bg-sunken/30">
                  <td className="px-3 py-1.5 text-[11.5px] max-w-[240px] truncate">{f.tercero}</td>
                  <td className="px-3 py-1.5 text-[11px] font-mono text-ink-3">{f.ruc ?? '—'}</td>
                  <td className="px-3 py-1.5 text-[11px] text-right">{num(f.debe)}</td>
                  <td className="px-3 py-1.5 text-[11px] text-right">{num(f.haber)}</td>
                  <td className={cn('px-3 py-1.5 text-[11px] text-right font-semibold', f.saldo < 0 && 'text-rose-600')}>{num(f.saldo)}</td>
                  <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums text-right text-ink-3">{f.movs}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-line bg-bg-sunken/40 font-semibold">
                <td className="px-3 py-2 text-[11.5px]" colSpan={2}>Total · {r.filas.length} contraparte(s){r.filas.length > 60 ? ' (60 en pantalla, todas en el Excel)' : ''}</td>
                <td className="px-3 py-2 text-[11px] text-right">{num(r.totales.debe)}</td>
                <td className="px-3 py-2 text-[11px] text-right">{num(r.totales.haber)}</td>
                <td className="px-3 py-2 text-[11px] text-right">{num(r.totales.saldo)}</td>
                <td className="px-3 py-2 text-[11px] font-mono tabular-nums text-right">{r.totales.movs}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, icon, tone, sub }: { label: string; value: string; icon: React.ReactNode; tone?: 'ok' | 'warn' | 'info'; sub?: string }) {
  // banda lateral de color · número neutro (funciona claro + oscuro)
  const border = tone === 'ok' ? 'border-l-emerald-500' : tone === 'warn' ? 'border-l-red-500' : tone === 'info' ? 'border-l-primary' : 'border-l-zinc-400';
  const iconTone = tone === 'ok' ? 'text-emerald-500' : tone === 'warn' ? 'text-red-500' : tone === 'info' ? 'text-primary' : 'text-ink-4';
  return (
    <div className={cn('rounded-lg border border-line border-l-[3px] bg-bg-elev p-3.5', border)}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4">{label}</span>
        <span className={iconTone}>{icon}</span>
      </div>
      <div className="mt-1 text-[20px] font-bold font-mono tabular-nums tracking-[-0.02em]">{value}</div>
      {sub && <div className="text-[10.5px] text-ink-4 mt-0.5">{sub}</div>}
    </div>
  );
}

function Field({ label, right, children }: { label: string; right?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-[10.5px] font-mono uppercase tracking-wider text-ink-4">{label}</span>
        {right && <span className="text-[9.5px] text-ink-4 italic">{right}</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 sm:p-6" onClick={onClose}>
      <div className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-xl border border-line bg-bg-elev p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-semibold mb-3">{title}</h3>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// H3.5 · Conciliación bancaria · importar extracto + match ERP ↔ banco
const CLASE_CONCIL: Record<string, string> = {
  cheques_pendientes: 'Cheque pendiente', depositos_en_transito: 'Depósito en tránsito', transferencias_pendientes: 'Transferencia pendiente',
  itf: 'ITF', comisiones: 'Comisión', intereses: 'Interés', debitos_automaticos: 'Débito automático', creditos_no_registrados: 'Crédito no registrado',
};
const agingCls = (d: number) => (d <= 7 ? 'text-emerald-600' : d <= 30 ? 'text-amber-600' : 'text-rose-600');

function ResumenConciliacionPanel({ cuentaHint, periodoHint }: { cuentaHint?: string | null; periodoHint?: string | null }) {
  const cuentasQ = useQuery({ queryKey: ['cuentas'], queryFn: () => api.finanzas.listCuentas() });
  const cuentas = cuentasQ.data?.cuentas ?? [];
  const [cuenta, setCuenta] = useState('');
  const [periodo, setPeriodo] = useState('');
  // F6 · el cuadre sigue al extracto en trabajo (cuenta y mes de sus líneas) · el usuario puede cambiarlos
  useEffect(() => { if (cuentaHint) setCuenta(cuentaHint); }, [cuentaHint]);
  useEffect(() => { if (periodoHint) setPeriodo(periodoHint); }, [periodoHint]);
  useEffect(() => { if (!cuenta && !cuentaHint && cuentas.length) setCuenta((cuentas.find((c) => c.tipo !== 'caja') ?? cuentas[0]!).id); }, [cuentas, cuenta, cuentaHint]);
  const q = useQuery({ queryKey: ['concil-resumen', cuenta, periodo], queryFn: () => api.conciliacion.resumen(cuenta, periodo), enabled: !!cuenta && /^\d{4}-\d{2}$/.test(periodo) });
  const r: ConciliacionResumen | undefined = q.data;
  const fila = (p: PartidaConcil) => (
    <tr key={p.id} className="border-t border-line text-[11px]">
      <td className="px-2 py-1 font-mono text-ink-4">{p.fecha.slice(5)}</td>
      <td className="px-2 py-1 truncate max-w-[210px]"><span className="text-ink-2">{CLASE_CONCIL[p.clase] ?? p.clase}</span> · {p.desc}</td>
      <td className="px-2 py-1 text-right font-mono tabular-nums">{fmtPEN(p.monto)}</td>
      <td className={cn('px-2 py-1 text-right font-mono', agingCls(p.aging))}>{p.aging}d</td>
    </tr>
  );
  return (
    <div className="rounded-lg border border-line bg-bg-elev p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">Resumen de conciliación <span className="text-ink-4 font-normal">· ¿está cuadrado?</span></h3>
        <div className="flex items-center gap-2">
          <select value={cuenta} onChange={(e) => setCuenta(e.target.value)} className="h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] max-w-[200px] truncate">
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.descripcion ?? c.codigo}</option>)}
          </select>
          <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px]" />
          <button onClick={() => window.print()} className="h-8 px-2.5 rounded-md border border-line text-[11.5px] text-ink-2 inline-flex items-center gap-1 hover:bg-bg-sunken"><Download className="h-3.5 w-3.5" /> Exportar</button>
        </div>
      </div>
      {!r ? (
        <div className="text-[12px] text-ink-4 py-6 text-center">{q.isLoading ? 'Calculando…' : 'Elige cuenta y periodo'}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-md border border-line p-2.5"><div className="font-mono text-[9px] uppercase tracking-wider text-ink-4">Saldo banco</div><div className="mt-0.5 text-[14px] font-mono font-bold tabular-nums">{fmtPEN(r.kpis.saldoBanco)}</div></div>
            <div className="rounded-md border border-line p-2.5"><div className="font-mono text-[9px] uppercase tracking-wider text-ink-4">Saldo libro · {r.cuenta.cuentaContable ?? '—'}</div><div className="mt-0.5 text-[14px] font-mono font-bold tabular-nums">{fmtPEN(r.kpis.saldoLibro)}</div></div>
            <div className="rounded-md border border-line p-2.5"><div className="font-mono text-[9px] uppercase tracking-wider text-ink-4">Diferencia</div><div className={cn('mt-0.5 text-[14px] font-mono font-bold tabular-nums', r.kpis.estado === 'cuadrado' ? 'text-emerald-600' : 'text-rose-600')}>{fmtPEN(r.kpis.diferencia)}</div></div>
            <div className="rounded-md border border-line p-2.5"><div className="font-mono text-[9px] uppercase tracking-wider text-ink-4">Estado</div><div className={cn('mt-0.5 text-[14px] font-bold', r.kpis.estado === 'cuadrado' ? 'text-emerald-600' : 'text-rose-600')}>{r.kpis.estado === 'cuadrado' ? '✓ Cuadrado' : '✗ Descuadrado'}</div></div>
          </div>
          <div className="text-[11px] text-ink-3">{r.kpis.partidasLibroPendientes} partidas del libro · {r.kpis.movimientosBancoPendientes} del banco pendientes · <b>{r.calidad.pctConciliado}% conciliado</b> ({r.calidad.conciliados}/{r.calidad.total})</div>
          {(r.saldoExtracto.inconsistente || r.saldoExtracto.estimado) && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 p-2 text-[10.5px] text-amber-800 dark:text-amber-300">
              {r.saldoExtracto.inconsistente && <>Saldo del extracto <b>inconsistente</b>: columna {fmtPEN(r.saldoExtracto.viaColumna ?? 0)} vs calculado {fmtPEN(r.saldoExtracto.viaMovimientos ?? 0)} — el extracto no cuadra consigo mismo. </>}
              {r.saldoExtracto.estimado && <>Saldo <b>estimado</b> (el extracto no trae saldo inicial). </>}
            </div>
          )}
          <div className="rounded-md bg-bg-sunken/40 p-3 text-[11px] font-mono space-y-0.5">
            <div className="flex justify-between"><span>Saldo banco (extracto)</span><span className="tabular-nums">{fmtPEN(r.kpis.saldoBanco)}</span></div>
            <div className="flex justify-between text-ink-3"><span>− Saldo libro (cuenta {r.cuenta.cuentaContable})</span><span className="tabular-nums">{fmtPEN(r.kpis.saldoLibro)}</span></div>
            <div className="flex justify-between border-t border-line pt-0.5 font-bold"><span>= Diferencia a explicar con partidas</span><span className={cn('tabular-nums', r.kpis.estado === 'cuadrado' ? 'text-emerald-600' : 'text-rose-600')}>{fmtPEN(r.kpis.diferencia)}</span></div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-md border border-line overflow-hidden">
              <div className="bg-bg-sunken px-2 py-1.5 text-[10px] font-mono uppercase text-ink-4">Libro → Banco (en tránsito) · {r.partidas.libroNoBanco.length}</div>
              <div className="max-h-60 overflow-auto"><table className="w-full"><tbody>{r.partidas.libroNoBanco.slice(0, 50).map(fila)}{r.partidas.libroNoBanco.length === 0 && <tr><td className="px-2 py-3 text-[11px] text-ink-4">Sin partidas</td></tr>}</tbody></table></div>
            </div>
            <div className="rounded-md border border-line overflow-hidden">
              <div className="bg-bg-sunken px-2 py-1.5 text-[10px] font-mono uppercase text-ink-4">Banco → Libro (ITF/comisiones/…) · {r.partidas.bancoNoLibro.length}</div>
              <div className="max-h-60 overflow-auto"><table className="w-full"><tbody>{r.partidas.bancoNoLibro.slice(0, 50).map(fila)}{r.partidas.bancoNoLibro.length === 0 && <tr><td className="px-2 py-3 text-[11px] text-ink-4">Sin partidas</td></tr>}</tbody></table></div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ConciliacionView({ proyectos, defaultProyecto }: { proyectos: { id: string; codigo: string; nombre: string }[]; defaultProyecto: string }) {
  const qc = useQueryClient();
  const [sel, setSel] = useState<string | null>(null);
  const [cuentaId, setCuentaId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState('');
  // F6 · flujos: registrar desde extracto (abre el formulario nuevo prellenado) + lote de cargos del banco
  const [registrarLinea, setRegistrarLinea] = useState<ExtractoLineaUI | null>(null);
  const [loteOpen, setLoteOpen] = useState(false);
  const cuentasQ = useQuery({ queryKey: ['cuentas'], queryFn: () => api.finanzas.listCuentas() });
  const extQ = useQuery({ queryKey: ['concil-ext'], queryFn: () => api.conciliacion.listExtractos() });
  const linQ = useQuery({ queryKey: ['concil-lin', sel], queryFn: () => api.conciliacion.getLineas(sel!), enabled: !!sel });
  const inval = () => { qc.invalidateQueries({ queryKey: ['concil-ext'] }); qc.invalidateQueries({ queryKey: ['concil-lin'] }); };
  const importar = useMutation({
    mutationFn: () => api.conciliacion.importar(file!, { cuentaId: cuentaId || undefined }),
    onSuccess: (r) => { setErr(''); setFile(null); inval(); setSel(r.extracto.id); },
    onError: (e: Error) => setErr(e.message),
  });
  const conciliar = useMutation({ mutationFn: (v: { id: string; mid: string }) => api.conciliacion.conciliar(v.id, v.mid), onSuccess: inval, onError: (e: Error) => setErr(e.message) });
  const setEstado = useMutation({ mutationFn: (v: { id: string; estado: string }) => api.conciliacion.setEstado(v.id, v.estado), onSuccess: inval });
  // F6 · confirmar sugerencias del matcher en lote (las de confianza baja quedan para revisión manual)
  const confirmarSug = useMutation({
    mutationFn: () => api.conciliacion.confirmarSugeridas(sel!),
    onSuccess: (r) => { setErr(''); inval(); if (r.bajaExcluidas > 0) setErr(`${r.conciliadas} conciliadas · ${r.bajaExcluidas} de confianza baja quedan para revisión manual`); },
    onError: (e: Error) => setErr(e.message),
  });
  const [filtro, setFiltro] = useState<'pendientes' | 'sugeridas' | 'cargos' | 'sinpareja' | 'conciliadas' | 'todas'>('pendientes');
  const cuentas = cuentasQ.data?.cuentas ?? [];
  const lineas = linQ.data?.lineas ?? [];
  const extractos = extQ.data?.extractos ?? [];
  const extSel = extractos.find((e) => e.id === sel); // cuenta bancaria del extracto (prefill)
  useEffect(() => { if (!sel && extractos.length) setSel(extractos[0]!.id); }, [sel, extractos]);

  // F6 · categorías de trabajo de una línea (gobiernan filtros, conteos y acciones)
  const catDe = (l: ExtractoLineaUI): 'sugerida' | 'cargo' | 'sinpareja' | 'conciliada' | 'otras' => {
    if (l.estado === 'conciliado') return 'conciliada';
    if (l.estado !== 'pendiente') return 'otras'; // diferencia · ignorado
    if (l.movimientoId) return 'sugerida';
    if (l.caso === 'itf' || l.caso === 'cargo_banco') return 'cargo';
    return 'sinpareja';
  };
  const conteo = { sugerida: 0, cargo: 0, sinpareja: 0, conciliada: 0, otras: 0 };
  for (const l of lineas) conteo[catDe(l)]++;
  const sugConfirmables = lineas.filter((l) => catDe(l) === 'sugerida' && l.confianza !== 'baja').length;
  const visibles = lineas.filter((l) => {
    const c = catDe(l);
    if (filtro === 'todas') return true;
    if (filtro === 'pendientes') return c === 'sugerida' || c === 'cargo' || c === 'sinpareja';
    if (filtro === 'sugeridas') return c === 'sugerida';
    if (filtro === 'cargos') return c === 'cargo';
    if (filtro === 'sinpareja') return c === 'sinpareja';
    return c === 'conciliada' || c === 'otras';
  });

  return (
    <div className="space-y-4">
      <ResumenConciliacionPanel cuentaHint={extSel?.cuentaId} periodoHint={lineas[0]?.fecha.slice(0, 7)} />

      {/* Extracto en trabajo + importar · una fila de contexto (el detalle vive en la bandeja) */}
      <div className="rounded-lg border border-line bg-bg-elev px-3.5 py-3 flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-4">Extracto</span>
        <select value={sel ?? ''} onChange={(e) => setSel(e.target.value || null)} className="h-8 px-2.5 rounded-md border border-line bg-bg-elev text-[12px] min-w-[240px] max-w-[340px] truncate">
          {extractos.length === 0 && <option value="">— sin extractos importados —</option>}
          {extractos.map((e) => <option key={e.id} value={e.id}>{e.nombreArchivo ?? 'extracto'} · {e.totalFilas} mov. · {new Date(e.importadoEn).toLocaleDateString('es-PE')}</option>)}
        </select>
        <div className="flex-1" />
        <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} className="h-8 px-2 rounded-md border border-line bg-bg-elev text-[11.5px] max-w-[180px] truncate">
          <option value="">— cuenta del archivo —</option>
          {cuentas.map((c) => <option key={c.id} value={c.id}>{c.descripcion ?? c.codigo}</option>)}
        </select>
        <input type="file" accept=".csv,.xlsx,.xls,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[11px] max-w-[190px]" />
        <button disabled={!file || importar.isPending} onClick={() => importar.mutate()} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90 disabled:opacity-50">{importar.isPending ? 'Leyendo…' : 'Importar'}</button>
        <div className="w-full text-[10.5px] text-ink-4">PDF del estado de cuenta BCP (lectura automática, ~2 min) o CSV / XLSX de cualquier banco · los re-imports del mismo mes se detectan solos</div>
        {err && <div className="w-full text-[11px] text-amber-700">{err}</div>}
      </div>

      {/* F6 · Bandeja de trabajo: una lista, filtrada por lo que falta decidir, con acciones en lote */}
      {sel && (
        <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2.5">
            <SegTabs value={filtro} onChange={setFiltro} opts={[
              { v: 'pendientes', l: 'Pendientes', n: conteo.sugerida + conteo.cargo + conteo.sinpareja },
              { v: 'sugeridas', l: 'Sugeridas', n: conteo.sugerida },
              { v: 'cargos', l: 'Cargos del banco', n: conteo.cargo },
              { v: 'sinpareja', l: 'Sin pareja', n: conteo.sinpareja },
              { v: 'conciliadas', l: 'Resueltas', n: conteo.conciliada + conteo.otras },
              { v: 'todas', l: 'Todas' },
            ] as const} />
            <div className="flex-1" />
            {sugConfirmables > 0 && (
              <button disabled={confirmarSug.isPending} onClick={() => confirmarSug.mutate()}
                title="Concilia las sugerencias de confianza alta y media · las de confianza baja (montos empatados) se revisan una por una"
                className="h-7 px-2.5 rounded-md bg-emerald-600 text-white text-[11px] font-semibold hover:opacity-90 disabled:opacity-50">
                {confirmarSug.isPending ? 'Conciliando…' : `Confirmar ${sugConfirmables} sugerida(s)`}
              </button>
            )}
            {conteo.cargo > 0 && (
              <button onClick={() => setLoteOpen(true)} className="h-7 px-2.5 rounded-md border border-line text-[11px] font-semibold text-ink-2 hover:bg-bg-sunken">
                Registrar {conteo.cargo} cargo(s) del banco
              </button>
            )}
          </div>
          {linQ.isLoading ? <SkelRows rows={8} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-bg-sunken border-b border-line"><tr className="text-left text-[10px] font-mono uppercase tracking-wider text-ink-4">
                <th className="px-3 py-2 w-16">Fecha</th><th className="px-3 py-2">Movimiento del banco</th><th className="px-3 py-2 w-28 text-right">Monto</th>
                <th className="px-3 py-2">Pareja en el ERP</th><th className="px-3 py-2 w-56"></th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {visibles.map((l) => { const c = catDe(l); return (
                  <tr key={l.id} className={cn('hover:bg-bg-sunken/30', c === 'conciliada' && 'opacity-55')}>
                    <td className="px-3 py-1.5 font-mono text-[10.5px] text-ink-3 whitespace-nowrap">{l.fecha.slice(5)}</td>
                    <td className="px-3 py-1.5 max-w-[280px]">
                      <div className="truncate text-[11.5px]" title={l.descripcion ?? ''}>{l.descripcion || '—'}</div>
                      {l.referencia && <div className="font-mono text-[9.5px] text-ink-4">op. {l.referencia}</div>}
                    </td>
                    <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums whitespace-nowrap', Number(l.monto) < 0 ? 'text-rose-600' : 'text-emerald-600')}>{fmtPEN(Number(l.monto))}</td>
                    <td className="px-3 py-1.5 text-[11px]">
                      {c === 'conciliada' && l.movimiento ? (
                        <span className="text-ink-2">✓ {l.movimiento.descripcion ?? l.movimiento.tipoMovimiento} · {fmtPEN(Number(l.movimiento.montoBase ?? l.movimiento.monto))}</span>
                      ) : c === 'sugerida' && l.movimiento ? (
                        <span>
                          {l.movimiento.descripcion ?? l.movimiento.tipoMovimiento} · {fmtPEN(Number(l.movimiento.montoBase ?? l.movimiento.monto))}
                          <span className={cn('ml-1.5 font-mono text-[9.5px]', l.confianza === 'alta' ? 'text-emerald-600' : l.confianza === 'media' ? 'text-amber-600' : 'text-rose-600')}>
                            {l.confianza}{l.confianza === 'baja' ? ' · monto repetido, revisar' : ''}
                          </span>
                        </span>
                      ) : c === 'cargo' ? (
                        <span className="text-ink-4">ITF / comisión del banco → lote (cuenta {l.cuentaSugerida})</span>
                      ) : l.estado === 'ignorado' ? (
                        <span className="text-ink-4">ignorada</span>
                      ) : l.estado === 'diferencia' ? (
                        <span className="text-rose-600">marcada como diferencia</span>
                      ) : (
                        <span className="text-ink-4">sin movimiento en el ERP</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {c === 'conciliada' ? (
                        <button onClick={() => setEstado.mutate({ id: l.id, estado: 'pendiente' })} className="text-[10.5px] text-ink-4 hover:text-foreground">deshacer</button>
                      ) : l.estado === 'ignorado' || l.estado === 'diferencia' ? (
                        <button onClick={() => setEstado.mutate({ id: l.id, estado: 'pendiente' })} className="text-[10.5px] text-ink-4 hover:text-foreground">reactivar</button>
                      ) : (
                        <div className="flex gap-1.5">
                          {c === 'sugerida' && <>
                            <button onClick={() => conciliar.mutate({ id: l.id, mid: l.movimientoId! })} className="h-6 px-2 rounded-md bg-emerald-600 text-white text-[10.5px] font-medium hover:opacity-90">Confirmar</button>
                            <button onClick={() => setEstado.mutate({ id: l.id, estado: 'pendiente' })} title="Quita la sugerencia · la línea pasa a Sin pareja para registrarla o conciliarla con otro movimiento" className="h-6 px-2 rounded-md border border-line text-[10.5px] text-ink-3 hover:bg-bg-sunken">Quitar</button>
                          </>}
                          {c === 'sinpareja' && (
                            <button onClick={() => setRegistrarLinea(l)} title="Abre el formulario prellenado con esta línea; al guardar queda conciliada" className="h-6 px-2 rounded-md border border-primary/60 text-primary text-[10.5px] font-semibold hover:bg-primary/5">Registrar</button>
                          )}
                          {c !== 'sugerida' && (
                            <button onClick={() => setEstado.mutate({ id: l.id, estado: 'diferencia' })} className="h-6 px-2 rounded-md border border-line text-[10.5px] text-ink-3 hover:text-rose-600">Diferencia</button>
                          )}
                          <button onClick={() => setEstado.mutate({ id: l.id, estado: 'ignorado' })} className="h-6 px-2 rounded-md border border-line text-[10.5px] text-ink-4 hover:bg-bg-sunken">Ignorar</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ); })}
                {visibles.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-10 text-center text-[12px] text-ink-3">
                    {filtro === 'pendientes' ? 'Nada pendiente en este extracto · todo decidido' : 'Sin líneas en este filtro'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          )}
          <div className="flex flex-wrap justify-between gap-2 border-t border-line px-3.5 py-2 text-[10.5px] text-ink-4">
            <span>{lineas.length} movimiento(s) del banco · {conteo.conciliada} conciliado(s)</span>
            <span className="font-mono tabular-nums">Σ abonos {fmtPEN(lineas.reduce((s, l) => s + Math.max(Number(l.monto), 0), 0))} · Σ cargos {fmtPEN(lineas.reduce((s, l) => s + Math.min(Number(l.monto), 0), 0))}</span>
          </div>
        </div>
      )}

      {/* F6 · Registrar desde extracto: formulario nuevo prellenado; al guardar la línea queda conciliada */}
      {registrarLinea && (
        <MovModalV2
          proyectos={proyectos}
          defaultProyecto={defaultProyecto}
          prefill={{
            entrada: registrarLinea.entradaSugerida ?? (Number(registrarLinea.monto) > 0 ? 'ingreso' : 'pago'),
            fecha: registrarLinea.fecha,
            monto: Number(registrarLinea.monto),
            numOperacion: registrarLinea.referencia,
            cuentaId: extSel?.cuentaId ?? null,
            descripcion: registrarLinea.descripcion,
          }}
          onRegistrado={(movId) => { if (movId) conciliar.mutate({ id: registrarLinea.id, mid: movId }); }}
          onClose={() => { setRegistrarLinea(null); inval(); }}
        />
      )}
      {loteOpen && sel && (
        <CargosBancoModal
          lineas={lineas.filter((l) => l.estado === 'pendiente' && !l.movimientoId && (l.caso === 'itf' || l.caso === 'cargo_banco'))}
          onClose={() => { setLoteOpen(false); inval(); qc.invalidateQueries({ queryKey: ['mov-global'] }); }}
        />
      )}
    </div>
  );
}

// ─── F6 · Lote de cargos del banco: ITF → 6412, comisiones/portes/mant → 679 (cuenta editable) ──
function CargosBancoModal({ lineas, onClose }: { lineas: ExtractoLineaUI[]; onClose: () => void }) {
  const [cuentas, setCuentas] = useState<Record<string, string>>(() => Object.fromEntries(lineas.map((l) => [l.id, l.cuentaSugerida ?? '679'])));
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const total = lineas.reduce((s, l) => s + Math.abs(Number(l.monto)), 0);
  const mut = useMutation({
    mutationFn: () => api.conciliacion.cargosBanco(lineas.map((l) => ({ lineaId: l.id, cuenta: cuentas[l.id] }))),
    onSuccess: (r) => {
      if (r.errores.length) setResultado(`${r.creados.length} registrado(s) · ${r.errores.length} con error: ${r.errores.join(' · ')}`);
      else { setResultado(null); onClose(); }
    },
    onError: (e: Error) => setError(e.message),
  });
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-backdropIn" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg rounded-xl border border-line bg-bg-elev shadow-2xl animate-modalPop">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <h2 className="text-[15px] font-bold">Cargos del banco · {lineas.length} línea(s)</h2>
            <div className="text-[11px] text-ink-3">Cada línea se registra como egreso con su cuenta (editable) y queda conciliada. El asiento nace en la pasada del período.</div>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-md inline-flex items-center justify-center text-ink-3 hover:bg-bg-sunken"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-2 max-h-[55vh] overflow-y-auto">
          {lineas.map((l) => (
            <div key={l.id} className="flex items-center gap-2.5 text-[11.5px]">
              <span className="font-mono text-[10.5px] text-ink-3 w-16">{l.fecha.slice(5)}</span>
              <span className="flex-1 min-w-0 truncate" title={l.descripcion ?? ''}>{l.descripcion}</span>
              <span className="font-mono text-rose-600 whitespace-nowrap">{fmtPEN(Number(l.monto))}</span>
              <input className={cn(inputCls, 'h-7 w-20 font-mono')} value={cuentas[l.id] ?? ''} onChange={(e) => setCuentas((s) => ({ ...s, [l.id]: e.target.value }))} title="Cuenta contable del cargo (6412 ITF · 679 comisiones)" />
            </div>
          ))}
          {resultado && <div className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11px] text-amber-700">{resultado}</div>}
          {error && <div className="rounded-md border border-rose-300/60 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-[11px] text-rose-700">{error}</div>}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-5 py-3">
          <span className="text-[11px] text-ink-3 mr-auto font-mono">Σ {fmtPEN(total)}</span>
          <button onClick={onClose} className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-bg-sunken">Cancelar</button>
          <button disabled={mut.isPending || !lineas.length} onClick={() => { setError(null); mut.mutate(); }}
            className={cn('h-8 px-3 rounded-md bg-amber-600 text-white text-[12px] font-semibold hover:opacity-90', (mut.isPending || !lineas.length) && 'opacity-50 pointer-events-none')}>
            {mut.isPending ? 'Registrando…' : `Registrar ${lineas.length} cargo(s)`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// re-export para mantener FinanzasTab disponible si se usa por-obra
export { FinanzasTab };
