// temporal · solo lectura: cuánta marcación real hay y qué dice el estado zlink
import { db } from '@erp/db';
import { sql } from 'drizzle-orm';

const r = await db.execute(sql`
  select count(*)::int as total,
         count(empleado_id)::int as con_empleado,
         min(punch_time) as primera,
         max(punch_time) as ultima,
         count(distinct device_sn)::int as lectores
  from asistencia_marcacion
`);
console.log('marcaciones:', r);

const c = await db.execute(sql`
  select base_url, company_id,
         (access_token is not null) as tiene_token,
         (refresh_token is not null) as tiene_refresh,
         token_expiry, last_sync_at, last_sync_msg
  from zlink_config
`);
console.log('config:', c);
process.exit(0);
