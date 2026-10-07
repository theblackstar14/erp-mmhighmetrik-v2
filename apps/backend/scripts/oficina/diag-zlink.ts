// Diagnóstico Zlink · estado del token cacheado + login limpio + una llamada cruda a
// /dcc/transaction mostrando el cuerpo de la respuesta (no solo el status).
// No escribe nada salvo los tokens que devuelve el login.
import '../../src/env.js';
import { db } from '@erp/db';
import { sql } from 'drizzle-orm';

const q = async (s: string) => { const r: any = await db.execute(sql.raw(s)); return (r.rows ?? r) as any[]; };

const [cfg] = await q(`select base_url, company_id,
    (access_token is not null) as tok, coalesce(length(access_token),0) as tlen,
    (refresh_token is not null) as refr, token_expiry, last_sync_at, last_sync_msg
  from zlink_config`);
console.log('· zlink_config:', cfg);
console.log('· token cacheado vigente?', cfg?.token_expiry ? new Date(cfg.token_expiry) > new Date() : false);

// Login limpio, ignorando lo cacheado.
const { cifrarPassword } = await import('../../src/lib/zlinkAsistencia.js');
const base = String(cfg.base_url).replace(/\/$/, '') + '/zlink-api';
const userName = process.env.ZLINK_USER!;
const lr = await fetch(`${base}/v2.0/zlink/customer/sso/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Source: 'pc', 'Accept-Language': 'en-US' },
  body: JSON.stringify({ userName, password: cifrarPassword(process.env.ZLINK_PASS!, userName) }),
});
const lj: any = await lr.json().catch(() => ({}));
console.log(`· login HTTP ${lr.status} · code=${lj.code} · keys(data)=${Object.keys(lj.data ?? {}).join(',')}`);
const token = lj.data?.access_token;
if (!token) { console.error('✗ sin access_token:', JSON.stringify(lj).slice(0, 400)); process.exit(1); }
console.log(`· access_token ${String(token).length} chars · expires_in ${lj.data?.expires_in}`);

// Llamada cruda: acá queremos VER el cuerpo, que es lo que el error 401/403 esconde.
const ids = (process.env.ZLINK_DEVICE_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const body = {
  pageNumber: 1, pageSize: 10, current: 1, operator: null,
  startDateTime: '2022-01-01 00:00:00', endDateTime: '2026-12-31 23:59:59',
  eventTime: ['2022-01-01', '2026-12-31'], deviceIds: ids, deviceType: 'att',
};
const tr = await fetch(`${base}/v1.0/zlink/dcc/transaction`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Source: 'pc', 'Accept-Language': 'en-US' },
  body: JSON.stringify(body),
});
const texto = await tr.text();
console.log(`· transaction HTTP ${tr.status}`);
console.log('· respuesta:', texto.slice(0, 600));
process.exit(0);
