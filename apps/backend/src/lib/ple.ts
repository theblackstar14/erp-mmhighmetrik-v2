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
// el pipe es el separador del formato: un '|' o salto de línea DENTRO de un campo (glosas largas) rompe la fila.
// La data trae además entidades HTML sin decodificar («4 &quot ROJO») y caracteres de control que el
// validador PLE rechaza — se limpian aquí, en la única puerta de salida del TXT.
const ENT: Record<string, string> = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' };
// Mojibake ALMACENADO en la DB (PERÃš = UTF-8 leído como Windows-1252 en algún import viejo).
// Se repara POR PARES (Ã/Â + continuación), no por cadena completa: la misma glosa suele mezclar
// mojibake con latin1 legítimo (·, tildes) y una re-decodificación total fallaría siempre.
const CP1252: Record<string, number> = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };
const reparaMojibake = (s: string): string => s.replace(/[ÂÃ](.)/g, (par, seg: string) => {
  const b2 = CP1252[seg] ?? seg.codePointAt(0)!;
  if (b2 < 0x80 || b2 > 0xbf) return par; // segundo char no es continuación UTF-8 → texto legítimo
  const ch = Buffer.from([par.codePointAt(0)!, b2]).toString('utf8');
  return ch.includes('�') ? par : ch;
});
const sinPipes = (c: string | number) => {
  if (typeof c !== 'string') return c;
  return reparaMojibake(c)
    .replace(/&#(\d+);?/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&(quot|amp|lt|gt|apos|nbsp);?/gi, (_, e) => ENT[e.toLowerCase()]!)
    .replace(/[|\u0000-\u001f\u00a0]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
};
// SUNAT exige los TXT en ANSI (ISO-8859-1): servirlos en UTF-8 corrompe las tildes y el PLE los
// rechaza. Puntuación tipográfica se degrada a ASCII; lo que no quepa en latin1 termina en '?'.
export const toAnsi = (s: string): Buffer => Buffer.from(
  s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/[^\r\n -ÿ]/g, '?'),
  'latin1',
);
const pipe = (campos: (string | number)[]) => campos.map((c) => (typeof c === 'number' ? c.toFixed(2) : sinPipes(c))).join('|') + '|';
// Correlativo del asiento (campo 3): inicia A/M/C; derivado SIEMPRE de los dígitos del CUO para que
// Diario, Compras y Ventas produzcan el mismo valor por operación (SUNAT cruza los libros por CUO+correlativo).
const corrM = (cuo: string) => `M${cuo.replace(/\D/g, '') || '1'}`;
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
  // F3.5 · destino del crédito fiscal (columnas 14-19 oficiales) + constancia detracción + doc modificado (NC)
  destinoCredito?: 'DG' | 'DGNG' | 'DNG';
  constanciaNumero?: string | null; constanciaFecha?: string | null;
  modSerie?: string | null; modNumero?: string | null;
  // F8 · estructura oficial 41 campos
  fechaVencimiento?: string | null;
  sujetoRetencion?: boolean;      // campo 33 · marca del CP sujeto a retención (agente)
  estado?: '1' | '6' | '9';       // campo 41 · 1 oportuno · 6 emitido antes, anotado en plazo (periodoContable) · 9 ajuste
  // F8.1 · cruce de libros: CUO = correlativo del asiento con el que la factura se centralizó en el
  // Diario (mismo valor en campo 2 de ambos libros, o SUNAT marca inconsistencia). Sin asiento → índice.
  cuo?: string | null;
};
export type FilaVenta = {
  fecha: string; tipoComprobante: string; serie: string; numero: string;
  clienteRuc: string | null; clienteRazon: string | null;
  baseGravada: number; igv: number; exonerado: number; total: number; tipoCambio: number | null;
  fechaVencimiento?: string | null; proyectoCodigo?: string | null; detraccion?: number | null;
  // F8 · estructura oficial 34 campos
  moneda?: string | null;
  modSerie?: string | null; modNumero?: string | null; // NC/ND: comprobante que modifica
  contrato?: string | null;                            // campo 31 · identificación del contrato/proyecto
  cuo?: string | null;                                 // F8.1 · cruce con el Diario (ver FilaCompra.cuo)
};
export type FilaDiario = {
  cuo: string; correlativoAsiento: string; fecha: string; glosa: string;
  cuenta: string; debe: number; haber: number;
  // F8 · estructura oficial (21 campos): tercero y comprobante del asiento — "de corresponder"
  moneda?: string | null; contraparteDoc?: string | null; tipoDoc?: string | null;
  serie?: string | null; numero?: string | null; fechaVenc?: string | null;
};

