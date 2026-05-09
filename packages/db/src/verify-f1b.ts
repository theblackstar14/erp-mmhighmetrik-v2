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

console.log('\n🔍 F1.B · Verificaciones cronograma MPP\n');

// 1. Proyecto actualizado con fechas
console.log('▸ Check 1 · Proyecto fechas inicio/fin actualizadas');
const proyecto = await sql`
  SELECT fecha_inicio::text AS fi, fecha_fin::text AS ff, dias_plazo, gantt_file
  FROM proyectos WHERE codigo = 'PG0005'
`;
const p = proyecto[0];
check('fecha_inicio = 2025-10-01', p?.fi === '2025-10-01');
check('fecha_fin = 2026-01-28', p?.ff === '2026-01-28');
check('dias_plazo = 120', Number(p?.dias_plazo) === 120);
check('gantt_file registrado', !!p?.gantt_file);

// 2. Partidas con fechas asignadas
console.log('\n▸ Check 2 · Partidas con fechas + duración');
const partidasConFechas = await sql`
  SELECT
    COUNT(*)::int AS total,
    COUNT(fecha_inicio)::int AS con_fecha_inicio,
    COUNT(fecha_fin)::int AS con_fecha_fin,
    COUNT(duracion_dias)::int AS con_duracion
  FROM partidas
  WHERE proyecto_id = (SELECT id FROM proyectos WHERE codigo = 'PG0005')
`;
const stats = partidasConFechas[0];
check('547 partidas total', Number(stats?.total) === 547);
check('≥ 540 con fecha_inicio (≥98.7%)', Number(stats?.con_fecha_inicio) >= 540);
check('≥ 540 con fecha_fin', Number(stats?.con_fecha_fin) >= 540);
check('≥ 540 con duración', Number(stats?.con_duracion) >= 540);

// 3. Cronograma fechas dentro rango
console.log('\n▸ Check 3 · Fechas dentro rango proyecto');
const fueraRango = await sql`
  SELECT COUNT(*)::int AS c FROM partidas pa
  JOIN proyectos p ON p.id = pa.proyecto_id
  WHERE p.codigo = 'PG0005'
    AND pa.fecha_inicio IS NOT NULL
    AND (pa.fecha_inicio < p.fecha_inicio OR pa.fecha_fin > p.fecha_fin)
`;
check('0 partidas fuera rango fechas proyecto', Number(fueraRango[0]?.c) === 0);

// 4. Tareas críticas (hitos MPP "1.1 Inicio de Obra" no se importan a partidas)
console.log('\n▸ Check 4 · Tareas críticas (ruta crítica)');
const criticas = await sql`
  SELECT COUNT(*)::int AS c FROM partidas
  WHERE proyecto_id = (SELECT id FROM proyectos WHERE codigo = 'PG0005')
    AND is_critical = true
`;
check('≥ 100 partidas críticas (ruta crítica)', Number(criticas[0]?.c) >= 100);

// 5. Import histórico tipo mpp_cronograma
console.log('\n▸ Check 5 · Histórico import MPP');
const imports = await sql`
  SELECT estado, partidas_importadas, monto_total_calculado, duracion_ms
  FROM imports_s10
  WHERE proyecto_id = (SELECT id FROM proyectos WHERE codigo = 'PG0005')
    AND tipo = 'mpp_cronograma'
  ORDER BY fecha_import DESC LIMIT 1
`;
check('import MPP registrado', imports.length > 0);
check('último import estado = exitoso', imports[0]?.estado === 'exitoso');
check('≥ 540 partidas matched', Number(imports[0]?.partidas_importadas) >= 540);
check(
  'monto_total_calculado ≈ 1,253,165.90',
  Math.abs(Number(imports[0]?.monto_total_calculado ?? 0) - 1253165.9) <= 1,
);

// 6. Sample partida verificada · 01.01.01.01 cartel
console.log('\n▸ Check 6 · Sample partida 01.01.01.01 (CARTEL)');
const cartel = await sql`
  SELECT codigo, nombre, fecha_inicio, fecha_fin, duracion_dias,
         pu_referencial::numeric AS ref, pu_contractual::numeric AS cont
  FROM partidas
  WHERE proyecto_id = (SELECT id FROM proyectos WHERE codigo = 'PG0005')
    AND codigo = '01.01.01.01'
`;
const c = cartel[0];
check('cartel tiene fecha_inicio', !!c?.fecha_inicio);
check('cartel tiene fecha_fin', !!c?.fecha_fin);
check('cartel duración 1 día', Number(c?.duracion_dias) === 1);
check('cartel pu_referencial = 2474.58', Number(c?.ref) === 2474.58);

// Resumen
console.log(`\n${'═'.repeat(60)}`);
console.log(`Resultado F1.B: ${pass} ✓ pasaron · ${fail} ✗ fallaron`);
if (fail > 0) {
  console.log('\n❌ FALLAS:');
  for (const f of fails) console.log(`  · ${f}`);
}

await sql.end();
process.exit(fail > 0 ? 1 : 0);
