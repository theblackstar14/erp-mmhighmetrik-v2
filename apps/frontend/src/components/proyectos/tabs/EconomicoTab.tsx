import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Check, Info, Pencil, Wallet } from 'lucide-react';
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
  const costosQ = useQuery({ queryKey: ['costos-obra', proyectoId], queryFn: () => api.proyectos.getCostosObra(proyectoId) });
  const [editPct, setEditPct] = useState(false);
  const [pctInput, setPctInput] = useState('');

  const setPct = useMutation({
    mutationFn: (pct: number) => api.proyectos.setParticipacion(proyectoId, pct),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pnl', proyectoId] }); setEditPct(false); },
  });

  if (isLoading) return <div className="text-[12px] text-ink-3">Cargando económico...</div>;
  if (!data) return <div className="text-[12px] text-destructive">Sin datos</div>;

  const { ingresos, costoReal, comprometido, miPct, miUtilidad } = data;

  const p = proyQ.data?.proyecto;
  // Base de contrato para la PLATA = VIGENTE (con deductivo) · lo que la obra realmente factura.
  // (El % de avance físico vs contrato ORIGINAL vive en Avance/Reconciliación, no acá.)
  const original = Number(p?.montoSubtotal ?? 0) || Number(p?.montoContractual ?? 0) / 1.18; // sin IGV
  const contractual = Number(p?.montoVigente ?? 0) / 1.18 || original; // sin IGV, vigente
  const deductivoPct = original > 0 && contractual < original ? (1 - contractual / original) * 100 : 0;
  const gastadoReal = costoReal.total; // pagado + pendiente
  const estimadoTerminar = comprometido.total; // cotizaciones + OC por ejecutar
  const eac = gastadoReal + estimadoTerminar; // costo proyectado al cierre (lo cargado)
  const utilidadEstimada = contractual - eac;
  const margenProyectado = contractual > 0 ? (utilidadEstimada / contractual) * 100 : 0;
  const margenMeta = Number(p?.pctUtilidad ?? 0.07) * 100;
  const sinCostos = gastadoReal === 0 && estimadoTerminar === 0;
  // Completitud de costo: presupuesto de costo = ingreso × (1 − margen meta). Si lo cargado ≪ esto → faltan costos
  // y el margen proyectado es ficticiamente alto. Lo marcamos en vez de presumirlo.
  const costoPresupuestado = contractual * (1 - Number(p?.pctUtilidad ?? 0.07));
  const pctCostoCargado = costoPresupuestado > 0 ? (eac / costoPresupuestado) * 100 : 0;
  const costoIncompleto = !sinCostos && pctCostoCargado < 80;
  // Costo real por rubro · top 3 + resto agrupado (mata la cola de 0%)
  const costoPorTipo = Object.entries(costoReal.porTipo ?? {}).sort((a, b) => b[1] - a[1]);
  const topRubros = costoPorTipo.slice(0, 3);
  const otrosRubros = costoPorTipo.slice(3);
  const otrosMonto = otrosRubros.reduce((s, [, v]) => s + v, 0);

  // ─── Ingresos y cobranza (data que SÍ existe aunque no haya costos) ───
  const cfTot = cashflowQ.data?.totales;
  const cobrado = cfTot?.valosCobrado ?? 0; // neto ya cobrado
  const porCobrar = cfTot?.valosPendiente ?? 0; // neto facturado por cobrar
  const retencion = cfTot?.retencionAcum ?? 0; // garantía retenida acumulada
  const facturado = ingresos.total; // Σ V (sin IGV)
  const netoFacturado = cobrado + porCobrar; // base neta (con IGV − retención)

  return (
    <div className="space-y-3">
      {/* ── RESULTADO · una sola utilidad protagonista ── */}
      <div className="rounded-xl border border-line bg-bg-elev p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[12px] text-ink-3">Utilidad al cierre <span className="text-ink-4">· proyectada</span></div>
            <div className={cn('mt-1 text-[32px] font-bold tracking-[-0.02em] font-mono leading-none tabular-nums', sinCostos ? 'text-ink-4' : utilidadEstimada >= 0 ? 'text-ok' : 'text-destructive')}>
              {sinCostos ? '—' : fmtPEN(utilidadEstimada)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[12px] text-ink-3">Margen proyectado</div>
            <div className={cn('text-[20px] font-bold font-mono tabular-nums', sinCostos ? 'text-ink-4' : margenProyectado >= margenMeta ? 'text-ok' : 'text-warn-ink')}>
              {sinCostos ? '—' : `${margenProyectado.toFixed(1)}%`}
            </div>
            <div className="text-[11px] text-ink-4">meta {margenMeta.toFixed(1)}%</div>
          </div>
        </div>

        {sinCostos ? (
          <div className="mt-3.5 pt-3 border-t border-line flex items-start gap-2.5 text-[11.5px] text-ink-3">
            <Info className="h-4 w-4 text-ink-4 mt-0.5 shrink-0" />
            <span><span className="font-medium text-ink-2">Sin costos cargados aún.</span> La utilidad no se puede proyectar hasta registrar gastos u OC. Contrato vigente <span className="font-mono font-semibold text-ink-1">{fmtPEN(contractual)}</span>.</span>
          </div>
        ) : (
          <div className="mt-3.5 pt-3 border-t border-line flex items-center gap-2.5 flex-wrap">
            <EqPart label="Contrato vigente" val={fmtPEN(contractual)} />
            <span className="text-[16px] text-ink-4">−</span>
            <EqPart label="Costo est. al cierre" val={fmtPEN(eac)} tone="destructive" />
            <span className="text-[16px] text-ink-4">=</span>
            <EqPart label="Utilidad" val={fmtPEN(utilidadEstimada)} tone={utilidadEstimada >= 0 ? 'ok' : 'destructive'} />
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2.5 rounded-md bg-bg-sunken/60 px-3 py-2 flex-wrap">
          <div className="text-[11.5px] text-ink-2 flex items-center gap-1.5 min-w-0">
            <Info className="h-3.5 w-3.5 text-ink-4 shrink-0" />
            <span>Devengado a hoy <span className="font-mono font-semibold">{fmtPEN(miUtilidad)}</span> <span className="text-ink-4">· entra todo el ingreso, el costo que falta aún no</span></span>
          </div>
          {editPct ? (
            <div className="flex items-center gap-1 shrink-0">
              <input className="h-7 w-16 px-2 rounded border border-line bg-bg-elev text-[12px] text-right" type="number" step="1" autoFocus value={pctInput} onChange={(e) => setPctInput(e.target.value)} />
              <span className="text-[11px] text-ink-3">%</span>
              <button onClick={() => { const v = Number(pctInput); if (Number.isFinite(v) && v >= 0 && v <= 100) setPct.mutate(v / 100); }} disabled={setPct.isPending} className="h-7 px-2 rounded bg-primary text-primary-foreground text-[11px] disabled:opacity-50"><Check className="h-3.5 w-3.5" /></button>
            </div>
          ) : (
            <button onClick={() => { setPctInput((miPct * 100).toString()); setEditPct(true); }} className={cn('shrink-0 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px]', miPct < 1 ? 'border-primary/50 text-primary' : 'border-line text-ink-3 hover:text-foreground')}>
              <Wallet className="h-3.5 w-3.5" /> MM {(miPct * 100).toFixed(0)}% <Pencil className="h-3 w-3 text-ink-4" />
            </button>
          )}
        </div>

        {deductivoPct > 0.05 && (
          <div className="mt-2 text-[10.5px] text-ink-4">Contrato vigente = original {fmtPEN(original)} − deductivo {deductivoPct.toFixed(2)}% (reducción de prestaciones).</div>
        )}
      </div>

      {/* ── RESULTADO DE OBRA (sin gastos de oficina) ── */}
      {costosQ.data && (
        <div className="rounded-lg border border-line bg-bg-elev p-4">
          <h3 className="text-[13px] font-semibold mb-2">Resultado de obra (sin gastos de oficina)</h3>
          <div className="space-y-1 text-[12px]">
            <div className="flex justify-between"><span className="text-ink-2">Valorización reconocida</span><span className="font-mono tabular-nums">{fmtPEN(costosQ.data.valorizacion)}</span></div>
            <div className="flex justify-between"><span className="text-ink-2">(−) Costo Directo ejecutado</span><span className="font-mono tabular-nums">−{fmtPEN(costosQ.data.cd.ejecutado)}</span></div>
            <div className="flex justify-between"><span className="text-ink-2">(−) Gasto General de Obra ejecutado</span><span className="font-mono tabular-nums">−{fmtPEN(costosQ.data.ggObra.ejecutado)}</span></div>
            <div className="flex justify-between border-t border-line pt-1.5 mt-1 font-semibold"><span>Resultado de obra</span><span className="font-mono tabular-nums">{fmtPEN(costosQ.data.resultadoObra)}</span></div>
          </div>
          <div className="mt-2 text-[10.5px] text-ink-4 space-y-0.5">
            <div>Presupuesto CD: {fmtPEN(costosQ.data.cd.presupuesto)}{costosQ.data.ggObra.presupuesto != null ? ` · Presupuesto GG obra: ${fmtPEN(costosQ.data.ggObra.presupuesto)}` : ' · GG embebido en el CD (sin presupuesto GG separable)'}</div>
            {costosQ.data.compartidosSinDistribuir > 0 && (
              <div className="text-amber-600">Incluye {fmtPEN(costosQ.data.compartidosSinDistribuir)} de costos compartidos aún sin distribuir entre obras.</div>
            )}
          </div>
        </div>
      )}

      {/* ── INGRESOS | COSTOS · dos caras de la moneda ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-lg border border-line bg-bg-elev p-4">
          <h3 className="text-[13px] font-semibold mb-3 flex items-center gap-1.5"><ArrowDownRight className="h-4 w-4 text-ok" /> Ingresos y cobranza</h3>
          <div className="space-y-3.5">
            <BarMeta label="Facturado" tag="s/IGV" value={facturado} total={contractual} color="bg-primary" restoLabel="Falta facturar" />
            <BarMeta label="Cobrado" tag="c/IGV neto" value={cobrado} total={netoFacturado} color="bg-emerald-500" restoLabel="Por cobrar" />
          </div>
          <div className="mt-3.5 pt-3 border-t border-line space-y-1.5 text-[12px]">
            <div className="flex justify-between"><span className="text-ink-3">Por cobrar <IgvTag t="c/IGV" /></span><span className="font-mono tabular-nums font-semibold">{fmtPEN(porCobrar)}</span></div>
            <div className="flex justify-between"><span className="text-ink-3">Retención garantía</span><span className="font-mono tabular-nums">{fmtPEN(retencion)}</span></div>
          </div>
          {retencion > 0 && <div className="mt-2 text-[10.5px] text-ink-4">Descontada en cada valorización · se devuelve al consentir la liquidación.</div>}
        </div>

        <div className="rounded-lg border border-line bg-bg-elev p-4">
          <h3 className="text-[13px] font-semibold mb-3 flex items-center gap-1.5"><ArrowUpRight className="h-4 w-4 text-warn-ink" /> Costos</h3>
          <div className="space-y-1.5 text-[12px]">
            <div className="flex justify-between"><span className="text-ink-3">Costo real <span className="text-ink-4">· {costoReal.gastos} gastos</span></span><span className="font-mono tabular-nums font-semibold">{fmtPEN(costoReal.total)}</span></div>
            <div className="flex justify-between"><span className="text-ink-3">Comprometido (OC) <span className="text-ink-4">· {fmtPEN(comprometido.bien)} bien / {fmtPEN(comprometido.servicio)} serv</span></span><span className="font-mono tabular-nums">{fmtPEN(comprometido.total)}</span></div>
            <div className="flex justify-between pt-1.5 border-t border-line"><span className="text-ink-2">= Costo al cierre (EAC)</span><span className="font-mono tabular-nums font-semibold">{fmtPEN(eac)}</span></div>
          </div>
          {costoPorTipo.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {topRubros.map(([tipo, monto]) => {
                const pct = costoReal.total > 0 ? (monto / costoReal.total) * 100 : 0;
                return (
                  <div key={tipo}>
                    <div className="flex justify-between text-[11px] mb-0.5"><span className="text-ink-3 truncate">{tipo}</span><span className="font-mono tabular-nums ml-2">{fmtPEN(monto)} · {pct.toFixed(0)}%</span></div>
                    <div className="h-1.5 rounded-full bg-bg-sunken overflow-hidden"><div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.min(100, pct)}%` }} /></div>
                  </div>
                );
              })}
              {otrosRubros.length > 0 && (
                <div className="flex justify-between text-[11px] text-ink-4 pt-0.5"><span>+ {otrosRubros.length} rubro(s)</span><span className="font-mono tabular-nums">{fmtPEN(otrosMonto)} · {costoReal.total > 0 ? ((otrosMonto / costoReal.total) * 100).toFixed(0) : 0}%</span></div>
              )}
            </div>
          )}
          {costoIncompleto && (
            <div className="mt-3 rounded-md bg-warn/10 px-3 py-2 text-[11px] text-warn-ink flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>Solo <span className="font-semibold">{pctCostoCargado.toFixed(0)}%</span> del costo presupuestado está cargado · el margen {margenProyectado.toFixed(1)}% es provisional hasta completar gastos.</span>
            </div>
          )}
        </div>
      </div>

      {/* ── FLUJO DE CAJA · detalle ── */}
      <CashflowSection proyectoId={proyectoId} />
    </div>
  );
}

// Parte de la ecuación Contrato − Costo = Utilidad
function EqPart({ label, val, tone }: { label: string; val: string; tone?: 'ok' | 'destructive' }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4">{label}</div>
      <div className={cn('text-[15px] font-bold tracking-[-0.01em] font-mono tabular-nums', tone === 'ok' ? 'text-ok' : tone === 'destructive' ? 'text-destructive' : 'text-ink-1')}>{val}</div>
    </div>
  );
}

// Etiqueta de base IGV (s/IGV · c/IGV) · evita el "por cobrar > facturado" falso
function IgvTag({ t }: { t: string }) {
  return <span className="ml-1 text-[9px] border border-line rounded px-1 py-px text-ink-4 font-normal align-middle">{t}</span>;
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

// Barra con meta · se llena hacia el total y muestra cuánto falta (resto) · tag = base IGV opcional
function BarMeta({ label, tag, value, total, color, restoLabel }: { label: string; tag?: string; value: number; total: number; color: string; restoLabel?: string }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  const resto = Math.max(0, total - value);
  return (
    <div>
      <div className="flex justify-between items-baseline text-[11.5px] mb-1">
        <span className="text-ink-3">{label}{tag && <IgvTag t={tag} />}</span>
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
