/**
 * PLE SUNAT · genera los TXT de Libros Electrónicos (PLE 5.x).
 * Libros: 5.1 Diario · 6.1 Mayor · 8.1 Registro de Compras · 14.1 Registro de Ventas.
 *
 * Estructura de campos = RS 286-2009/SUNAT y modificatorias (línea base aceptada por PLE 5.x).
 * ponytail: cada libro es UN array de campos explícito. Si el validador SUNAT marca un campo,
 *           se corrige en su array — no hay magia escondida. VALIDAR contra el PLE del contador.
 *
 * Formato TXT: campos separados por "|" CON pipe final, líneas en CRLF, montos con punto y 2 dec.
 */

const EMPRESA_RUC = '20610639764';
const IGV_PCT = 18;

// ── helpers de formato ──────────────────────────────────────
const pipe = (campos: (string | number)[]) => campos.map((c) => (typeof c === 'number' ? c.toFixed(2) : c)).join('|') + '|';
const n2 = (x: unknown) => Number(x ?? 0); // los montos van como number → pipe() los formatea
const dmy = (iso: string | null | undefined) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : '';
};
const periodoTxt = (periodo: string) => periodo.replace('-', '') + '00'; // 2026-01 → 20260100

// Tabla 10 · tipo de comprobante (los que usa MM)
function tablaComprobante(t: string | null | undefined): string {
  const s = (t ?? '').toLowerCase();
  if (s.includes('factura')) return '01';
  if (s.includes('recibo') && s.includes('honorario')) return '02';
  if (s.includes('boleta')) return '03';
  if (s.includes('liquidaci')) return '04';
  if (s.includes('nota') && s.includes('cr')) return '07';
  if (s.includes('nota') && s.includes('d')) return '08';
  if (s.includes('ticket')) return '12';
  return '00'; // otros · ponytail: ampliar mapa si aparecen más tipos
}

// Tabla 2 · tipo de documento de identidad por longitud del número
function tablaDocIdentidad(num: string | null | undefined): string {
  const d = (num ?? '').replace(/\D/g, '');
  if (d.length === 11) return '6'; // RUC
  if (d.length === 8) return '1'; // DNI
  if (d.length > 0) return '0'; // otros
  return '0';
}

// ── tipos de entrada (filas normalizadas por la ruta) ───────
export type FilaCompra = {
  fecha: string; tipoComprobante: string | null; serie: string | null; numero: string | null;
  proveedorRuc: string | null; proveedorRazon: string | null;
  baseGravada: number; igv: number; noGravado: number; total: number; moneda: string | null; tipoCambio: number | null;
};
export type FilaVenta = {
  fecha: string; tipoComprobante: string; serie: string; numero: string;
  clienteRuc: string | null; clienteRazon: string | null;
  baseGravada: number; igv: number; exonerado: number; total: number; tipoCambio: number | null;
};
export type FilaDiario = {
  cuo: string; correlativoAsiento: string; fecha: string; glosa: string;
  cuenta: string; debe: number; haber: number;
};

// ── 8.1 REGISTRO DE COMPRAS (080100) · 31 campos ────────────
export function compras80100(periodo: string, filas: FilaCompra[]): string {
  const P = periodoTxt(periodo);
  return filas.map((f, i) => {
    const cuo = String(i + 1);
    return pipe([
      P,                                  // 1 Periodo
      cuo,                                // 2 CUO
      `M${cuo}`,                          // 3 Correlativo del asiento / código de operación
      dmy(f.fecha),                       // 4 Fecha de emisión
      '',                                 // 5 Fecha de vencimiento/pago
      tablaComprobante(f.tipoComprobante),// 6 Tipo CP (Tabla 10)
      f.serie ?? '',                      // 7 Serie
      '',                                 // 8 Año DUA/DSI
      f.numero ?? '',                     // 9 Número CP
      tablaDocIdentidad(f.proveedorRuc),  // 10 Tipo doc identidad proveedor (Tabla 2)
      f.proveedorRuc ?? '',               // 11 Número doc proveedor
      f.proveedorRazon ?? '',             // 12 Razón social proveedor
      n2(f.baseGravada),                  // 13 BI gravada destinada a operac. gravadas
      n2(f.igv),                          // 14 IGV de 13
      0,                                  // 15 BI gravada destinada a gravadas y no gravadas
      0,                                  // 16 IGV de 15
      0,                                  // 17 BI gravada destinada a no gravadas
      0,                                  // 18 IGV de 17
      n2(f.noGravado),                    // 19 Valor adquisiciones no gravadas
      0,                                  // 20 ISC
      0,                                  // 21 Otros tributos y cargos
      n2(f.total),                        // 22 Importe total
      '',                                 // 23 N° CP sujeto no domiciliado
      '',                                 // 24 N° constancia depósito detracción
      '',                                 // 25 Fecha constancia detracción
      f.tipoCambio ? n2(f.tipoCambio) : 0,// 26 Tipo de cambio
      '',                                 // 27 Fecha CP modificado
      '',                                 // 28 Tipo CP modificado
      '',                                 // 29 Serie CP modificado
      '',                                 // 30 Número CP modificado
      '1',                                // 31 Estado (1 = anotado oportunamente)
    ]);
  }).join('\r\n');
}

