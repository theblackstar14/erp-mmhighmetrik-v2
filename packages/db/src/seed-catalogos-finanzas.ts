/**
 * Fase 0 finanzas · seed idempotente de catálogos globales desde data/*.json.
 * Cada sección se salta si su JSON no existe todavía.
 *   pnpm --filter @erp/db exec tsx src/seed-catalogos-finanzas.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no definido: revisa el .env de la raiz (debe apuntar a erp_mmh_test)');
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const leer = <T>(nombre: string): T | null => {
  const p = path.resolve(__dirname, 'data', nombre);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) as T) : null;
};

// ── catálogos SUNAT ──
type Catalogos = Record<string, { nombre: string; filas: { codigo: string; descripcion: string; extra: Record<string, string> }[] }>;
const cats = leer<Catalogos>('sunat-catalogos.json');
if (cats) {
  let n = 0;
  await sql.begin(async (tx) => {
    for (const [catalogo, { filas }] of Object.entries(cats)) {
      for (const f of filas) {
        await tx`insert into catalogo_sunat (catalogo, codigo, descripcion, extra)
                 values (${catalogo}, ${f.codigo}, ${f.descripcion}, ${tx.json(f.extra)})
                 on conflict (catalogo, codigo) do update set descripcion = excluded.descripcion, extra = excluded.extra`;
        n++;
      }
    }
  });
  console.log(`✅ catalogo_sunat · ${n} filas`);
} else console.log('⏭  sunat-catalogos.json no existe');

// ── tasas de detracción ──
type Detr = { tasas: { codigo: string; descripcion: string; anexo: string | null; porcentaje: number | null; montoMinimo: number; vigenciaDesde: string; vigenciaHasta: string | null; observacion: string | null }[] };
const detr = leer<Detr>('detracciones.json');
if (detr) {
  await sql.begin(async (tx) => {
    for (const t of detr.tasas) {
      await tx`insert into detraccion_tasa (codigo, descripcion, anexo, porcentaje, monto_minimo, vigencia_desde, vigencia_hasta, observacion)
               values (${t.codigo}, ${t.descripcion}, ${t.anexo}, ${t.porcentaje}, ${t.montoMinimo}, ${t.vigenciaDesde}, ${t.vigenciaHasta}, ${t.observacion})
               on conflict (codigo, vigencia_desde) do update set descripcion = excluded.descripcion, anexo = excluded.anexo,
                 porcentaje = excluded.porcentaje, monto_minimo = excluded.monto_minimo, vigencia_hasta = excluded.vigencia_hasta, observacion = excluded.observacion`;
    }
  });
  console.log(`✅ detraccion_tasa · ${detr.tasas.length} filas`);
} else console.log('⏭  detracciones.json no existe');

// ── PCGE: solo inserta cuentas nuevas, nunca pisa las existentes ──
type Pcge = { cuentas: { codigo: string; descripcion: string; tipo: string; nivel: number; parentCodigo: string | null; clasificable: boolean }[] };
const pcge = leer<Pcge>('pcge-2010.json');
if (pcge) {
  let nuevas = 0;
  await sql.begin(async (tx) => {
    for (const c of pcge.cuentas) {
      const r = await tx`insert into plan_contable (codigo, descripcion, tipo, parent_codigo, nivel, clasificable, es_divisionaria, activa)
                         values (${c.codigo}, ${c.descripcion}, ${c.tipo}, ${c.parentCodigo}, ${c.nivel}, ${c.clasificable}, false, true)
                         on conflict (codigo) do nothing`;
      nuevas += r.count;
    }
  });
  console.log(`✅ plan_contable · ${nuevas} cuentas nuevas (de ${pcge.cuentas.length} en el PCGE)`);
} else console.log('⏭  pcge-2010.json no existe');

await sql.end();
