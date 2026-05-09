import { useQuery } from '@tanstack/react-query';
import { type Proyecto, api } from '@/lib/api.js';
import { fmtCompact, fmtDate, fmtPEN } from '@/lib/utils.js';

export function ResumenTab({ proyecto }: { proyecto: Proyecto }) {
  const avancesQ = useQuery({
    queryKey: ['avances-proyecto', proyecto.id],
    queryFn: () => api.proyectos.getAvances(proyecto.id),
  });

  const contrato = Number.parseFloat(proyecto.montoContractual ?? '0');
  const cd = Number.parseFloat(proyecto.costoDirecto ?? '0');
  const k = avancesQ.data?.kpis;

  const totalReal = k?.totalReal ?? 0;
  const avanceFisico = k?.avanceFisicoPct ?? 0;
  const avanceFinanciero = k?.avanceFinancieroPct ?? 0;

  // Días restantes
  const diasRestantes =
    proyecto.fechaFin
      ? Math.max(0, Math.round((new Date(proyecto.fechaFin).getTime() - Date.now()) / 86_400_000))
      : null;

  // Utilidad proyectada simple · contrato − CD real proyectado
  // EAC = if pct>0: cd × (real/EV), else cd
  const earnedValue = k?.earnedValue ?? 0;
  const eac = earnedValue > 0 && totalReal > 0 ? cd * (totalReal / earnedValue) : cd;
  const utilidadProyectada = contrato - eac;
  const margenPct = contrato > 0 ? (utilidadProyectada / contrato) * 100 : 0;

  const kpis = [
    { lbl: 'Contrato', val: fmtCompact(contrato), sub: fmtPEN(contrato), full: true },
    { lbl: 'Costo Directo', val: fmtCompact(cd), sub: 'XML cronograma', full: false },
    {
      lbl: 'Ejecutado Real',
      val: fmtPEN(totalReal),
      sub: cd > 0 ? `${((totalReal / cd) * 100).toFixed(1)}% del CD` : '—',
      accent: 'text-primary',
    },
    {
      lbl: 'Utilidad Proyectada',
      val: fmtCompact(utilidadProyectada),
      sub: `Margen ${margenPct.toFixed(1)}%`,
      accent: utilidadProyectada < 0 ? 'text-destructive' : 'text-ok',
    },
    { lbl: 'Avance Físico', val: `${avanceFisico.toFixed(1)}%`, progress: avanceFisico },
    { lbl: 'Avance Financiero', val: `${avanceFinanciero.toFixed(1)}%`, progress: avanceFinanciero },
    {
      lbl: 'Días Restantes',
      val: diasRestantes != null ? `${diasRestantes}d` : '—',
      sub: proyecto.fechaFin ?? 'Sin fecha fin',
      accent: diasRestantes != null && diasRestantes < 30 ? 'text-destructive' : '',
    },
  ];

  return (
    <div className="space-y-5">
      {/* KPIs · 7 cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2.5">
        {kpis.map((k) => (
          <div key={k.lbl} className="rounded-md border border-line bg-bg-elev p-3 min-w-0">
            <div
              className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-4 truncate"
              title={k.lbl}
            >
              {k.lbl}
            </div>
            <div
              className={`mt-1 text-[16px] font-bold tracking-[-0.02em] truncate ${k.accent ?? ''}`}
              title={k.full ? `${k.val}` : ''}
            >
              {k.val}
            </div>
            {k.sub && (
              <div className="text-[10px] text-ink-3 mt-0.5 truncate" title={k.sub}>
                {k.sub}
              </div>
            )}
            {'progress' in k && k.progress != null && (
              <div className="mt-2 h-1 w-full rounded-full bg-bg-sunken overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, Number(k.progress))}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Datos contrato + acciones */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3">
        <div className="rounded-md border border-line bg-bg-elev">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-[13px] font-semibold">Datos del contrato</h3>
          </div>
          <div className="grid grid-cols-2 gap-3 p-4">
            {[
              { lbl: 'Modalidad', val: proyecto.modalidad ?? '—' },
              { lbl: 'Estado', val: proyecto.status ?? '—' },
              { lbl: 'Fecha inicio', val: fmtDate(proyecto.fechaInicio) },
              { lbl: 'Fecha fin', val: fmtDate(proyecto.fechaFin) },
              { lbl: 'Costo directo', val: fmtPEN(cd) },
              { lbl: 'Monto contractual', val: fmtPEN(contrato) },
            ].map((d) => (
              <div key={d.lbl}>
                <div className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-4">{d.lbl}</div>
                <div className="text-[12px] text-foreground mt-0.5">{d.val}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-line bg-bg-elev">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-[13px] font-semibold">Próximos pasos</h3>
          </div>
          <ol className="p-4 space-y-2 text-[11.5px] text-ink-3 list-decimal list-inside">
            <li>Sube cronograma MS Project</li>
            <li>Revisa partidas extraídas</li>
            <li>Marca avances en partidas hoja</li>
            <li>Genera valorización mensual</li>
            <li>Sube documentos al NAS</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
