// F3.6 · TC venta SUNAT del día vía API pública (apis.net.pe, sin token, rate-limited).
// Falla en red/limite → null: el caller responde 502 y Kelly lo carga manual (tabla tipo_cambio).
export async function obtenerTcSunat(fecha: string): Promise<{ fecha: string; compra: number; venta: number } | null> {
  try {
    const r = await fetch(`https://api.apis.net.pe/v1/tipo-cambio-sunat?fecha=${fecha}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { fecha?: string; compra?: number; venta?: number };
    if (!(Number(j.compra) > 0) || !(Number(j.venta) > 0)) return null;
    return { fecha: j.fecha ?? fecha, compra: Number(j.compra), venta: Number(j.venta) };
  } catch {
    return null;
  }
}
