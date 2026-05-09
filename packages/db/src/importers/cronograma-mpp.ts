/**
 * Parser cronograma MPP · usando JSON ya convertido por MPXJ
 *
 * Bugs identificados en parser previo (mppParser.ts) y FIXES aplicados:
 *  ✓ Bug 1: Cost en JSON MPXJ viene en valor REAL decimal (NO ÷ 100 como XML)
 *  ✓ Bug 2: Duration en SEGUNDOS work-time (8h/día). Convertir: sec/3600/8 = días
 *  ✓ Bug 3: Wrappers 2 niveles ("1" PRESUPUESTO + "1.x" subpresupuestos virtuales)
 *  ✓ Bug 4: outline_number formato distinto · MPP "1.2.1.1.1.1" vs Excel "01.01.01.01"
 *  ✓ Bug 5: Hito "Inicio de Obra" sin código · skip
 *
 * Estrategia match con partidas BD:
 *  - Match por NOMBRE normalizado (trim · uppercase · single-space)
 *  - Fallback: match por código convertido si nombre falla
 *  - NO sobrescribir partidas · solo UPDATE fechas + duración + costo MPP
 */
import { Decimal } from 'decimal.js';

export interface MppTask {
  id: number | null;
  unique_id?: number;
  outline_number: string | number | null;
  outline_level: number | null;
  name: string | null;
  duration: number | null; // en segundos work-time
  start: string | null; // ISO
  finish: string | null; // ISO
  cost: number | null;
  milestone?: boolean;
  summary?: boolean;
  critical?: boolean;
  predecessors?: Array<{
    unique_id: number;
    predecessor_task_unique_id: number;
    successor_task_unique_id: number;
    type?: string;
  }>;
}

export interface MppParseResult {
  totalTasks: number;
  tasksRelevantes: number;
  totalCost: number;
  startDate: Date | null;
  finishDate: Date | null;
  durationDays: number;
  tasks: MppTaskNormalized[];
  errors: string[];
  warnings: string[];
}

export interface MppTaskNormalized {
  uniqueId: number;
  outlineMpp: string; // "1.2.1.1.1.1"
  codigoExcel: string | null; // "01.01.01.01" (convertido)
  nombre: string;
  nombreNormalizado: string;
  outlineLevel: number;
  fechaInicio: Date | null;
  fechaFin: Date | null;
  duracionDias: number;
  cost: number;
  isMilestone: boolean;
  isSummary: boolean;
  isCritical: boolean;
  predecessorIds: number[]; // unique_ids del MPP
}

/**
 * Convierte segundos work-time MPXJ a días calendario.
 * MS Project usa 8h/día · 3427200 sec = 952 horas / 8 = 119 días
 */
function segundosToDias(seg: number | null): number {
  if (!seg || seg <= 0) return 0;
  return Math.round(seg / 3600 / 8);
}

/**
 * Normaliza nombre para match: uppercase, trim, colapsa espacios.
 * Quita acentos y caracteres no alfanuméricos opcional.
 */
