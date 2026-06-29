/**
 * Cliente NAS vía WebDAV (Synology WebDAV Server · puerto 5005 HTTP / 5006 HTTPS).
 * Protocolo estándar · auth básica (NAS_USER/PASS). Alcanzable desde cualquier red vía túnel.
 * Base de proyectos: NAS_ROOT (ej. /ERP/Proyectos). Carpeta por obra: NAS_ROOT/<codigo>.
 */
import { type WebDAVClient, createClient } from 'webdav';
import type { Readable } from 'node:stream';
import { env } from '../env.js';

let client: WebDAVClient | null = null;
function nas(): WebDAVClient {
  if (!client) {
    client = createClient(env.NAS_URL.replace(/\/$/, ''), { username: env.NAS_USER, password: env.NAS_PASS });
  }
  return client;
}

export type NasFile = { name: string; path: string; isDir: boolean; size: number; mtime: number | null };

function wrapErr(e: unknown): Error {
  const msg = (e as Error)?.message ?? String(e);
  if (/fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|timeout/i.test(msg)) {
    return new Error(`NAS no alcanzable (${env.NAS_URL}) · ¿WebDAV activo / túnel arriba / red?`);
  }
  if (/401|403|unauthorized/i.test(msg)) return new Error('NAS auth falló · revisa NAS_USER/PASS');
  return new Error(msg);
}

export async function nasList(folderPath: string): Promise<NasFile[]> {
  try {
    const items = (await nas().getDirectoryContents(folderPath)) as Array<{
      basename: string; filename: string; type: 'file' | 'directory'; size: number; lastmod: string;
    }>;
    return items.map((f) => ({
      name: f.basename,
      path: f.filename,
      isDir: f.type === 'directory',
      size: f.size ?? 0,
      mtime: f.lastmod ? new Date(f.lastmod).getTime() : null,
    }));
  } catch (e) {
    // 404 → carpeta no existe → vacío
    if (/404|not found/i.test((e as Error)?.message ?? '')) return [];
    throw wrapErr(e);
  }
}

export async function nasCreateFolder(parentPath: string, name: string): Promise<void> {
  const full = `${parentPath.replace(/\/$/, '')}/${name}`;
  try {
    await nas().createDirectory(full, { recursive: true });
  } catch (e) {
    // 405/409 → ya existe · OK
    if (/405|409|exist/i.test((e as Error)?.message ?? '')) return;
    throw wrapErr(e);
  }
}

export async function nasUpload(destFolder: string, filename: string, buffer: Buffer): Promise<void> {
  try {
    await nas().putFileContents(`${destFolder.replace(/\/$/, '')}/${filename}`, buffer, { overwrite: true });
  } catch (e) {
    throw wrapErr(e);
  }
}

export async function nasDownload(filePath: string): Promise<{ stream: Readable; filename: string }> {
  try {
    const stream = nas().createReadStream(filePath) as unknown as Readable;
    return { stream, filename: filePath.split('/').pop() ?? 'archivo' };
  } catch (e) {
    throw wrapErr(e);
  }
}

// Candado · el ERP-automático SOLO puede escribir bajo /ERP (carpeta no sincronizada).
// Evita repetir el incidente de escribir en /Proyectos (sincronizada con Synology Drive).
function assertErp(path: string, which: string): void {
  const n = `/${path.replace(/^\/+/, '')}`;
  if (n !== '/ERP' && !n.startsWith('/ERP/')) {
    throw new Error(`Bloqueado: el ERP solo escribe bajo /ERP. ${which} resolvió a "${path}". Corrige NAS_ROOT/NAS_ROOT_ADMIN en .env.`);
  }
}

// Carpeta base de un proyecto · NAS_ROOT/<codigo> (siempre bajo /ERP)
export function nasProyectoPath(codigo: string): string {
  const p = `${env.NAS_ROOT.replace(/\/$/, '')}/${codigo}`;
  assertErp(p, 'NAS_ROOT');
  return p;
}

// Estructura estándar de carpetas por obra (ASCII · sin tildes/espacios → seguro WebDAV)
export const NAS_CARPETAS_ESTANDAR = [
  '01_Contrato',
  '02_Expediente_Tecnico',
  '03_Valorizaciones',
  '04_Cuaderno_Obra',
  '05_Garantias_Adelantos',
  '06_Planos',
  '07_Ensayos_Calidad',
  '08_Actas',
  '09_Fotos',
  '10_Adicionales_Ampliaciones',
  '11_Penalidades',
  '12_Liquidacion',
  '13_Logistica',
  '14_Administrativo',
];

export async function nasInitProyecto(codigo: string): Promise<string[]> {
  const root = env.NAS_ROOT.replace(/\/$/, '');
  const baseP = nasProyectoPath(codigo);
  await nasCreateFolder(root, codigo); // asegurar base del proyecto
  const creadas: string[] = [];
  for (const carpeta of NAS_CARPETAS_ESTANDAR) {
    await nasCreateFolder(baseP, carpeta);
    creadas.push(carpeta);
  }
  return creadas;
}

// Archiva un buffer en <proyecto>/<subcarpeta>/<filename> · BEST-EFFORT (nunca lanza).
// Crea la carpeta si falta. Devuelve true si quedó archivado. Para auto-archivar
// uploads del ERP (valorización, .mpp, contrato, cronograma) sin bloquear la acción.
export async function nasArchivarProyecto(codigo: string, subcarpeta: string, filename: string, buffer: Buffer): Promise<boolean> {
  try {
    const folder = `${nasProyectoPath(codigo)}/${subcarpeta}`;
    await nas().createDirectory(folder, { recursive: true }).catch((e) => {
      if (!/405|409|exist/i.test((e as Error)?.message ?? '')) throw e;
    });
    await nasUpload(folder, filename, buffer);
    return true;
  } catch (e) {
    console.error(`[nasArchivar] ${codigo}/${subcarpeta}/${filename}: ${(e as Error).message}`);
    return false;
  }
}

// ─── Logística · carpeta de una OC/OS ────────────────────────
// Con obra:  {proyecto}/13_Logistica/{anio}/{numero}/
// Sin obra:  {NAS_ROOT_ADMIN}/Logistica/{anio}/{numero}/  (oficina/empresa MM)
export function nasOcFolder(opts: { proyectoCodigo: string | null; anio: number; numero: string }): string {
  const { proyectoCodigo, anio, numero } = opts;
  if (proyectoCodigo) {
    return `${nasProyectoPath(proyectoCodigo)}/13_Logistica/${anio}/${numero}`;
  }
  const adminBase = env.NAS_ROOT_ADMIN.replace(/\/$/, '');
  assertErp(adminBase, 'NAS_ROOT_ADMIN');
  return `${adminBase}/Logistica/${anio}/${numero}`;
}

// Crea recursivamente la carpeta de la OC y devuelve su path
export async function nasEnsureOcFolder(opts: { proyectoCodigo: string | null; anio: number; numero: string }): Promise<string> {
  // Asegura la estructura estándar de la obra (14 carpetas) antes de crear la subcarpeta de la OC.
  if (opts.proyectoCodigo) await nasInitProyecto(opts.proyectoCodigo).catch(() => {});
  const folder = nasOcFolder(opts);
  await nas().createDirectory(folder, { recursive: true }).catch((e) => {
    if (!/405|409|exist/i.test((e as Error)?.message ?? '')) throw wrapErr(e);
  });
  return folder;
}
