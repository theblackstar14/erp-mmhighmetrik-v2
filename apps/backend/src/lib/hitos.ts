/**
 * Detecta HITOS CONTRACTUALES sugeridos desde el cronograma del proyecto.
 *
 * Determinista (sin IA): clasifica el NOMBRE de las partidas/tareas (milestones,
 * resúmenes, hojas) contra los 7 tipos legales por keyword, y toma su fecha
 * planificada. Funciona con cualquier cronograma ya importado (de .mpp o Excel),
 * porque lee de las `partidas` persistidas, no del momento del upload.
 *
 * El usuario confirma cada sugerencia contra el acta real → se vuelve hito_obra.
 */
export const HITO_TIPOS = [
  'entrega_terreno', 'inicio_plazo', 'ampliacion_plazo', 'culminacion',
  'recepcion', 'liquidacion', 'consentimiento_liquidacion',
] as const;
export type HitoTipo = (typeof HITO_TIPOS)[number];

export interface HitoSugerido {
  tipo: HitoTipo;
  fechaPlan: string; // YYYY-MM-DD
  confianza: number; // 0–1 · solidez del match (gate de alertas)
  fuente: string; // nombre de la partida/tarea
  razon: string;
}

// Item neutro · una partida o tarea del cronograma con su nombre y fechas.
export interface HitoItem {
  nombre: string;
  isMilestone: boolean;
  inicio: string | null; // YYYY-MM-DD
  fin: string | null;
}

// Keyword → tipo. Orden importa (más específico primero).
// Patrones específicos · evitar falsos positivos (un hito legal mal puesto es peor que faltar).
const KW: Array<[HitoTipo, RegExp]> = [
  ['consentimiento_liquidacion', /CONSENTIMIENTO/i],
  ['liquidacion', /LIQUIDACI[OÓ]N (DE (LA )?)?OBRA|LIQUIDACI[OÓ]N FINAL|LIQUIDACI[OÓ]N DEL CONTRATO/i],
  ['recepcion', /RECEPCI[OÓ]N (DE (LA )?)?OBRA|ACTA.*RECEP/i],
  ['ampliacion_plazo', /AMPLIACI[OÓ]N (DE )?PLAZO/i],
  ['entrega_terreno', /ENTREGA.*TERRENO|ACTA.*TERRENO/i],
  ['inicio_plazo', /INICIO (DE (LA )?)?OBRA|INICIO (DEL )?PLAZO|ACTA.*INICIO/i],
  ['culminacion', /CULMINACI[OÓ]N (DE (LA )?)?OBRA|FIN DE (LA )?OBRA|T[EÉ]RMINO DE (LA )?OBRA/i],
];
// Tipos cuya fecha es el FIN de la tarea (eventos de cierre). El resto usa inicio.
const USA_FIN = new Set<HitoTipo>(['culminacion', 'recepcion', 'liquidacion', 'consentimiento_liquidacion']);

const d10 = (s: string | null): string | null => (s ? s.slice(0, 10) : null);

export function clasificarHitos(items: HitoItem[], proyInicio: string | null, proyFin: string | null): HitoSugerido[] {
  const out = new Map<HitoTipo, HitoSugerido>();
  const consider = (tipo: HitoTipo, fecha: string | null, fuente: string, confianza: number, razon: string) => {
    if (!fecha) return;
    const prev = out.get(tipo);
    if (!prev || confianza > prev.confianza) out.set(tipo, { tipo, fechaPlan: fecha, confianza, fuente, razon });
  };

  for (const it of items) {
    if (!it.nombre) continue;
    for (const [tipo, re] of KW) {
      if (!re.test(it.nombre)) continue;
      const fecha = d10(USA_FIN.has(tipo) ? (it.fin ?? it.inicio) : (it.inicio ?? it.fin));
      const conf = it.isMilestone ? 0.9 : 0.75;
      consider(tipo, fecha, it.nombre, conf, it.isMilestone ? 'Hito marcado en el cronograma.' : 'Tarea del cronograma.');
    }
  }
  // inicio/culminación a falta de tarea con nombre: deriva de las fechas del proyecto.
  if (!out.has('inicio_plazo') && proyInicio) consider('inicio_plazo', d10(proyInicio), 'Inicio del cronograma', 0.5, 'Fecha de inicio del proyecto.');
  if (!out.has('culminacion') && proyFin) consider('culminacion', d10(proyFin), 'Fin del cronograma', 0.5, 'Fecha de fin del proyecto.');
  return [...out.values()];
}

// ponytail: deja la verificación de la lógica de clasificación.
export function _demo(): void {
  const items: HitoItem[] = [
    { nombre: 'ENTREGA DE TERRENO', isMilestone: true, inicio: '2026-04-01', fin: '2026-04-01' },
    { nombre: 'RECEPCIÓN DE OBRA', isMilestone: true, inicio: '2026-12-20', fin: '2026-12-25' },
    { nombre: 'Excavación masiva', isMilestone: false, inicio: '2026-05-01', fin: '2026-06-01' },
  ];
  const r = clasificarHitos(items, '2026-04-01', '2026-12-31');
  const byTipo = new Map(r.map((s) => [s.tipo, s]));
  if (byTipo.get('entrega_terreno')?.fechaPlan !== '2026-04-01') throw new Error('entrega_terreno usa inicio');
  if (byTipo.get('recepcion')?.fechaPlan !== '2026-12-25') throw new Error('recepcion usa fin');
  if (!byTipo.get('inicio_plazo')) throw new Error('inicio derivado del proyecto');
  if (byTipo.get('culminacion')?.fechaPlan !== '2026-12-31') throw new Error('culminacion derivada del fin');
  console.log('hitos._demo ok', r.length);
}
