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

console.log('\n🔍 F1.D · Verificaciones Fórmulas Polinómicas\n');

// 1. 5 FPs insertadas
console.log('▸ Check 1 · 5 Fórmulas Polinómicas');
const fps = await sql`
  SELECT subpresupuesto_codigo, subpresupuesto_nombre, fecha_base::text AS fb, area_geografica
  FROM formulas_polinomicas
  WHERE proyecto_id = (SELECT id FROM proyectos WHERE codigo='PG0005')
  ORDER BY subpresupuesto_codigo
`;
check('5 FPs insertadas', fps.length === 5);
check('001 OBRAS PROVISIONALES', fps[0]?.subpresupuesto_codigo === '001' && String(fps[0]?.subpresupuesto_nombre).includes('PROVISIONALES'));
check('002 ESTRUCTURAS', fps[1]?.subpresupuesto_codigo === '002' && String(fps[1]?.subpresupuesto_nombre).includes('ESTRUCTURAS'));
check('003 ARQUITECTURA', fps[2]?.subpresupuesto_codigo === '003' && String(fps[2]?.subpresupuesto_nombre).includes('ARQUITECTURA'));
check('004 INSTALACIONES SANITARIAS', fps[3]?.subpresupuesto_codigo === '004' && String(fps[3]?.subpresupuesto_nombre).includes('SANITARIAS'));
check('005 INSTALACIONES ELECTRICAS', fps[4]?.subpresupuesto_codigo === '005' && String(fps[4]?.subpresupuesto_nombre).includes('ELECTRICAS'));

// 2. Fechas + áreas
console.log('\n▸ Check 2 · Metadata FPs');
check('fecha_base 2025-06-07', fps.every((f) => f?.fb === '2025-06-07'));
check('area_geografica LIMA-SURCO', fps.every((f) => String(f?.area_geografica).includes('SURCO')));

// 3. Σ coeficientes = 1.0 cada FP
console.log('\n▸ Check 3 · Σ coeficientes = 1.000 cada FP');
const sumas = await sql`
  SELECT
    fp.subpresupuesto_codigo,
    SUM(fm.coeficiente)::numeric(10,4) AS suma
  FROM formulas_polinomicas fp
  JOIN formulas_monomios fm ON fm.formula_id = fp.id
  WHERE fp.proyecto_id = (SELECT id FROM proyectos WHERE codigo='PG0005')
  GROUP BY fp.subpresupuesto_codigo
  ORDER BY fp.subpresupuesto_codigo
`;
for (const s of sumas) {
  check(
    `FP ${s.subpresupuesto_codigo} · Σ coef = 1.000`,
    Math.abs(Number(s.suma) - 1.0) <= 0.001,
  );
}

// 4. Monomios + IUs
console.log('\n▸ Check 4 · Monomios e IUs por FP');
const monomios = await sql`
  SELECT
    fp.subpresupuesto_codigo,
    COUNT(DISTINCT fm.id)::int AS num_monomios,
    COUNT(fmi.id)::int AS num_ius
  FROM formulas_polinomicas fp
  LEFT JOIN formulas_monomios fm ON fm.formula_id = fp.id
  LEFT JOIN formulas_monomios_ius fmi ON fmi.monomio_id = fm.id
  WHERE fp.proyecto_id = (SELECT id FROM proyectos WHERE codigo='PG0005')
  GROUP BY fp.subpresupuesto_codigo
  ORDER BY fp.subpresupuesto_codigo
`;
check('FP 001 · 4 monomios', monomios.find((m) => m.subpresupuesto_codigo === '001')?.num_monomios === 4);
check('FP 002 · 6 monomios', monomios.find((m) => m.subpresupuesto_codigo === '002')?.num_monomios === 6);
check('FP 003 · 6 monomios', monomios.find((m) => m.subpresupuesto_codigo === '003')?.num_monomios === 6);
check('FP 004 · 5 monomios', monomios.find((m) => m.subpresupuesto_codigo === '004')?.num_monomios === 5);
check('FP 005 · 6 monomios', monomios.find((m) => m.subpresupuesto_codigo === '005')?.num_monomios === 6);
check(
  'Cada FP tiene ≥ 4 IUs vinculados',
  monomios.every((m) => Number(m.num_ius) >= 4),
);

// 5. Pesos % por monomio = 100% (Σ pesos IUs por monomio = 100)
console.log('\n▸ Check 5 · Σ pesos IUs por monomio = 100%');
const pesos = await sql`
  SELECT
    fp.subpresupuesto_codigo,
    fm.numero AS monomio_num,
    fm.simbolo,
    SUM(fmi.peso_porcentual)::numeric(8,3) AS suma_peso
  FROM formulas_polinomicas fp
  JOIN formulas_monomios fm ON fm.formula_id = fp.id
  JOIN formulas_monomios_ius fmi ON fmi.monomio_id = fm.id
  WHERE fp.proyecto_id = (SELECT id FROM proyectos WHERE codigo='PG0005')
  GROUP BY fp.subpresupuesto_codigo, fm.numero, fm.simbolo
  ORDER BY fp.subpresupuesto_codigo, fm.numero
`;
const todosCuadran = pesos.every((p) => Math.abs(Number(p.suma_peso) - 100) <= 0.5);
check('Σ pesos IUs = 100% en todos los monomios', todosCuadran);

// 6. Caso especial · monomio compuesto MO 02 estructuras
console.log('\n▸ Check 6 · Caso compuesto · FP 002 monomio C (cemento+agregado)');
const c2 = await sql`
  SELECT fmi.iu_codigo, fmi.peso_porcentual::numeric AS peso
  FROM formulas_monomios fm
  JOIN formulas_monomios_ius fmi ON fmi.monomio_id = fm.id
  JOIN formulas_polinomicas fp ON fp.id = fm.formula_id
  WHERE fp.subpresupuesto_codigo = '002' AND fm.simbolo = 'C'
  ORDER BY fmi.peso_porcentual DESC
`;
check(
  'FP 002 monomio C tiene 2 IUs (cemento 21 + agregado 05)',
  c2.length === 2 && c2.some((x) => x.iu_codigo === '21') && c2.some((x) => x.iu_codigo === '05'),
);

// 7. Import histórico
console.log('\n▸ Check 7 · Histórico import');
const imp = await sql`
  SELECT estado, partidas_importadas
  FROM imports_s10
  WHERE proyecto_id = (SELECT id FROM proyectos WHERE codigo='PG0005')
    AND tipo = 'formulas_polinomicas'
  ORDER BY fecha_import DESC LIMIT 1
`;
check('import FP registrado', imp.length > 0);
check('import FP exitoso', imp[0]?.estado === 'exitoso');
check('5 FPs registradas en import', imp[0]?.partidas_importadas === 5);

console.log(`\n${'═'.repeat(60)}`);
console.log(`Resultado F1.D: ${pass} ✓ pasaron · ${fail} ✗ fallaron`);
if (fail > 0) {
  console.log('\n❌ FALLAS:');
  for (const f of fails) console.log(`  · ${f}`);
}

await sql.end();
process.exit(fail > 0 ? 1 : 0);
