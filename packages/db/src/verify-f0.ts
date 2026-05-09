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

console.log('\n🔍 F0 Foundation · Verificaciones\n');

// Check 1: Proyecto PG0005 montos correctos
console.log('▸ Check 1 · Proyecto PG0005 montos contractuales');
const proyectos = await sql`
  SELECT id, codigo, monto_referencial, monto_contractual, monto_vigente, factor_oferta
  FROM proyectos WHERE codigo = 'PG0005'
`;
const p = proyectos[0];
check('proyecto PG0005 existe', proyectos.length === 1);
check('monto_referencial = 1,821,179.83', Number(p?.monto_referencial) === 1821179.83);
check('monto_contractual = 1,730,120.84', Number(p?.monto_contractual) === 1730120.84);
check('monto_vigente = 1,675,933.17', Number(p?.monto_vigente) === 1675933.17);
check('factor_oferta ≈ 0.95', Math.abs(Number(p?.factor_oferta) - 0.95) < 0.001);

// Check 2: Consorcio LIMA
console.log('\n▸ Check 2 · Consorcio LIMA · 2 integrantes 50/50');
const consorcio = await sql`
  SELECT razon_social, pct_participacion, es_lider
  FROM consorcios_integrantes
  WHERE proyecto_id = (SELECT id FROM proyectos WHERE codigo = 'PG0005')
  ORDER BY es_lider DESC
`;
check('2 consorciados', consorcio.length === 2);
check(
  'DORATTA líder 50%',
  consorcio[0]?.razon_social?.includes('DORATTA') &&
    Number(consorcio[0]?.pct_participacion) === 0.5 &&
    consorcio[0]?.es_lider === true,
);
check(
  'LCL no líder 50%',
  consorcio[1]?.razon_social?.includes('LCL') &&
    Number(consorcio[1]?.pct_participacion) === 0.5 &&
    consorcio[1]?.es_lider === false,
);

// Check 3: Penalidades catálogo
console.log('\n▸ Check 3 · Penalidades catálogo · 10 supuestos');
const penal = await sql`
  SELECT COUNT(*)::int AS c FROM penalidades_catalogo
  WHERE proyecto_id = (SELECT id FROM proyectos WHERE codigo = 'PG0005')
`;
check('10 penalidades catalogadas', penal[0]?.c === 10);

// Check 4: Parámetros tributarios
console.log('\n▸ Check 4 · Parámetros SUNAT · 8 vigentes');
const trib = await sql`
  SELECT COUNT(*)::int AS c FROM parametros
  WHERE categoria_id = 'tributario' AND estado = 'vigente'
`;
check('8 parámetros tributarios', trib[0]?.c === 8);

// Check 5: Función param_get
console.log('\n▸ Check 5 · Función param_get');
try {
  const det = await sql`SELECT param_get('detraccion_construccion_pct') AS v`;
  check('param_get(detraccion_construccion) = 0.04', parseFloat(String(det[0]?.v)) === 0.04);

  const jornal = await sql`SELECT param_get('jornal_operario') AS v`;
  check('param_get(jornal_operario) = 88.10', parseFloat(String(jornal[0]?.v)) === 88.1);

  const tope = await sql`SELECT param_get('tope_adicionales_pct') AS v`;
  check('param_get(tope_adicionales) = 0.50', parseFloat(String(tope[0]?.v)) === 0.5);
} catch (err) {
  check('param_get function works', false, String(err).slice(0, 100));
}

// Check 6: Domain events insert + LISTEN/NOTIFY trigger
console.log('\n▸ Check 6 · Domain events · trigger LISTEN/NOTIFY');
const proyectoId = p?.id;
try {
  await sql`
    INSERT INTO domain_events (aggregate_type, aggregate_id, aggregate_version, event_type, payload, metadata)
    VALUES ('Proyecto', ${proyectoId}, 1, 'TestF0Verify', '{"test":true}'::jsonb, '{"user":"verify"}'::jsonb)
  `;
  const events = await sql`SELECT COUNT(*)::int AS c FROM domain_events`;
  check('insert domain_event OK · sequence_number auto', events[0]?.c >= 1);

  const seqCheck = await sql`SELECT sequence_number FROM domain_events ORDER BY sequence_number DESC LIMIT 1`;
  check('sequence_number bigserial > 0', Number(seqCheck[0]?.sequence_number) > 0);
} catch (err) {
  check('domain_events insert', false, String(err).slice(0, 150));
}

// Check 7: Domain events INMUTABLE
console.log('\n▸ Check 7 · Domain events INMUTABLE');
try {
  await sql`DELETE FROM domain_events WHERE event_type = 'TestF0Verify'`;
  check('DELETE en domain_events bloqueado', false, 'no debió permitir DELETE');
} catch (err) {
  const msg = String(err);
  check('DELETE bloqueado correctamente', msg.includes('inmutables'));
}

try {
  await sql`UPDATE domain_events SET event_type = 'Hacked' WHERE event_type = 'TestF0Verify'`;
  check('UPDATE en domain_events bloqueado', false, 'no debió permitir UPDATE');
} catch (err) {
  const msg = String(err);
  check('UPDATE bloqueado correctamente', msg.includes('inmutables'));
}

// Check 8: Audit log immutable + hash chain
console.log('\n▸ Check 8 · Audit log · hash chain');
try {
  await sql`
    INSERT INTO audit_log_immutable (user_email, user_role, action)
    VALUES ('verify@f0', 'admin', 'verify_f0_test')
  `;
  const audit = await sql`
    SELECT current_hash, previous_hash FROM audit_log_immutable
    WHERE action = 'verify_f0_test'
    ORDER BY occurred_at DESC LIMIT 1
  `;
  const a = audit[0];
  check('audit log insertado', !!a);
  check('current_hash 64 chars (SHA-256)', a?.current_hash?.length === 64);
  check('previous_hash existe (puede ser empty si primer registro)', a?.previous_hash !== null);
} catch (err) {
  check('audit log hash chain', false, String(err).slice(0, 150));
}

// Check 9: Garantía retención 10%
console.log('\n▸ Check 9 · Garantía retención 10% PG0005');
const gar = await sql`
  SELECT tipo, monto, estado FROM garantias
  WHERE proyecto_id = (SELECT id FROM proyectos WHERE codigo = 'PG0005')
`;
check('1 garantía retención', gar.length === 1);
check('tipo = retencion', gar[0]?.tipo === 'retencion');
check('monto = 173,012.08', Number(gar[0]?.monto) === 173012.08);
check('estado = vigente', gar[0]?.estado === 'vigente');

// Check 10: Indices unificados
console.log('\n▸ Check 10 · Índices Unificados INEI');
const ius = await sql`SELECT COUNT(*)::int AS c FROM indices_unificados`;
check('29 IUs catalogados', ius[0]?.c === 29);

// Check 11: Período contable abierto
console.log('\n▸ Check 11 · Período contable diciembre 2025');
const periodo = await sql`
  SELECT estado FROM periodos_contables
  WHERE proyecto_id = (SELECT id FROM proyectos WHERE codigo = 'PG0005')
    AND anio = 2025 AND mes = 12
`;
check('período diciembre 2025 abierto', periodo[0]?.estado === 'abierto');

// ═══════════════════════════════════════════════════════════
// RESUMEN FINAL
// ═══════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(60)}`);
console.log(`Resultado F0 Foundation: ${pass} ✓ pasaron · ${fail} ✗ fallaron`);

if (fail > 0) {
  console.log('\n❌ FALLAS:');
  for (const f of fails) console.log(`  · ${f}`);
}

await sql.end();
process.exit(fail > 0 ? 1 : 0);
