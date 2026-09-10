/**
 * documentoAdjunto.ts — helper genérico para adjuntar archivos a cualquier entidad.
 * Sube el buffer al NAS y registra la fila en documento_adjunto.
 * NAS_ROOT_ADMIN = /ERP/02_Administracion (no cambiar aquí, viene del env).
 */
import { db, schema } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { env } from '../env.js';
import { nasUpload } from './nas.js';

// ─── Path builder (exported for unit tests) ──────────────────
export function buildNasPath(opts: {
  subPath: string;   // e.g. '2026-07/99999999'
  nombreArchivo: string;
}): string {
  const base = env.NAS_ROOT_ADMIN.replace(/\/$/, '');
  return `${base}/Planilla/${opts.subPath}/${opts.nombreArchivo}`;
}

// ─── Upload + insert ──────────────────────────────────────────
export async function registrarDocumento(opts: {
  entidadTipo: string;
  entidadId: string;
  docTipo: string;
  fileBuffer: Buffer;
  nombreArchivo: string;
  subidoPor: string | null;
  subPath?: string;
}): Promise<{ nasPath: string }> {
  const { entidadTipo, entidadId, docTipo, fileBuffer, nombreArchivo, subidoPor, subPath } = opts;

  const nasPath = buildNasPath({ subPath: subPath ?? entidadId, nombreArchivo });

  // dest folder = everything before the last '/'
  const lastSlash = nasPath.lastIndexOf('/');
  const destFolder = nasPath.substring(0, lastSlash);
  const filename = nasPath.substring(lastSlash + 1);

  await nasUpload(destFolder, filename, fileBuffer);

  await db.insert(schema.documentoAdjunto).values({
    entidadTipo,
    entidadId,
    docTipo,
    nasPath,
    nombreArchivo,
    subidoPor: subidoPor ?? null,
    fecha: new Date().toISOString().slice(0, 10),
  });

  return { nasPath };
}

// ─── Query helpers ────────────────────────────────────────────

/** Returns a map of docTipo → true for every doc that exists for the entity. */
export async function docsDeEntidad(
  entidadTipo: string,
  entidadId: string,
): Promise<Record<string, boolean>> {
  const rows = await db
    .select({ docTipo: schema.documentoAdjunto.docTipo })
    .from(schema.documentoAdjunto)
    .where(
      and(
        eq(schema.documentoAdjunto.entidadTipo, entidadTipo),
        eq(schema.documentoAdjunto.entidadId, entidadId),
      ),
    );

  const map: Record<string, boolean> = {};
  for (const r of rows) map[r.docTipo] = true;
  return map;
}

/** Convenience for planilla_oficina_detalle rows. */
export async function docsDetalle(
  detalleId: string,
): Promise<{ boleta: boolean; comprobante: boolean }> {
  const map = await docsDeEntidad('planilla_oficina_detalle', detalleId);
  return {
    boleta: map['boleta_pago'] === true,
    comprobante: map['comprobante_pago'] === true,
  };
}