// ── 8.1 REGISTRO DE COMPRAS (080100) · 31 campos ────────────
// F8 · estructura OFICIAL del Anexo 2 (PLE Ver 5) · 41 campos. Destino del crédito en 14-19,
// constancia de detracción en 31 (FECHA) y 32 (NÚMERO) — el orden oficial, no el que asumimos antes.
export function compras80100(periodo: string, filas: FilaCompra[]): string {
  const P = periodoTxt(periodo);
  return filas.map((f, i) => {
    const cuo = f.cuo ?? String(i + 1);
    const dc = f.destinoCredito ?? 'DG';
    return pipe([
      P,                                  // 1 Periodo
      cuo,                                // 2 CUO (= campo 2 del Diario si la compra ya se centralizó)
      corrM(cuo),                         // 3 Correlativo del asiento (inicia en M)
      dmy(f.fecha),                       // 4 Fecha de emisión
      f.fechaVencimiento ? dmy(f.fechaVencimiento) : '', // 5 Fecha de vencimiento o pago
      tablaComprobante(f.tipoComprobante),// 6 Tipo CP (Tabla 10)
      f.serie ?? '',                      // 7 Serie (o código dependencia DUA)
      '',                                 // 8 Año de emisión DUA/DSI
      f.numero ?? '',                     // 9 Número CP
      '',                                 // 10 Importe total operaciones diarias sin derecho a crédito (opcional)
      tablaDocIdentidad(f.proveedorRuc),  // 11 Tipo doc identidad proveedor (Tabla 2)
      f.proveedorRuc ?? '',               // 12 Número RUC / doc proveedor
      f.proveedorRazon ?? '',             // 13 Razón social proveedor
      dc === 'DG' ? n2(f.baseGravada) : 0,   // 14 BI destinada a operaciones gravadas
      dc === 'DG' ? n2(f.igv) : 0,           // 15 IGV de 14
      dc === 'DGNG' ? n2(f.baseGravada) : 0, // 16 BI destinada a gravadas y no gravadas
      dc === 'DGNG' ? n2(f.igv) : 0,         // 17 IGV de 16
      dc === 'DNG' ? n2(f.baseGravada) : 0,  // 18 BI destinada a no gravadas
      dc === 'DNG' ? n2(f.igv) : 0,          // 19 IGV de 18
      n2(f.noGravado),                    // 20 Valor adquisiciones no gravadas
      0,                                  // 21 ISC
      0,                                  // 22 Otros conceptos, tributos y cargos
      n2(f.total),                        // 23 Importe total
      f.moneda ?? 'PEN',                  // 24 Código de moneda (Tabla 4)
      f.tipoCambio ? Number(f.tipoCambio).toFixed(3) : '', // 25 Tipo de cambio (formato oficial 1.3 · obligatorio si moneda ≠ PEN)
      '',                                 // 26 Fecha CP que se modifica
      f.modSerie ? '01' : '',             // 27 Tipo CP que se modifica
      f.modSerie ?? '',                   // 28 Serie CP que se modifica
      '',                                 // 29 Código dependencia aduanera DUA
      f.modNumero ?? '',                  // 30 Número CP que se modifica
      f.constanciaFecha ? dmy(f.constanciaFecha) : '', // 31 FECHA constancia depósito detracción
      f.constanciaNumero ?? '',           // 32 NÚMERO constancia depósito detracción
      f.sujetoRetencion ? '1' : '',       // 33 Marca CP sujeto a retención
      '',                                 // 34 Clasificación bienes/servicios (Tabla 30, de corresponder)
      '',                                 // 35 Identificación contrato (sociedades irregulares)
      '',                                 // 36 Error tipo 1 (inconsistencia TC)
      '',                                 // 37 Error tipo 2 (no habido)
      '',                                 // 38 Error tipo 3 (renuncia exoneración)
      '',                                 // 39 Error tipo 4 (DNI en liquidaciones)
      '',                                 // 40 Indicador CP cancelado con medios de pago
      f.estado ?? '1',                    // 41 Estado (1 oportuno · 6 anotado en plazo posterior)
    ]);
  }).join('\r\n');
}

