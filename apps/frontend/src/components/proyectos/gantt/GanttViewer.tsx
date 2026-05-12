import { useVirtualizer } from '@tanstack/react-virtual';
import { Calendar, ChevronDown, ChevronRight, Diamond, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Partida } from '@/lib/api.js';
import { cn, fmtPEN, partidaPrecioUnitario, partidaPresupuesto } from '@/lib/utils.js';

type ZoomLevel = 'day' | 'week' | 'month' | 'quarter';
const PX_PER_DAY: Record<ZoomLevel, number> = { day: 24, week: 8, month: 3, quarter: 1 };
const ZOOM_LABEL: Record<ZoomLevel, string> = { day: 'Día', week: 'Sem', month: 'Mes', quarter: 'Trim' };
const ROW_HEIGHT = 26;
const HEADER_HEIGHT = 44;
const LEFT_WIDTH = 380;

// Paleta colores por capítulo (top-level) · 10 valores distinguibles
const CAPITULO_PALETTE = [
  { bg: 'hsl(217 91% 60% / 0.18)', stroke: 'hsl(217 91% 50%)', fill: 'hsl(217 91% 55%)' }, // azul
  { bg: 'hsl(265 85% 60% / 0.18)', stroke: 'hsl(265 85% 50%)', fill: 'hsl(265 85% 55%)' }, // violeta
  { bg: 'hsl(160 60% 45% / 0.18)', stroke: 'hsl(160 60% 38%)', fill: 'hsl(160 60% 42%)' }, // verde
  { bg: 'hsl(38 92% 55% / 0.20)', stroke: 'hsl(38 92% 48%)', fill: 'hsl(38 92% 52%)' }, // ámbar
  { bg: 'hsl(335 80% 55% / 0.18)', stroke: 'hsl(335 80% 45%)', fill: 'hsl(335 80% 50%)' }, // rosa
  { bg: 'hsl(190 75% 45% / 0.18)', stroke: 'hsl(190 75% 38%)', fill: 'hsl(190 75% 42%)' }, // cyan
  { bg: 'hsl(20 85% 55% / 0.20)', stroke: 'hsl(20 85% 48%)', fill: 'hsl(20 85% 52%)' }, // naranja
  { bg: 'hsl(290 60% 55% / 0.18)', stroke: 'hsl(290 60% 45%)', fill: 'hsl(290 60% 50%)' }, // morado
  { bg: 'hsl(75 60% 45% / 0.18)', stroke: 'hsl(75 60% 38%)', fill: 'hsl(75 60% 42%)' }, // verde-amarillo
  { bg: 'hsl(220 15% 45% / 0.18)', stroke: 'hsl(220 15% 38%)', fill: 'hsl(220 15% 42%)' }, // gris
];

function getCapituloKey(codigo: string): string {
  // top-level: primer segmento del código (01, 02, etc)
  return codigo.split('.')[0] ?? codigo;
}

type EstadoTarea = 'no_iniciada' | 'en_curso' | 'completada' | 'atrasada' | 'proxima_vence';
function calcularEstado(
  p: Partida,
  pctReal: number,
  today: Date,
): EstadoTarea {
  if (pctReal >= 100) return 'completada';
  const fin = p.fechaFin ? new Date(`${p.fechaFin.slice(0, 10)}T00:00:00Z`) : null;
  if (fin && fin < today && pctReal < 100) return 'atrasada';
  if (pctReal > 0) return 'en_curso';
  // No iniciada · check si está próxima a vencer (fin dentro 7 días)
  const ini = p.fechaInicio ? new Date(`${p.fechaInicio.slice(0, 10)}T00:00:00Z`) : null;
  if (ini && fin) {
    const dias = (fin.getTime() - today.getTime()) / 86_400_000;
    if (dias > 0 && dias <= 7 && ini <= today) return 'proxima_vence';
  }
  return 'no_iniciada';
}

const ESTADO_COLORES: Record<EstadoTarea, { bg: string; stroke: string; chip: string; label: string }> = {
  no_iniciada: { bg: 'hsl(220 13% 80% / 0.4)', stroke: 'hsl(220 13% 60%)', chip: 'gray', label: 'No iniciada' },
  en_curso: { bg: 'hsl(217 91% 60% / 0.20)', stroke: 'hsl(217 91% 50%)', chip: 'blue', label: 'En curso' },
  completada: { bg: 'hsl(160 60% 45% / 0.25)', stroke: 'hsl(160 60% 38%)', chip: 'green', label: 'Completada' },
  atrasada: { bg: 'hsl(0 75% 55% / 0.25)', stroke: 'hsl(0 75% 50%)', chip: 'red', label: 'Atrasada' },
  proxima_vence: { bg: 'hsl(38 92% 55% / 0.25)', stroke: 'hsl(38 92% 48%)', chip: 'amber', label: 'Próx vencer' },
};

type Props = {
  partidas: Partida[];
  height?: number;
};

