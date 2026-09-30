import assert from 'node:assert/strict';
import { db, schema } from '@erp/db';
import { eq } from 'drizzle-orm';
import { getYtd } from '../../src/lib/renta5taYtd.js';

const [emp] = await db.select({ id: schema.empleados.id }).from(schema.empleados).limit(1);
await db.delete(schema.renta5taBaseline).where(eq(schema.renta5taBaseline.empleadoId, emp!.id));
await db.insert(schema.renta5taBaseline).values({ empleadoId: emp!.id, anio: 2026, acumuladoImportado: '12000', retencionesImportadas: '340' });
const y = await getYtd(emp!.id, 2026, 2);
assert.ok(Math.abs(y.acumuladoPercibido - 12000) <= 0.01 && Math.abs(y.retencionesPrevias - 340) <= 0.01, 'import baseline refleja en YTD');
await db.delete(schema.renta5taBaseline).where(eq(schema.renta5taBaseline.empleadoId, emp!.id));
console.log('config-oficina VERDE'); process.exit(0);