// ── 14.1 REGISTRO DE VENTAS E INGRESOS (140100) · 34 campos (estructura oficial Anexo 2) ─
export function ventas140100(periodo: string, filas: FilaVenta[]): string {
  const P = periodoTxt(periodo);
  return filas.map((f, i) => {
    const cuo = f.cuo ?? String(i + 1);
    return pipe([
      P,                                  // 1 Periodo
      cuo,                                // 2 CUO (= campo 2 del Diario si la venta ya se centralizó)
      corrM(cuo),                         // 3 Correlativo del asiento (inicia en M)
      dmy(f.fecha),                       // 4 Fecha de emisión
      f.fechaVencimiento ? dmy(f.fechaVencimiento) : '', // 5 Fecha de vencimiento o pago
      tablaComprobante(f.tipoComprobante),// 6 Tipo CP (Tabla 10)
      f.serie,                            // 7 Serie
      f.numero,                           // 8 Número CP
      '',                                 // 9 Número final (tickets consolidados)
      tablaDocIdentidad(f.clienteRuc),    // 10 Tipo doc identidad cliente
      f.clienteRuc ?? '',                 // 11 Número doc cliente
      f.clienteRazon ?? '',               // 12 Razón social cliente
      0,                                  // 13 Valor facturado de exportación
      n2(f.baseGravada),                  // 14 BI operación gravada
      0,                                  // 15 Descuento de la BI
      n2(f.igv),                          // 16 IGV/IPM
      0,                                  // 17 Descuento del IGV
      n2(f.exonerado),                    // 18 Importe exonerado
      0,                                  // 19 Importe inafecto
      0,                                  // 20 ISC
      0,                                  // 21 BI IVAP
      0,                                  // 22 IVAP
      0,                                  // 23 Otros conceptos y tributos
      n2(f.total),                        // 24 Importe total
      f.moneda ?? 'PEN',                  // 25 Código de moneda (Tabla 4)
      f.tipoCambio ? Number(f.tipoCambio).toFixed(3) : '', // 26 Tipo de cambio (formato oficial 1.3 · obligatorio si moneda ≠ PEN)
      '',                                 // 27 Fecha CP que se modifica
      f.modSerie ? '01' : '',             // 28 Tipo CP que se modifica
      f.modSerie ?? '',                   // 29 Serie CP que se modifica
      f.modNumero ?? '',                  // 30 Número CP que se modifica
      f.contrato ?? '',                   // 31 Identificación del contrato/proyecto
      '',                                 // 32 Error tipo 1 (inconsistencia TC)
      '',                                 // 33 Indicador CP cancelado con medios de pago
      '1',                                // 34 Estado
    ]);
  }).join('\r\n');
}

