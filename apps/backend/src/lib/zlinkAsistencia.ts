// Integración lector biométrico SenseFP M1 vía nube ZKBio Zlink (portal minervaiot).
// El lector solo empuja a la nube Zlink (sin ADMS ni puerto LAN); el ERP la sondea.
//
// Contrato reversiado del portal (bundle main.8b00402f + HAR real 2026-10-06):
//   login    POST /zlink-api/v2.0/zlink/customer/sso/login          {userName, password:<AES>}  → access/refresh_token, expires_in
//   refresh  POST /zlink-api/v1.0/zlink/customer/sso/refresh_token   {refresh_token}            → access/refresh_token, expires_in
//   marcas   POST /zlink-api/v1.0/zlink/dcc/transaction (Bearer)     {deviceIds, deviceType:att, rango, paginación} → data.list
// Password cifrado client-side: AES-256-CBC, key=MD5hex("ZlkLgInSeCetKKrEy:"+userName), iv="VrdMiseryEbcDzEK", base64.
// Credenciales por env (nunca manejamos la contraseña en claro en DB): ZLINK_USER, ZLINK_PASS, ZLINK_DEVICE_IDS.
import { createCipheriv, createHash } from 'node:crypto';
import { db, schema } from '@erp/db';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';

// Forma interna normalizada. fetchTransactions mapea la respuesta real del portal a esto,
// así persistir()/el match por numDoc no dependen de los nombres de campo de Zlink.
export type ZlinkTxn = {
  id: number | string;
  employee_code: string;
  first_name?: string;
  punch_time: string; // ISO con tz, p.ej. '2026-06-11T17:12:10-05:00'
  upload_time?: string;
  terminal_sn?: string;
  terminal_alias?: string;
  timezone?: string;
  source?: number;
};

export class ZlinkError extends Error {}

// Cifrado de contraseña exacto al del portal (ver cabecera). stdlib, sin CryptoJS.
const ZLINK_PW_SALT = 'ZlkLgInSeCetKKrEy:';
const ZLINK_PW_IV = 'VrdMiseryEbcDzEK'; // 16 bytes fijos
// Exportada solo para que scripts/oficina/test-zlink-crypto.ts pruebe ESTA función y no una copia.
export function cifrarPassword(password: string, userName: string): string {
  const key = createHash('md5').update(ZLINK_PW_SALT + userName).digest('hex'); // 32 ascii = AES-256
  const c = createCipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), Buffer.from(ZLINK_PW_IV, 'utf8'));
  return Buffer.concat([c.update(password, 'utf8'), c.final()]).toString('base64');
}

async function getConfig(): Promise<schema.ZlinkConfig> {
  let [cfg] = await db.select().from(schema.zlinkConfig).limit(1);
  if (!cfg) [cfg] = await db.insert(schema.zlinkConfig).values({ id: 'singleton' }).returning();
  return cfg!;
}

// Token válido: usa el access_token cacheado si no venció; si venció refresca; si no hay
// refresh válido, hace login con las credenciales de env. Sin credenciales → error claro.
async function tokenValido(cfg: schema.ZlinkConfig): Promise<string> {
  const margen = 60_000; // 1 min de margen
  const vigente = cfg.accessToken && cfg.tokenExpiry && cfg.tokenExpiry.getTime() - margen > Date.now();
  if (vigente) return cfg.accessToken!;

  if (cfg.refreshToken) {
    const nuevo = await refrescarToken(cfg);
    if (nuevo) return nuevo;
  }
  return login(cfg);
}

const apiBase = (cfg: schema.ZlinkConfig) => cfg.baseUrl.replace(/\/$/, '') + '/zlink-api';

// Guarda el par de tokens devuelto por login/refresh y devuelve el access_token.
async function guardarTokens(j: { access_token?: string; refresh_token?: string; expires_in?: number }, fallbackRefresh?: string | null): Promise<string> {
  if (!j.access_token) throw new ZlinkError('Zlink no devolvió access_token');
  const expiry = new Date(Date.now() + Number(j.expires_in ?? 3599) * 1000);
  await db.update(schema.zlinkConfig).set({
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? fallbackRefresh ?? null,
    tokenExpiry: expiry,
  }).where(eq(schema.zlinkConfig.id, 'singleton'));
  return j.access_token;
}

