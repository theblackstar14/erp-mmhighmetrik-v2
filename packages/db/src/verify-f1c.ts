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

console.log('\n🔍 F1.C · Verificaciones calendario adquisiciones\n');

// 1. Total recursos
console.log('▸ Check 1 · Recursos catálogo');
const totals = await sql`
  SELECT
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE tipo='mano_obra')::int AS mo,
    COUNT(*) FILTER (WHERE tipo='material')::int AS mat,
    COUNT(*) FILTER (WHERE tipo='equipo')::int AS eq
  FROM recursos
`;
check('392 recursos total', totals[0]?.total === 392);
check('6 mano de obra', totals[0]?.mo === 6);
check('372 materiales', totals[0]?.mat === 372);
check('14 equipos', totals[0]?.eq === 14);

// 2. Cronograma adquisiciones
console.log('\n▸ Check 2 · Cronograma adquisiciones');
const cronog = await sql`
  SELECT
    COUNT(*)::int AS total,
    SUM(monto)::numeric(14,2) AS suma_total
  FROM cronograma_adquisiciones
  WHERE proyecto_id = (SELECT id FROM proyectos WHERE codigo='PG0005')
`;
check('≥ 600 registros cronograma', Number(cronog[0]?.total) >= 600);
check('Σ monto = 1,253,165.90', Number(cronog[0]?.suma_total) === 1253165.9);

// 3. Distribución mensual exacta
console.log('\n▸ Check 3 · Distribución mensual');
const meses = await sql`
  SELECT mes_index, mes_etiqueta, SUM(monto)::numeric(14,2) AS suma
  FROM cronograma_adquisiciones
  WHERE proyecto_id = (SELECT id FROM proyectos WHERE codigo='PG0005')
  GROUP BY mes_index, mes_etiqueta
  ORDER BY mes_index
`;
check(
  'mes 1 Oct-25 = 229,253.22',
  Number(meses[0]?.suma) === 229253.22 && meses[0]?.mes_etiqueta === 'Oct-25',
);
check(
  'mes 2 Nov-25 = 351,716.18',
  Number(meses[1]?.suma) === 351716.18 && meses[1]?.mes_etiqueta === 'Nov-25',
);
check(
  'mes 3 Dic-25 = 395,368.38',
  Number(meses[2]?.suma) === 395368.38 && meses[2]?.mes_etiqueta === 'Dic-25',
);
check(
  'mes 4 Ene-26 = 276,828.12',
  Number(meses[3]?.suma) === 276828.12 && meses[3]?.mes_etiqueta === 'Ene-26',
);

// 4. Triple cuadre matemático con CD contractual proyecto
console.log('\n▸ Check 4 · Triple cuadre matemático');
const cuadre = await sql`
  SELECT
    p.costo_directo::numeric AS cd_ref,
    p.factor_oferta::numeric AS factor,
    (p.costo_directo * p.factor_oferta)::numeric(14,2) AS cd_contract_calc,
    (SELECT SUM(monto)::numeric(14,2) FROM cronograma_adquisiciones WHERE proyecto_id = p.id) AS suma_calend,
    (SELECT SUM(presupuesto_contractual)::numeric(14,2) FROM partidas WHERE proyecto_id = p.id AND nivel = 1) AS suma_partidas_contract
  FROM proyectos p WHERE p.codigo = 'PG0005'
`;
const c = cuadre[0];
check('CD ref = 1,319,122.00', Number(c?.cd_ref) === 1319122);
check('Factor oferta = 0.95', Number(c?.factor) === 0.95);
check('CD contractual calc = 1,253,165.90', Number(c?.cd_contract_calc) === 1253165.9);
check('Σ calendario = 1,253,165.90', Number(c?.suma_calend) === 1253165.9);
check(
  'Σ partidas contractual = 1,253,165.90',
  Number(c?.suma_partidas_contract) === 1253165.9,
);

// 5. Clasificación IU automática
console.log('\n▸ Check 5 · Clasificación IU automática');
const ius = await sql`
  SELECT
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE iu_codigo IS NOT NULL)::int AS clasificados,
    COUNT(DISTINCT iu_codigo) FILTER (WHERE iu_codigo IS NOT NULL)::int AS ius_distintos
  FROM recursos WHERE iu_codigo IS NOT NULL OR iu_codigo IS NULL
`;
check('clasificación IU > 25% (heurística básica)', Number(ius[0]?.clasificados) >= Number(ius[0]?.total) * 0.25);
check('múltiples IUs distintos', Number(ius[0]?.ius_distintos) >= 5);

// 6. Recursos clave existen
console.log('\n▸ Check 6 · Recursos clave catalogados');
const claves = await sql`
  SELECT codigo, descripcion, tipo, iu_codigo
  FROM recursos
  WHERE codigo IN ('47 00006', '47 00007', '00 07449', '49 00122')
  ORDER BY codigo
`;
check('CAPATAZ 47 00006 catalogado', claves.find((r) => r.codigo === '47 00006')?.tipo === 'mano_obra');
check('OPERARIO 47 00007 catalogado', claves.find((r) => r.codigo === '47 00007')?.tipo === 'mano_obra');
check('PIEDRA CHANCADA 00 07449 catalogado', !!claves.find((r) => r.codigo === '00 07449'));
check('VIBRADOR 49 00122 catalogado equipo', claves.find((r) => r.codigo === '49 00122')?.tipo === 'equipo');

// 7. Import histórico
console.log('\n▸ Check 7 · Histórico import');
const imp = await sql`
  SELECT estado, insumos_importados, monto_total_calculado
  FROM imports_s10
  WHERE proyecto_id = (SELECT id FROM proyectos WHERE codigo='PG0005')
    AND tipo = 'calendario_adquisiciones'
  ORDER BY fecha_import DESC LIMIT 1
`;
check('import calendario registrado', imp.length > 0);
check('último import exitoso', imp[0]?.estado === 'exitoso');
check('392 recursos importados', imp[0]?.insumos_importados === 392);

console.log(`\n${'═'.repeat(60)}`);
console.log(`Resultado F1.C: ${pass} ✓ pasaron · ${fail} ✗ fallaron`);
if (fail > 0) {
  console.log('\n❌ FALLAS:');
  for (const f of fails) console.log(`  · ${f}`);
}

await sql.end();
process.exit(fail > 0 ? 1 : 0);