// ── 5.1 LIBRO DIARIO y 6.1 LIBRO MAYOR (050100/060100) · 21 campos ──────────
// F8 · estructura OFICIAL del Anexo 2 (PLE Ver 5): ambos libros comparten exactamente el mismo
// layout de 21 campos. El correlativo (campo 3) DEBE iniciar en A/M/C — nuestro correlativo
// interno AS-… empezaba con "A" (= asiento de apertura para el PLE): la ruta manda M#### y el
// AS-… viaja como CUO (campo 2, llave del software).
function libroDiarioMayor(periodo: string, filas: FilaDiario[]): string {
  const P = periodoTxt(periodo);
  return filas.map((f) => pipe([
    P,                                                    // 1 Periodo (AAAAMM00)
    f.cuo,                                                // 2 CUO · llave del software
    /^[AMC]/.test(f.correlativoAsiento) && !f.correlativoAsiento.startsWith('AS')
      ? f.correlativoAsiento : `M${f.correlativoAsiento.replace(/\D/g, '') || '1'}`, // 3 A/M/C + correlativo
    f.cuenta,                                             // 4 Cuenta desagregada
    '',                                                   // 5 Unidad de operación (de corresponder)
    '',                                                   // 6 Centro de costos (de corresponder)
    f.moneda ?? 'PEN',                                    // 7 Moneda de origen (Tabla 4)
    f.contraparteDoc ? tablaDocIdentidad(f.contraparteDoc) : '', // 8 Tipo doc identidad del emisor
    f.contraparteDoc ?? '',                               // 9 Número doc identidad
    f.tipoDoc ? tablaComprobante(f.tipoDoc) : '',         // 10 Tipo CP (Tabla 10, de corresponder)
    f.serie ?? '',                                        // 11 Serie CP
    f.numero ?? '',                                       // 12 Número CP
    dmy(f.fecha),                                         // 13 Fecha contable
    f.fechaVenc ? dmy(f.fechaVenc) : '',                  // 14 Fecha de vencimiento
    dmy(f.fecha),                                         // 15 Fecha de operación o emisión
    f.glosa,                                              // 16 Glosa
    '',                                                   // 17 Glosa referencial
    n2(f.debe),                                           // 18 Debe
    n2(f.haber),                                          // 19 Haber
    '',                                                   // 20 Dato estructurado (de ser el caso)
    '1',                                                  // 21 Estado
  ])).join('\r\n');
}
export const diario50100 = libroDiarioMayor;
export const mayor60100 = libroDiarioMayor;

// ══════════ SIRE (Sistema Integrado de Registros Electrónicos) ══════════
// SIRE cubre SOLO Ventas (RVIE) y Compras (RCE). Diario/Mayor NO van al SIRE (siguen por PLE/SLE-PLE).
// Estructura AMPLIA: RVIE = 40 campos núcleo · RCE = 32 campos. Fecha ISO (AAAA-MM-DD), TC a 3 dec, SIN pipe final.
// ⚠ BORRADOR: el orden/cantidad EXACTOS y los campos condicionales (>60 según comprobante: placa, DAM/DUA,
//   póliza, incoterm, medio de pago, etc.) dependen de la RS vigente. VALIDAR contra un archivo real exportado
//   del portal SIRE antes de importar en producción.
// GAP DE CAPTURA: los campos marcados «(s/dato)» salen vacíos porque el modelo de datos aún no los guarda
//   (fecha vencimiento real, CAR, detracción/percepción, comprobante modificado, aduana, contrato/proyecto).
const m2 = (x: unknown) => Number(x ?? 0).toFixed(2);
const tc3 = (x: unknown) => Number(x ?? 1).toFixed(3);
const periodo6 = (periodo: string) => periodo.replace('-', ''); // 2026-07 → 202607
const iso = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : '');