// ── 14.1 REGISTRO DE VENTAS E INGRESOS (140100) · 29 campos ─
export function ventas140100(periodo: string, filas: FilaVenta[]): string {
  const P = periodoTxt(periodo);
  return filas.map((f, i) => {
    const cuo = String(i + 1);
    return pipe([
      P,                                  // 1 Periodo
      cuo,                                // 2 CUO
      `M${cuo}`,                          // 3 Correlativo del asiento
      dmy(f.fecha),                       // 4 Fecha de emisión
      '',                                 // 5 Fecha de vencimiento/pago
      tablaComprobante(f.tipoComprobante),// 6 Tipo CP (Tabla 10)
      f.serie,                            // 7 Serie
      f.numero,                           // 8 Número CP
      tablaDocIdentidad(f.clienteRuc),    // 9 Tipo doc identidad cliente
      f.clienteRuc ?? '',                 // 10 Número doc cliente
      f.clienteRazon ?? '',               // 11 Razón social cliente
      0,                                  // 12 Valor facturado exportación
      n2(f.baseGravada),                  // 13 BI operación gravada
      0,                                  // 14 Descuento BI
      n2(f.igv),                          // 15 IGV/IPM
      0,                                  // 16 Descuento IGV
      n2(f.exonerado),                    // 17 Importe exonerado
      0,                                  // 18 Importe inafecto
      0,                                  // 19 ISC
      0,                                  // 20 BI IVAP (arroz)
      0,                                  // 21 IGV IVAP
      0,                                  // 22 Otros tributos
      n2(f.total),                        // 23 Importe total
      f.tipoCambio ? n2(f.tipoCambio) : 0,// 24 Tipo de cambio
      '',                                 // 25 Fecha CP modificado
      '',                                 // 26 Tipo CP modificado
      '',                                 // 27 Serie CP modificado
      '',                                 // 28 Número CP modificado
      '1',                                // 29 Estado
    ]);
  }).join('\r\n');
}

// ── 5.1 LIBRO DIARIO (050100) · 14 campos ───────────────────
export function diario50100(periodo: string, filas: FilaDiario[]): string {
  const P = periodoTxt(periodo);
  return filas.map((f) => pipe([
    P,                  // 1 Periodo
    f.cuo,              // 2 CUO
    f.correlativoAsiento, // 3 Correlativo del asiento (M####)
    dmy(f.fecha),       // 4 Fecha de la operación
    f.glosa,            // 5 Glosa
    '',                 // 6 Glosa referencial
    f.cuenta,           // 7 Código de la cuenta contable
    '',                 // 8 Código libro de referencia (Tabla 8)
    '',                 // 9 Correlativo de la operación de referencia
    '',                 // 10 Número del documento sustentatorio
    n2(f.debe),         // 11 Debe
    n2(f.haber),        // 12 Haber
    '1',                // 13 Estado de la operación
  ])).join('\r\n');
}