export function normalizeName(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // sin acentos
    .toUpperCase()
    .replace(/[^\w\s.]/g, ' ') // alfanum + punto · resto a space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Convierte outline MPP "1.2.1.1.1.1" → código Excel "01.01.01.01"
 *
 * Estructura wrapper detectada en MPP PG0005:
 *   - segments[0] = "1" wrapper PRESUPUESTO root · skip
 *   - segments[1] = "2..6" subpresupuesto MPP · convertir restando 1: 2→01, 3→02, 4→03, 5→04, 6→05
 *   - segments[2] = "1" sub-wrapper duplicado · skip
 *   - segments[3..] = jerarquía real Excel · padear a 2 dígitos
 *
 * Ejemplos:
 *   "1.2.1.1.1.1" → "01.01.01.01"
 *   "1.3.1.1.3.1.2" → "02.01.03.01.02"
 *   "1.2" → "01" (título nivel 1)
 *   "1.2.1.1" → "01.01" (título nivel 2)
 */
export function convertirOutlineMppACodigo(outlineMpp: string | number | null): string | null {
  if (outlineMpp === null || outlineMpp === undefined) return null;
  const s = String(outlineMpp);
  const segments = s.split('.');

  // outlines tipo "0" o "1" son wrappers root · sin código Excel
  if (segments.length < 2) return null;
  if (segments[0] !== '1') return null; // raíz siempre debe ser "1"

  // Hitos nivel 2: "1.1" Inicio Obra, "1.7" Fin Obra · códigos especiales con prefijo "00"
  // Subpresupuestos: "1.2..6" → Excel 01..05 (restar 1)
  const subpresMpp = Number.parseInt(segments[1], 10);
  if (!Number.isFinite(subpresMpp)) return null;
  if (subpresMpp < 2) {
    // Hito nivel 2 (ej. 1.1 Inicio · 1.7 podría ser fin)
    // Usar prefijo "00" + número para que NO colisione con códigos S10
    if (segments.length === 2) return `00.HITO.${subpresMpp}`;
    return null;
  }
  // Si es subpresupuesto fuera de rango (>5 = 6) probablemente es hito (ej "1.7" Termino)
  if (subpresMpp > 6 && segments.length === 2) {
    return `00.HITO.${subpresMpp}`;
  }
  const subpresExcel = String(subpresMpp - 1).padStart(2, '0');

  // Sin más segmentos = título nivel 1 ("01")
  if (segments.length === 2) return subpresExcel;

  // Skip wrapper segments[2] = "1" (sub-wrapper duplicado)
  // Resto = jerarquía Excel
  const restoSegments = segments.slice(3);
  if (restoSegments.length === 0) {
    // "1.2.1" → wrapper sub · NO genera código (el código sería duplicado de "1.2")
    return null;
  }

  const restoFormateado = restoSegments.map((seg) => seg.padStart(2, '0')).join('.');
  return `${subpresExcel}.${restoFormateado}`;
}

function safeDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseMppJson(jsonContent: string | object): MppParseResult {
  const data = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;
  const result: MppParseResult = {
    totalTasks: 0,
    tasksRelevantes: 0,
    totalCost: 0,
    startDate: null,
    finishDate: null,
    durationDays: 0,
    tasks: [],
    errors: [],
    warnings: [],
  };

  const rawTasks: MppTask[] = data.tasks ?? [];
  result.totalTasks = rawTasks.length;

  // Detectar root project task · outline_number = "0" (no tiene 'id' field)
  const rootTask = rawTasks.find(
    (t) => String(t.outline_number ?? '') === '0' || (t as { unique_id?: number }).unique_id === 0,
  );
  if (rootTask) {
    result.startDate = safeDate(rootTask.start);
    result.finishDate = safeDate(rootTask.finish);
    result.durationDays = segundosToDias(rootTask.duration);
    result.totalCost = rootTask.cost ?? 0;
  } else {
    result.warnings.push('Root task no detectado (sin outline_number=0)');
  }

  // Filtrar tasks relevantes
  // Incluir: outline ≥ 3 segmentos (partidas reales)
  // + Milestones de nivel 2 (Inicio Obra · Termino Obra · etc) que son hitos cronograma
  const sumaCalculada = new Decimal(0);
  for (const t of rawTasks) {
    const outlineMpp = t.outline_number;
    if (outlineMpp === null || outlineMpp === undefined) continue;
    const outlineStr = String(outlineMpp);
    const segments = outlineStr.split('.');

    // Skip wrapper root (outline "0" o "1")
    if (segments.length < 2) continue;

    // Skip wrappers internos · pero SÍ incluir milestones de cualquier nivel
    const esRelevante = segments.length >= 3 || !!t.milestone;
    if (!esRelevante) continue;

    const codigoExcel = convertirOutlineMppACodigo(outlineMpp);
    const nombre = (t.name ?? '').trim();
    if (!nombre) continue;

    const fechaInicio = safeDate(t.start);
    const fechaFin = safeDate(t.finish);
    const duracionDias = segundosToDias(t.duration);
    const cost = t.cost ?? 0;

    // Predecesores · array de unique_ids
    const predecessorIds = (t.predecessors ?? [])
      .map((p) => p.predecessor_task_unique_id)
      .filter((id): id is number => typeof id === 'number' && id > 0);

    result.tasks.push({
      uniqueId: t.unique_id ?? 0,
      outlineMpp: outlineStr,
      codigoExcel,
      nombre,
      nombreNormalizado: normalizeName(nombre),
      outlineLevel: t.outline_level ?? 0,
      fechaInicio,
      fechaFin,
      duracionDias,
      cost,
      isMilestone: !!t.milestone,
      isSummary: !!t.summary,
      isCritical: !!t.critical,
      predecessorIds,
    });

    if (!t.summary) {
      sumaCalculada.add(cost);
    }
  }

  result.tasksRelevantes = result.tasks.length;

  // Validaciones
  if (result.totalCost === 0) {
    result.warnings.push('totalCost del root task = 0 · puede no estar disponible');
  }

  return result;
}
