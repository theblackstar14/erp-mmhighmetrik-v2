// Integración lector biométrico SenseFP M1 vía nube ZKBio Zlink.
// El lector solo empuja a la nube Zlink (sin ADMS ni puerto LAN); el ERP la sondea.
// Endpoint de marcaciones verificado en vivo: POST /api/v1.0/transaction/ (Bearer token).
import { db, schema } from '@erp/db';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';

export type ZlinkTxn = {
  id: number | string;
  employee_code: string;
  first_name?: string;
  punch_time: string; // 'YYYY-MM-DD HH:mm:ss'
  upload_time?: string;
  terminal_sn?: string;
  terminal_alias?: string;
  timezone?: string;
  source?: number;
};

export class ZlinkError extends Error {}

async function getConfig(): Promise<schema.ZlinkConfig> {
  let [cfg] = await db.select().from(schema.zlinkConfig).limit(1);
  if (!cfg) [cfg] = await db.insert(schema.zlinkConfig).values({ id: 'singleton' }).returning();
  return cfg!;
}

// Token válido: usa el access_token si no venció; si venció intenta refrescar (best-effort).
// El refresh depende del endpoint de Minerva (ZLINK_REFRESH_URL); si no está configurado
// y el token venció, pide re-vincular. La obtención inicial del token la siembra el usuario
// (pega el token del portal) — no manejamos su contraseña.
async function tokenValido(cfg: schema.ZlinkConfig): Promise<string> {
  const margen = 60_000; // 1 min de margen
  const vigente = cfg.accessToken && cfg.tokenExpiry && cfg.tokenExpiry.getTime() - margen > Date.now();
  if (vigente) return cfg.accessToken!;

  if (cfg.refreshToken && process.env.ZLINK_REFRESH_URL) {
    const nuevo = await refrescarToken(cfg);
    if (nuevo) return nuevo;
  }
  throw new ZlinkError('Token de Zlink vencido o ausente · vincula el lector de nuevo (pega el token del portal)');
}

// Refresco best-effort. El endpoint exacto de Minerva se configura por env para no hardcodear
// una URL sin verificar. ponytail: cuando ZKTeco confirme el endpoint OpenAPI, fijarlo aquí.
async function refrescarToken(cfg: schema.ZlinkConfig): Promise<string | null> {
  try {
    const resp = await fetch(process.env.ZLINK_REFRESH_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: cfg.refreshToken }),
    });
    if (!resp.ok) return null;
    const j = (await resp.json()) as { access_token?: string; expires_in?: number; refresh_token?: string };
    if (!j.access_token) return null;
    const expiry = new Date(Date.now() + (Number(j.expires_in ?? 3599) * 1000));
    await db.update(schema.zlinkConfig).set({
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? cfg.refreshToken,
      tokenExpiry: expiry,
    }).where(eq(schema.zlinkConfig.id, 'singleton'));
    return j.access_token;
  } catch {
    return null;
  }
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// Trae marcaciones del rango [desde, hasta] paginando. source=0 = todas las fuentes.
export async function fetchTransactions(cfg: schema.ZlinkConfig, token: string, desde: Date, hasta: Date): Promise<ZlinkTxn[]> {
  const base = cfg.baseUrl.replace(/\/$/, '');
  const out: ZlinkTxn[] = [];
  const pageSize = 100;
  for (let page = 1; page <= 50; page++) { // tope 5000 marcaciones/sync
    const qs = new URLSearchParams({
      pageSize: String(pageSize), start_date: ymd(desde), end_date: ymd(hasta),
      source: '0', pageNumber: String(page), ordering: '-punch_time,',
    });
    const resp = await fetch(`${base}/api/v1.0/transaction/?${qs}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (resp.status === 401 || resp.status === 403) throw new ZlinkError('Zlink rechazó el token (401/403) · re-vincula el lector');
    if (!resp.ok) throw new ZlinkError(`Zlink respondió ${resp.status}`);
    const j = (await resp.json()) as { result?: { total?: number; data?: ZlinkTxn[] } };
    const data = j.result?.data ?? [];
    out.push(...data);
    if (data.length < pageSize) break; // última página
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
    configurado: !!cfg.accessToken,
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
