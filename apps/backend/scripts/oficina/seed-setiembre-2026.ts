/**
 * Seed planilla oficina Setiembre 2026 (17 personas, segun Excel/planilla fisica).
 * Escribe SOLO empleados + adelantos (prorrateo). Luego recalcular la planilla 2026-09
 * desde la UI (boton Calcular) o el endpoint /calcular.
 *
 * Caso de demo: pension VARIADA (ONP + 4 AFP) y varios adelantos prorrateados como prestamo.
 * 3 personas dejadas "exactas" segun la fuente (sin adelanto sintetico): Mario, Vivian, Kely.
 * (Las tasas/pension del resto "se confirmaran" luego — aqui variadas para exponer el motor.)
 *
 * Modos:
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/oficina/seed-setiembre-2026.ts
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/oficina/seed-setiembre-2026.ts --limpiar
 *
 * Requiere DATABASE_URL=erp_mmh_test.
 */
import { db, schema } from '@erp/db';
import { eq, like, inArray } from 'drizzle-orm';

const MARKER = 'SEED-SET2026';        // banco marker en empleados nuevos
const ADEL_MOTIVO = 'Adelanto set-2026 (demo prorrateo)';
const FECHA_ADELANTO = '2026-09-01';

interface Persona {
  dni: string;
  nombre: string;
  cargo: string;
  ingreso: string;
  cese?: string;
  sueldo: number;
  pension: string;                    // 'ONP' | 'AFP Integra(M)' | ...
  adelanto?: { monto: number; cuotas: number };
  activo?: boolean;                   // default true
}

// ── Roster (fuente: planilla fisica). Pension del resto = demo variada; se confirmara. ──
const ROSTER: Persona[] = [
  // EXACTOS (pension real conocida, sin adelanto):
  { dni: '48448443', nombre: 'GARCIA CALDERON MARIO GUILLERMO', cargo: 'GERENTE ADMINISTRATIVO', ingreso: '2025-06-01', sueldo: 12850, pension: 'AFP Profuturo(M)' },
  { dni: '72172317', nombre: 'RIVERA LOZANO VIVIAN',            cargo: 'INGENIERA CIVIL',         ingreso: '2025-06-01', sueldo: 10000, pension: 'AFP Profuturo(F)' },
  { dni: '76474088', nombre: 'MENDIETA GUEVARA KELY',           cargo: 'ASISTENTE DE CONTABILIDAD', ingreso: '2025-11-03', sueldo: 2200, pension: 'AFP Integra(F)' },
  // RESTO (pension variada + adelantos demo):
  { dni: '43760364', nombre: 'HUERTA FELIX JOSEPH JOHAN',       cargo: 'AUXILIAR LOGISTICO',       ingreso: '2023-12-01', sueldo: 1130, pension: 'ONP' },
  { dni: '70998972', nombre: 'MORENO RAMOS VICTOR JOEL',        cargo: 'ASISTENTE DE LOGISTICA',   ingreso: '2025-06-08', sueldo: 5000, pension: 'AFP Integra(M)', adelanto: { monto: 3000, cuotas: 3 } },
  { dni: '46710141', nombre: 'CHALLCO HUAMAN JONATHAN EDWARD',  cargo: 'ASISTENTE DE OFICINA TECNICA', ingreso: '2025-08-01', sueldo: 3500, pension: 'AFP Integra(M)' },
  { dni: '70320583', nombre: 'ACOSTA PAYANO RENZO ANGELO',      cargo: 'ASISTENTE DE PROYECTOS',   ingreso: '2026-01-17', sueldo: 3000, pension: 'ONP', adelanto: { monto: 1500, cuotas: 3 } },
  { dni: '74643871', nombre: 'RAMIREZ FLORES SHEYLA NAYLIN',    cargo: 'PRACTICANTE DE ARQUITECTURA', ingreso: '2026-05-01', sueldo: 1130, pension: 'AFP Prima(F)' },
  { dni: '74699328', nombre: 'ARIAS SANDOVAL MIKE ANDERSON',    cargo: 'EJECUTIVO',                ingreso: '2026-04-01', sueldo: 5810, pension: 'AFP Habitat(M)', adelanto: { monto: 2400, cuotas: 4 } },
  { dni: '47349935', nombre: 'BAUTISTA CARAZAS ELVIS YOEL',     cargo: 'RESIDENTE CALABOZO',       ingreso: '2026-05-01', sueldo: 5000, pension: 'AFP Profuturo(M)', adelanto: { monto: 5000, cuotas: 5 } },
  { dni: '73800815', nombre: 'CISNEROS PIANTO MIGUEL ANGEL',    cargo: 'SSOMA CALABOZO',           ingreso: '2026-05-01', sueldo: 4200, pension: 'ONP' },
  { dni: '07629725', nombre: 'CAVERO BELTRAN SERGIO EDUARDO',   cargo: 'RESIDENTE SAN MARTIN',     ingreso: '2026-05-01', sueldo: 1130, pension: 'AFP Integra(M)' },
  { dni: '71237840', nombre: 'MIJAHUANCA RUBEN ESWAR EDINSON',  cargo: 'SSOMA SAN MARTIN',         ingreso: '2026-05-01', sueldo: 3700, pension: 'AFP Prima(M)' },
  { dni: '43170938', nombre: 'LEVANO CHARALLA LUIS RUBEN',      cargo: 'RESIDENTE OBRA',           ingreso: '2026-05-01', sueldo: 6000, pension: 'AFP Profuturo(M)', adelanto: { monto: 4500, cuotas: 3 } },
  { dni: '60895477', nombre: 'GARCIA CALDERON ANDREA',          cargo: 'ENCARGADA DE REDES SOCIALES', ingreso: '2026-06-01', sueldo: 5000, pension: 'ONP' },
  { dni: '73653370', nombre: 'YANGARI BERROCAL RICKY BRAYAN',   cargo: 'ENCARGADO DE LOGISTICA',   ingreso: '2026-06-01', cese: '2026-07-31', sueldo: 3100, pension: 'AFP Integra(M)', activo: false },
  { dni: '77033457', nombre: 'HUAMAN GAGO LUIS EVER',           cargo: 'ALMACEN',                  ingreso: '2026-05-01', sueldo: 2800, pension: 'AFP Habitat(M)', adelanto: { monto: 1200, cuotas: 2 } },
];

