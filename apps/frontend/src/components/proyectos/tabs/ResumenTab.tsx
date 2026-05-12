import { useQuery } from '@tanstack/react-query';
import { type Proyecto, api } from '@/lib/api.js';
import { fmtDate, fmtPEN } from '@/lib/utils.js';

export function ResumenTab({ proyecto }: { proyecto: Proyecto }) {
  const avancesQ = useQuery({
    queryKey: ['avances-proyecto', proyecto.id],
    queryFn: () => api.proyectos.getAvances(proyecto.id),
  });
  const valoresQ = useQuery({
    queryKey: ['valorizaciones', proyecto.id],
    queryFn: () => api.proyectos.getValorizaciones(proyecto.id),
  });

  const contrato = Number.parseFloat(proyecto.montoContractual ?? '0');
  // costoDirecto en DB YA es contractual (CD real empresa) · NO multiplicar otra vez
  const cdContractual = Number.parseFloat(proyecto.costoDirecto ?? '0');
  const factorOferta = Number.parseFloat(proyecto.factorOferta ?? '1');
  const montoVigente = Number.parseFloat(
    proyecto.montoVigente ?? proyecto.montoContractual ?? '0',
  );
  const subtotalContratado = Number.parseFloat(proyecto.montoSubtotal ?? '0');
  const pctGg = Number.parseFloat(proyecto.pctGg ?? '0.10');
  const pctUtilidad = Number.parseFloat(proyecto.pctUtilidad ?? '0.07');

  const k = avancesQ.data?.kpis;
  const valStats = valoresQ.data?.stats;
  // Prioridad: valorizaciones (oficial S10) sobre avances manuales
  const totalRealVal = valStats?.sumCd ?? 0;
  const totalReal = totalRealVal > 0 ? totalRealVal : k?.totalReal ?? 0;
  const avanceFisico = totalRealVal > 0 && subtotalContratado > 0
    ? (totalRealVal / subtotalContratado) * 100
    : (k?.avanceFisicoPct ?? 0);
  const avanceFinanciero = totalRealVal > 0 && subtotalContratado > 0
    ? (totalRealVal / subtotalContratado) * 100
    : (k?.avanceFinancieroPct ?? 0);

  // Días restantes · fix TZ + soporte vencido
  const diasRestantes = (() => {
    if (!proyecto.fechaFin) return null;
    const ff = new Date(`${String(proyecto.fechaFin).slice(0, 10)}T00:00:00Z`);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return Math.round((ff.getTime() - today.getTime()) / 86_400_000);
  })();

  // Utilidad CONTRACTUAL · lo que el contrato reconoce sobre CD CONTRACTUAL
  const ggContractual = cdContractual * pctGg;
  const utilNetaContractual = cdContractual * pctUtilidad;
  const subtotalContractual = cdContractual + ggContractual + utilNetaContractual; // sin IGV

  // Proyección utility REAL · si hay ejecución, extrapola costo total real
  // Costo total = CD ejecutado + GG ejecutado (asumido = presupuestado por ahora)
  const earnedValue = k?.earnedValue ?? 0;
  const cdEjecucionExtrapolada =
    earnedValue > 0 && totalReal > 0 ? cdContractual * (totalReal / earnedValue) : cdContractual;
  const ggExtrapolado = ggContractual; // hasta tener compras GG reales · usa presupuestado
  const costoTotalProyectado = cdEjecucionExtrapolada + ggExtrapolado;
  const utilProyectadaReal = subtotalContractual - costoTotalProyectado;
  const margenSobreCDPct =
    cdContractual > 0 ? (utilProyectadaReal / cdContractual) * 100 : 0;

  const kpis = [
    {
      lbl: 'Contrato',
      val: fmtPEN(contrato),
      sub: montoVigente !== contrato ? `Vigente: ${fmtPEN(montoVigente)}` : 'Monto contractual',
      full: true,
    },
    {
      lbl: 'Costo Directo',
      val: fmtPEN(cdContractual),
      sub: `Contractual · factor oferta ${factorOferta.toFixed(4)}`,
      full: true,
    },
    {
      lbl: 'Ejecutado Real',
      val: fmtPEN(totalReal),
      sub: cdContractual > 0 ? `${((totalReal / cdContractual) * 100).toFixed(1)}% del CD contractual` : '—',
      accent: 'text-primary',
    },
    {
      lbl: 'GG Contractual',
      val: fmtPEN(ggContractual),
      sub: `${(pctGg * 100).toFixed(0)}% sobre CD contractual`,
      accent: '',
    },
    {
      lbl: 'Utilidad Presup.',
      val: fmtPEN(utilNetaContractual),
      sub: `${(pctUtilidad * 100).toFixed(0)}% sobre CD contractual`,
      accent: 'text-ok',
    },
    {
      lbl: 'Utilidad Real Proy.',
      val: fmtPEN(utilProyectadaReal),
      sub:
        totalReal > 0
          ? `Margen ${margenSobreCDPct.toFixed(1)}% · vs costo real`
          : `Sin ejecución · = presupuestada (${(pctUtilidad * 100).toFixed(0)}%)`,
      accent:
        utilProyectadaReal < utilNetaContractual * 0.99
          ? 'text-destructive'
          : utilProyectadaReal > utilNetaContractual * 1.01
            ? 'text-ok'
            : '',
    },
    { lbl: 'Avance Físico', val: `${avanceFisico.toFixed(1)}%`, progress: avanceFisico },
    { lbl: 'Avance Financiero', val: `${avanceFinanciero.toFixed(1)}%`, progress: avanceFinanciero },
    {
      lbl: 'Días Restantes',
      val:
        diasRestantes == null
          ? '—'
          : diasRestantes < 0
            ? `Vencido ${Math.abs(diasRestantes)}d`
            : `${diasRestantes}d`,
      sub: proyecto.fechaFin ? `Fin: ${proyecto.fechaFin.slice(0, 10)}` : 'Sin fecha fin',
      accent:
        diasRestantes == null
          ? ''
          : diasRestantes < 0
            ? 'text-destructive'
            : diasRestantes < 30
              ? 'text-warn'
              : '',
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

      {/* Datos contrato + económicos + identificación */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_300px] gap-3">
        {/* Identificación contractual */}
        <div className="rounded-md border border-line bg-bg-elev">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-[13px] font-semibold">Identificación contractual</h3>
          </div>
          <div className="grid grid-cols-2 gap-3 p-4">
            {[
              { lbl: 'N° Contrato', val: proyecto.numeroContrato ?? '—' },
              { lbl: 'CUI', val: proyecto.cui ?? '—' },
              { lbl: 'N° Licitación', val: proyecto.numeroProcesoLicitacion ?? '—' },
              { lbl: 'Etapa', val: proyecto.etapa ?? '—' },
              { lbl: 'Modalidad', val: proyecto.modalidad ?? '—' },
              { lbl: 'Estado', val: proyecto.status ?? '—' },
              { lbl: 'Fecha buena pro', val: fmtDate(proyecto.fechaBuenaPro) },
              { lbl: 'Firma contrato', val: fmtDate(proyecto.fechaFirmaContrato) },
              { lbl: 'Fecha inicio', val: fmtDate(proyecto.fechaInicio) },
              { lbl: 'Fecha fin', val: fmtDate(proyecto.fechaFin) },
              { lbl: 'Plazo', val: `${proyecto.diasPlazo ?? '—'} días` },
            ].map((d) => (
              <div key={d.lbl}>
                <div className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-4">{d.lbl}</div>
                <div className="text-[12px] text-foreground mt-0.5 break-words">{d.val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Económico · 3 montos clave */}
        <div className="rounded-md border border-line bg-bg-elev">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-[13px] font-semibold">Estructura económica</h3>
          </div>
          <div className="p-4 space-y-3">
            <div>
              <div className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-4">
                Presupuesto referencial · municipalidad
              </div>
              <div className="text-[14px] font-bold text-foreground mt-0.5">
                {fmtPEN(Number.parseFloat(proyecto.montoReferencial ?? '0'))}
              </div>
              <div className="text-[10px] text-ink-3 mt-0.5">CD contractual: {fmtPEN(cdContractual)}</div>
            </div>
            <div className="border-t border-line pt-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-4">
                Monto contractual · oferta consorcio (×{factorOferta.toFixed(2)})
              </div>
              <div className="text-[14px] font-bold text-primary mt-0.5">{fmtPEN(contrato)}</div>
              <div className="text-[10px] text-ink-3 mt-0.5">
                CD contractual: {fmtPEN(cdContractual)}
              </div>
            </div>
            {montoVigente !== contrato && (
              <div className="border-t border-line pt-3">
                <div className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-4">
                  Monto vigente · post modificaciones
                </div>
                <div className="text-[14px] font-bold text-warn mt-0.5">{fmtPEN(montoVigente)}</div>
                <div className="text-[10px] text-ink-3 mt-0.5">
                  Δ: {fmtPEN(montoVigente - contrato)}
                </div>
              </div>
            )}
            <div className="border-t border-line pt-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-4 mb-2">
                Breakdown contractual (lo que cobras)
              </div>
              <div className="space-y-1.5 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-ink-3">CD contractual</span>
                  <span className="font-mono">{fmtPEN(cdContractual)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-3">+ GG ({(pctGg * 100).toFixed(0)}%)</span>
                  <span className="font-mono">{fmtPEN(ggContractual)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-3">+ Utilidad ({(pctUtilidad * 100).toFixed(0)}%)</span>
                  <span className="font-mono text-ok">{fmtPEN(utilNetaContractual)}</span>
                </div>
                <div className="flex justify-between border-t border-line pt-1.5">
                  <span className="text-ink-2 font-medium">Subtotal</span>
                  <span className="font-mono font-medium">{fmtPEN(subtotalContractual)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-3">+ IGV (18%)</span>
                  <span className="font-mono">{fmtPEN(subtotalContractual * 0.18)}</span>
                </div>
                <div className="flex justify-between border-t border-line pt-1.5">
                  <span className="text-ink-2 font-bold">Total</span>
                  <span className="font-mono font-bold text-primary">{fmtPEN(contrato)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Próximos pasos */}
        <div className="rounded-md border border-line bg-bg-elev">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-[13px] font-semibold">Próximos pasos</h3>
          </div>
          <ol className="p-4 space-y-2 text-[11.5px] text-ink-3 list-decimal list-inside">
            <li>Importar calendario adquisiciones (recursos · F1.C)</li>
            <li>Importar fórmulas polinómicas (F1.D)</li>
            <li>Conectar NAS y subir documentos firmados</li>
            <li>Registrar avances físicos partidas</li>
            <li>Generar primera valorización mensual</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
