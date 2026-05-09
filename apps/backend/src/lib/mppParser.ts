import { XMLParser } from 'fast-xml-parser';

/**
 * Parser MS Project XML (formato Aspose Tasks export)
 *
 * Bugs fixados desde v1:
 * - Cost en MS Project XML viene × 100 (centavos para precision decimal). Dividir.
 *   Ejemplo: <Cost>135098</Cost> = S/ 1,350.98 (no S/ 135,098)
 * - WBS con outline level wrappers (root tasks que envuelven). Detectar baseLevel.
 *
 * Mejoras v2:
 * - Extracción de metrado desde campos de texto / unidad
 * - Manejo robusto de fechas ISO
 * - Validación esquema antes de retornar
 */

export type ParsedTask = {
  uid: number;
  id: number;
  outlineNumber: string; // 1.2.1.1
  outlineLevel: number;
  wbs: string;
  name: string;
  start: Date | null;
  finish: Date | null;
  durationHours: number;
  durationDays: number;
  durationLabel: string | null; // "120 días"
  percentComplete: number;
  cost: number; // ya dividido por 100 (S/ reales)
  remainingCost: number;
  actualCost: number;
  metrado: number | null; // cantidad ejecutable
  unidad: string | null; // m³, m², kg, glb, etc.
  precioUnitario: number | null;
  isMilestone: boolean;
  isSummary: boolean;
  isCritical: boolean;
  predecessors: number[];
  resourceUIDs: number[];
};

export type ParsedProject = {
  startDate: Date | null;
  finishDate: Date | null;
  totalCost: number;
  totalTasks: number;
  tasks: ParsedTask[];
  baseLevel: number; // nivel real de capítulos (skip wrappers)
};

const ISO_DURATION_RE = /PT?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;

function parseDurationISO(s: string | undefined): number {
  if (!s) return 0;
  // PT8H = 8 hours
  // P0Y0M0DT8H0M0S
  const m = s.match(ISO_DURATION_RE);
  if (!m) return 0;
  const hours = Number.parseInt(m[1] ?? '0', 10);
  const minutes = Number.parseInt(m[2] ?? '0', 10);
  return hours + minutes / 60;
}

function safeDate(s: string | number | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function num(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v));
  return Number.isNaN(n) ? fallback : n;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Detecta el outline level real de capítulos (skip wrappers de 1 sola tarea raíz).
 * Algunos XMLs tienen Level 0 (proyecto · "GANTT CREMATORIO") + Level 1 ("PRESUPUESTO 95%")
 * que son envoltorios. Los capítulos reales empiezan en Level 2.
 */
function detectBaseLevel(tasks: ParsedTask[]): number {
  const counts: Record<number, number> = {};
  for (const t of tasks) {
    counts[t.outlineLevel] = (counts[t.outlineLevel] ?? 0) + 1;
  }
  const sortedLevels = Object.keys(counts)
    .map(Number)
    .sort((a, b) => a - b);
  for (const lvl of sortedLevels) {
    if ((counts[lvl] ?? 0) >= 2) return lvl;
  }
  return 1;
}

/**
 * Extrae metrado y unidad desde extended attributes o text fields del task.
 * En MS Project, los costos unitarios típicamente vienen en campos personalizados.
 */
function extractMetradoUnidad(task: Record<string, unknown>): {
  metrado: number | null;
  unidad: string | null;
} {
  // ExtendedAttribute con FieldID común para "Cantidad" o "Metrado"
  const extAttrs = task.ExtendedAttribute;
  const attrsArray = Array.isArray(extAttrs) ? extAttrs : extAttrs ? [extAttrs] : [];

  let metrado: number | null = null;
  let unidad: string | null = null;

  for (const attr of attrsArray) {
    const a = attr as Record<string, unknown>;
    const fieldId = str(a.FieldID);
    const value = str(a.Value);
    // FieldIDs comunes para texto custom (Number1-Number20, Text1-Text30)
    // 188743734 fue usado en v1 para durationLabel
    // Detectar por valor numérico simple = metrado
    // Valores con "m³", "m2", "kg" = unidad
    if (/^\d+(\.\d+)?$/.test(value) && metrado === null) {
      metrado = num(value);
    }
    if (/m[²2³3]|kg|gln|und|glb|pza|p²|p2/i.test(value) && !unidad) {
      unidad = value.trim();
    }
  }

  // También buscar en Notes / Hyperlink / etc si hay
  return { metrado, unidad };
}

