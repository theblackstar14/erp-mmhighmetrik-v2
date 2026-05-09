import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const sql = postgres(
  process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_mmh',
  { max: 1 },
);

let pass = 0;
let fail = 0;
const fails: string[] = [];

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` · ${detail}` : ''}`);
    fail++;
    fails.push(name);
  }
}

console.log('\n🔍 F1.A · Verificaciones presupuesto importado\n');

// 1. Total partidas
console.log('▸ Check 1 · Total partidas PG0005');
const totals = await sql`
  SELECT
    COUNT(*) FILTER (WHERE is_summary = true)::int  AS titulos,
    COUNT(*) FILTER (WHERE is_summary = false)::int AS hoja,
    COUNT(*)::int AS total
  FROM partidas
  WHERE proyecto_id = (SELECT id FROM proyectos WHERE codigo = 'PG0005')
`;
check('547 partidas total', totals[0]?.total === 547);
check('393 partidas hoja', totals[0]?.hoja === 393);
check('154 títulos', totals[0]?.titulos === 154);

// 2. Cuadre Σ presupuesto = CD
console.log('\n▸ Check 2 · Cuadre presupuesto');
const sumas = await sql`
  SELECT
    SUM(presupuesto)::numeric(14,2) AS suma_hoja,
    SUM(presupuesto_contractual)::numeric(14,2) AS suma_contractual
  FROM partidas
  WHERE proyecto_id = (SELECT id FROM proyectos WHERE codigo = 'PG0005')
    AND is_summary = false
`;
check('Σ partidas hoja = 1,319,122.00', Number(sumas[0]?.suma_hoja) === 1319122.0);
check(
  'Σ presupuesto contractual ≈ 1,253,165.90 (±100)',
  Math.abs(Number(sumas[0]?.suma_contractual) - 1253165.9) <= 100,
);

// 3. Jerarquía
console.log('\n▸ Check 3 · Jerarquía partidas');
const jerar = await sql`
  SELECT codigo, parent_codigo, nivel
  FROM partidas
  WHERE proyecto_id = (SELECT id FROM proyectos WHERE codigo = 'PG0005')
    AND codigo IN ('01.01.01.01', '02.04.01.01', '05.02.02.03')
  ORDER BY codigo
`;
check('partida 01.01.01.01 nivel 4', jerar.find((p) => p.codigo === '01.01.01.01')?.nivel === 4);
check('partida 01.01.01.01 parent = 01.01.01', jerar.find((p) => p.codigo === '01.01.01.01')?.parent_codigo === '01.01.01');
check('partida 05.02.02.03 nivel 4', jerar.find((p) => p.codigo === '05.02.02.03')?.nivel === 4);

// 4. Títulos nivel 1
console.log('\n▸ Check 4 · 5 títulos nivel 1 (subpresupuestos)');
const n1 = await sql`
  SELECT codigo, presupuesto::numeric(14,2) AS monto
  FROM partidas
  WHERE proyecto_id = (SELECT id FROM proyectos WHERE codigo = 'PG0005')
    AND nivel = 1
  ORDER BY codigo
`;
check('5 títulos nivel 1', n1.length === 5);
check('título 01 = 81,795.78', Number(n1[0]?.monto) === 81795.78);
check('título 02 = 793,653.49', Number(n1[1]?.monto) === 793653.49);
check('título 03 = 365,973.23', Number(n1[2]?.monto) === 365973.23);
check('título 04 = 30,565.14', Number(n1[3]?.monto) === 30565.14);
check('título 05 = 47,134.36', Number(n1[4]?.monto) === 47134.36);

// 5. PU contractual = referencial × factor
console.log('\n▸ Check 5 · pu_contractual cálculo');
const pus = await sql`
  SELECT
    p.codigo,
    p.pu_referencial::numeric AS ref,
    p.pu_contractual::numeric AS cont,
    pr.factor_oferta::numeric AS factor
  FROM partidas p
  JOIN proyectos pr ON pr.id = p.proyecto_id
  WHERE pr.codigo = 'PG0005'
    AND p.is_summary = false
    AND p.pu_referencial IS NOT NULL
  LIMIT 5
`;
let allOK = true;
for (const r of pus) {
  const calc = Number(r.ref) * Number(r.factor);
  const diff = Math.abs(Number(r.cont) - calc);
  if (diff > 0.001) allOK = false;
}
check('pu_contractual = pu_referencial × factor_oferta (5 muestras)', allOK);

// 6. Import histórico registrado
console.log('\n▸ Check 6 · Histórico import');
const imports = await sql`
  SELECT estado, partidas_importadas, monto_total_calculado, duracion_ms
  FROM imports_s10
  WHERE proyecto_id = (SELECT id FROM proyectos WHERE codigo = 'PG0005')
    AND tipo = 'presupuesto'
  ORDER BY fecha_import DESC LIMIT 1
`;
check('import registrado en histórico', imports.length > 0);
check('último import estado = exitoso', imports[0]?.estado === 'exitoso');
check('547 partidas importadas registradas', imports[0]?.partidas_importadas === 547);

// 7. Cuadre cruzado · 5 checks matemáticos
console.log('\n▸ Check 7 · Cuadre cruzado matemático');
const cuadre = await sql`
  SELECT
    SUM(presupuesto)::numeric(14,2) AS suma_partidas,
    SUM(presupuesto) FILTER (WHERE nivel = 1)::numeric(14,2) AS suma_nivel1
  FROM partidas
  WHERE proyecto_id = (SELECT id FROM proyectos WHERE codigo = 'PG0005')
    AND ((nivel = 1) OR (is_summary = false))
`;
const sumaHoja = Number(sumas[0]?.suma_hoja);
const sumaN1 = Number(cuadre[0]?.suma_nivel1);
check('Σ partidas hoja = Σ títulos nivel 1', Math.abs(sumaHoja - sumaN1) <= 0.01);

// Resumen
console.log(`\n${'═'.repeat(60)}`);
console.log(`Resultado F1.A: ${pass} ✓ pasaron · ${fail} ✗ fallaron`);
if (fail > 0) {
  console.log('\n❌ FALLAS:');
  for (const f of fails) console.log(`  · ${f}`);
}

await sql.end();
process.exit(fail > 0 ? 1 : 0);
