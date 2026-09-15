/**
 * Fase 1 · esquema: tablas/columnas nuevas, asiento_id nullable, cuenta BN y exports ORM.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-fase1-tablas.ts
 */
import '../../src/env.js'; // carga .env (erp_mmh_test) antes de que @erp/db abra la conexion
import assert from 'node:assert/strict';
import { db, schema } from '@erp/db';
import { eq, sql } from 'drizzle-orm';

type Col = { table_name: string; column_name: string; is_nullable: string };
const cols = (await db.execute(sql`select table_name, column_name, is_nullable from information_schema.columns
  where table_name in ('gasto_lineas','detraccion_documento','gastos','aplicacion_documento','cuentas_bancarias')`)) as unknown as Col[];
const tiene = (t: string, c: string) => cols.find((x) => x.table_name === t && x.column_name === c);

for (const c of ['gasto_id', 'numero', 'descripcion', 'unidad', 'cantidad', 'valor_unitario', 'descuento', 'valor_venta', 'afectacion_igv', 'igv', 'cuenta_contable', 'partida_id', 'proyecto_id', 'a_inventario']) assert.ok(tiene('gasto_lineas', c), `gasto_lineas.${c}`);
for (const c of ['doc_origen_tipo', 'doc_origen_id', 'empresa_id', 'codigo', 'porcentaje', 'base_pen', 'monto', 'monto_declarado', 'cuenta_bn', 'npd', 'constancia_numero', 'fecha_deposito', 'estado']) assert.ok(tiene('detraccion_documento', c), `detraccion_documento.${c}`);
for (const c of ['fecha_vencimiento', 'tipo_cambio', 'retencion', 'retencion_tipo', 'percepcion', 'doc_modifica_serie', 'doc_modifica_numero', 'motivo_nota']) assert.ok(tiene('gastos', c), `gastos.${c}`);
assert.equal(tiene('aplicacion_documento', 'asiento_id')?.is_nullable, 'YES', 'aplicacion_documento.asiento_id nullable');
for (const c of ['origen_tipo', 'origen_id']) assert.ok(tiene('aplicacion_documento', c), `aplicacion_documento.${c}`);
assert.ok(tiene('cuentas_bancarias', 'tipo'), 'cuentas_bancarias.tipo');
// D1 · 'Recibo por Honorarios' son 21 caracteres: doc_tipo debe quedar en 40, no en 20
const docTipoLen = (await db.execute(sql`select character_maximum_length as len from information_schema.columns where table_name = 'documento_pendiente' and column_name = 'doc_tipo'`)) as unknown as { len: number }[];
assert.equal(docTipoLen[0]?.len, 40, 'documento_pendiente.doc_tipo ancho a 40');

const [bn] = await db.select().from(schema.cuentasBancarias).where(eq(schema.cuentasBancarias.codigo, '00003354431'));
assert.deepEqual([bn?.tipo, bn?.cuentaContable, bn?.activo], ['detracciones', '1071', true], 'cuenta BN de detracciones');
const [kely] = await db.select().from(schema.cuentasBancarias).where(eq(schema.cuentasBancarias.codigo, 'REND-KELY'));
assert.equal(kely?.tipo, 'caja', 'REND-* es caja');

type Idx = { indexdef: string };
const idx = (await db.execute(sql`select indexdef from pg_indexes where indexname = 'docpend_uq'`)) as unknown as Idx[];
assert.match(idx[0]?.indexdef ?? '', /tercero_ruc/, 'docpend_uq incluye tercero_ruc');

await db.select().from(schema.gastoLineas).limit(1);
await db.select().from(schema.detraccionDocumento).limit(1);
console.log('fase1-tablas VERDE');
process.exit(0);
