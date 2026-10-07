/**
 * Parser del plan de cuentas de CONTASIS.
 *
 * El Excel que manda Kelly ES el esquema de su tabla: fila 1 títulos, fila 2 tipos
 * (`C (20,0)`), fila 3 NOMBRES DE COLUMNA de su DB, datos desde la fila 5.
 * Se mapea por el nombre de columna de la fila 3, no por índice: las posiciones cambian
 * entre versiones del export, los nombres no.
 *
 * Puro: no toca DB ni filesystem. Recibe el buffer, devuelve filas listas para upsert.
 * Spec: docs/superpowers/specs/2026-10-07-contasis-espejo-design.md §3.1
 */
import * as XLSX from 'xlsx';

export type CuentaContasis = {
  codigo: string;
  descripcion: string;
  tipo: string;
  nivel: number;
  parentCodigo: string | null;
  clasificable: boolean;
  contasisNivel: number | null;
  contasisTipo: number | null;
  contasisAnalisis: number | null;
  destinoDebe: string | null;
  destinoHaber: string | null;
  exigeCentroCosto: boolean;
  codBalance1: string | null;
  codBalance2: string | null;
  cuentaCierre: string | null;
};

// Elemento (primer dígito) → nuestro `tipo`. `plan_contable.tipo` es NOT NULL, así que
// los elementos 0 (cuentas de orden) y 8 (saldos intermediarios) TAMBIÉN necesitan valor:
// sin esto el INSERT revienta a mitad de las 2068 nuevas. Nadie hace switch sobre `tipo`
// (se pasa tal cual en contabilidad.ts:192), así que sumar dos valores es seguro.
const TIPO_POR_ELEMENTO: Record<string, string> = {
  '0': 'Orden',
  '1': 'Activo',
  '2': 'Activo',
  '3': 'Activo',
  '4': 'Pasivo',
  '5': 'Patrimonio',
  '6': 'Gasto',
  '7': 'Ingreso',
  '8': 'Resultado',
  '9': 'Costo',
};

/**
 * Un código que aparece dos veces en el export de Kelly. `ccodcue` es su PK declarada, así
 * que su tabla no podría tener las dos filas: el Excel no es un dump fiel. Nos quedamos con
 * la primera y devolvemos esto para que el loader lo imprima — elegir en silencio sería
 * decidir en qué clase cae un gasto sin que nadie lo vea (ver `difiereEnDestino`).
 */
export type DuplicadoPlan = {
  codigo: string;
  conservada: CuentaContasis;
  descartada: CuentaContasis;
  /** true = las dos filas mandan el gasto a destinos distintos. Pregunta para Kelly, no la decidimos. */
  difiereEnDestino: boolean;
};

export function tipoPorElemento(codigo: string): string {
  return TIPO_POR_ELEMENTO[codigo[0]!] ?? 'Orden';
}

const txt = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim(); // todo viene padded a ancho fijo: C (20,0), C (100,0)…
  return s === '' ? null : s;
};
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function parsePlanContasis(buf: Buffer): { cuentas: CuentaContasis[]; duplicados: DuplicadoPlan[] } {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets['Plan de Cuentas'];
  if (!ws) throw new Error(`hoja 'Plan de Cuentas' no encontrada · hojas: ${wb.SheetNames.join(', ')}`);

  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
  // fila 3 (índice 2) = nombres de columna de su DB
  const cols = (raw[2] ?? []).map((c) => (c == null ? '' : String(c).trim()));
  const idx = (nombre: string): number => {
    const i = cols.indexOf(nombre);
    if (i < 0) throw new Error(`columna '${nombre}' no está en el archivo · columnas: ${cols.filter(Boolean).join(', ')}`);
    return i;
  };
  const C = {
    cod: idx('ccodcue'), desc: idx('cdescue'), niv: idx('nnivcue'), tip: idx('ntipcue'),
    ana: idx('nanacue'), bal1: idx('ccodbal1'), bal2: idx('ccodbal2'),
    deb: idx('cdesdeb'), hab: idx('cdeshab'), cos: idx('nafecos'), cie: idx('ccuecie'),
  };
  // ponytail: `cper` (2026) se ignora a propósito. El plan es un catálogo, no una serie
  // temporal; si 2027 difiere se recarga. Si alguna vez hay que ver dos años a la vez,
  // `periodo_plan` entra a la PK y se migra — no antes. Spec §3.1.

  // datos desde la fila 5 (índice 4); filas sin código son separadores
  const filas = raw.slice(3).filter((r) => txt(r[C.cod]) !== null);

  const codigos = new Set(filas.map((r) => txt(r[C.cod])!));

  // El padre es el prefijo EXISTENTE más largo, no el de largo−1: 6011020 cuelga de 6011
  // porque 601102 y 60110 no existen en el catálogo. Si se usara largo−1, el rollup del
  // árbol de cuentas quedaría colgando de un padre inexistente.
  const padreDe = (codigo: string): string | null => {
    for (let n = codigo.length - 1; n >= 1; n--) {
      const p = codigo.slice(0, n);
      if (codigos.has(p)) return p;
    }
    return null;
  };

  const fila = (r: unknown[]): CuentaContasis => {
    const codigo = txt(r[C.cod])!;
    return {
      codigo,
      descripcion: txt(r[C.desc]) ?? codigo,
      tipo: tipoPorElemento(codigo),
      // nuestra convención de nivel es por largo del código: '10'→1, '101'→2, '1041'→3, '10411'→4
      nivel: codigo.length - 1,
      parentCodigo: padreDe(codigo),
      // regla WS0: clasificable = cuenta de gasto/costo (elemento 6 o 9) · alimenta derivarClase
      clasificable: codigo[0] === '6' || codigo[0] === '9',
      contasisNivel: num(r[C.niv]),
      contasisTipo: num(r[C.tip]),
      contasisAnalisis: num(r[C.ana]),
      destinoDebe: txt(r[C.deb]),
      destinoHaber: txt(r[C.hab]),
      exigeCentroCosto: num(r[C.cos]) !== null,
      codBalance1: txt(r[C.bal1]),
      codBalance2: txt(r[C.bal2]),
      cuentaCierre: txt(r[C.cie]),
    };
  };

  // Dedupe: la primera gana, el resto se reporta. Sin esto el INSERT revienta contra la PK.
  const porCodigo = new Map<string, CuentaContasis>();
  const duplicados: DuplicadoPlan[] = [];
  for (const r of filas) {
    const c = fila(r);
    const previa = porCodigo.get(c.codigo);
    if (previa) {
      duplicados.push({
        codigo: c.codigo,
        conservada: previa,
        descartada: c,
        difiereEnDestino: previa.destinoDebe !== c.destinoDebe || previa.destinoHaber !== c.destinoHaber,
      });
      continue;
    }
    porCodigo.set(c.codigo, c);
  }
  return { cuentas: [...porCodigo.values()], duplicados };
}
