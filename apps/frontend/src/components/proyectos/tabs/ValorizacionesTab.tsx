import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Receipt,
  TrendingDown,
  TrendingUp,
  Upload,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { api, type Valorizacion, type ValorizacionReajuste } from '@/lib/api.js';
import { cn, fmtCompact, fmtPEN } from '@/lib/utils.js';

const STATUS_CHIP: Record<string, string> = {
  borrador: 'amber',
  emitida: 'blue',
  aprobada: 'green',
  cobrada: 'green',
  rechazada: 'red',
};

const SUBP_NOMBRE: Record<string, string> = {
  '001': 'OBRAS PROVISIONALES',
  '002': 'ESTRUCTURAS',
  '003': 'ARQUITECTURA',
  '004': 'INSTALACIONES SANITARIAS',
  '005': 'INSTALACIONES ELÉCTRICAS',
  GLOBAL: 'OBRA GLOBAL',
};

type Modo = 'pen' | 'pct';

export function ValorizacionesTab({ proyectoId }: { proyectoId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['valorizaciones', proyectoId],
    queryFn: () => api.proyectos.getValorizaciones(proyectoId),
  });
  const proyQ = useQuery({
    queryKey: ['proyecto', proyectoId],
    queryFn: () => api.proyectos.get(proyectoId),
  });

  const [modo, setModo] = useState<Modo>('pen');
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadOk, setUploadOk] = useState<string | null>(null);

  const montoSubtotal = Number(proyQ.data?.proyecto?.montoSubtotal ?? 0);
  const baseRef = montoSubtotal > 0 ? montoSubtotal : 1;

  const uploadMut = useMutation({
    mutationFn: (file: File) => api.proyectos.uploadValorizacion(proyectoId, file),
    onSuccess: (r) => {
      setUploadError(null);
      setUploadOk(
        `Val N°${r.valorizacion.numero} ${r.valorizacion.mesPeriodo} · ${r.partidasInsertadas} partidas · ${r.partidasSinMatch} sin match`,
      );
      qc.invalidateQueries({ queryKey: ['valorizaciones', proyectoId] });
      qc.invalidateQueries({ queryKey: ['proyecto', proyectoId] });
    },
    onError: (e: Error) => {
      setUploadOk(null);
      setUploadError(e.message);
    },
  });

  const onFile = (f: File | null) => {
    if (!f) return;
    setUploadOk(null);
    setUploadError(null);
    uploadMut.mutate(f);
  };

  const valorizaciones = data?.valorizaciones ?? [];
  const reajustes = data?.reajustes ?? [];
  const stats = data?.stats ?? null;

  const reajustesPorVal = useMemo(() => {
    const map = new Map<string, ValorizacionReajuste[]>();
    for (const r of reajustes) {
      const arr = map.get(r.valorizacionId) ?? [];
      arr.push(r);
      map.set(r.valorizacionId, arr);
    }
    return map;
  }, [reajustes]);

  // Curva acumulada por valorización (para tabla)
  const curvaAcum = useMemo(() => {
    let acumEjec = 0;
    let acumProg = 0;
    return valorizaciones.map((v) => {
      acumEjec += Number(v.montoCd);
      acumProg += Number(v.vProgramado ?? 0);
      return {
        num: v.numero,
        label: v.mesPeriodo ?? v.fechaHasta.slice(0, 7),
        periodoEjec: Number(v.montoCd),
        acumEjec,
        periodoProg: Number(v.vProgramado ?? 0),
        acumProg,
        pctEjec: Number(v.pctAvance),
        pctProg: baseRef > 0 ? (acumProg / baseRef) * 100 : 0,
        k: Number(v.factorReajusteK ?? 1),
      };
    });
  }, [valorizaciones, baseRef]);

  // Curva S completa · usar de última valorización · INICIO → fin proyecto
  type CurvaSPunto = {
    label: string;
    fecha: string | null;
    pctProgMes: number;
    pctProgAcum: number;
    pctEjecMes: number;
    pctEjecAcum: number;
  };
  const curvaSCompleta = useMemo<CurvaSPunto[]>(() => {
    if (valorizaciones.length === 0) return [];
    // Tomar la última val con curvaS · ejecutado se acumula desde múltiples vals
    const conCurva = [...valorizaciones]
      .filter((v) => (v.snapshot as { curvaS?: CurvaSPunto[] } | null)?.curvaS?.length)
      .sort((a, b) => b.numero - a.numero);
    const fuente = conCurva[0];
    if (!fuente) return [];
    const base = ((fuente.snapshot as { curvaS?: CurvaSPunto[] }).curvaS ?? []).map((c) => ({ ...c }));
    // Sobrescribir % ejecutado con datos REALES de todas las valorizaciones cargadas
    let acumEjec = 0;
    for (const punto of base) {
      const vMes = valorizaciones.find((v) => v.mesPeriodo === punto.label);
      if (vMes) {
        const pct = baseRef > 0 ? (Number(vMes.montoCd) / baseRef) * 100 : 0;
        punto.pctEjecMes = pct;
        acumEjec += pct;
        punto.pctEjecAcum = acumEjec;
      } else if (punto.label !== 'INICIO') {
        punto.pctEjecMes = 0;
        punto.pctEjecAcum = 0;
      }
    }
    return base;
  }, [valorizaciones, baseRef]);

  if (isLoading) {
    return <div className="text-[13px] text-ink-3">Cargando valorizaciones...</div>;
  }

  const toggleExpand = (id: string) => {
    const next = new Set(expandidas);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandidas(next);
  };

  // Curva chart dimensions
  const chartW = 880;
  const chartH = 220;
  const padL = 56;
  const padR = 16;
  const padT = 16;
  const padB = 32;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  // Convertir % a S/ multiplicando por baseRef/100
  const pctToVal = (pct: number) => (modo === 'pen' ? (pct / 100) * baseRef : pct);
  const maxVal = modo === 'pen' ? Math.max(baseRef, 1) : 120; // 120% cap visual en modo %
  const xStep = curvaSCompleta.length > 1 ? innerW / (curvaSCompleta.length - 1) : innerW;
  const pointsProg = curvaSCompleta.map((c, i) => ({
    x: padL + i * xStep,
    y: padT + innerH - (pctToVal(c.pctProgAcum) / maxVal) * innerH,
    val: pctToVal(c.pctProgAcum),
    label: c.label,
    showLabel: c.pctProgAcum > 0,
  }));
  // Ejecutado: solo dibujar hasta el último mes con datos (incluye INICIO=0,0)
  const lastEjecIdx = (() => {
    let idx = -1;
    for (let i = 0; i < curvaSCompleta.length; i++) {
      const p = curvaSCompleta[i]!;
      if (p.label === 'INICIO' || p.pctEjecAcum > 0) idx = i;
    }
    return idx;
  })();
  const pointsEjec = curvaSCompleta.slice(0, lastEjecIdx + 1).map((c, i) => ({
    x: padL + i * xStep,
    y: padT + innerH - (pctToVal(c.pctEjecAcum) / maxVal) * innerH,
    val: pctToVal(c.pctEjecAcum),
    label: c.label,
    showLabel: c.label === 'INICIO' || c.pctEjecAcum > 0,
  }));
  const fmtAxis = (n: number) => (modo === 'pen' ? fmtCompact(n) : `${n.toFixed(0)}%`);

  const hayValorizaciones = valorizaciones.length > 0;

  return (
    <div className="space-y-5">
      {/* Upload bar */}
      <div className="rounded-md border border-line bg-bg-elev p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold flex items-center gap-1.5">
            <Upload className="h-3.5 w-3.5 text-ink-3" />
            Subir valorización mensual
          </h3>
          <p className="text-[11px] text-ink-3 mt-0.5">
            Formato Excel S10 (.xlsx) · cabecera + K + Reajuste + partidas detalle
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploadMut.isPending}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90 disabled:opacity-50"
          >
            {uploadMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {uploadMut.isPending ? 'Procesando...' : 'Subir .xlsx'}
          </button>
        </div>
      </div>

      {uploadError && (
        <div className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-[12px] text-destructive flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>Error · {uploadError}</span>
        </div>
      )}
      {uploadOk && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-[12px] text-emerald-700 dark:text-emerald-400">
          ✓ {uploadOk}
        </div>
      )}

      {!hayValorizaciones && (
        <div className="rounded-md border border-line bg-bg-elev p-6 text-center">
          <Receipt className="mx-auto h-8 w-8 text-ink-3 mb-2" />
          <div className="text-[13px] text-ink-2">Sin valorizaciones registradas</div>
          <div className="text-[12px] text-ink-3 mt-1">
            Sube la valorización N°1 en Excel para empezar
          </div>
        </div>
      )}

      {/* Adelanto/Atraso destacado */}
      {hayValorizaciones && (() => {
        // Último mes con ejecución · comparar pctEjecAcum vs pctProgAcum
        const ultimoMesEjec = [...curvaSCompleta]
          .filter((p) => p.label === 'INICIO' || p.pctEjecAcum > 0)
          .pop();
        if (!ultimoMesEjec || ultimoMesEjec.label === 'INICIO') return null;
        const delta = ultimoMesEjec.pctEjecAcum - ultimoMesEjec.pctProgAcum;
        const adelantado = delta >= 0;
        const Icon = adelantado ? TrendingUp : TrendingDown;
        const sign = adelantado ? '+' : '';
        return (
          <div
            className={cn(
              'rounded-md border p-4 flex items-center justify-between gap-4',
              adelantado
                ? 'border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/30'
                : 'border-amber-500/30 bg-amber-50 dark:bg-amber-950/30',
            )}
          >
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'h-10 w-10 rounded-full flex items-center justify-center',
                  adelantado
                    ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400'
                    : 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400',
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <div
                  className={cn(
                    'text-[14px] font-semibold',
                    adelantado
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-amber-700 dark:text-amber-400',
                  )}
                >
                  {adelantado ? 'Obra adelantada' : 'Obra atrasada'} · {sign}
                  {delta.toFixed(2)}%
                </div>
                <div className="text-[11px] text-ink-3 mt-0.5">
                  Mes {ultimoMesEjec.label} · Ejecutado {ultimoMesEjec.pctEjecAcum.toFixed(2)}% vs
                  Programado {ultimoMesEjec.pctProgAcum.toFixed(2)}% acumulado
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-ink-3">Equivalente</div>
              <div
                className={cn(
                  'text-[15px] font-semibold tabular-nums',
                  adelantado
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400',
                )}
              >
                {sign}
                {fmtPEN((delta / 100) * baseRef)}
              </div>
              <div className="text-[10px] text-ink-3 mt-0.5">sobre subtotal contratado</div>
            </div>
          </div>
        );
      })()}

      {/* Toggle modo S/ vs % */}
      {hayValorizaciones && (
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-ink-3">
            {montoSubtotal > 0 ? `Base: Subtotal contratado S/ ${montoSubtotal.toLocaleString('es-PE', { minimumFractionDigits: 2 })}` : 'Subtotal contratado no configurado'}
          </div>
          <div className="inline-flex rounded-md border border-line p-0.5 bg-bg-sunken">
            <button
              type="button"
              onClick={() => setModo('pen')}
              className={cn(
                'h-7 px-3 rounded-[5px] text-[11.5px] font-medium transition-colors',
                modo === 'pen' ? 'bg-bg-elev text-foreground shadow-sm' : 'text-ink-3 hover:text-foreground',
              )}
            >
              S/
            </button>
            <button
              type="button"
              onClick={() => setModo('pct')}
              className={cn(
                'h-7 px-3 rounded-[5px] text-[11.5px] font-medium transition-colors',
                modo === 'pct' ? 'bg-bg-elev text-foreground shadow-sm' : 'text-ink-3 hover:text-foreground',
              )}
            >
              %
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      {hayValorizaciones && stats && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Stat label="Valorizaciones" value={stats.cantidad.toString()} />
          {modo === 'pen' ? (
            <>
              <Stat label="Σ CD ejecutado" value={fmtPEN(stats.sumCd)} />
              <Stat label="Σ Reajuste" value={fmtPEN(stats.sumReajuste)} accent="amber" />
              <Stat label="Σ Total c/IGV" value={fmtPEN(stats.sumTotal)} />
            </>
          ) : (
            <>
              <Stat
                label="% Ejecutado acum"
                value={`${((stats.sumCd / baseRef) * 100).toFixed(2)}%`}
                accent="blue"
              />
              <Stat
                label="% Programado acum"
                value={`${((curvaAcum[curvaAcum.length - 1]?.acumProg ?? 0) / baseRef * 100).toFixed(2)}%`}
              />
              <Stat
                label="Δ Ejec-Prog"
                value={`${(((stats.sumCd - (curvaAcum[curvaAcum.length - 1]?.acumProg ?? 0)) / baseRef) * 100).toFixed(2)}%`}
                accent={stats.sumCd >= (curvaAcum[curvaAcum.length - 1]?.acumProg ?? 0) ? 'green' : 'amber'}
              />
            </>
          )}
          <Stat label="% Avance ejec" value={`${stats.pctAvanceUltima.toFixed(2)}%`} accent="blue" />
          <Stat label="K promedio" value={stats.kPromedio.toFixed(5)} accent="blue" />
        </div>
      )}

      {/* Curva acumulada · ejecutado vs programado */}
      {hayValorizaciones && (
      <div className="rounded-md border border-line bg-bg-elev p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-ink-3" />
            <h3 className="text-[13px] font-semibold">
              Curva valorización · {modo === 'pen' ? 'monto (S/)' : 'porcentaje acumulado'}
            </h3>
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-[2px] bg-blue-500" />
              Programado
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-[2px]" style={{ background: 'hsl(var(--destructive))' }} />
              Ejecutado
            </span>
          </div>
        </div>
        <svg
          viewBox={`0 0 ${chartW} ${chartH}`}
          className="w-full h-[220px]"
          preserveAspectRatio="none"
        >
          {/* Y-axis grid */}
          {[0, 0.25, 0.5, 0.75, 1].map((p) => (
            <g key={p}>
              <line
                x1={padL}
                x2={chartW - padR}
                y1={padT + innerH * (1 - p)}
                y2={padT + innerH * (1 - p)}
                stroke="hsl(var(--line))"
                strokeDasharray="2 4"
              />
              <text
                x={padL - 6}
                y={padT + innerH * (1 - p) + 3}
                textAnchor="end"
                className="fill-ink-3 text-[9px]"
              >
                {fmtAxis(maxVal * p)}
              </text>
            </g>
          ))}
          {/* Línea programada · azul · curva completa */}
          <polyline
            fill="none"
            stroke="rgb(59 130 246)"
            strokeWidth="2"
            points={pointsProg.map((p) => `${p.x},${p.y}`).join(' ')}
          />
          {pointsProg.map((p, i) => (
            <g key={`p-${i}`}>
              <circle cx={p.x} cy={p.y} r="3" fill="rgb(59 130 246)" />
              {p.showLabel && (
                <text
                  x={p.x}
                  y={p.y - 6}
                  textAnchor="middle"
                  className="fill-blue-600 dark:fill-blue-400 text-[9px] font-medium"
                >
                  {modo === 'pen' ? fmtCompact(p.val) : `${p.val.toFixed(2)}%`}
                </text>
              )}
              {/* Eje X labels · todos los meses */}
              <text
                x={p.x}
                y={chartH - 8}
                textAnchor="middle"
                className="fill-ink-3 text-[9px]"
              >
                {p.label === 'INICIO' ? 'INICIO' : p.label}
              </text>
            </g>
          ))}
          {/* Línea ejecutada · rojo · solo hasta último mes con datos */}
          {pointsEjec.length > 1 && (
            <polyline
              fill="none"
              stroke="hsl(var(--destructive))"
              strokeWidth="2.5"
              points={pointsEjec.map((p) => `${p.x},${p.y}`).join(' ')}
            />
          )}
          {pointsEjec.map((p, i) => (
            <g key={`e-${i}`}>
              <rect x={p.x - 3} y={p.y - 3} width="6" height="6" fill="hsl(var(--destructive))" />
              {p.showLabel && p.val > 0 && (
                <text
                  x={p.x}
                  y={p.y - 8}
                  textAnchor="middle"
                  className="fill-[hsl(var(--destructive))] text-[9px] font-semibold"
                >
                  {modo === 'pen' ? fmtCompact(p.val) : `${p.val.toFixed(2)}%`}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      )}

      {/* Tabla valorizaciones */}
      {hayValorizaciones && (
      <div className="rounded-md border border-line overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-bg-sunken border-b border-line">
            <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3">
              <th className="w-8 px-2 py-2"></th>
              <th className="px-2 py-2">N°</th>
              <th className="px-2 py-2">Periodo</th>
              {modo === 'pen' ? (
                <>
                  <th className="px-2 py-2">% Avance</th>
                  <th className="px-2 py-2 text-right">CD bruto</th>
                  <th className="px-2 py-2 text-right">K avg</th>
                  <th className="px-2 py-2 text-right">Reajuste</th>
                  <th className="px-2 py-2 text-right">CD c/reajuste</th>
                  <th className="px-2 py-2 text-right">IGV 18%</th>
                  <th className="px-2 py-2 text-right">Total</th>
                </>
              ) : (
                <>
                  <th className="px-2 py-2 text-right">% Prog mes</th>
                  <th className="px-2 py-2 text-right">% Ejec mes</th>
                  <th className="px-2 py-2 text-right">Δ mes</th>
                  <th className="px-2 py-2 text-right">% Prog acum</th>
                  <th className="px-2 py-2 text-right">% Ejec acum</th>
                  <th className="px-2 py-2 text-right">K avg</th>
                </>
              )}
              <th className="px-2 py-2">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {valorizaciones.map((v, i) => {
              const isExpanded = expandidas.has(v.id);
              const reaj = reajustesPorVal.get(v.id) ?? [];
              const reajusteMonto = Number(v.montoReajuste ?? 0);
              const cdConReaj = Number(v.montoCd);
              const cdBruto = cdConReaj - reajusteMonto;
              const curvaRow = curvaAcum[i];
              return (
                <FilaValorizacion
                  key={v.id}
                  v={v}
                  cdBruto={cdBruto}
                  isExpanded={isExpanded}
                  reaj={reaj}
                  onToggle={() => toggleExpand(v.id)}
                  modo={modo}
                  baseRef={baseRef}
                  pctProgAcum={curvaRow?.pctProg ?? 0}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

function FilaValorizacion({
  v,
  cdBruto,
  isExpanded,
  reaj,
  onToggle,
  modo,
  baseRef,
  pctProgAcum,
}: {
  v: Valorizacion;
  cdBruto: number;
  isExpanded: boolean;
  reaj: ValorizacionReajuste[];
  onToggle: () => void;
  modo: Modo;
  baseRef: number;
  pctProgAcum: number;
}) {
  const Caret = isExpanded ? ChevronDown : ChevronRight;
  const cd = Number(v.montoCd);
  const igv = Number(v.montoIgv);
  const total = Number(v.montoTotal);
  const k = Number(v.factorReajusteK ?? 1);
  const reajuste = Number(v.montoReajuste ?? 0);
  const pctAv = Number(v.pctAvance);
  const chipKind = STATUS_CHIP[v.status] ?? 'gray';

  return (
    <>
      <tr className="hover:bg-bg-sunken cursor-pointer" onClick={onToggle}>
        <td className="px-2 py-2">
          <Caret className="h-3.5 w-3.5 text-ink-3" />
        </td>
        <td className="px-2 py-2 font-mono font-semibold">N°{v.numero}</td>
        <td className="px-2 py-2 text-ink-2">
          {v.mesPeriodo ?? `${v.fechaDesde.slice(0, 7)} → ${v.fechaHasta.slice(0, 7)}`}
        </td>
        {modo === 'pen' ? (
          <>
            <td className="px-2 py-2">{pctAv.toFixed(2)}%</td>
            <td className="px-2 py-2 text-right tabular-nums">{fmtPEN(cdBruto)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{k.toFixed(5)}</td>
            <td className="px-2 py-2 text-right tabular-nums text-amber-700 dark:text-amber-400">
              {fmtPEN(reajuste)}
            </td>
            <td className="px-2 py-2 text-right tabular-nums font-medium">{fmtPEN(cd)}</td>
            <td className="px-2 py-2 text-right tabular-nums text-ink-3">{fmtPEN(igv)}</td>
            <td className="px-2 py-2 text-right tabular-nums font-semibold">{fmtPEN(total)}</td>
          </>
        ) : (
          (() => {
            const vProg = Number(v.vProgramado ?? 0);
            const pctProgMes = baseRef > 0 ? (vProg / baseRef) * 100 : 0;
            const pctEjecMes = baseRef > 0 ? (cd / baseRef) * 100 : 0;
            const delta = pctEjecMes - pctProgMes;
            const deltaColor = delta >= 0 ? 'text-emerald-600' : 'text-amber-700 dark:text-amber-400';
            return (
              <>
                <td className="px-2 py-2 text-right tabular-nums">{pctProgMes.toFixed(2)}%</td>
                <td className="px-2 py-2 text-right tabular-nums font-medium">{pctEjecMes.toFixed(2)}%</td>
                <td className={cn('px-2 py-2 text-right tabular-nums', deltaColor)}>
                  {delta >= 0 ? '+' : ''}
                  {delta.toFixed(2)}%
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-ink-3">{pctProgAcum.toFixed(2)}%</td>
                <td className="px-2 py-2 text-right tabular-nums font-semibold">{pctAv.toFixed(2)}%</td>
                <td className="px-2 py-2 text-right tabular-nums">{k.toFixed(5)}</td>
              </>
            );
          })()
        )}
        <td className="px-2 py-2">
          <span className={`chip ${chipKind}`}>{v.status}</span>
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-bg-sunken/40">
          <td colSpan={modo === 'pen' ? 11 : 10} className="px-4 py-3">
            <div className="space-y-4">
              {/* RES.VALO cabecera S10 */}
              <div>
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-ink-3 font-semibold mb-2">
                  <Receipt className="h-3.5 w-3.5" />
                  Resumen valorización S10 {v.archivoXlsx ? `· ${v.archivoXlsx}` : ''}
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  <MiniStat lbl="V (Valorización)" val={fmtPEN(Number(v.montoCd))} />
                  <MiniStat lbl="Reajuste R" val={fmtPEN(Number(v.montoReajuste ?? 0))} />
                  <MiniStat lbl="Deducciones D" val={fmtPEN(Number(v.montoDeducciones ?? 0))} />
                  <MiniStat lbl="VB (V+R-D)" val={fmtPEN(Number(v.montoValorizacionBruta ?? 0))} />
                  <MiniStat lbl="Amortizaciones A" val={fmtPEN(Number(v.montoAmortizaciones ?? 0))} />
                  <MiniStat lbl="VN (VB-A)" val={fmtPEN(Number(v.montoValorizacionNeta ?? 0))} />
                  <MiniStat lbl="Multa" val={fmtPEN(Number(v.multa ?? 0))} />
                  <MiniStat lbl="IGV 18%" val={fmtPEN(Number(v.montoIgv))} />
                  <MiniStat lbl="Total con IGV" val={fmtPEN(Number(v.montoTotalConIgv ?? v.montoTotal))} />
                  <MiniStat lbl="Retención" val={fmtPEN(Number(v.montoRetencion ?? 0))} accent="amber" />
                  <MiniStat
                    lbl="Total contratista"
                    val={fmtPEN(Number(v.totalContratista ?? 0))}
                    accent="green"
                  />
                  <MiniStat lbl="Condición" val={v.condicion ?? '—'} accent="blue" />
                </div>
              </div>

              {/* Reajuste detalle real/prog/reconocido/pagado */}
              {(v.vProgramado || v.reajusteReal) && (
                <div>
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-ink-3 font-semibold mb-2">
                    <TrendingUp className="h-3.5 w-3.5" />
                    Cálculo reajuste · R = V × (K-1)
                  </div>
                  <table className="w-full text-[11px]">
                    <thead className="text-ink-3 border-b border-line">
                      <tr>
                        <th className="text-left py-1">Concepto</th>
                        <th className="text-right py-1">Valor</th>
                        <th className="text-left pl-3 py-1">Concepto</th>
                        <th className="text-right py-1">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/40">
                      <tr>
                        <td className="py-1">V-real (V) (1)</td>
                        <td className="py-1 text-right tabular-nums">{fmtPEN(Number(v.montoCd))}</td>
                        <td className="pl-3 py-1">V-programado (2)</td>
                        <td className="py-1 text-right tabular-nums">{fmtPEN(Number(v.vProgramado ?? 0))}</td>
                      </tr>
                      <tr>
                        <td className="py-1">K-1 (3)</td>
                        <td className="py-1 text-right tabular-nums">
                          {(Number(v.factorReajusteK ?? 1) - 1).toFixed(6)}
                        </td>
                        <td className="pl-3 py-1">Vr (1)+(6)</td>
                        <td className="py-1 text-right tabular-nums">{fmtPEN(Number(v.vrConReajuste ?? 0))}</td>
                      </tr>
                      <tr>
                        <td className="py-1">Reajuste REAL (4)=(1)×(3)</td>
                        <td className="py-1 text-right tabular-nums text-amber-700 dark:text-amber-400">
                          {fmtPEN(Number(v.reajusteReal ?? 0))}
                        </td>
                        <td className="pl-3 py-1">Reajuste PROG (5)=(2)×(3)</td>
                        <td className="py-1 text-right tabular-nums text-ink-3">
                          {fmtPEN(Number(v.reajusteProgramado ?? 0))}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1">Reajuste RECONOCIDO (6)</td>
                        <td className="py-1 text-right tabular-nums">{fmtPEN(Number(v.reajusteReconocido ?? 0))}</td>
                        <td className="pl-3 py-1">Reajuste PAGADO (8)</td>
                        <td className="py-1 text-right tabular-nums">{fmtPEN(Number(v.reajustePagado ?? 0))}</td>
                      </tr>
                      <tr>
                        <td className="py-1">Acum anterior</td>
                        <td className="py-1 text-right tabular-nums">{fmtPEN(Number(v.reajusteAcumAnterior ?? 0))}</td>
                        <td className="pl-3 py-1">Acum actual</td>
                        <td className="py-1 text-right tabular-nums">{fmtPEN(Number(v.reajusteAcumActual ?? 0))}</td>
                      </tr>
                      <tr className="font-semibold">
                        <td className="py-1">Reajuste presente val</td>
                        <td className="py-1 text-right tabular-nums">{fmtPEN(Number(v.reajustePresente ?? 0))}</td>
                        <td colSpan={2} className="pl-3 py-1 text-ink-3 italic">
                          (valor finalmente aplicado en RES.VALO)
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {/* K monomios */}
              {reaj.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-ink-3 font-semibold mb-2">
                    <FileText className="h-3.5 w-3.5" />
                    Fórmula polinómica K · mes {reaj[0]?.anioMesIndice ?? '—'}
                  </div>
                  <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                    {reaj.map((r) => (
                      <DetalleReajuste key={r.id} r={r} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function MiniStat({
  lbl,
  val,
  accent,
}: {
  lbl: string;
  val: string;
  accent?: 'blue' | 'amber' | 'green';
}) {
  const accentClass = {
    blue: 'text-blue-600 dark:text-blue-400',
    amber: 'text-amber-700 dark:text-amber-400',
    green: 'text-emerald-600 dark:text-emerald-400',
  };
  return (
    <div className="rounded border border-line bg-bg-elev px-2.5 py-1.5">
      <div className="text-[9.5px] uppercase tracking-wide text-ink-3 font-medium">{lbl}</div>
      <div className={cn('text-[12px] font-semibold tabular-nums', accent && accentClass[accent])}>
        {val}
      </div>
    </div>
  );
}

function DetalleReajuste({ r }: { r: ValorizacionReajuste }) {
  const k = Number(r.kCalculado);
  const monto = Number(r.montoSubpresupuesto);
  const reajuste = Number(r.montoReajuste);
  return (
    <div className="rounded border border-line bg-bg-elev p-3">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="text-[12px] font-semibold">{r.subpresupuestoCodigo} · {SUBP_NOMBRE[r.subpresupuestoCodigo] ?? '—'}</div>
          <div className="text-[10.5px] text-ink-3 font-mono uppercase tracking-wide mt-0.5">
            K = {k.toFixed(6)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10.5px] text-ink-3">Monto subp</div>
          <div className="text-[12px] tabular-nums">{fmtPEN(monto)}</div>
          <div
            className={cn(
              'text-[10.5px] tabular-nums mt-0.5',
              reajuste >= 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-600',
            )}
          >
            {reajuste >= 0 ? '+' : ''}
            {fmtPEN(reajuste)}
          </div>
        </div>
      </div>
      {r.detalleK?.length > 0 && (
        <table className="w-full text-[11px] mt-2">
          <thead className="text-ink-3 border-b border-line">
            <tr>
              <th className="text-left py-1 font-medium">M</th>
              <th className="text-left py-1 font-medium">Símb</th>
              <th className="text-right py-1 font-medium">Coef</th>
              <th className="text-right py-1 font-medium">Ir</th>
              <th className="text-right py-1 font-medium">Io</th>
              <th className="text-right py-1 font-medium">Ir/Io</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/40">
            {r.detalleK.map((d) => (
              <tr key={d.monomio}>
                <td className="py-0.5 font-mono">M{d.monomio}</td>
                <td className="py-0.5 font-mono">{d.simbolo}</td>
                <td className="py-0.5 text-right tabular-nums">{d.coef.toFixed(3)}</td>
                <td className="py-0.5 text-right tabular-nums">{d.ir.toFixed(2)}</td>
                <td className="py-0.5 text-right tabular-nums">{d.io.toFixed(2)}</td>
                <td className="py-0.5 text-right tabular-nums">{d.relacion.toFixed(5)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'blue' | 'amber' | 'green';
}) {
  const accentClass = {
    blue: 'text-blue-600 dark:text-blue-400',
    amber: 'text-amber-700 dark:text-amber-400',
    green: 'text-emerald-600 dark:text-emerald-400',
  };
  return (
    <div className="rounded-md border border-line bg-bg-elev px-3 py-2.5">
      <div className="text-[10.5px] uppercase tracking-wide text-ink-3 font-medium">{label}</div>
      <div className={cn('text-[15px] font-semibold tabular-nums mt-0.5', accent && accentClass[accent])}>
        {value}
      </div>
    </div>
  );
}
