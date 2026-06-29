// Imprime / guarda como PDF una hoja HTML SIN salir de la pestaña, usando un
// iframe oculto. Compartido por el visor de OC y la lista de equipo.
export function printSheet(sheet: HTMLElement, opts: { title: string; styles: string; logoUrl?: string; fitHeightMm?: number }): void {
  let html = sheet.outerHTML;
  if (opts.logoUrl) {
    const abs = `${window.location.origin}${opts.logoUrl}`;
    const esc = opts.logoUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(`src="${esc}"`, 'g'), `src="${abs}"`);
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) { iframe.remove(); return; }
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8" /><title>${opts.title}</title><style>${opts.styles}</style></head><body>${html}</body></html>`);
  doc.close();

  const win = iframe.contentWindow!;
  let done = false;
  const cleanup = () => { if (!done) { done = true; setTimeout(() => iframe.remove(), 300); } };
  win.onafterprint = cleanup;

  // dispara el diálogo UNA sola vez (evita doble print al combinar load + fallback)
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    // ponytail: zoom-to-fit 1 pagina solo si desborda · floor 0.6 → OC enorme sigue paginando (no ilegible). Chrome/Edge honran zoom en print.
    if (opts.fitHeightMm) {
      const el = doc.querySelector('.oc-print-sheet') as HTMLElement | null;
      if (el) {
        const maxPx = (opts.fitHeightMm * 96) / 25.4;
        if (el.scrollHeight > maxPx) el.style.zoom = String(Math.max(0.6, maxPx / el.scrollHeight));
      }
    }
    try { win.focus(); win.print(); } catch { /* noop */ }
  };

  // esperar a que cargue el logo antes de imprimir
  const img = doc.querySelector('img');
  if (img && !img.complete) {
    img.addEventListener('load', () => setTimeout(fire, 50));
    img.addEventListener('error', () => setTimeout(fire, 50));
    setTimeout(fire, 800); // fallback si la imagen tarda (guard evita re-disparo)
  } else {
    setTimeout(fire, 150);
  }
  setTimeout(cleanup, 60000); // limpieza de seguridad
}