export function GanttViewer({ partidas, height = 700 }: Props) {
  const [zoom, setZoom] = useState<ZoomLevel>('week');
  const [showOnlyCritical, setShowOnlyCritical] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    return new Set(partidas.filter((p) => p.nivel >= 3).map((p) => p.codigo));
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  // Solo partidas con fechas válidas · hitos bracket: 1er hito arriba, resto al final
  const validPartidas = useMemo(() => {
    const filtered = partidas.filter((p) => p.fechaInicio && p.fechaFin);
    const hitos = filtered
      .filter((p) => p.isMilestone || p.codigo.startsWith('00.HITO'))
      .sort((a, b) => (a.fechaInicio ?? '').localeCompare(b.fechaInicio ?? ''));
    const noHitos = filtered.filter(
      (p) => !p.isMilestone && !p.codigo.startsWith('00.HITO'),
    );
    if (hitos.length === 0) return noHitos;
    if (hitos.length === 1) return [hitos[0]!, ...noHitos];
    // 2+ hitos · primero al tope · resto al final ordenados por fecha
    return [hitos[0]!, ...noHitos, ...hitos.slice(1)];
  }, [partidas]);

  // Aplicar collapse + filtros
  const visiblePartidas = useMemo(() => {
    const partidaMap = new Map(validPartidas.map((p) => [p.codigo, p]));
    return validPartidas.filter((p) => {
      // Filtro críticas
      if (showOnlyCritical && !p.isCritical && !p.isSummary && !hasChildren(p, validPartidas)) return false;
      // Filtro búsqueda
      if (search.trim()) {
        const ql = search.toLowerCase();
        if (!p.nombre.toLowerCase().includes(ql) && !p.codigo.includes(ql)) return false;
        return true; // si match · siempre visible (no respeta collapse)
      }
      // Respetar collapse
      let parent = p.parentCodigo;
      while (parent) {
        if (collapsed.has(parent)) return false;
        const found = partidaMap.get(parent);
        parent = found?.parentCodigo ?? null;
      }
      return true;
    });
  }, [validPartidas, collapsed, search, showOnlyCritical]);

  // Range de fechas · REAL (sin padding) para KPIs y VISUAL (con padding) para Gantt
  const { dateRange, dateRangeReal } = useMemo(() => {
    if (validPartidas.length === 0) return { dateRange: null, dateRangeReal: null };
    // parseDate UTC fuerza · evita off-by-1 TZ Lima -5
    const parseDate = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);
    let min = parseDate(validPartidas[0]!.fechaInicio!);
    let max = parseDate(validPartidas[0]!.fechaFin!);
    for (const p of validPartidas) {
      const s = parseDate(p.fechaInicio!);
      const f = parseDate(p.fechaFin!);
      if (s < min) min = s;
      if (f > max) max = f;
    }
    const real = { min: new Date(min), max: new Date(max) };
    // Padding visual ±5 días
    min.setUTCDate(min.getUTCDate() - 5);
    max.setUTCDate(max.getUTCDate() + 5);
    return { dateRange: { min, max }, dateRangeReal: real };
  }, [validPartidas]);

  // KPIs
  const kpis = useMemo(() => {
    // Incluir TODAS las partidas nivel 1 (incluso si no tienen fechas/dur)
    // Para el viewer Gantt usamos validPartidas pero el cost total incluye todas
    const cap1 = partidas.filter((p) => p.nivel === 1);
    const totalCost = cap1.reduce((s, p) => s + partidaPresupuesto(p), 0);
    const leaves = validPartidas.filter((p) => !hasChildren(p, validPartidas));
    const avgProgress =
      leaves.length > 0
        ? leaves.reduce((s, p) => s + Number(p.percentComplete ?? 0), 0) / leaves.length
        : 0;
    const criticas = validPartidas.filter((p) => p.isCritical && !p.isSummary).length;
    const hitos = validPartidas.filter((p) => p.isMilestone).length;
    // Duración REAL · sin padding visual del Gantt
    const totalDuration = dateRangeReal
      ? Math.ceil((dateRangeReal.max.getTime() - dateRangeReal.min.getTime()) / 86_400_000)
      : 0;
    return { totalDuration, totalCost, avgProgress, criticas, totalLeaves: leaves.length, hitos };
  }, [validPartidas, dateRangeReal]);

  // Map capítulo → color (top-level capítulos asignados a paleta)
  const capituloColor = useMemo(() => {
    const map = new Map<string, (typeof CAPITULO_PALETTE)[number]>();
    const capitulos = [...new Set(validPartidas.map((p) => getCapituloKey(p.codigo)))].sort();
    capitulos.forEach((cap, i) => {
      map.set(cap, CAPITULO_PALETTE[i % CAPITULO_PALETTE.length]!);
    });
    return map;
  }, [validPartidas]);

  // Today reference (1 vez)
  const todayDate = useMemo(() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }, []);

  // CPM forward + backward pass · early/late start/finish + holguras
  type CpmData = {
    earlyStart: number; // días desde inicio proyecto
    earlyFinish: number;
    lateStart: number;
    lateFinish: number;
    floatTotal: number; // holgura total
    floatFree: number; // holgura libre
  };
  const cpm = useMemo(() => {
    const result = new Map<string, CpmData>();
    if (validPartidas.length === 0 || !dateRangeReal) return result;
    const minMs = dateRangeReal.min.getTime();
    const projectFinish = validPartidas.reduce((m, p) => {
      const f = p.fechaFin ? new Date(`${p.fechaFin.slice(0, 10)}T00:00:00Z`).getTime() : 0;
      return Math.max(m, f);
    }, 0);
    const projectFinishDay = (projectFinish - minMs) / 86_400_000;

    // Calc por partida (hojas con fechas)
    for (const p of validPartidas) {
      if (!p.fechaInicio || !p.fechaFin) continue;
      const es = (new Date(`${p.fechaInicio.slice(0, 10)}T00:00:00Z`).getTime() - minMs) / 86_400_000;
      const ef = (new Date(`${p.fechaFin.slice(0, 10)}T00:00:00Z`).getTime() - minMs) / 86_400_000;
      // Late = Early para no-críticas si no calculamos full · simplificación
      // Para críticas: late = early (holgura 0)
      // Para no-críticas: calcular holgura desde proyectFin con sucesores
      let lateFinish = projectFinishDay;
      let lateStart = lateFinish - (ef - es);

      // Si es crítica · holgura 0
      if (p.isCritical) {
        lateStart = es;
        lateFinish = ef;
      }
      // Holgura libre: dist hasta primer sucesor
      const sucesores = validPartidas.filter((o) => (o.predecessors ?? []).includes(p.codigo));
      let floatFree = projectFinishDay - ef;
      for (const suc of sucesores) {
        if (!suc.fechaInicio) continue;
        const sucEs = (new Date(`${suc.fechaInicio.slice(0, 10)}T00:00:00Z`).getTime() - minMs) / 86_400_000;
        floatFree = Math.min(floatFree, sucEs - ef);
      }
      const floatTotal = lateFinish - ef;

      result.set(p.codigo, {
        earlyStart: es,
        earlyFinish: ef,
        lateStart,
        lateFinish,
        floatTotal: Math.max(0, floatTotal),
        floatFree: Math.max(0, floatFree),
      });
    }
    return result;
  }, [validPartidas, dateRangeReal]);

  // Virtualizer
  const rowVirtualizer = useVirtualizer({
    count: visiblePartidas.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // Helpers
  const totalDays = dateRange
    ? Math.ceil((dateRange.max.getTime() - dateRange.min.getTime()) / 86_400_000)
    : 0;
  const pxPerDay = PX_PER_DAY[zoom];
  const totalWidth = totalDays * pxPerDay;
  const today = new Date();
  const dayToX = (d: Date) =>
    dateRange ? ((d.getTime() - dateRange.min.getTime()) / 86_400_000) * pxPerDay : 0;
  const todayX = dateRange ? dayToX(today) : -1;
  const todayInRange = dateRange && today >= dateRange.min && today <= dateRange.max;

  const toggleCollapse = (codigo: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(codigo)) next.delete(codigo);
      else next.add(codigo);
      return next;
    });
  };
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () =>
    setCollapsed(new Set(validPartidas.filter((p) => p.nivel >= 1).map((p) => p.codigo)));

  const goToToday = () => {
    if (!scrollRef.current || !todayInRange) return;
    const targetX = Math.max(0, todayX - 200);
    scrollRef.current.scrollTo({ left: targetX, behavior: 'smooth' });
  };

  // Ticks eje X
  const ticks = useMemo(() => {
    if (!dateRange) return [];
    const result: { x: number; label: string; major: boolean }[] = [];
    const cursor = new Date(dateRange.min);
    cursor.setHours(0, 0, 0, 0);

    if (zoom === 'day') {
      while (cursor <= dateRange.max) {
        result.push({
          x: dayToX(cursor),
          label: cursor.getDate().toString(),
          major: cursor.getDate() === 1,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
    } else if (zoom === 'week') {
      while (cursor.getDay() !== 1) cursor.setDate(cursor.getDate() + 1);
      while (cursor <= dateRange.max) {
        result.push({
          x: dayToX(cursor),
          label: `${cursor.getDate()} ${cursor.toLocaleDateString('es-PE', { month: 'short' })}`,
          major: cursor.getDate() <= 7,
        });
        cursor.setDate(cursor.getDate() + 7);
      }
    } else if (zoom === 'month') {
      cursor.setDate(1);
      while (cursor <= dateRange.max) {
        result.push({
          x: dayToX(cursor),
          label: cursor.toLocaleDateString('es-PE', { month: 'short', year: '2-digit' }),
          major: cursor.getMonth() === 0,
        });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    } else {
      // quarter
      cursor.setDate(1);
      cursor.setMonth(Math.floor(cursor.getMonth() / 3) * 3);
      while (cursor <= dateRange.max) {
        const q = Math.floor(cursor.getMonth() / 3) + 1;
        result.push({
          x: dayToX(cursor),
          label: `Q${q} ${cursor.getFullYear()}`,
          major: q === 1,
        });
        cursor.setMonth(cursor.getMonth() + 3);
      }
    }
    return result;
  }, [dateRange, zoom]);

  // Ir a primer match búsqueda
  useEffect(() => {
    if (search.trim() && visiblePartidas.length > 0) {
      rowVirtualizer.scrollToIndex(0, { align: 'start' });
    }
  }, [search, rowVirtualizer, visiblePartidas.length]);

  // Keyboard nav · ↑↓ navegar · Esc cerrar panel · +/- zoom
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Solo si el contenedor Gantt tiene foco · evitar interferencia con inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'Escape' && selectedId) {
        e.preventDefault();
        setSelectedId(null);
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (visiblePartidas.length === 0) return;
        e.preventDefault();
        const curIdx = selectedId
          ? visiblePartidas.findIndex((p) => p.id === selectedId)
          : -1;
        const nextIdx =
          e.key === 'ArrowDown'
            ? Math.min(visiblePartidas.length - 1, curIdx + 1)
            : Math.max(0, curIdx - 1);
        const next = visiblePartidas[nextIdx];
        if (next) {
          setSelectedId(next.id);
          rowVirtualizer.scrollToIndex(nextIdx, { align: 'center' });
        }
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        const order: ZoomLevel[] = ['quarter', 'month', 'week', 'day'];
        const idx = order.indexOf(zoom);
        if (idx < order.length - 1) setZoom(order[idx + 1]!);
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        const order: ZoomLevel[] = ['quarter', 'month', 'week', 'day'];
        const idx = order.indexOf(zoom);
        if (idx > 0) setZoom(order[idx - 1]!);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, visiblePartidas, rowVirtualizer, zoom]);

  if (!dateRange) {
    return (
      <div className="rounded-md border border-line bg-bg-elev p-12 text-center">
        <p className="text-[12px] text-ink-3">Sin partidas con fechas válidas</p>
      </div>
    );
  }

  const selected = selectedId ? validPartidas.find((p) => p.id === selectedId) : null;

  return (
    <div className="space-y-3">
      {/* KPIs · 5 cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <Kpi lbl="Duración" val={`${kpis.totalDuration}d`} sub={dateRangeReal ? `${dateRangeReal.min.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', timeZone: 'UTC' })} → ${dateRangeReal.max.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}` : ''} />
        <Kpi
          lbl="Costo Contractual"
          val={fmtPEN(kpis.totalCost)}
          sub="Suma capítulos nivel 1"
          mono
        />
        <Kpi lbl="Progreso" val={`${kpis.avgProgress.toFixed(1)}%`} sub={`${kpis.totalLeaves} hojas`} />
        <Kpi lbl="Críticas" val={`${kpis.criticas}`} sub={`de ${kpis.totalLeaves} hojas`} accent="text-destructive" />
        <Kpi lbl="Hitos" val={`${kpis.hitos}`} sub="◆ milestones" accent="text-warn" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-bg-elev px-3 py-2">
        <div className="flex items-center gap-2">
          {/* Zoom */}
          <div className="flex rounded-md border border-line overflow-hidden">
            {(['day', 'week', 'month', 'quarter'] as ZoomLevel[]).map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setZoom(z)}
                className={cn(
                  'px-2.5 py-1 text-[11px] font-medium transition-colors',
                  zoom === z
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-bg-elev text-ink-3 hover:bg-bg-sunken',
                )}
              >
                {ZOOM_LABEL[z]}
              </button>
            ))}
          </div>
          {/* Solo críticas */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showOnlyCritical}
              onChange={(e) => setShowOnlyCritical(e.target.checked)}
              className="rounded border-line"
            />
            <span className="text-[11px] text-ink-2">Solo críticas</span>
          </label>
        </div>
        <div className="flex items-center gap-2">
          {/* Búsqueda */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-4" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar partida..."
              className="h-7 w-44 rounded-md border border-line bg-bg-sunken pl-7 pr-2 text-[11px] outline-none placeholder:text-ink-4 focus:border-primary"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-ink-4 hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={goToToday}
            disabled={!todayInRange}
            className="flex items-center gap-1 h-7 px-2.5 rounded-md border border-line text-[11px] text-ink-2 hover:bg-bg-sunken disabled:opacity-50"
            title="Ir a hoy"
          >
            <Calendar className="h-3 w-3" />
            Hoy
          </button>
          <button
            type="button"
            onClick={expandAll}
            className="h-7 px-2.5 rounded-md border border-line text-[11px] text-ink-2 hover:bg-bg-sunken"
          >
            Expandir
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="h-7 px-2.5 rounded-md border border-line text-[11px] text-ink-2 hover:bg-bg-sunken"
          >
            Colapsar
          </button>
        </div>
      </div>

      {/* Body · gantt + side panel */}
      <div className="flex gap-3" style={{ height }}>
        {/* Gantt main */}
        <div className="flex-1 rounded-md border border-line bg-bg-elev overflow-hidden flex flex-col min-w-0">
          {/* Header sticky */}
          <div className="flex shrink-0 border-b border-line bg-bg-sunken" style={{ height: HEADER_HEIGHT }}>
            <div
              className="shrink-0 grid items-center gap-2 px-3 border-r border-line"
              style={{ width: LEFT_WIDTH, gridTemplateColumns: '60px 1fr 50px 36px' }}
            >
              <span className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4 font-medium">WBS</span>
              <span className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4 font-medium">Tarea</span>
              <span className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4 font-medium text-right">Dur.</span>
              <span className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4 font-medium text-right">%</span>
            </div>
            <TimelineHeader
              ticks={ticks}
              totalWidth={totalWidth}
              todayX={todayX}
              todayInRange={!!todayInRange}
            />
          </div>

          {/* Body scroll */}
          <div ref={scrollRef} className="flex-1 overflow-auto relative">
            <div
              style={{
                height: rowVirtualizer.getTotalSize(),
                width: LEFT_WIDTH + totalWidth,
                position: 'relative',
              }}
            >
              {/* Línea hoy global · vertical full height */}
              {todayInRange && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-destructive z-10 pointer-events-none"
                  style={{
                    left: LEFT_WIDTH + todayX,
                    boxShadow: '0 0 0 0.5px hsl(var(--destructive))',
                  }}
                />
              )}

              {/* Overlay líneas dependencias · solo entre items virtualizados visibles */}
              <DependencyOverlay
                visiblePartidas={visiblePartidas}
                virtualItems={rowVirtualizer.getVirtualItems()}
                dayToX={dayToX}
                leftWidth={LEFT_WIDTH}
                totalWidth={totalWidth}
                totalHeight={rowVirtualizer.getTotalSize()}
                selectedCodigo={selected?.codigo ?? null}
                hoverCodigo={hover}
              />

              {rowVirtualizer.getVirtualItems().map((vrow) => {
                const p = visiblePartidas[vrow.index]!;
                const has = hasChildren(p, validPartidas);
                const isCol = collapsed.has(p.codigo);
                const isSel = selectedId === p.id;
                const isHov = hover === p.codigo;
                const indent = (p.nivel - 1) * 12;
                const start = new Date(`${p.fechaInicio!.slice(0, 10)}T00:00:00Z`);
                const finish = new Date(`${p.fechaFin!.slice(0, 10)}T00:00:00Z`);
                const x = dayToX(start);
                const w = Math.max(2, dayToX(finish) - x);

                // Tooltip info compacta
                const pctValRow = p.valorizado ? Number(p.valorizado.pctAvanceReal) : 0;
                const pctMppRow = Number(p.percentComplete ?? 0);
                const pctRealRow = pctValRow > 0 ? pctValRow : pctMppRow;
                const tooltipParts = [
                  `${p.codigo} · ${p.nombre}`,
                  `${fmtSpanish(p.fechaInicio)} → ${fmtSpanish(p.fechaFin)} (${p.duracionDias ?? 0}d)`,
                  pctRealRow > 0 ? `Avance: ${pctRealRow.toFixed(1)}%` : 'Sin avance',
                  p.isCritical ? '⚠ Crítica' : '',
                  p.isMilestone ? '◆ Hito' : '',
                  p.valorizado ? `Valorizado: ${fmtPEN(Number(p.valorizado.montoAcumulado))}` : '',
                ].filter(Boolean).join('\n');

                return (
                  <div
                    key={p.id}
                    onMouseEnter={() => setHover(p.codigo)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setSelectedId(p.id)}
                    title={tooltipParts}
                    className={cn(
                      'absolute left-0 flex border-b border-line/40 cursor-pointer transition-colors',
                      isSel && 'bg-primary-soft',
                      !isSel && isHov && 'bg-bg-sunken/60',
                      !isSel && !isHov && p.nivel === 1 && 'bg-bg-sunken/40',
                    )}
                    style={{
                      top: vrow.start,
                      height: vrow.size,
                      width: LEFT_WIDTH + totalWidth,
                    }}
                  >
                    {/* Left · 4 columnas */}
                    <div
                      className="shrink-0 grid items-center gap-2 px-3 border-r border-line/60"
                      style={{ width: LEFT_WIDTH, gridTemplateColumns: '60px 1fr 50px 36px' }}
                    >
                      <div className="flex items-center gap-0.5" style={{ paddingLeft: indent }}>
                        {has ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleCollapse(p.codigo);
                            }}
                            className="text-ink-3 hover:text-foreground shrink-0"
                          >
                            {isCol ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </button>
                        ) : (
                          <span className="w-3 shrink-0" />
                        )}
                        <span className="font-mono text-[9.5px] text-ink-4 truncate">{p.codigo}</span>
                      </div>
                      <span
                        className={cn(
                          'truncate text-[11px]',
                          p.nivel === 1 && 'font-bold uppercase',
                          p.nivel === 2 && 'font-semibold',
                        )}
                        title={p.nombre}
                      >
                        {p.isMilestone && <Diamond className="inline h-2.5 w-2.5 mr-1 fill-warn text-warn" />}
                        {p.nombre}
                      </span>
                      <span className="font-mono text-[10px] text-ink-3 text-right">
                        {p.duracionDias ?? 0}d
                      </span>
                      <span
                        className={cn(
                          'font-mono text-[10px] text-right',
                          Number(p.percentComplete ?? 0) >= 100 ? 'text-ok' : Number(p.percentComplete ?? 0) > 0 ? 'text-warn-ink' : 'text-ink-4',
                        )}
                      >
                        {Number(p.percentComplete ?? 0).toFixed(0)}%
                      </span>
                    </div>

                    {/* Right · timeline svg per row */}
                    <div className="relative" style={{ width: totalWidth }}>
                      <svg
                        width={totalWidth}
                        height={vrow.size}
                        style={{ display: 'block' }}
                      >
                        {/* Grid vertical sutil */}
                        {ticks.filter((t) => t.major).map((t) => (
                          <line
                            key={t.x}
                            x1={t.x}
                            y1={0}
                            x2={t.x}
                            y2={vrow.size}
                            stroke="hsl(var(--line))"
                            strokeWidth={0.5}
                            opacity={0.5}
                          />
                        ))}

                        {/* Bar · usa HSL vars para adaptar light/dark */}
                        {p.isMilestone ? (
                          <polygon
                            points={`${x},${vrow.size / 2 - 6} ${x + 6},${vrow.size / 2} ${x},${vrow.size / 2 + 6} ${x - 6},${vrow.size / 2}`}
                            fill="hsl(var(--warn))"
                            stroke="hsl(var(--warn-ink))"
                            strokeWidth={1}
                          />
                        ) : has || p.isSummary ? (
                          <g>
                            <rect
                              x={x}
                              y={vrow.size / 2 - 2}
                              width={w}
                              height={4}
                              fill="hsl(var(--foreground))"
                              rx={1}
                            />
                            <polygon
                              points={`${x},${vrow.size / 2 + 2} ${x + 5},${vrow.size - 6} ${x - 5},${vrow.size - 6}`}
                              fill="hsl(var(--foreground))"
                            />
                            <polygon
                              points={`${x + w},${vrow.size / 2 + 2} ${x + w + 5},${vrow.size - 6} ${x + w - 5},${vrow.size - 6}`}
                              fill="hsl(var(--foreground))"
                            />
                          </g>
                        ) : (
                          (() => {
                            // Pct real desde valorización · fallback al percentComplete MPP
                            const pctVal = p.valorizado ? Number(p.valorizado.pctAvanceReal) : 0;
                            const pctMpp = Number(p.percentComplete ?? 0);
                            const pctReal = pctVal > 0 ? pctVal : pctMpp;
                            const estado = calcularEstado(p, pctReal, todayDate);
                            const estColor = ESTADO_COLORES[estado];
                            const capColor = capituloColor.get(getCapituloKey(p.codigo));
                            // Crítica overrides estado para borde rojo
                            const stroke = p.isCritical ? 'hsl(var(--destructive))' : estColor.stroke;
                            const bg = estado === 'no_iniciada' && capColor ? capColor.bg : estColor.bg;
                            const fillColor =
                              estado === 'completada'
                                ? 'hsl(160 60% 45%)'
                                : estado === 'atrasada'
                                  ? 'hsl(0 75% 55%)'
                                  : estado === 'proxima_vence'
                                    ? 'hsl(38 92% 55%)'
                                    : capColor?.fill ?? 'hsl(var(--primary))';
                            const valW = w * (pctReal / 100);
                            return (
                              <g>
                                <rect
                                  x={x}
                                  y={6}
                                  width={w}
                                  height={vrow.size - 12}
                                  fill={bg}
                                  stroke={stroke}
                                  strokeWidth={p.isCritical ? 1.4 : 0.8}
                                  rx={2}
                                />
                                {pctReal > 0 && (
                                  <rect
                                    x={x}
                                    y={6}
                                    width={valW}
                                    height={vrow.size - 12}
                                    fill={fillColor}
                                    rx={2}
                                  />
                                )}
                                {/* Indicador valorización · marca real avance si vino de val */}
                                {pctVal > 0 && pctVal < 100 && (
                                  <line
                                    x1={x + valW}
                                    y1={4}
                                    x2={x + valW}
                                    y2={vrow.size - 4}
                                    stroke="hsl(var(--foreground))"
                                    strokeWidth={1.2}
                                    strokeDasharray="2 1"
                                  />
                                )}
                                {/* Label dentro · duración + % si caben */}
                                {w > 38 && (
                                  <text
                                    x={x + 4}
                                    y={vrow.size / 2 + 3}
                                    fontSize="9"
                                    fill={pctReal > 30 ? 'white' : 'hsl(var(--foreground))'}
                                    fontFamily="monospace"
                                    fontWeight={600}
                                    style={{ pointerEvents: 'none' }}
                                  >
                                    {p.duracionDias}d {pctReal > 0 && w > 60 ? `· ${pctReal.toFixed(0)}%` : ''}
                                  </text>
                                )}
                              </g>
                            );
                          })()
                        )}
                      </svg>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Side panel · detalles */}
        {selected && (
          <GanttDetailsPanel
            partida={selected}
            allPartidas={validPartidas}
            cpm={cpm.get(selected.codigo) ?? null}
            todayDate={todayDate}
            onClose={() => setSelectedId(null)}
            onNavigate={(codigo) => {
              const target = validPartidas.find((p) => p.codigo === codigo);
              if (target) setSelectedId(target.id);
            }}
          />
        )}
      </div>
    </div>
  );
}

