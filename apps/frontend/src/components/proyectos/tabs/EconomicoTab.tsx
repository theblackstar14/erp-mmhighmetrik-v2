import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Info, Pencil, Sparkles, Wallet } from 'lucide-react';
import { Suspense, lazy, useState } from 'react';
import { api } from '@/lib/api.js';
import { cn, fmtPEN } from '@/lib/utils.js';

const FlujoCajaChart = lazy(() => import('./FlujoCajaChart.js'));

export function EconomicoTab({ proyectoId }: { proyectoId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['pnl', proyectoId], queryFn: () => api.proyectos.getPnl(proyectoId) });
  const proyQ = useQuery({ queryKey: ['proyecto', proyectoId], queryFn: () => api.proyectos.get(proyectoId) });
  // mismo queryKey que CashflowSection · react-query lo deduplica (no doble fetch)
  const cashflowQ = useQuery({ queryKey: ['cashflow', proyectoId], queryFn: () => api.proyectos.getCashflow(proyectoId) });
  const [editPct, setEditPct] = useState(false);
  const [pctInput, setPctInput] = useState('');

  const setPct = useMutation({
    mutationFn: (pct: number) => api.proyectos.setParticipacion(proyectoId, pct),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pnl', proyectoId] }); setEditPct(false); },
  });

  if (isLoading) return <div className="text-[12px] text-ink-3">Cargando económico...</div>;
  if (!data) return <div className="text-[12px] text-destructive">Sin datos</div>;

  const { ingresos, costoReal, comprometido, miPct, miUtilidad } = data;

  // ─── Análisis de utilidad proyectada (EAC) · estilo v1 ───
  const p = proyQ.data?.proyecto;
  const contractual = Number(p?.montoSubtotal ?? 0) || Number(p?.montoContractual ?? 0) / 1.18; // sin IGV
  const gastadoReal = costoReal.total; // pagado + pendiente
  const estimadoTerminar = comprometido.total; // cotizaciones + OC por ejecutar
  const eac = gastadoReal + estimadoTerminar; // costo proyectado al cierre
  const utilidadEstimada = contractual - eac;
  const margenProyectado = contractual > 0 ? (utilidadEstimada / contractual) * 100 : 0;
  const margenMeta = Number(p?.pctUtilidad ?? 0.07) * 100;
  // Sin costos cargados → el EAC=0 haría parecer el contrato entero como utilidad (margen 100%).
  // No mostramos esa cifra engañosa: empty-state hasta que haya gastos/OC.
  const sinCostos = gastadoReal === 0 && estimadoTerminar === 0;
  // Desglose de costo real por rubro (tipoGasto), ordenado desc · drill-down
  const costoPorTipo = Object.entries(costoReal.porTipo ?? {}).sort((a, b) => b[1] - a[1]);

  // ─── Ingresos y cobranza (data que SÍ existe aunque no haya costos) ───
  const cfTot = cashflowQ.data?.totales;
  const cobrado = cfTot?.valosCobrado ?? 0; // neto ya cobrado
  const porCobrar = cfTot?.valosPendiente ?? 0; // neto facturado por cobrar
  const retencion = cfTot?.retencionAcum ?? 0; // garantía retenida acumulada
  const facturado = ingresos.total; // Σ V (sin IGV)
  const pctFacturado = contractual > 0 ? (facturado / contractual) * 100 : 0;
  const netoFacturado = cobrado + porCobrar; // base neta (con IGV − retención)

  return (
    <div className="space-y-4">
      {/* Nota base */}
      <div className="text-[11px] text-ink-3">
        Montos <strong>sin IGV</strong> · ingreso = valorizaciones (V) · costo real = gastos ejecutados · comprometido = OC aprobadas
      </div>

      {/* Tira de KPIs · siempre con número (ingresos tienen data aunque no haya costos) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <Kpi lbl="Facturado (V)" val={fmtPEN(facturado)} sub={`${pctFacturado.toFixed(1)}% del contrato`} accent="primary" />
        <Kpi lbl="Por cobrar" val={fmtPEN(porCobrar)} sub={cobrado > 0 ? `${fmtPEN(cobrado)} cobrado` : 'sin cobros aún'} accent="amber" />
        <Kpi lbl="Retención garantía" val={fmtPEN(retencion)} sub="acum · se devuelve al cierre" />
        <Kpi lbl="Costo real" val={fmtPEN(costoReal.total)} sub={`${costoReal.gastos} gastos`} />
        <Kpi lbl="Mi utilidad" val={fmtPEN(miUtilidad)} sub={`devengada · ${(miPct * 100).toFixed(0)}%`} accent={miUtilidad >= 0 ? 'ok' : 'destructive'} />
      </div>

      {/* Ingresos y cobranza · barras que se llenan + cuánto falta */}
      <div className="rounded-md border border-line bg-bg-elev p-4">
        <h3 className="text-[13px] font-semibold mb-3.5">Ingresos y cobranza</h3>
        <div className="space-y-4">
          <BarMeta label="Facturado del contrato" value={facturado} total={contractual} color="bg-primary" restoLabel="Falta facturar" />
          <BarMeta label="Cobrado de lo facturado (neto)" value={cobrado} total={netoFacturado} color="bg-emerald-500" restoLabel="Por cobrar" />
        </div>
        {retencion > 0 && (
          <div className="mt-3.5 rounded-md bg-bg-sunken/50 px-3 py-2 text-[10.5px] text-ink-3">
            Retención de garantía acumulada <span className="font-mono font-semibold text-ink-1">{fmtPEN(retencion)}</span> · descontada en cada
            valorización, se devuelve al consentir la liquidación.
          </div>
        )}
      </div>

      {/* Análisis de Utilidad Proyectada (hero) + Márgenes */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.7fr_1fr] gap-3">
        <div className="rounded-md border border-line bg-bg-elev p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-[13px] font-semibold">Utilidad proyectada al cierre (EAC)</h3>
              <p className="text-[10px] text-ink-4 mt-0.5">Contractual − costo estimado al terminar · distinta de la utilidad devengada a hoy (abajo)</p>
            </div>
            <span className="inline-flex items-center gap-1 chip blue shrink-0"><Sparkles className="h-3 w-3" /> Basado en cotizaciones</span>
          </div>
          {sinCostos ? (
            <div className="rounded-md border border-dashed border-line bg-bg-sunken/40 px-3 py-4 flex items-start gap-2.5">
              <Info className="h-4 w-4 text-ink-4 mt-0.5 shrink-0" />
              <div className="text-[11.5px] text-ink-3 leading-snug">
                <span className="font-medium text-ink-2">Sin costos cargados aún.</span> La utilidad proyectada no se puede estimar
                hasta registrar gastos reales (compras/planilla) u OC comprometidas. Presupuesto contractual:{' '}
                <span className="font-mono font-semibold text-ink-1">{fmtPEN(contractual)}</span>.
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4">Presupuesto Contractual</div>
                  <div className="text-[20px] font-bold tracking-[-0.02em]">{fmtPEN(contractual)}</div>
                </div>
                <span className="text-[18px] text-ink-4">−</span>
                <div className="min-w-0 text-center">
                  <div className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4">Costo Proyectado (EAC)</div>
                  <div className="text-[20px] font-bold tracking-[-0.02em] text-destructive">{fmtPEN(eac)}</div>
                </div>
                <span className="text-[18px] text-ink-4">=</span>
                <div className="min-w-0 text-right">
                  <div className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4">Utilidad Estimada</div>
                  <div className={cn('text-[22px] font-bold tracking-[-0.02em]', utilidadEstimada >= 0 ? 'text-ok' : 'text-destructive')}>{fmtPEN(utilidadEstimada)}</div>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                <Bar label="Gastado Real (Pagado + Pendiente pago)" value={gastadoReal} total={contractual} color="bg-primary" />
                <Bar label="Estimado a Terminar (Cotizaciones y OC)" value={estimadoTerminar} total={contractual} color="bg-amber-500" />
              </div>
            </>
          )}
        </div>

        {/* Resumen de márgenes */}
        <div className="rounded-md border border-line bg-bg-elev p-4">
          <h3 className="text-[13px] font-semibold mb-4">Resumen de Márgenes</h3>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-[11px] mb-1"><span className="text-ink-3">Margen Bruto Meta</span><span className="font-mono font-medium">{margenMeta.toFixed(1)}%</span></div>
              <div className="h-2 rounded-full bg-bg-sunken overflow-hidden"><div className="h-full rounded-full bg-line-strong" style={{ width: `${Math.min(100, margenMeta)}%` }} /></div>
            </div>
            <div>
              <div className="flex justify-between text-[11px] mb-1"><span className="text-ink-3">Margen Proyectado Hoy</span><span className={cn('font-mono font-medium', sinCostos ? 'text-ink-4' : margenProyectado >= margenMeta ? 'text-ok' : 'text-warn-ink')}>{sinCostos ? '—' : `${margenProyectado.toFixed(1)}%`}</span></div>
              <div className="h-2 rounded-full bg-bg-sunken overflow-hidden"><div className={cn('h-full rounded-full', margenProyectado >= margenMeta ? 'bg-ok' : 'bg-warn')} style={{ width: `${sinCostos ? 0 : Math.min(100, Math.max(0, margenProyectado))}%` }} /></div>
            </div>
          </div>
          <p className="mt-3 text-[10.5px] text-ink-4 leading-snug">
            {gastadoReal === 0 && estimadoTerminar === 0
              ? 'Sin costos registrados aún · el margen proyectado iguala la meta hasta cargar compras/planilla.'
              : `Ingresos valorizados: ${fmtPEN(ingresos.total)} (${ingresos.valorizaciones} V) · costo real ${fmtPEN(gastadoReal)} (${costoReal.gastos} gastos).`}
          </p>
        </div>
      </div>

      {/* Comprometido (OC) breakdown */}
      <div className="rounded-md border border-line bg-bg-elev p-3">
        <div className="text-[11px] font-semibold text-ink-2 mb-2">Comprometido (OC) por concepto · {fmtPEN(comprometido.total)}</div>
        <div className="grid grid-cols-2 gap-2.5 text-[12px]">
          <div className="flex justify-between"><span className="text-ink-3">Bienes (OC)</span><span className="font-mono tabular-nums">{fmtPEN(comprometido.bien)}</span></div>
          <div className="flex justify-between"><span className="text-ink-3">Servicios (OS)</span><span className="font-mono tabular-nums">{fmtPEN(comprometido.servicio)}</span></div>
        </div>
        <div className="text-[10.5px] text-ink-4 mt-1.5">
          {costoReal.total === 0 && comprometido.total > 0
            ? 'Hay OC comprometidas pero sin gastos reales registrados aún · la utilidad usa costo REAL (tab Finanzas)'
            : 'Comprometido = compromiso futuro (OC) · costo real = gasto ya ejecutado'}
        </div>
      </div>

      {/* Costo real por rubro · drill-down + link a Finanzas */}
      <div className="rounded-md border border-line bg-bg-elev p-3">
        <div className="text-[11px] font-semibold text-ink-2 mb-2">
          Costo real por rubro · {fmtPEN(costoReal.total)} <span className="text-ink-4 font-normal">({costoReal.gastos} gastos)</span>
        </div>
        {costoPorTipo.length === 0 ? (
          <div className="text-[11px] text-ink-4">Sin gastos registrados · registra compras/planilla en Finanzas para ver el desglose.</div>
        ) : (
          <div className="space-y-1.5">
            {costoPorTipo.map(([tipo, monto]) => {
              const pct = costoReal.total > 0 ? (monto / costoReal.total) * 100 : 0;
              return (
                <div key={tipo}>
                  <div className="flex justify-between text-[11.5px] mb-0.5">
                    <span className="text-ink-3">{tipo}</span>
                    <span className="font-mono tabular-nums">{fmtPEN(monto)} · {pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-bg-sunken overflow-hidden">
                    <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Mi bolsillo */}
      <div className="rounded-md border border-primary/40 bg-primary/5 p-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[12px] font-semibold text-ink-1 flex items-center gap-1.5"><Wallet className="h-4 w-4 text-primary" /> Mi parte (MM)</span>
          {/* Mi % editable */}
          {editPct ? (
            <div className="flex items-center gap-1">
              <input
                className="h-7 w-20 px-2 rounded border border-line bg-bg-elev text-[12px] text-right"
                type="number" step="1" placeholder="%" autoFocus
                value={pctInput}
                onChange={(e) => setPctInput(e.target.value)}
              />
              <span className="text-[11px] text-ink-3">%</span>
              <button
                onClick={() => { const v = Number(pctInput); if (Number.isFinite(v) && v >= 0 && v <= 100) setPct.mutate(v / 100); }}
                disabled={setPct.isPending}
                className="h-7 px-2 rounded bg-primary text-primary-foreground text-[11px] disabled:opacity-50"
              ><Check className="h-3.5 w-3.5" /></button>
            </div>
          ) : (
            <button
              onClick={() => { setPctInput((miPct * 100).toString()); setEditPct(true); }}
              className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
            >
              {(miPct * 100).toFixed(0)}% participación <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="flex items-baseline gap-2.5">
          <span className={cn('text-[30px] font-bold tracking-[-0.02em] leading-none', miUtilidad >= 0 ? 'text-primary' : 'text-destructive')}>
            {fmtPEN(miUtilidad)}
          </span>
          <span className="text-[12px] text-ink-3">mi utilidad · devengada a hoy</span>
        </div>
        <div className="text-[10.5px] text-ink-4 mt-1">
          = ingresos {fmtPEN(ingresos.total)} × {(miPct * 100).toFixed(0)}% − costo real {fmtPEN(costoReal.total)} <span className="italic">(financias tus costos completos)</span>
        </div>
      </div>

      {/* Flujo de caja */}
      <CashflowSection proyectoId={proyectoId} />
    </div>
  );
}

function CashflowSection({ proyectoId }: { proyectoId: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['cashflow', proyectoId], queryFn: () => api.proyectos.getCashflow(proyectoId) });
  if (isLoading) return <div className="text-[12px] text-ink-3">Cargando flujo de caja...</div>;
  if (!data || data.buckets.length === 0) {
    return (
      <div className="rounded-md border border-line bg-bg-elev p-4">
        <h3 className="text-[13px] font-semibold mb-1">Flujo de caja</h3>
        <p className="text-[11px] text-ink-3">Sin movimientos · registra adelantos, valos o compras con fecha</p>
      </div>
    );
  }
  const { buckets, totales } = data;
  return (
    <div className="rounded-md border border-line bg-bg-elev">
      <div className="border-b border-line px-4 py-3">
        <h3 className="text-[13px] font-semibold">Flujo de caja proyectado (con IGV)</h3>
        <p className="text-[11px] text-ink-3 mt-0.5">
          Entradas {fmtPEN(totales.entradas)} · Salidas {fmtPEN(totales.salidas)} ·
          <span className={cn('font-semibold ml-1', totales.saldoFinal >= 0 ? 'text-ok' : 'text-destructive')}>saldo {fmtPEN(totales.saldoFinal)}</span>
          {totales.retencionAcum > 0 && <span className="ml-2 text-ink-4">retención {totales.retencionDevuelta ? 'devuelta' : `pendiente ${fmtPEN(totales.retencionAcum)}`}</span>}
        </p>
        <p className="text-[10.5px] text-ink-4 mt-1">
          Valos ubicadas por mes de periodo (proyectado, no fecha de cobro real) · de ellas{' '}
          <span className="text-ok font-medium">{fmtPEN(totales.valosCobrado)} cobrado</span> · {fmtPEN(totales.valosPendiente)} por cobrar
        </p>
      </div>
      <div className="p-4"><Suspense fallback={<div className="h-[260px] animate-pulse rounded bg-bg-sunken/50" />}><FlujoCajaChart buckets={buckets} /></Suspense></div>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line bg-bg-sunken">
              {['Mes', 'Adelanto', 'Valos', 'Devol. ret.', 'Compras', 'IGV SUNAT', 'Neto', 'Saldo acum.'].map((h, i) => (
                <th key={i} className={cn('px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-4', i === 0 ? 'text-left' : 'text-right')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.ym} className="border-b border-line">
                <td className="px-2.5 py-1.5 text-[11.5px] font-mono">{b.ym}</td>
                <Num v={b.adelantos} pos />
                <Num v={b.valos} pos />
                <Num v={b.devolucionRetencion} pos />
                <Num v={-b.compras} />
                <Num v={-b.igvSunat} />
                <td className={cn('px-2.5 py-1.5 text-[11.5px] font-mono tabular-nums text-right font-semibold', b.neto >= 0 ? 'text-ok' : 'text-destructive')}>{fmtPEN(b.neto)}</td>
                <td className={cn('px-2.5 py-1.5 text-[11.5px] font-mono tabular-nums text-right font-bold', b.saldoAcum >= 0 ? 'text-foreground' : 'text-destructive')}>{fmtPEN(b.saldoAcum)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Num({ v, pos }: { v: number; pos?: boolean }) {
  if (Math.abs(v) < 0.01) return <td className="px-2.5 py-1.5 text-[11.5px] text-right text-ink-4">—</td>;
  return <td className={cn('px-2.5 py-1.5 text-[11.5px] font-mono tabular-nums text-right', pos ? 'text-ok' : 'text-warn-ink')}>{fmtPEN(v)}</td>;
}

function Bar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-[11px] mb-1"><span className="text-ink-3">{label}</span><span className="font-mono tabular-nums">{fmtPEN(value)}</span></div>
      <div className="h-2.5 rounded-full bg-bg-sunken overflow-hidden"><div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

// Tarjeta KPI compacta · siempre muestra número
function Kpi({ lbl, val, sub, accent }: { lbl: string; val: string; sub?: string; accent?: 'primary' | 'amber' | 'ok' | 'destructive' }) {
  const ac = {
    primary: 'text-primary',
    amber: 'text-amber-700 dark:text-amber-400',
    ok: 'text-emerald-600 dark:text-emerald-400',
    destructive: 'text-destructive',
  };
  return (
    <div className="rounded-md border border-line bg-bg-elev px-3 py-2.5">
      <div className="text-[9.5px] uppercase tracking-wider text-ink-4 font-medium">{lbl}</div>
      <div className={cn('text-[16px] font-bold tracking-[-0.02em] tabular-nums mt-0.5', accent && ac[accent])}>{val}</div>
      {sub && <div className="text-[10px] text-ink-4 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

// Barra con meta · se llena hacia el total y muestra cuánto falta (resto)
function BarMeta({ label, value, total, color, restoLabel }: { label: string; value: number; total: number; color: string; restoLabel?: string }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  const resto = Math.max(0, total - value);
  return (
    <div>
      <div className="flex justify-between items-baseline text-[11.5px] mb-1">
        <span className="text-ink-3">{label}</span>
        <span className="font-mono tabular-nums">
          <span className="font-semibold text-ink-1">{fmtPEN(value)}</span>
          <span className="text-ink-4"> / {fmtPEN(total)} · {pct.toFixed(1)}%</span>
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-bg-sunken overflow-hidden">
        <div className={cn('h-full rounded-full transition-[width] duration-500', color)} style={{ width: `${pct}%` }} />
      </div>
      {resto > 0.01 && <div className="text-[10px] text-ink-4 mt-0.5">{restoLabel ?? 'Falta'} {fmtPEN(resto)}</div>}
    </div>
  );
}