(async () => {
  const isLimpiar = process.argv.includes('--limpiar');
  try {
    if (isLimpiar) {
      console.log('\n==== limpiar seed-setiembre-2026 ====');
      const seeded = await db.select({ id: schema.empleados.id, nombre: schema.empleados.nombre })
        .from(schema.empleados).where(eq(schema.empleados.banco, MARKER));
      if (seeded.length) {
        await db.delete(schema.adelantoOficina)
          .where(inArray(schema.adelantoOficina.empleadoId, seeded.map((s) => s.id)));
        await db.delete(schema.empleados).where(eq(schema.empleados.banco, MARKER));
      }
      // adelantos demo tambien pueden estar sobre empleados preexistentes (no-MARKER)
      await db.delete(schema.adelantoOficina).where(like(schema.adelantoOficina.motivo, 'Adelanto set-2026%'));
      console.log(`  ${seeded.length} empleados seed eliminados + adelantos demo purgados.`);
      return;
    }

    console.log('\n==== seed-setiembre-2026 · upsert empleados + adelantos ====');
    let creados = 0, actualizados = 0, adelantosCreados = 0;

    // Purgar adelantos demo previos (idempotencia)
    await db.delete(schema.adelantoOficina).where(like(schema.adelantoOficina.motivo, 'Adelanto set-2026%'));

    for (const p of ROSTER) {
      const [existing] = await db.select({ id: schema.empleados.id, banco: schema.empleados.banco })
        .from(schema.empleados).where(eq(schema.empleados.numDoc, p.dni)).limit(1);

      const base = {
        nombre: p.nombre,
        cargo: p.cargo,
        tipoPlanilla: 'admin' as const,
        activo: p.activo ?? true,
        sistemaPension: p.pension,
        sueldoBaseMensual: String(p.sueldo),
        fechaIngreso: p.ingreso,
        fechaCese: p.cese ?? null,
        asignacionFamiliar: false,
      };

      let empId: string;
      if (existing) {
        // No pisar banco si el empleado ya existia sin marker (dato real).
        await db.update(schema.empleados).set(base).where(eq(schema.empleados.id, existing.id));
        empId = existing.id;
        actualizados++;
        console.log(`  ~ ${p.nombre.padEnd(34)} (update) pension=${p.pension}`);
      } else {
        const [ins] = await db.insert(schema.empleados)
          .values({ ...base, numDoc: p.dni, banco: MARKER }).returning({ id: schema.empleados.id });
        empId = ins!.id;
        creados++;
        console.log(`  + ${p.nombre.padEnd(34)} (nuevo)  pension=${p.pension}`);
      }

      if (p.adelanto) {
        await db.insert(schema.adelantoOficina).values({
          empleadoId: empId,
          fecha: FECHA_ADELANTO,
          montoTotal: String(p.adelanto.monto),
          numCuotas: p.adelanto.cuotas,
          motivo: ADEL_MOTIVO,
          estado: 'vigente',
        });
        adelantosCreados++;
        const cuota = Math.round((p.adelanto.monto / p.adelanto.cuotas) * 100) / 100;
        console.log(`      adelanto ${p.adelanto.monto} / ${p.adelanto.cuotas} cuotas => ${cuota}/mes`);
      }
    }

    console.log(`\n  Empleados: ${creados} nuevos, ${actualizados} actualizados. Adelantos: ${adelantosCreados}.`);
    console.log('  Ahora recalcular la planilla 2026-09 (boton Calcular en la UI o POST /calcular).');
    console.log('  Nota: empleados admin preexistentes SIN sueldo (Delgado/Leguia/Rojas/Sanchez) saldran en 0.00.\n');
  } catch (e: any) {
    console.error('\n  ERROR:', e?.message ?? e);
    if (e?.stack) console.error(e.stack);
    process.exitCode = 1;
  } finally {
    await (db as any).$client?.end?.().catch(() => {});
    process.exit(process.exitCode ?? 0);
  }
})();