export function rvieVentas(periodo: string, filas: FilaVenta[]): string {
  const P = periodo6(periodo);
  return filas.map((f, i) => {
    const cuo = f.cuo ?? String(i + 1);
    return [
      P,                                   // 1  Periodo (AAAAMM)
      cuo,                                 // 2  CUO / código único de operación
      corrM(cuo),                          // 3  Número correlativo del asiento
      iso(f.fecha),                        // 4  Fecha de emisión
      iso(f.fechaVencimiento),             // 5  Fecha de vencimiento / pago
      tablaComprobante(f.tipoComprobante), // 6  Tipo de comprobante (Tabla 10)
      f.serie,                             // 7  Serie
      f.numero,                            // 8  Número
      '',                                  // 9  Número final (rango boletas · s/dato)
      tablaDocIdentidad(f.clienteRuc),     // 10 Tipo doc identidad cliente (Tabla 2)
      f.clienteRuc ?? '',                  // 11 N° documento cliente
      f.clienteRazon ?? '',                // 12 Razón social / nombre
      m2(0),                               // 13 Valor facturado exportación
      m2(f.baseGravada),                   // 14 Base imponible gravada
      m2(0),                               // 15 Descuento base imponible
      m2(f.igv),                           // 16 IGV / IPM
      m2(0),                               // 17 Descuento IGV
      m2(f.exonerado),                     // 18 Importe exonerado
      m2(0),                               // 19 Importe inafecto
      m2(0),                               // 20 ISC
      m2(0),                               // 21 Base IVAP
      m2(0),                               // 22 IVAP
      m2(0),                               // 23 ICBPER
      m2(0),                               // 24 Otros tributos
      m2(f.total),                         // 25 Importe total
      'PEN',                               // 26 Moneda
      tc3(f.tipoCambio),                   // 27 Tipo de cambio
      '',                                  // 28 Fecha comprobante modificado (s/dato)
      '',                                  // 29 Tipo comprobante modificado (s/dato)
      '',                                  // 30 Serie comprobante modificado (s/dato)
      '',                                  // 31 Número comprobante modificado (s/dato)
      f.proyectoCodigo ?? '',              // 32 Contrato / Proyecto
      '',                                  // 33 Clasificación de operación (s/dato)
      '',                                  // 34 Código de anotación CAR (lo asigna SUNAT)
      '1',                                 // 35 Estado del registro (1 = registrado)
      '',                                  // 36 Indicador de ajuste (s/dato)
      iso(f.fecha),                        // 37 Fecha de registro
      '',                                  // 38 Observaciones
      Number(f.detraccion ?? 0) > 0 ? '1' : '', // 39 Indicador de detracción
      '',                                  // 40 Indicador de percepción (s/dato)
    ].map(sinPipes).join('|');
  }).join('\r\n');
}
export function rceCompras(periodo: string, filas: FilaCompra[]): string {
  const P = periodo6(periodo);
  return filas.map((f, i) => {
    const cuo = f.cuo ?? String(i + 1);
    return [
      P,                                   // 1  Periodo
      cuo,                                 // 2  CUO
      corrM(cuo),                          // 3  Número correlativo del asiento
      iso(f.fecha),                        // 4  Fecha de emisión
      '',                                  // 5  Fecha de vencimiento (s/dato)
      tablaComprobante(f.tipoComprobante), // 6  Tipo de comprobante
      f.serie ?? '',                       // 7  Serie
      '',                                  // 8  Año de la DUA/DSI (s/dato)
      f.numero ?? '',                      // 9  Número
      tablaDocIdentidad(f.proveedorRuc),   // 10 Tipo doc identidad proveedor
      f.proveedorRuc ?? '',                // 11 N° documento proveedor
      f.proveedorRazon ?? '',              // 12 Razón social
      m2(f.destinoCredito === 'DGNG' || f.destinoCredito === 'DNG' ? 0 : f.baseGravada), // 13 BI gravada (DG)
      m2(f.destinoCredito === 'DGNG' || f.destinoCredito === 'DNG' ? 0 : f.igv),         // 14 IGV
      m2(f.destinoCredito === 'DGNG' ? f.baseGravada : 0), // 15 Base imponible gravada mixta
      m2(f.destinoCredito === 'DGNG' ? f.igv : 0),         // 16 IGV mixto
      m2(f.destinoCredito === 'DNG' ? f.baseGravada : 0),  // 17 Base imponible no gravada
      m2(f.destinoCredito === 'DNG' ? f.igv : 0),          // 18 IGV no gravado
      m2(f.noGravado),                     // 19 Adquisiciones no gravadas
      m2(0),                               // 20 ISC
      m2(0),                               // 21 IVAP
      m2(0),                               // 22 ICBPER
      m2(0),                               // 23 Otros tributos
      m2(f.total),                         // 24 Importe total
      f.moneda ?? 'PEN',                   // 25 Moneda
      tc3(f.tipoCambio),                   // 26 Tipo de cambio
      f.constanciaNumero ?? '',            // 27 Detracción (N° constancia · vacío = crédito diferido)
      '',                                  // 28 Percepción (s/dato)
      '',                                  // 29 Retención (s/dato)
      '',                                  // 30 Código de anotación CAR (lo asigna SUNAT)
      iso(f.fecha),                        // 31 Fecha de registro
      '1',                                 // 32 Estado
    ].map(sinPipes).join('|');
  }).join('\r\n');
}
export const sireNombreArchivo = (periodo: string, tipo: 'RCE' | 'RVIE') => `SIRE_${tipo}_${periodo.replace('-', '')}.txt`;