// Login con usuario+contraseña (env). La contraseña viaja cifrada igual que el portal.
async function login(cfg: schema.ZlinkConfig): Promise<string> {
  const userName = process.env.ZLINK_USER;
  const password = process.env.ZLINK_PASS;
  if (!userName || !password) {
    throw new ZlinkError('Credenciales de Zlink ausentes · define ZLINK_USER y ZLINK_PASS en el entorno del backend');
  }
  const resp = await fetch(`${apiBase(cfg)}/v2.0/zlink/customer/sso/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Source: 'pc', 'Accept-Language': 'en-US' },
    body: JSON.stringify({ userName, password: cifrarPassword(password, userName) }),
  });
  const j = (await resp.json().catch(() => ({}))) as { code?: string; message?: string; data?: { access_token?: string; refresh_token?: string; expires_in?: number } };
  if (!resp.ok || !j.data?.access_token) {
    throw new ZlinkError(`Login Zlink falló (${resp.status}${j.code ? ' ' + j.code : ''})${j.message ? ': ' + j.message : ''}`);
  }
  return guardarTokens(j.data);
}

async function refrescarToken(cfg: schema.ZlinkConfig): Promise<string | null> {
  try {
    const resp = await fetch(`${apiBase(cfg)}/v1.0/zlink/customer/sso/refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Source: 'pc' },
      body: JSON.stringify({ refresh_token: cfg.refreshToken }),
    });
    if (!resp.ok) return null;
    const j = (await resp.json().catch(() => ({}))) as { data?: { access_token?: string; refresh_token?: string; expires_in?: number } };
    if (!j.data?.access_token) return null;
    return guardarTokens(j.data, cfg.refreshToken);
  } catch {
    return null;
  }
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const ymdhms = (d: Date, end = false) => `${ymd(d)} ${end ? '23:59:59' : '00:00:00'}`;

// IDs de lector a sondear (env, coma-separado). Es un UUID interno de 32 hex, NO el serial que
// el portal muestra bajo el nombre del lector (ese sale en la respuesta como `deviceSn`).
// Se saca del propio request del portal: F12 → Network → POST /dcc/transaction → payload.deviceIds.
function deviceIds(): string[] {
  return (process.env.ZLINK_DEVICE_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

// Fila cruda del portal (POST /dcc/transaction → data.list). Solo los campos que usamos.
type ZlinkRawTxn = {
  id: string; personPin?: string; personName?: string;
  punchTime?: string; eventTime?: string; deviceSn?: string; devAlias?: string;
};

// Trae marcaciones del rango [desde, hasta] paginando. Normaliza a ZlinkTxn en el borde.
export async function fetchTransactions(cfg: schema.ZlinkConfig, token: string, desde: Date, hasta: Date): Promise<ZlinkTxn[]> {
  const ids = deviceIds();
  if (ids.length === 0) throw new ZlinkError('Sin lectores configurados · define ZLINK_DEVICE_IDS (deviceId del portal)');
  const url = `${apiBase(cfg)}/v1.0/zlink/dcc/transaction`;
  const out: ZlinkTxn[] = [];
  const pageSize = 100;
  for (let page = 1; page <= 50; page++) { // tope 5000 marcaciones/sync
    const body = {
      pageNumber: page, pageSize, current: page, operator: null,
      startDateTime: ymdhms(desde), endDateTime: ymdhms(hasta, true),
      eventTime: [ymd(desde), ymd(hasta)], deviceIds: ids, deviceType: 'att',
    };
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Source: 'pc', 'Accept-Language': 'en-US' },
      body: JSON.stringify(body),
    });
    if (resp.status === 401 || resp.status === 403) throw new ZlinkError('Zlink rechazó el token (401/403) · revisa credenciales');
    if (!resp.ok) throw new ZlinkError(`Zlink respondió ${resp.status}`);
    const j = (await resp.json()) as { code?: string; data?: { totalCount?: number; list?: ZlinkRawTxn[] } };
    const list = j.data?.list ?? [];
    for (const r of list) {
      out.push({
        id: r.id,
        employee_code: String(r.personPin ?? ''),
        first_name: r.personName,
        punch_time: r.punchTime ?? (r.eventTime ?? '').replace(' ', 'T'),
        terminal_sn: r.deviceSn,
        terminal_alias: r.devAlias,
      });
    }
    if (list.length < pageSize) break; // última página
  }
  return out;
}

// Match employee_code → empleado por numDoc (DNI/PIN). Sin match → empleadoId null (se conserva igual).
function indexarEmpleados(empleados: { id: string; numDoc: string | null }[]) {
  const m = new Map<string, string>();
  for (const e of empleados) if (e.numDoc) m.set(e.numDoc.trim(), e.id);
  return m;
}

export type SyncResult = { traidas: number; nuevas: number; sinMatch: number; desde: string; hasta: string };

