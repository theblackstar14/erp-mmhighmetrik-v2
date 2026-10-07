/**
 * Carga el plan de cuentas de CONTASIS como catálogo canónico (spec §3.1).
 *
 * Idempotente y conservador:
 *   · código NUEVO        → INSERT completo (descripción, tipo, nivel, parent, clasificable + CONTASIS)
 *   · código COMPARTIDO   → UPDATE SOLO de las columnas CONTASIS + es_contasis.
 *                           NO pisa descripcion/tipo/nivel/parent/clasificable/activa/es_divisionaria:
 *                           esas cuentas están EN USO en asientos históricos y cambiarles
 *                           `clasificable` cambiaría derivarClase() sobre data ya registrada.
 *   · nuestras 487 propias → no se tocan ni se desactivan: el histórico las referencia por FK.
 *
 * Correr desde apps/backend:
 *   node <tsx> scripts/contasis/cargar-plan.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, schema } from '@erp/db';
import { sql } from 'drizzle-orm';
import { parsePlanContasis } from '../../src/lib/contasisPlan.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(AQUI, 'PLAN DE CUENTAS ESTANDAR_SQL.xlsx');

const { cuentas, duplicados } = parsePlanContasis(fs.readFileSync(FIXTURE));
console.log(`· parseadas ${cuentas.length} cuentas de la fixture`);

// Los duplicados del export se reportan SIEMPRE, no se esconden: para los que difieren en
// destino, la fila que gana decide en qué clase cae el gasto, y eso lo confirma Kelly.
if (duplicados.length) {
  console.log(`⚠ ${duplicados.length} códigos repetidos en el export · se conservó la primera fila:`);
  for (const d of duplicados) {
    const marca = d.difiereEnDestino ? ' ← DESTINO DISTINTO, confirmar con Kelly' : '';
    console.log(`   ${d.codigo}: conservada "${d.conservada.descripcion}" (destino ${d.conservada.destinoDebe ?? '—'})`);
    console.log(`   ${' '.repeat(d.codigo.length)}  descartada "${d.descartada.descripcion}" (destino ${d.descartada.destinoDebe ?? '—'})${marca}`);
  }
}

const previas = new Set(
  (await db.select({ codigo: schema.planContable.codigo }).from(schema.planContable)).map((r) => r.codigo),
);
const nuevas = cuentas.filter((c) => !previas.has(c.codigo));
const compartidas = cuentas.filter((c) => previas.has(c.codigo));
console.log(`· ${nuevas.length} nuevas · ${compartidas.length} compartidas · ${previas.size} ya existentes`);

// Ordenar por largo de código para que el padre entre antes que el hijo. parent_codigo no es
// FK en la DB, pero insertar en orden deja el árbol consistente si alguna vez se valida.
nuevas.sort((a, b) => a.codigo.length - b.codigo.length);

const LOTE = 500; // insert masivo por lotes: 2065 filas en un solo VALUES infla el parse del server
let insertadas = 0;
for (let i = 0; i < nuevas.length; i += LOTE) {
  const lote = nuevas.slice(i, i + LOTE);
  await db.insert(schema.planContable).values(
    lote.map((c) => ({
      codigo: c.codigo,
      descripcion: c.descripcion,
      tipo: c.tipo,
      parentCodigo: c.parentCodigo,
      nivel: c.nivel,
      clasificable: c.clasificable,
      empresaId: null, // compartida: hay una sola empresa real
      activa: true,
      contasisNivel: c.contasisNivel,
      contasisTipo: c.contasisTipo,
      contasisAnalisis: c.contasisAnalisis,
      destinoDebe: c.destinoDebe,
      destinoHaber: c.destinoHaber,
      exigeCentroCosto: c.exigeCentroCosto,
      codBalance1: c.codBalance1,
      codBalance2: c.codBalance2,
      cuentaCierre: c.cuentaCierre,
      esContasis: true,
    })),
  ).onConflictDoNothing({ target: schema.planContable.codigo });
  insertadas += lote.length;
}
console.log(`· insertadas ${insertadas} cuentas nuevas`);

// Compartidas: SOLO las columnas CONTASIS. Un UPDATE por cuenta es aceptable (1327 filas,
// corre una vez por carga de catálogo); no vale la pena un VALUES/FROM a mano.
let actualizadas = 0;
for (const c of compartidas) {
  await db.update(schema.planContable).set({
    contasisNivel: c.contasisNivel,
    contasisTipo: c.contasisTipo,
    contasisAnalisis: c.contasisAnalisis,
    destinoDebe: c.destinoDebe,
    destinoHaber: c.destinoHaber,
    exigeCentroCosto: c.exigeCentroCosto,
    codBalance1: c.codBalance1,
    codBalance2: c.codBalance2,
    cuentaCierre: c.cuentaCierre,
    esContasis: true,
  }).where(sql`${schema.planContable.codigo} = ${c.codigo}`);
  actualizadas++;
}
console.log(`· actualizadas ${actualizadas} compartidas (solo columnas CONTASIS)`);

const r: any = await db.execute(sql`
  select count(*)::int total,
         count(*) filter (where es_contasis)::int contasis,
         count(*) filter (where not es_contasis)::int propias,
         max(length(codigo))::int maxlen
    from plan_contable`);
const [fila] = (r.rows ?? r) as any[];
console.log(`✅ plan_contable: ${fila.total} cuentas · ${fila.contasis} CONTASIS · ${fila.propias} solo nuestras · maxlen ${fila.maxlen}`);