// ── nombre del archivo PLE ──────────────────────────────────
// LE + RUC(11) + AAAAMMDD + libro(6) + correlativo(2) + indOperac + indContenido + indMoneda + indLibro + .txt
export function nombreArchivo(periodo: string, libroCodigo: string, conOperaciones: boolean): string {
  const aaaammdd = periodo.replace('-', '') + '00';
  const indOper = conOperaciones ? '1' : '0';
  // sufijo: indOperaciones · indContenido(1) · indMoneda(1=PEN) · indLibroElectrónico(1)
  return `LE${EMPRESA_RUC}${aaaammdd}${libroCodigo}00${indOper}111.TXT`; // patrón oficial: LERRRRRRRRRRRAAAAMM00cccccc00OIM1.TXT
}

export const LIBROS = {
  '5.1': { codigo: '050100', nombre: 'Libro Diario', sire: false },
  '6.1': { codigo: '060100', nombre: 'Libro Mayor', sire: false },
  '8.1': { codigo: '080100', nombre: 'Registro de Compras', sire: false },
  '14.1': { codigo: '140100', nombre: 'Registro de Ventas e Ingresos', sire: false },
  RCE: { codigo: 'RCE', nombre: 'SIRE · Registro de Compras (RCE)', sire: true },
  RVIE: { codigo: 'RVIE', nombre: 'SIRE · Registro de Ventas (RVIE)', sire: true },
} as const;
export type LibroKey = keyof typeof LIBROS;

export const IGV_TASA = IGV_PCT;

