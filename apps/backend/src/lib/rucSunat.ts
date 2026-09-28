// F5.1 · consulta de RUC en la API pública (apis.net.pe, sin token, rate-limited).
// Falla de red/límite → null: el caller cae al tipeo manual.
export async function consultarRuc(numero: string): Promise<{
  ruc: string; razonSocial: string; estado: string | null; condicion: string | null; direccion: string | null;
} | null> {
  try {
    const r = await fetch(`https://api.apis.net.pe/v1/ruc?numero=${numero}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { numeroDocumento?: string; nombre?: string; estado?: string; condicion?: string; direccion?: string };
    if (!j?.nombre) return null;
    return {
      ruc: j.numeroDocumento ?? numero,
      razonSocial: j.nombre,
      estado: j.estado ?? null,
      condicion: j.condicion ?? null,
      direccion: j.direccion ?? null,
    };
  } catch {
    return null;
  }
}