// ── 6.1 LIBRO MAYOR (060100) · 8 campos ─────────────────────
export function mayor60100(periodo: string, filas: FilaDiario[]): string {
  const P = periodoTxt(periodo);
  return filas.map((f) => pipe([
    P,            // 1 Periodo
    f.cuo,        // 2 CUO
    '5',          // 3 Código del libro de origen (Tabla 8 · 5 = Libro Diario)
    f.correlativoAsiento, // 4 Correlativo de la operación de origen
    f.cuenta,     // 5 Código de la cuenta contable
    n2(f.debe),   // 6 Debe
    n2(f.haber),  // 7 Haber
    '1',          // 8 Estado
  ])).join('\r\n');
}

// ── nombre del archivo PLE ──────────────────────────────────
// LE + RUC(11) + AAAAMMDD + libro(6) + correlativo(2) + indOperac + indContenido + indMoneda + indLibro + .txt
export function nombreArchivo(periodo: string, libroCodigo: string, conOperaciones: boolean): string {
  const aaaammdd = periodo.replace('-', '') + '00';
  const indOper = conOperaciones ? '1' : '0';
  // sufijo: indOperaciones · indContenido(1) · indMoneda(1=PEN) · indLibroElectrónico(1)
  return `LE${EMPRESA_RUC}${aaaammdd}${libroCodigo}00${indOper}111.txt`;
}

export const LIBROS = {
  '5.1': { codigo: '050100', nombre: 'Libro Diario' },
  '6.1': { codigo: '060100', nombre: 'Libro Mayor' },
  '8.1': { codigo: '080100', nombre: 'Registro de Compras' },
  '14.1': { codigo: '140100', nombre: 'Registro de Ventas e Ingresos' },
} as const;
export type LibroKey = keyof typeof LIBROS;

export const IGV_TASA = IGV_PCT;

// ── self-check (tsx apps/backend/src/lib/ple.ts) ────────────
if (process.argv[1]?.replace(/\\/g, '/').endsWith('lib/ple.ts')) {
  const assert = (c: boolean, m: string) => { if (!c) { throw new Error('FAIL: ' + m); } };
  // pipe final presente + montos a 2 decimales
  const l = pipe(['202601 00', 1, 'x', 123.5]);
  assert(l === '202601 00|1.00|x|123.50|', 'pipe/format: ' + l);
  // compras: 31 campos (30 pipes internos + el final) → 31 segmentos al hacer split sin el vacío final
  const c = compras80100('2026-01', [{ fecha: '2026-01-15', tipoComprobante: 'Factura', serie: 'F001', numero: '123', proveedorRuc: '20123456789', proveedorRazon: 'ACME SAC', baseGravada: 100, igv: 18, noGravado: 0, total: 118, moneda: 'PEN', tipoCambio: null }]);
  assert(c.split('|').length - 1 === 31, 'compras campos=' + (c.split('|').length - 1));
  assert(c.startsWith('20260100|1|M1|15/01/2026|'), 'compras prefijo: ' + c.slice(0, 30));
  assert(c.includes('|01|F001||123|6|20123456789|ACME SAC|100.00|18.00|'), 'compras cuerpo');
  // ventas: 29 campos
  const v = ventas140100('2026-01', [{ fecha: '2026-01-20', tipoComprobante: 'Factura', serie: 'F001', numero: '9', clienteRuc: '20100000001', clienteRazon: 'MUNI X', baseGravada: 1000, igv: 180, exonerado: 0, total: 1180, tipoCambio: null }]);
  assert(v.split('|').length - 1 === 29, 'ventas campos=' + (v.split('|').length - 1));
  // diario 13, mayor 8
  const d = diario50100('2026-01', [{ cuo: '1', correlativoAsiento: 'M1', fecha: '2026-01-15', glosa: 'compra', cuenta: '601201', debe: 100, haber: 0 }]);
  assert(d.split('|').length - 1 === 13, 'diario campos=' + (d.split('|').length - 1));
  const m = mayor60100('2026-01', [{ cuo: '1', correlativoAsiento: 'M1', fecha: '2026-01-15', glosa: '', cuenta: '601201', debe: 100, haber: 0 }]);
  assert(m.split('|').length - 1 === 8, 'mayor campos=' + (m.split('|').length - 1));
  // nombre archivo
  const nom = nombreArchivo('2026-01', '080100', true);
  assert(nom === 'LE2061063976420260100080100001111.txt', 'nombre: ' + nom);
  console.log('ple.ts self-check OK ·', nom);
}
