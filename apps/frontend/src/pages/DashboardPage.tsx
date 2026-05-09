import { Calendar, Sparkles } from 'lucide-react';

export function DashboardPage() {
  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Dashboard Operativo</h1>
          <p className="text-[13px] text-ink-3 mt-0.5">
            Gestión de proyectos, finanzas y alertas críticas de obra
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-line bg-bg-elev text-[12px] font-medium text-ink-2 hover:bg-bg-sunken transition-colors self-start sm:self-auto"
        >
          <Calendar className="h-3.5 w-3.5" />
          Abril 2026
        </button>
      </header>

      {/* KPIs · 4 cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard
          lbl="Cartera Total"
          val="S/ 0.00"
          rightLbl="—"
          rightVal=""
          sub="0 proyectos activos"
        />
        <KpiCardSplit
          lbl="Salud (CPI/SPI)"
          items={[
            { val: '0', lbl: 'Crítico', color: 'text-destructive' },
            { val: '0', lbl: 'Observación', color: 'text-warn' },
            { val: '0', lbl: 'Saludable', color: 'text-ok' },
          ]}
        />
        <KpiCard
          lbl="Avance Físico Prom."
          val="0.0%"
          rightLbl="Forecast"
          rightVal="—"
          sub="Sin proyectos"
          showProgress
        />
        <KpiCard
          lbl="Licitaciones En Curso"
          val="S/ 0.00"
          rightLbl="En revisión"
          rightVal=""
          sub="0 procesos activos"
        />
      </div>

      {/* Bottom · 2 cols */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-3">
        {/* Flujo de Caja */}
        <div className="rounded-md border border-line bg-bg-elev">
          <div className="flex items-center justify-between border-b border-line p-4">
            <div>
              <h3 className="text-[13px] font-semibold">Flujo de Caja Consolidado</h3>
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 mt-0.5 block">
                Click para desglosar
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-md border border-line overflow-hidden">
                {['Día', 'Mes', 'Año', 'Total'].map((p, i) => (
                  <button
                    key={p}
                    type="button"
                    className={`px-2.5 py-1 text-[11px] ${
                      i === 1 ? 'bg-primary text-primary-foreground' : 'bg-bg-elev text-ink-3 hover:bg-bg-sunken'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 ml-2">
                Monto S/ por mes
              </span>
            </div>
          </div>
          <div className="flex h-72 items-center justify-center text-[13px] text-ink-3">
            Sin datos · crea proyectos para ver el flujo
          </div>
        </div>

        {/* Alertas IA */}
        <div className="rounded-md border border-line bg-bg-elev">
          <div className="flex items-center justify-between border-b border-line p-4">
            <h3 className="text-[13px] font-semibold">Alertas de IA</h3>
            <span className="chip blue">
              <Sparkles className="h-2.5 w-2.5" />
              IA
            </span>
          </div>
          <div className="p-4 space-y-3">
            <div className="rounded-md border-l-2 border-line py-2 pl-3 text-[12px] text-ink-3">
              Sin alertas · el sistema analiza tu data y reporta acá.
            </div>
          </div>
        </div>
      </div>

      {/* Estado de Proyectos · tabla */}
      <div className="rounded-md border border-line bg-bg-elev">
        <div className="flex items-center justify-between border-b border-line p-4">
          <h3 className="text-[13px] font-semibold">Estado de Proyectos</h3>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-line bg-bg-elev text-[11px] font-medium text-ink-2 hover:bg-bg-sunken transition-colors"
          >
            Filtrar...
          </button>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              {['ID', 'Nombre del Proyecto', 'Cliente', 'Estado', 'Presupuesto', 'Avance Físico'].map(
                (h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-ink-4"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={6} className="px-4 py-12 text-center text-[12px] text-ink-3">
                Sin proyectos · crea el primero desde "Proyectos"
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── KPI · simple ─── */
function KpiCard({
  lbl,
  val,
  rightLbl,
  rightVal,
  sub,
  showProgress,
}: {
  lbl: string;
  val: string;
  rightLbl?: string;
  rightVal?: string;
  sub?: string;
  showProgress?: boolean;
}) {
  return (
    <div className="rounded-md border border-line bg-bg-elev p-4">
      <div className="flex items-start justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-ink-4 font-medium">
          {lbl}
        </span>
        {rightLbl && (
          <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-ink-4 font-medium">
            {rightLbl}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-[22px] font-bold tracking-[-0.02em] truncate">{val}</span>
        {rightVal && <span className="text-[11px] text-ink-3 ml-2">{rightVal}</span>}
      </div>
      {sub && <div className="text-[11px] text-ink-3 mt-1">{sub}</div>}
      {showProgress && (
        <div className="mt-3 h-1 w-full rounded-full bg-bg-sunken overflow-hidden">
          <div className="h-full bg-primary" style={{ width: '0%' }} />
        </div>
      )}
    </div>
  );
}

/* ─── KPI · split (CPI/SPI con 3 valores) ─── */
function KpiCardSplit({
  lbl,
  items,
}: {
  lbl: string;
  items: Array<{ val: string; lbl: string; color: string }>;
}) {
  return (
    <div className="rounded-md border border-line bg-bg-elev p-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-ink-4 font-medium">
        {lbl}
      </span>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {items.map((it) => (
          <div key={it.lbl} className="text-center">
            <div className={`text-[22px] font-bold tracking-[-0.02em] ${it.color}`}>{it.val}</div>
            <div className="font-mono text-[9px] uppercase tracking-wider text-ink-3 mt-0.5">
              {it.lbl}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