/* ─── Sub-componentes ─── */

function Kpi({
  lbl,
  val,
  sub,
  accent,
  mono,
}: {
  lbl: string;
  val: string;
  sub: string;
  accent?: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border border-line bg-bg-elev p-2.5 min-w-0">
      <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4 truncate">{lbl}</div>
      <div className={cn('mt-0.5 truncate font-bold tracking-[-0.02em]', accent, mono ? 'text-[13px] font-mono' : 'text-[15px]')}>
        {val}
      </div>
      <div className="text-[10px] text-ink-3 mt-0.5 truncate">{sub}</div>
    </div>
  );
}

function TimelineHeader({
  ticks,
  totalWidth,
  todayX,
  todayInRange,
}: {
  ticks: { x: number; label: string; major: boolean }[];
  totalWidth: number;
  todayX: number;
  todayInRange: boolean;
}) {
  return (
    <div className="relative" style={{ width: totalWidth, height: HEADER_HEIGHT }}>
      <svg width={totalWidth} height={HEADER_HEIGHT}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={t.x}
              y1={t.major ? 0 : HEADER_HEIGHT - 16}
              x2={t.x}
              y2={HEADER_HEIGHT}
              stroke={t.major ? 'hsl(var(--line-strong))' : 'hsl(var(--line))'}
              strokeWidth={t.major ? 1 : 0.5}
            />
            <text
              x={t.x + 3}
              y={HEADER_HEIGHT - 5}
              fontSize="9.5"
              fill="hsl(var(--ink-3))"
              fontFamily="monospace"
              fontWeight={t.major ? 600 : 400}
            >
              {t.label}
            </text>
          </g>
        ))}
        {todayInRange && (
          <g>
            <line
              x1={todayX}
              y1={0}
              x2={todayX}
              y2={HEADER_HEIGHT}
              stroke="hsl(var(--destructive))"
              strokeWidth={1.5}
            />
            <rect
              x={todayX - 14}
              y={2}
              width={28}
              height={14}
              fill="hsl(var(--destructive))"
              rx={2}
            />
            <text
              x={todayX}
              y={12}
              fontSize="9"
              fill="white"
              fontFamily="monospace"
              fontWeight={700}
              textAnchor="middle"
            >
              HOY
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

function GanttDetailsPanel({
  partida: p,
  allPartidas,
  cpm,
  todayDate,
  onClose,
  onNavigate,
}: {
  partida: Partida;
  allPartidas: Partida[];
  cpm: {
    earlyStart: number;
    earlyFinish: number;
    lateStart: number;
    lateFinish: number;
    floatTotal: number;
    floatFree: number;
  } | null;
  todayDate: Date;
  onClose: () => void;
  onNavigate: (codigo: string) => void;
}) {
  // Predecesoras: lookup por código
  const predecesoras = (p.predecessors ?? [])
    .map((codigo) => allPartidas.find((x) => x.codigo === codigo))
    .filter((x): x is Partida => !!x);
  // Sucesoras: tasks que tienen a este código en sus predecessors
  const sucesoras = allPartidas.filter((other) =>
    (other.predecessors ?? []).includes(p.codigo),
  );

  // Breadcrumb WBS
  const breadcrumb = useMemo(() => {
    const segments = p.codigo.split('.');
    return segments.map((_, idx) => segments.slice(0, idx + 1).join('.'));
  }, [p.codigo]);

  // Estado + valorización
  const pctVal = p.valorizado ? Number(p.valorizado.pctAvanceReal) : 0;
  const pctMpp = Number(p.percentComplete ?? 0);
  const pctReal = pctVal > 0 ? pctVal : pctMpp;
  const estado = calcularEstado(p, pctReal, todayDate);
  const estColor = ESTADO_COLORES[estado];

  // Costos
  const budget = partidaPresupuesto(p);
  const valorizado = p.valorizado ? Number(p.valorizado.montoAcumulado) : 0;
  const restante = budget - valorizado;

  return (
    <div className="w-80 shrink-0 rounded-md border border-line bg-bg-elev overflow-hidden flex flex-col">
      <div className="flex items-start justify-between border-b border-line px-3 py-2.5">
        <div className="min-w-0">
          {/* Breadcrumb WBS */}
          <div className="flex items-center gap-0.5 font-mono text-[9px] uppercase tracking-wider text-ink-4 mb-0.5 flex-wrap">
            {breadcrumb.map((bc, i) => (
              <span key={bc} className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => onNavigate(bc)}
                  className="hover:text-foreground transition-colors"
                  title={`Ir a ${bc}`}
                >
                  {bc}
                </button>
                {i < breadcrumb.length - 1 && <span className="text-ink-4/50">›</span>}
              </span>
            ))}
          </div>
          <h4 className="text-[12.5px] font-semibold leading-tight">{p.nombre}</h4>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-bg-sunken"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-[11.5px]">
        {/* Chips estado */}
        <div className="flex gap-1.5 flex-wrap">
          <span className={`chip ${estColor.chip}`}>{estColor.label}</span>
          {p.isMilestone && <span className="chip amber">◆ Hito</span>}
          {p.isCritical && <span className="chip red">⚠ Crítica</span>}
          {p.isSummary && <span className="chip blue">Resumen</span>}
          {p.valorizado?.ultimaValNumero != null && (
            <span className="chip blue">● Val N°{p.valorizado.ultimaValNumero}</span>
          )}
        </div>

        {/* Fechas */}
        <Section title="Fechas">
          <Row lbl="Inicio" val={fmtSpanish(p.fechaInicio)} />
          <Row lbl="Fin" val={fmtSpanish(p.fechaFin)} />
          <Row lbl="Duración" val={`${p.duracionDias ?? 0} días`} />
          <Row
            lbl="% Avance real"
            val={`${pctReal.toFixed(1)}%${pctVal > 0 ? ' (val)' : pctMpp > 0 ? ' (MPP)' : ''}`}
          />
        </Section>

        {/* CPM · Holguras */}
        {cpm && !p.isMilestone && !p.isSummary && (
          <Section title="CPM / Holgura">
            <Row lbl="Inicio temprano" val={`${cpm.earlyStart.toFixed(0)} d`} />
            <Row lbl="Fin temprano" val={`${cpm.earlyFinish.toFixed(0)} d`} />
            <Row lbl="Inicio tardío" val={`${cpm.lateStart.toFixed(0)} d`} />
            <Row lbl="Fin tardío" val={`${cpm.lateFinish.toFixed(0)} d`} />
            <Row
              lbl="Holgura total"
              val={`${cpm.floatTotal.toFixed(0)} d`}
              mono
            />
            <Row
              lbl="Holgura libre"
              val={`${cpm.floatFree.toFixed(0)} d`}
              mono
            />
          </Section>
        )}

        {/* Económico · Contractual + restante */}
        <Section title="Costos">
          <Row lbl="Presupuesto" val={fmtPEN(budget)} mono />
          {valorizado > 0 && (
            <>
              <Row lbl="Valorizado" val={fmtPEN(valorizado)} mono />
              <Row
                lbl="Restante"
                val={fmtPEN(restante)}
                mono
              />
            </>
          )}
          {valorizado === 0 && <Row lbl="Restante" val={fmtPEN(budget)} mono />}
          {p.unidad && <Row lbl="Unidad" val={p.unidad} />}
          {p.cantidad && <Row lbl="Cantidad" val={Number(p.cantidad).toLocaleString('es-PE')} />}
          {partidaPrecioUnitario(p) !== null && (
            <Row lbl="Precio Unitario" val={fmtPEN(partidaPrecioUnitario(p) ?? 0)} mono />
          )}
        </Section>

        {/* Predecesoras · click navega */}
        {predecesoras.length > 0 && (
          <Section title={`Predecesoras (${predecesoras.length})`}>
            <div className="space-y-1.5">
              {predecesoras.slice(0, 8).map((pred) => (
                <button
                  key={pred.id}
                  type="button"
                  onClick={() => onNavigate(pred.codigo)}
                  className="w-full rounded border border-line bg-bg-sunken/40 px-2 py-1.5 flex items-center gap-2 hover:border-primary hover:bg-bg-sunken/80 transition-colors text-left"
                >
                  <span className="chip blue text-[8.5px]">FS</span>
                  <span className="font-mono text-[9.5px] text-ink-3 shrink-0">{pred.codigo}</span>
                  <span className="text-[10.5px] truncate flex-1" title={pred.nombre}>
                    {pred.nombre}
                  </span>
                </button>
              ))}
              {predecesoras.length > 8 && (
                <div className="text-[10px] text-ink-3 italic">+{predecesoras.length - 8} más...</div>
              )}
            </div>
          </Section>
        )}

        {/* Sucesoras · click navega */}
        {sucesoras.length > 0 && (
          <Section title={`Sucesoras (${sucesoras.length})`}>
            <div className="space-y-1.5">
              {sucesoras.slice(0, 8).map((suc) => (
                <button
                  key={suc.id}
                  type="button"
                  onClick={() => onNavigate(suc.codigo)}
                  className="w-full rounded border border-line bg-bg-sunken/40 px-2 py-1.5 flex items-center gap-2 hover:border-primary hover:bg-bg-sunken/80 transition-colors text-left"
                >
                  <span className="chip text-[8.5px]">FS</span>
                  <span className="font-mono text-[9.5px] text-ink-3 shrink-0">{suc.codigo}</span>
                  <span className="text-[10.5px] truncate flex-1" title={suc.nombre}>
                    {suc.nombre}
                  </span>
                </button>
              ))}
              {sucesoras.length > 8 && (
                <div className="text-[10px] text-ink-3 italic">+{sucesoras.length - 8} más...</div>
              )}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

/* ─── DependencyOverlay · líneas FS entre tareas visibles ─── */
function DependencyOverlay({
  visiblePartidas,
  virtualItems,
  dayToX,
  leftWidth,
  totalWidth,
  totalHeight,
  selectedCodigo,
  hoverCodigo,
}: {
  visiblePartidas: Partida[];
  virtualItems: { index: number; start: number; size: number }[];
  dayToX: (d: Date) => number;
  leftWidth: number;
  totalWidth: number;
  totalHeight: number;
  selectedCodigo: string | null;
  hoverCodigo: string | null;
}) {
  // Map codigo → posición vertical en visible array
  const codigoToVRow = new Map<string, { yMid: number; xStart: number; xEnd: number }>();
  virtualItems.forEach((vi) => {
    const p = visiblePartidas[vi.index];
    if (!p || !p.fechaInicio || !p.fechaFin) return;
    codigoToVRow.set(p.codigo, {
      yMid: vi.start + vi.size / 2,
      xStart: dayToX(new Date(`${p.fechaInicio.slice(0, 10)}T00:00:00Z`)),
      xEnd: dayToX(new Date(`${p.fechaFin.slice(0, 10)}T00:00:00Z`)),
    });
  });

  const lines: { d: string; key: string; highlight: boolean }[] = [];
  virtualItems.forEach((vi) => {
    const p = visiblePartidas[vi.index];
    if (!p || !p.predecessors) return;
    const here = codigoToVRow.get(p.codigo);
    if (!here) return;
    p.predecessors.forEach((predCodigo) => {
      const pred = codigoToVRow.get(predCodigo);
      if (!pred) return;
      // Path: predEnd → 8px right → down/up to current → currentStart
      const x1 = pred.xEnd;
      const y1 = pred.yMid;
      const x2 = here.xStart;
      const y2 = here.yMid;
      const midX = Math.max(x1 + 8, x2 - 8);
      const d = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2 - 4} ${y2}`;
      const isHighlight =
        p.codigo === selectedCodigo ||
        predCodigo === selectedCodigo ||
        p.codigo === hoverCodigo ||
        predCodigo === hoverCodigo;
      lines.push({ d, key: `${predCodigo}→${p.codigo}`, highlight: isHighlight });
    });
  });

  if (lines.length === 0) return null;

  return (
    <svg
      width={totalWidth}
      height={totalHeight}
      className="absolute pointer-events-none"
      style={{ left: leftWidth, top: 0, zIndex: 5 }}
    >
      <defs>
        <marker id="dep-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--ink-3))" />
        </marker>
        <marker id="dep-arrow-hl" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--primary))" />
        </marker>
      </defs>
      {lines.map((l) => (
        <path
          key={l.key}
          d={l.d}
          fill="none"
          stroke={l.highlight ? 'hsl(var(--primary))' : 'hsl(var(--ink-4))'}
          strokeWidth={l.highlight ? 1.5 : 0.7}
          strokeOpacity={l.highlight ? 0.95 : 0.45}
          markerEnd={l.highlight ? 'url(#dep-arrow-hl)' : 'url(#dep-arrow)'}
        />
      ))}
    </svg>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4 font-medium mb-1.5">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ lbl, val, mono }: { lbl: string; val: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-ink-3">{lbl}</span>
      <span className={cn('font-medium text-foreground', mono && 'font-mono')}>{val}</span>
    </div>
  );
}

function hasChildren(p: Partida, all: Partida[]): boolean {
  return all.some((c) => c.parentCodigo === p.codigo);
}

function fmtSpanish(d: string | null): string {
  if (!d) return '—';
  // Force UTC parse · evita off-by-1 (Postgres date sin TZ → JS Date interpreta UTC)
  const date = new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
  return date.toLocaleDateString('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