// Sincroniza: token → fetch desde la última marcación (−2 días de solape) → dedupe → match → insert.
export async function syncAsistencia(): Promise<SyncResult> {
  const cfg = await getConfig();
  const token = await tokenValido(cfg);

  // Ventana: desde la última marcación guardada −2 días (solape por subidas tardías), o 30 días atrás.
  const [ultima] = await db.select({ punch: schema.asistenciaMarcacion.punchTime })
    .from(schema.asistenciaMarcacion).orderBy(desc(schema.asistenciaMarcacion.punchTime)).limit(1);
  const hasta = new Date();
  const desde = ultima?.punch ? new Date(ultima.punch.getTime() - 2 * 86400_000) : new Date(Date.now() - 30 * 86400_000);

  const txns = await fetchTransactions(cfg, token, desde, hasta);
  const result = await persistir(txns, ymd(desde), ymd(hasta));

  await db.update(schema.zlinkConfig).set({
    lastSyncAt: new Date(),
    lastSyncMsg: `${result.nuevas} nuevas de ${result.traidas} (${result.sinMatch} sin empleado)`,
  }).where(eq(schema.zlinkConfig.id, 'singleton'));
  return result;
}

// Dedupe por zlink_id + match por numDoc. Separado para poder testear sin red.
export async function persistir(txns: ZlinkTxn[], desde: string, hasta: string): Promise<SyncResult> {
  if (txns.length === 0) return { traidas: 0, nuevas: 0, sinMatch: 0, desde, hasta };
  const ids = txns.map((t) => String(t.id));
  const existentes = new Set(
    (await db.select({ z: schema.asistenciaMarcacion.zlinkId }).from(schema.asistenciaMarcacion)
      .where(inArray(schema.asistenciaMarcacion.zlinkId, ids))).map((r) => r.z),
  );
  const nuevos = txns.filter((t) => !existentes.has(String(t.id)));
  if (nuevos.length === 0) return { traidas: txns.length, nuevas: 0, sinMatch: 0, desde, hasta };

  const empleados = await db.select({ id: schema.empleados.id, numDoc: schema.empleados.numDoc }).from(schema.empleados);
  const idx = indexarEmpleados(empleados);

  let sinMatch = 0;
  const rows = nuevos.map((t) => {
    const empleadoId = idx.get((t.employee_code ?? '').trim()) ?? null;
    if (!empleadoId) sinMatch++;
    return {
      zlinkId: String(t.id),
      employeeCode: String(t.employee_code ?? ''),
      empleadoId,
      nombre: t.first_name ?? null,
      punchTime: new Date(t.punch_time.replace(' ', 'T')),
      deviceSn: t.terminal_sn ?? null,
      terminalAlias: t.terminal_alias ?? null,
      raw: t as unknown as Record<string, unknown>,
    };
  });
  await db.insert(schema.asistenciaMarcacion).values(rows).onConflictDoNothing();
  return { traidas: txns.length, nuevas: rows.length, sinMatch, desde, hasta };
}

// Lista marcaciones de un rango (para la UI).
export async function listarMarcaciones(desde: string, hasta: string) {
  return db.select().from(schema.asistenciaMarcacion)
    .where(and(gte(schema.asistenciaMarcacion.punchTime, new Date(desde + 'T00:00:00')),
               lte(schema.asistenciaMarcacion.punchTime, new Date(hasta + 'T23:59:59'))))
    .orderBy(desc(schema.asistenciaMarcacion.punchTime));
}

export async function getEstadoZlink() {
  const cfg = await getConfig();
  return {
    configurado: !!(process.env.ZLINK_USER && process.env.ZLINK_PASS), // login por credenciales (env)
    lectores: deviceIds().length,
    baseUrl: cfg.baseUrl,
    companyId: cfg.companyId,
    tokenExpiry: cfg.tokenExpiry,
    lastSyncAt: cfg.lastSyncAt,
    lastSyncMsg: cfg.lastSyncMsg,
  };
}

export async function setConfigZlink(patch: { baseUrl?: string; companyId?: string; accessToken?: string; refreshToken?: string; expiresIn?: number }) {
  await db.insert(schema.zlinkConfig).values({ id: 'singleton' }).onConflictDoNothing();
  const set: Record<string, unknown> = {};
  if (patch.baseUrl !== undefined) set.baseUrl = patch.baseUrl;
  if (patch.companyId !== undefined) set.companyId = patch.companyId;
  if (patch.accessToken !== undefined) {
    set.accessToken = patch.accessToken;
    set.tokenExpiry = new Date(Date.now() + (Number(patch.expiresIn ?? 3599) * 1000));
  }
  if (patch.refreshToken !== undefined) set.refreshToken = patch.refreshToken;
  await db.update(schema.zlinkConfig).set(set).where(eq(schema.zlinkConfig.id, 'singleton'));
  return getEstadoZlink();
}
