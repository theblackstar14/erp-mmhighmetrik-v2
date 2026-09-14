import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, MinusCircle, XCircle } from 'lucide-react';
import { type ReconciliacionCheck, api } from '@/lib/api.js';
import { cn, fmtPEN } from '@/lib/utils.js';

export function ReconciliacionTab({ proyectoId }: { proyectoId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['reconciliacion', proyectoId],
    queryFn: () => api.proyectos.getReconciliacion(proyectoId),
  });

  if (isLoading)
    return (
      <div className="flex items-center gap-2 text-[13px] text-ink-3">
        <Loader2 className="h-4 w-4 animate-spin" /> Reconciliando montos...
      </div>
    );
  if (error || !data)
    return <div className="text-[13px] text-destructive">Error cargando reconciliación</div>;

  const ggUtLabel = {
    separado: 'GG+UT separados',
    embebido_cd: 'GG+UT embebidos en CD',
    simple_pct: 'Desglose simple',
  }[data.proyecto.ggUtModo];

  return (
    <div className="space-y-5">
      {/* Banner estado global */}
      <div
        className={cn(
          'flex items-center gap-2.5 rounded-md px-4 py-3',
          data.ok ? 'bg-ok-soft' : 'bg-destructive-soft',
        )}
      >
        {data.ok ? (
          <CheckCircle2 className="h-5 w-5 text-ok shrink-0" />
        ) : (
          <XCircle className="h-5 w-5 text-destructive shrink-0" />
        )}
        <div>
          <p className={cn('text-[13px] font-semibold', data.ok ? 'text-ok' : 'text-destructive')}>
            {data.ok
              ? 'Montos reconciliados · sin discrepancias'
              : `${data.discrepancias.length} discrepancia(s) detectada(s) · revisar antes de continuar`}
          </p>
          <p className="text-[11px] text-ink-3 mt-0.5">
            Tolerancia ±{fmtPEN(data.epsilon)} · estructura: {ggUtLabel}
          </p>
        </div>
      </div>

      {/* Fuentes de CD */}
      <section className="space-y-2.5">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 font-medium">
          Fuentes de Costo Directo
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FuenteCard
            titulo="Expediente"
            sub="Cronograma valorizado"
            valor={data.fuentes.expedienteCd}
          />
          <FuenteCard
            titulo="Σ Partidas hoja"
            sub={`${data.fuentes.partidasHoja} partidas en DB`}
            valor={data.fuentes.partidasCd}
          />
          <FuenteCard
            titulo="Σ Valorizado"
            sub={`${data.fuentes.valorizaciones} valorizaciones · ${
              data.fuentes.pctAvanceAcum != null
                ? `${data.fuentes.pctAvanceAcum.toFixed(1)}% avance acum.`
                : 'sin avance'
            }`}
            valor={data.fuentes.valorizadoCd}
          />
        </div>
      </section>

      {/* Fuentes de inversión */}
      {data.fuentes.inversion.montoInversion != null && (
        <section className="space-y-2.5">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 font-medium">
            Componentes de inversión
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
            <FuenteCard titulo="Subtotal obra" sub="CD (+GG+UT)" valor={data.fuentes.inversion.componentes.subtotal} compact />
            <FuenteCard titulo="IGV" sub="18%" valor={data.fuentes.inversion.componentes.igv} compact />
            <FuenteCard titulo="Mobiliario" sub="equipamiento" valor={data.fuentes.inversion.componentes.mobiliario} compact />
            <FuenteCard titulo="Exped. técnico" sub="doc trabajo" valor={data.fuentes.inversion.componentes.expedienteTecnico} compact />
            <FuenteCard titulo="Superv. exped." sub="doc trabajo" valor={data.fuentes.inversion.componentes.supervisionExpediente} compact />
            <FuenteCard titulo="Superv. obra" sub="5.68%" valor={data.fuentes.inversion.componentes.supervisionObra} compact />
            <FuenteCard titulo="Monto inversión" sub="total" valor={data.fuentes.inversion.montoInversion} compact accent />
          </div>
        </section>
      )}

      {/* Checks · agrupados obra / inversión */}
      {(['obra', 'inversion'] as const).map((grupo) => {
        const grupoChecks = data.checks.filter((c) => c.grupo === grupo);
        if (grupoChecks.length === 0) return null;
        return (
          <section key={grupo} className="space-y-2.5">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 font-medium">
              {grupo === 'obra' ? 'Verificaciones · Obra (CD)' : 'Verificaciones · Inversión'}
            </h3>
            <div className="space-y-2">
              {grupoChecks.map((c) => (
                <CheckRow key={c.nombre} check={c} />
              ))}
            </div>
          </section>
        );
      })}

      <p className="text-[10.5px] text-ink-4">
        Reporte de solo lectura · no modifica datos. Las discrepancias deben resolverse corrigiendo
        el documento fuente y re-importando.
      </p>
    </div>
  );
}

function FuenteCard({
  titulo,
  sub,
  valor,
  compact,
  accent,
}: {
  titulo: string;
  sub: string;
  valor: number | null;
  compact?: boolean;
  accent?: boolean;
}) {
  return (
    <div className={cn('rounded-md border p-3', accent ? 'border-primary/40 bg-primary/5' : 'border-line bg-bg-sunken/40')}>
      <p className="text-[11px] text-ink-3 truncate">{titulo}</p>
      <p className={cn('font-semibold tabular-nums mt-0.5', compact ? 'text-[13px]' : 'text-[16px]', accent && 'text-primary')}>
        {valor != null ? fmtPEN(valor) : '—'}
      </p>
      <p className="text-[10px] text-ink-4 mt-0.5">{sub}</p>
    </div>
  );
}

function CheckRow({ check: c }: { check: ReconciliacionCheck }) {
  const icon =
    c.severidad === 'ok' ? (
      <CheckCircle2 className="h-4 w-4 text-ok shrink-0" />
    ) : c.severidad === 'error' ? (
      <XCircle className="h-4 w-4 text-destructive shrink-0" />
    ) : c.severidad === 'warn' ? (
      <AlertTriangle className="h-4 w-4 text-warn-ink shrink-0" />
    ) : (
      <MinusCircle className="h-4 w-4 text-ink-4 shrink-0" />
    );
  const border =
    c.severidad === 'error'
      ? 'border-destructive/30'
      : c.severidad === 'warn'
        ? 'border-warn/30'
        : 'border-line';
  return (
    <div className={cn('rounded-md border bg-bg-elev p-3', border)}>
      <div className="flex items-start gap-2.5">
        {icon}
        <div className="flex-1 min-w-0">
          <p className="text-[12.5px] font-medium">{c.descripcion}</p>
          <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] font-mono tabular-nums">
            <Cmp label={c.a.fuente} valor={c.a.valor} />
            <Cmp label={c.b.fuente} valor={c.b.valor} />
          </div>
          {c.diff != null && (
            <p
              className={cn(
                'text-[10.5px] mt-1 tabular-nums',
                c.ok ? 'text-ink-4' : 'text-destructive',
              )}
            >
              Diferencia: {fmtPEN(Math.abs(c.diff))}
              {c.severidad === 'na' && ' · no evaluable'}
            </p>
          )}
          {c.ok === null && (
            <p className="text-[10.5px] mt-1 text-ink-4">No evaluable · falta una fuente</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Cmp({ label, valor }: { label: string; valor: number | null }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-ink-3 truncate font-sans">{label}</span>
      <span className="text-foreground">{valor != null ? fmtPEN(valor) : '—'}</span>
    </div>
  );
}
