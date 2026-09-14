/**
 * WS-1 · genera el Excel de apertura de PRUEBA (empresa MG).
 * Uso: tsx apps/backend/scripts/ws1/make-fixture.ts [out.xlsx]
 * Data cuadrada a proposito (ver cabecera del script de apertura).
 */
import * as XLSX from 'xlsx';
import { resolve } from 'node:path';

const out = process.argv[2] ?? resolve(process.cwd(), 'apps/backend/scripts/ws1/apertura_prueba_MG.xlsx');

const META = [
  { clave: 'empresa_ruc', valor: '00000000002' }, // MG
  { clave: 'fecha_apertura', valor: '2025-12-31' },
];

const BANCOS = [
  { cuenta_contable: '10411', moneda: 'PEN', tipo_cambio: '', saldo: 50000 },
  { cuenta_contable: '10441', moneda: 'PEN', tipo_cambio: '', saldo: 20000 },
];

const DETRACCIONES = [
  { cuenta_contable: '1071', saldo: 8000 },
];

// 3 CxC (una en USD). obra_codigo asocia a PG0001.
const CXC = [
  { cuenta_control: '1212', tercero_ruc: '20544464389', tercero_razon: 'A & A COPIADORAS S.A.C.', doc_tipo: 'FACTURA', doc_serie: 'F001', doc_numero: '100', fecha_emision: '2025-11-10', fecha_venc: '2025-12-10', moneda: 'PEN', tipo_cambio: '', monto_original: 30000, saldo_pendiente: 30000, obra_codigo: 'PG0001' },
  { cuenta_control: '1212', tercero_ruc: '20603566794', tercero_razon: 'A & A TERRA LAB. S.A.C.', doc_tipo: 'FACTURA', doc_serie: 'F001', doc_numero: '101', fecha_emision: '2025-11-20', fecha_venc: '2025-12-20', moneda: 'PEN', tipo_cambio: '', monto_original: 12000, saldo_pendiente: 12000, obra_codigo: '' },
  { cuenta_control: '1212', tercero_ruc: '20548252777', tercero_razon: 'A & E SUMINISTROS S.A.C.', doc_tipo: 'INVOICE', doc_serie: 'INV', doc_numero: '900', fecha_emision: '2025-12-01', fecha_venc: '2026-01-15', moneda: 'USD', tipo_cambio: 3.75, monto_original: 4000, saldo_pendiente: 4000, obra_codigo: '' },
];

// 4 CxP (una en USD).
const CXP = [
  { cuenta_control: '4212', tercero_ruc: '20297832761', tercero_razon: 'CONSTRUCTORA Y CONSULTORA TENORIO SAC', doc_tipo: 'FACTURA', doc_serie: 'F002', doc_numero: '200', fecha_emision: '2025-11-05', fecha_venc: '2025-12-05', moneda: 'PEN', tipo_cambio: '', monto_original: 18000, saldo_pendiente: 18000, obra_codigo: '' },
  { cuenta_control: '4212', tercero_ruc: '20376082114', tercero_razon: 'OSINERGMIN', doc_tipo: 'FACTURA', doc_serie: 'F002', doc_numero: '201', fecha_emision: '2025-11-15', fecha_venc: '2025-12-15', moneda: 'PEN', tipo_cambio: '', monto_original: 9000, saldo_pendiente: 9000, obra_codigo: '' },
  { cuenta_control: '4212', tercero_ruc: '20608496859', tercero_razon: 'ZANE CONSTRUCCION S.A.C.', doc_tipo: 'FACTURA', doc_serie: 'F002', doc_numero: '202', fecha_emision: '2025-12-02', fecha_venc: '2026-01-02', moneda: 'PEN', tipo_cambio: '', monto_original: 6000, saldo_pendiente: 6000, obra_codigo: '' },
  { cuenta_control: '4212', tercero_ruc: '20544464389', tercero_razon: 'A & A COPIADORAS S.A.C.', doc_tipo: 'INVOICE', doc_serie: 'INV', doc_numero: '777', fecha_emision: '2025-12-10', fecha_venc: '2026-02-10', moneda: 'USD', tipo_cambio: 3.75, monto_original: 2000, saldo_pendiente: 2000, obra_codigo: '' },
];

// Patrimonio = plug que cuadra el asiento (lo pone Kelly). 135000 - 40500 = 94500.
const PATRIMONIO = [
  { cuenta_contable: '591', saldo: 94500 },
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(META), 'META');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(BANCOS), 'BANCOS');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(DETRACCIONES), 'DETRACCIONES');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(CXC), 'CXC');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(CXP), 'CXP');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(PATRIMONIO), 'PATRIMONIO');
XLSX.writeFile(wb, out);
console.log('fixture escrito:', out);