// ── self-check (tsx apps/backend/src/lib/ple.ts) ────────────
if (process.argv[1]?.replace(/\\/g, '/').endsWith('lib/ple.ts')) {
  const assert = (c: boolean, m: string) => { if (!c) { throw new Error('FAIL: ' + m); } };
  // pipe final presente + montos a 2 decimales
  const l = pipe(['202601 00', 1, 'x', 123.5]);
  assert(l === '202601 00|1.00|x|123.50|', 'pipe/format: ' + l);
  // F8 · compras: 41 campos oficiales (Anexo 2 Ver 5)
  const c = compras80100('2026-01', [{ fecha: '2026-01-15', tipoComprobante: 'Factura', serie: 'F001', numero: '123', proveedorRuc: '20123456789', proveedorRazon: 'ACME SAC', baseGravada: 100, igv: 18, noGravado: 0, total: 118, moneda: 'PEN', tipoCambio: null, constanciaNumero: '2026-000418', constanciaFecha: '2026-01-20' }]);
  assert(c.split('|').length - 1 === 41, 'compras campos=' + (c.split('|').length - 1));
  assert(c.startsWith('20260100|1|M1|15/01/2026||01|F001||123||6|20123456789|ACME SAC|100.00|18.00|'), 'compras prefijo: ' + c.slice(0, 90));
  assert(c.includes('|118.00|PEN||'), 'compras total/moneda');
  assert(c.includes('|20/01/2026|2026-000418|'), 'compras constancia (31 fecha · 32 número)');
  // F8 · ventas: 34 campos oficiales
  const v = ventas140100('2026-01', [{ fecha: '2026-01-20', tipoComprobante: 'Factura', serie: 'F001', numero: '9', clienteRuc: '20100000001', clienteRazon: 'MUNI X', baseGravada: 1000, igv: 180, exonerado: 0, total: 1180, tipoCambio: null }]);
  assert(v.split('|').length - 1 === 34, 'ventas campos=' + (v.split('|').length - 1));
  assert(v.includes('|1180.00|PEN||'), 'ventas total/moneda');
  // F8 · diario y mayor: 21 campos oficiales cada uno (mismo layout) · correlativo inicia en M (no AS-)
  const d = diario50100('2026-01', [{ cuo: 'AS-202601-0001', correlativoAsiento: 'AS-202601-0001', fecha: '2026-01-15', glosa: 'compra', cuenta: '601201', debe: 100, haber: 0, contraparteDoc: '20123456789', tipoDoc: 'Factura', serie: 'F001', numero: '123' }]);
  assert(d.split('|').length - 1 === 21, 'diario campos=' + (d.split('|').length - 1));
  assert(d.startsWith('20260100|AS-202601-0001|M2026010001|601201|||PEN|6|20123456789|01|F001|123|15/01/2026||15/01/2026|compra||100.00|0.00||1|'), 'diario fila: ' + d);
  const m = mayor60100('2026-01', [{ cuo: '1', correlativoAsiento: 'M1', fecha: '2026-01-15', glosa: '', cuenta: '601201', debe: 100, haber: 0 }]);
  assert(m.split('|').length - 1 === 21, 'mayor campos=' + (m.split('|').length - 1));
  // SIRE · RVIE 40 campos (fecha ISO · TC 3 dec · sin pipe final · CUO+correlativo)
  const rv = rvieVentas('2026-07', [{ fecha: '2026-07-01', tipoComprobante: 'Factura', serie: 'F001', numero: '00001234', clienteRuc: '20123456789', clienteRazon: 'CLIENTE UNO S.A.C.', baseGravada: 1000, igv: 180, exonerado: 0, total: 1180, tipoCambio: null }]);
  assert(rv.split('|').length === 40, 'rvie campos=' + rv.split('|').length);
  assert(rv.startsWith('202607|1|M1|2026-07-01||01|F001|00001234||6|20123456789|CLIENTE UNO S.A.C.|0.00|1000.00|0.00|180.00|'), 'rvie cabecera: ' + rv.slice(0, 90));
  assert(rv.includes('|1180.00|PEN|1.000|'), 'rvie total/moneda/tc');
  // SIRE · RCE 32 campos
  const rc = rceCompras('2026-07', [{ fecha: '2026-07-03', tipoComprobante: 'Factura', serie: 'F001', numero: '00098765', proveedorRuc: '20600011122', proveedorRazon: 'PROVEEDOR SAC', baseGravada: 800, igv: 144, noGravado: 0, total: 944, moneda: 'PEN', tipoCambio: null }]);
  assert(rc.split('|').length === 32, 'rce campos=' + rc.split('|').length);
  assert(rc.startsWith('202607|1|M1|2026-07-03||01|F001||00098765|6|20600011122|PROVEEDOR SAC|800.00|144.00|'), 'rce cabecera: ' + rc.slice(0, 90));
  assert(rc.includes('|944.00|PEN|1.000|'), 'rce total/moneda/tc');
  // nombre archivo
  const nom = nombreArchivo('2026-01', '080100', true);
  assert(nom === 'LE2061063976420260100080100001111.TXT', 'nombre: ' + nom);
  console.log('ple.ts self-check OK ·', nom);
}
