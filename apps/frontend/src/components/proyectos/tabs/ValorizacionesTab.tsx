import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  Receipt,
  TrendingDown,
  TrendingUp,
  Upload,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { api, type Valorizacion, type ValorizacionReajuste } from '@/lib/api.js';
import { cn, fmtPEN } from '@/lib/utils.js';
import { invalidateResumen } from '@/lib/invalidate.js';

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
  const curvaQ = useQuery({
    queryKey: ['curva-s', proyectoId],
    queryFn: () => api.proyectos.getCurvaS(proyectoId),
  });

  const [modo, setModo] = useState<Modo>('pen');
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadOk, setUploadOk] = useState<string | null>(null);
  const [cobro, setCobro] = useState<{ valId: string } | null>(null); // valo a marcar cobrada → pide cuenta destino
  const cuentasQ = useQuery({ queryKey: ['cuentas'], queryFn: () => api.finanzas.listCuentas(), staleTime: 5 * 60 * 1000 });

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
      invalidateResumen(qc);
    },
    onError: (e: Error) => {
      setUploadOk(null);
      setUploadError(e.message);
    },
  });

  const cambiarEstado = useMutation({
    mutationFn: (v: { valId: string; estado: string; cuentaId?: string; fechaCobro?: string }) =>
      api.proyectos.setValorizacionEstado(proyectoId, v.valId, v.estado, v.cuentaId ? { cuentaId: v.cuentaId, fechaCobro: v.fechaCobro } : undefined),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['valorizaciones', proyectoId] }); invalidateResumen(qc); setCobro(null); },
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

  // ── Timeline mensual del cronograma · cada periodo: presentada / pendiente / no presentada ──
  const MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const periodos = useMemo(() => {
    const cd = curvaQ.data?.data;
    const allBuckets = cd?.buckets ?? [];
    const plan = cd?.plan ?? [];
    // periodos reales de valorización = meses con plan > 0 (excluye el mes INICIO con plan 0)
    let real = allBuckets.map((b, i) => ({ b, plan: Number(plan[i] ?? 0) })).filter((x) => x.b.start && x.plan > 0);
    if (real.length === 0) real = allBuckets.filter((b) => b.start).map((b) => ({ b, plan: 0 }));
    const hoyStr = new Date().toISOString().slice(0, 10);
    const valByMes = new Map<string, (typeof valorizaciones)[number]>();
    for (const v of valorizaciones) {
      const ym = v.mesPeriodo ?? v.fechaDesde?.slice(0, 7) ?? '';
      if (ym) valByMes.set(ym, v);
    }
    return real.map(({ b }, i) => {
      const ym = b.start.slice(0, 7);
      const fin = (b.finish ?? b.start).slice(0, 10);
      const v = valByMes.get(ym);
      const vencido = fin < hoyStr;
      const estado: 'presentada' | 'no_presentada' | 'pendiente' = v ? 'presentada' : vencido ? 'no_presentada' : 'pendiente';
      return {
        idx: i + 1, // V01 = primer mes con plan
        ym,
        label: `${MES[Number(ym.slice(5, 7)) - 1] ?? '—'} ${ym.slice(2, 4)}`,
        fin,
        estado,
        valNumero: v?.numero ?? null,
        montoCd: v ? Number(v.montoCd) : null,
        pct: v ? Number(v.pctAvance) : null,
      };
    });
  }, [curvaQ.data, valorizaciones]);
  const presentadas = periodos.filter((p) => p.estado === 'presentada').length;
  const noPresentadas = periodos.filter((p) => p.estado === 'no_presentada').length;

  // Avance de inversión (oficial · % al pie del Excel) · de la última val con dato
  const inversionInfo = useMemo(() => {
    const conInv = valorizaciones
      .filter((v) => v.pctInversionAcumulado != null && Number(v.pctInversionAcumulado) > 0)
      .sort((a, b) => a.numero - b.numero);
    const ult = conInv[conInv.length - 1];
    if (!ult) return null;
    return {
      pct: Number(ult.pctInversionAcumulado),
      acum: Number(ult.montoInversionAcumulado ?? 0),
      numero: ult.numero,
    };
  }, [valorizaciones]);

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
    // Sobrescribir con datos REALES si la valorización está en DB
    // Si NO está en DB pero curvaS del Excel tiene ejec > 0 · usar Excel (inferido)
    let acumEjec = 0;
    for (const punto of base) {
      const vMes = valorizaciones.find((v) => v.mesPeriodo === punto.label);
      if (vMes) {
        // Mes con valorización en DB · usar dato exacto
        const pct = baseRef > 0 ? (Number(vMes.montoCd) / baseRef) * 100 : 0;
        punto.pctEjecMes = pct;
        acumEjec += pct;
        punto.pctEjecAcum = acumEjec;
      } else if (punto.label !== 'INICIO' && punto.pctEjecMes > 0) {
        // Mes sin val en DB pero Excel reporta avance · usar valor Excel (inferido)
        acumEjec += punto.pctEjecMes;
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

      {/* Timeline mensual del cronograma · presentada / pendiente / no presentada */}
      {periodos.length > 0 && (
        <div className="rounded-md border border-line bg-bg-elev">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <h3 className="text-[13px] font-semibold flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5 text-ink-3" /> Cronograma de valorizaciones · {periodos.length} periodos</h3>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> {presentadas} presentadas</span>
              {noPresentadas > 0 && <span className="inline-flex items-center gap-1 text-rose-500"><AlertTriangle className="h-3.5 w-3.5" /> {noPresentadas} no presentadas</span>}
              <span className="inline-flex items-center gap-1 text-ink-4"><Clock className="h-3.5 w-3.5" /> {periodos.length - presentadas - noPresentadas} por venir</span>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto p-3">
            {periodos.map((p) => {
              const cfg = {
                presentada: { ring: 'border-emerald-500/40 bg-emerald-500/5', dot: 'bg-emerald-500', txt: 'text-emerald-600', Icon: CheckCircle2 },
                no_presentada: { ring: 'border-rose-500/40 bg-rose-500/5', dot: 'bg-rose-500', txt: 'text-rose-500', Icon: AlertTriangle },
                pendiente: { ring: 'border-line bg-bg-sunken/30', dot: 'bg-ink-4/40', txt: 'text-ink-4', Icon: Clock },
              }[p.estado];
              return (
                <div key={p.ym} className={cn('min-w-[120px] shrink-0 rounded-md border p-2.5', cfg.ring)}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-3">{p.label}</span>
                    <span className="font-mono text-[9.5px] text-ink-4">V{String(p.idx).padStart(2, '0')}</span>
                  </div>
                  <div className={cn('mt-1 flex items-center gap-1 text-[11px] font-medium', cfg.txt)}>
                    <cfg.Icon className="h-3.5 w-3.5" />
                    {p.estado === 'presentada' ? `N°${p.valNumero}` : p.estado === 'no_presentada' ? 'No present.' : 'Pendiente'}
                  </div>
                  {p.estado === 'presentada' ? (
                    <div className="mt-1">
                      <div className="font-mono text-[11px] font-semibold tabular-nums">{fmtPEN(p.montoCd ?? 0)}</div>
                      <div className="text-[10px] text-ink-4">{(p.pct ?? 0).toFixed(1)}% acum</div>
                    </div>
                  ) : (
                    <div className="mt-1 text-[10px] text-ink-4">vence {p.fin.slice(8, 10)}/{p.fin.slice(5, 7)}</div>
                  )}
                </div>
              );
            })}
          </div>
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

      {/* Avance oficial · inversión (% al pie del Excel) + obra físico secundario */}
      {hayValorizaciones && inversionInfo && (
        <div className="rounded-md border border-line bg-bg-elev px-4 py-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">
              Avance de inversión
              <span className="ml-2 chip green">oficial MEF/OxI</span>
            </span>
            <span className="text-[10px] text-ink-4">Val N°{inversionInfo.numero}</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2.5 flex-wrap">
            <span className="text-[28px] font-bold tracking-[-0.02em] text-primary leading-none">
              {inversionInfo.pct.toFixed(2)}%
            </span>
            <span className="text-[12px] text-ink-3">ejecutado · {fmtPEN(inversionInfo.acum)}</span>
          </div>
          <div className="mt-1.5 text-[11px] text-ink-3">
            Avance físico obra (CD):{' '}
            <span className="font-semibold text-ink-1">{(stats?.pctAvanceUltima ?? 0).toFixed(2)}%</span>
            <span className="text-[10px] text-ink-4"> · interno · lo que factura el contratista</span>
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
          <Stat label="% Avance obra (físico)" value={`${stats.pctAvanceUltima.toFixed(2)}%`} accent="blue" />
          <Stat label="K promedio" value={stats.kPromedio.toFixed(5)} accent="blue" />
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
                  <th className="px-2 py-2 text-right">Neto a pagar</th>
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
                  onChangeEstado={(estado) => estado === 'cobrada' ? setCobro({ valId: v.id }) : cambiarEstado.mutate({ valId: v.id, estado })}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {cobro && (
        <CobroValoModal
          cuentas={cuentasQ.data?.cuentas ?? []}
          pending={cambiarEstado.isPending}
          onClose={() => setCobro(null)}
          onConfirm={(cuentaId, fechaCobro) => cambiarEstado.mutate({ valId: cobro.valId, estado: 'cobrada', cuentaId, fechaCobro })}
        />
      )}
    </div>
  );
}

// Mini-modal · al marcar valo cobrada pide cuenta destino (nace movimiento Ingreso de caja)
function CobroValoModal({ cuentas, pending, onClose, onConfirm }: {
  cuentas: { id: string; descripcion: string | null; codigo: string; banco?: string | null }[];
  pending: boolean;
  onClose: () => void;
  onConfirm: (cuentaId: string, fechaCobro: string) => void;
}) {
  const [cuentaId, setCuentaId] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-backdropIn" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-sm rounded-xl border border-line bg-bg-elev p-5 shadow-xl animate-modalPop">
        <h3 className="text-[14px] font-semibold mb-1">Registrar cobro</h3>
        <p className="text-[11.5px] text-ink-3 mb-3">Se crea un movimiento de caja (Ingreso) en la cuenta destino.</p>
        <div className="space-y-3">
          <label className="block">
            <span className="text-[10.5px] font-mono uppercase tracking-wider text-ink-4">Cuenta destino *</span>
            <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} className="mt-1 h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] w-full">
              <option value="">— elegir cuenta —</option>
              {cuentas.map((c) => <option key={c.id} value={c.id}>{c.descripcion ?? c.codigo}{c.banco ? ` · ${c.banco}` : ''}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[10.5px] font-mono uppercase tracking-wider text-ink-4">Fecha de cobro</span>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="mt-1 h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] w-full" />
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-bg-sunken">Cancelar</button>
            <button disabled={!cuentaId || pending} onClick={() => onConfirm(cuentaId, fecha)} className="h-8 px-3 rounded-md bg-emerald-600 text-white text-[12px] font-medium disabled:opacity-50">
              {pending ? 'Guardando…' : 'Registrar cobro'}
            </button>
          </div>
        </div>
      </div>
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
  onChangeEstado,
}: {
  v: Valorizacion;
  cdBruto: number;
  isExpanded: boolean;
  reaj: ValorizacionReajuste[];
  onToggle: () => void;
  modo: Modo;
  baseRef: number;
  pctProgAcum: number;
  onChangeEstado: (estado: string) => void;
}) {
  const Caret = isExpanded ? ChevronDown : ChevronRight;
  const cd = Number(v.montoCd);
  const igv = Number(v.montoIgv);
  const total = Number(v.montoTotalConIgv ?? v.montoTotal); // bruto c/IGV
  const retencion = Number(v.montoRetencion ?? 0);
  const neto = Number(v.totalContratista ?? total); // lo que realmente entra a caja (bruto − retención)
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
            <td className="px-2 py-2 text-right tabular-nums font-semibold">
              {fmtPEN(neto)}
              {retencion > 0 && (
                <div className="text-[10px] font-normal text-ink-4">
                  bruto {fmtPEN(total)} · ret −{fmtPEN(retencion)}
                </div>
              )}
            </td>
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
        <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
          <select
            className={cn('chip border-0 cursor-pointer', chipKind)}
            value={v.status}
            onChange={(e) => onChangeEstado(e.target.value)}
          >
            <option value="borrador">borrador</option>
            <option value="emitida">emitida</option>
            <option value="conformidad_supervision">conformidad superv.</option>
            <option value="aprobada">aprobada</option>
            <option value="facturada">facturada</option>
            <option value="cobrada">cobrada</option>
            <option value="rechazada">rechazada</option>
          </select>
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