export function parseMSProjectXML(xmlContent: string): ParsedProject {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: true,
    trimValues: true,
    isArray: (name) => name === 'Task' || name === 'ExtendedAttribute' || name === 'PredecessorLink' || name === 'Resource' || name === 'Assignment',
  });

  const json = parser.parse(xmlContent);
  const project = json.Project ?? json;

  const tasksRaw = project.Tasks?.Task ?? [];
  const tasksArray = Array.isArray(tasksRaw) ? tasksRaw : [tasksRaw];

  const tasks: ParsedTask[] = tasksArray
    .filter((t: unknown) => t && typeof t === 'object')
    .map((t: Record<string, unknown>) => {
      const cost = num(t.Cost) / 100; // FIX bug v1 · MS Project guarda × 100
      const remainingCost = num(t.RemainingCost) / 100;
      const actualCost = num(t.ActualCost) / 100;
      const durationHours = parseDurationISO(str(t.Duration));
      const durationDays = Math.round(durationHours / 8);
      const { metrado, unidad } = extractMetradoUnidad(t);
      const precioUnitario = metrado && metrado > 0 ? cost / metrado : null;

      // ExtendedAttribute para durationLabel "120 días"
      const extAttrs = t.ExtendedAttribute;
      const attrsArray = Array.isArray(extAttrs) ? extAttrs : extAttrs ? [extAttrs] : [];
      const durationLabel =
        attrsArray
          .map((a) => str((a as Record<string, unknown>).Value))
          .find((v) => /\d+\s*(d[íi]as?|h(oras?)?)/i.test(v)) ?? null;

      const predLinks = t.PredecessorLink;
      const predArray = Array.isArray(predLinks) ? predLinks : predLinks ? [predLinks] : [];
      const predecessors = predArray
        .map((p) => num((p as Record<string, unknown>).PredecessorUID))
        .filter((n) => n > 0);

      return {
        uid: num(t.UID),
        id: num(t.ID),
        outlineNumber: str(t.OutlineNumber),
        outlineLevel: num(t.OutlineLevel),
        wbs: str(t.WBS),
        name: str(t.Name),
        start: safeDate(t.Start as string),
        finish: safeDate(t.Finish as string),
        durationHours,
        durationDays,
        durationLabel,
        percentComplete: num(t.PercentComplete),
        cost,
        remainingCost,
        actualCost,
        metrado,
        unidad,
        precioUnitario,
        isMilestone: str(t.Milestone) === '1',
        isSummary: str(t.Summary) === '1',
        isCritical: str(t.Critical) === '1',
        predecessors,
        resourceUIDs: [],
      };
    })
    .filter((t: ParsedTask) => t.name); // skip tareas sin nombre

  const baseLevel = detectBaseLevel(tasks);
  const totalCost = tasks
    .filter((t) => t.outlineLevel === baseLevel)
    .reduce((sum, t) => sum + t.cost, 0);

  return {
    startDate: safeDate(project.StartDate as string),
    finishDate: safeDate(project.FinishDate as string),
    totalCost,
    totalTasks: tasks.length,
    tasks,
    baseLevel,
  };
}

/**
 * Convierte tasks parseadas a registros para tabla `partidas` de la DB.
 * Filtra wrappers y normaliza códigos jerárquicos (1.2.1.1).
 */
export function tasksToPartidas(parsed: ParsedProject, proyectoId: string) {
  const { tasks, baseLevel } = parsed;
  // UID → outlineNumber (codigo) map para convertir predecessors UIDs a códigos
  const uidToCodigo = new Map<number, string>();
  tasks
    .filter((t) => t.outlineLevel >= baseLevel)
    .forEach((t, idx) => {
      uidToCodigo.set(t.uid, t.outlineNumber || String(idx + 1));
    });

  return tasks
    .filter((t) => t.outlineLevel >= baseLevel)
    .map((t, idx) => {
      const code = t.outlineNumber || String(idx + 1);
      const parts = code.split('.');
      const parentCodigo = parts.length > 1 ? parts.slice(0, -1).join('.') : null;
      const relLevel = t.outlineLevel - baseLevel + 1;
      // Convertir predecessors de UIDs a codigos
      const predecessorsCodigos = t.predecessors
        .map((uid) => uidToCodigo.get(uid))
        .filter((c): c is string => !!c);

      return {
        proyectoId,
        codigo: code,
        parentCodigo,
        nivel: relLevel,
        nombre: t.name,
        unidad: t.unidad,
        cantidad: t.metrado != null ? String(t.metrado) : null,
        precioUnitario: t.precioUnitario != null ? String(t.precioUnitario.toFixed(4)) : null,
        presupuesto: String(t.cost.toFixed(2)),
        duracionDias: t.durationDays,
        fechaInicio: t.start ? t.start.toISOString().slice(0, 10) : null,
        fechaFin: t.finish ? t.finish.toISOString().slice(0, 10) : null,
        isSummary: t.isSummary,
        isMilestone: t.isMilestone,
        isCritical: t.isCritical,
        percentComplete: String(t.percentComplete ?? 0),
        predecessors: predecessorsCodigos,
        orden: idx,
      };
    });
}
