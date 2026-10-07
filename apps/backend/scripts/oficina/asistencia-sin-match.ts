/**
 * Quién quedó sin vincular tras el sync y por qué. El PIN del lector se matchea contra
 * empleados.num_doc; lo que no cruza queda con empleado_id null y no sirve para planilla.
 *
 * Desde apps/backend:
 *   node <tsx> scripts/oficina/asistencia-sin-match.ts
 */
import { db } from '@erp/db';
import { sql } from 'drizzle-orm';

const q = async (s: string) => { const r: any = await db.execute(sql.raw(s)); return (r.rows ?? r) as any[]; };

const [tot] = await q(`select count(*)::int n, count(empleado_id)::int ok,
    min(punch_time)::date primera, max(punch_time)::date ultima,
    count(distinct employee_code)::int personas from asistencia_marcacion`);
console.log(`· ${tot.n} marcaciones · ${tot.ok} vinculadas · ${tot.n - tot.ok} sueltas · ${tot.personas} personas · ${tot.primera} → ${tot.ultima}`);

console.log('\n· PINs SIN empleado (lo que hay que mapear):');
for (const r of await q(`
  select employee_code, max(nombre) nombre, count(*)::int marcas,
         min(punch_time)::date desde, max(punch_time)::date hasta
    from asistencia_marcacion where empleado_id is null
   group by employee_code order by marcas desc`)) {
  console.log(`   ${String(r.employee_code).padEnd(12)} ${String(r.nombre ?? '—').padEnd(34)} ${String(r.marcas).padStart(4)} marcas  ${r.desde} → ${r.hasta}`);
}

console.log('\n· PINs vinculados OK:');
for (const r of await q(`
  select m.employee_code, max(m.nombre) nombre, count(*)::int marcas
    from asistencia_marcacion m where m.empleado_id is not null
   group by m.employee_code order by marcas desc`)) {
  console.log(`   ${String(r.employee_code).padEnd(12)} ${String(r.nombre ?? '—').padEnd(34)} ${String(r.marcas).padStart(4)} marcas`);
}

// Un PIN que no cruza puede ser un empleado que SÍ existe con otro documento. Buscar por
// nombre es lo que convierte "202 sueltas" en una lista corta de correcciones concretas.
console.log('\n· empleados activos sin ninguna marcación vinculada:');
for (const r of await q(`
  select e.num_doc, e.nombre from empleados e
   where coalesce(e.activo, true)
     and not exists (select 1 from asistencia_marcacion m where m.empleado_id = e.id)
   order by e.nombre limit 40`)) {
  console.log(`   ${String(r.num_doc ?? '—').padEnd(12)} ${r.nombre}`);
}
process.exit(0);
