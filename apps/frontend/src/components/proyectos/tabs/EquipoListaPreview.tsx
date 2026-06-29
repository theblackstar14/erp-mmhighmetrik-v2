import { Printer, X } from 'lucide-react';
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { printSheet } from '@/lib/printSheet.js';

const EMISOR = {
  razonSocial: 'MM HIGH METRIK ENGINEERS S.A.C.',
  ruc: '20610639764',
  direccion: 'Av. Republica de Colombia 625 Of. 501',
  distrito: 'San Isidro',
  departamento: 'Lima',
  email: 'mmhighmetrik@gmail.com',
  telefono: '(+51) 955 137 140',
  logoUrl: '/logo-mm.png',
};

export type EquipoListaData = {
  proyecto: { codigo: string; nombre: string; ubicacion: string | null };
  responsable: { nombre: string; rol?: string | null } | null;
  equipo: { nombre: string; rol: string }[];
  cuadrilla: { nombre: string; categoria: string | null }[];
};

const hoyEs = () => {
  const d = new Date();
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
};

export function EquipoListaPreview({ data, onClose }: { data: EquipoListaData; onClose: () => void }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const print = () => {
    if (sheetRef.current) printSheet(sheetRef.current, { title: `Equipo ${data.proyecto.codigo}`, styles: EQ_STYLES, logoUrl: EMISOR.logoUrl });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-black/45 to-black/65 backdrop-blur-sm p-4 sm:p-8"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-xl border border-line bg-bg-elev shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-2.5 bg-bg-elev shrink-0">
          <div className="min-w-0">
            <h2 className="text-[13px] font-bold tracking-[0.02em] truncate">LISTA DE EQUIPO · {data.proyecto.codigo}</h2>
            <p className="text-[10.5px] text-ink-3 mt-0.5 truncate">{data.proyecto.nombre}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={print} className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium hover:opacity-90" title="Imprimir o guardar como PDF">
              <Printer className="h-3.5 w-3.5" /> Imprimir / Guardar PDF
            </button>
            <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded text-ink-3 hover:bg-bg-sunken"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="eq-preview-scroll flex-1">
          <div ref={sheetRef} className="eq-print-sheet">
            <style>{EQ_STYLES}</style>
            <EquipoSheet data={data} />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function EquipoSheet({ data }: { data: EquipoListaData }) {
  const { proyecto, responsable, equipo, cuadrilla } = data;
  return (
    <div className="eq-content">
      <div className="eq-header">
        <div className="eq-logo-wrap">
          <img src={EMISOR.logoUrl} alt="MM HIGH METRIK ENGINEERS" className="eq-logo" />
        </div>
        <div className="eq-header-right">
          <div><b>Fecha de emisión</b></div>
          <div>{hoyEs()}</div>
        </div>
      </div>

      <div className="eq-title">LISTA DE EQUIPO DEL PROYECTO</div>

      <table className="eq-kv">
        <tbody>
          <tr><td className="eq-kv-l">Proyecto</td><td>:</td><td><b>{proyecto.codigo}</b> · {proyecto.nombre}</td></tr>
          {proyecto.ubicacion && <tr><td className="eq-kv-l">Ubicación</td><td>:</td><td>{proyecto.ubicacion}</td></tr>}
          <tr><td className="eq-kv-l">Responsable</td><td>:</td><td>{responsable ? `${responsable.nombre}${responsable.rol ? ` · ${responsable.rol}` : ''}` : '— sin asignar —'}</td></tr>
        </tbody>
      </table>

      <div className="eq-section">Equipo profesional ({equipo.length})</div>
      {equipo.length === 0 ? (
        <div className="eq-empty">Sin equipo profesional asignado.</div>
      ) : (
        <table className="eq-table">
          <thead><tr><th style={{ width: '12mm' }}>N°</th><th>Nombre</th><th style={{ width: '55mm' }}>Rol</th></tr></thead>
          <tbody>
            {equipo.map((m, i) => (
              <tr key={`${m.nombre}-${i}`}><td className="c">{i + 1}</td><td>{m.nombre}</td><td>{m.rol}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="eq-section">Cuadrilla de obra ({cuadrilla.length})</div>
      {cuadrilla.length === 0 ? (
        <div className="eq-empty">Sin obreros asignados a esta obra.</div>
      ) : (
        <table className="eq-table">
          <thead><tr><th style={{ width: '12mm' }}>N°</th><th>Nombre</th><th style={{ width: '55mm' }}>Categoría</th></tr></thead>
          <tbody>
            {cuadrilla.map((e, i) => (
              <tr key={`${e.nombre}-${i}`}><td className="c">{i + 1}</td><td>{e.nombre}</td><td>{e.categoria ?? '—'}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="eq-footer">
        {EMISOR.razonSocial} · RUC {EMISOR.ruc}<br />
        {EMISOR.direccion} · {EMISOR.distrito} - {EMISOR.departamento} · Telf. {EMISOR.telefono} · {EMISOR.email}
      </div>
    </div>
  );
}

const EQ_STYLES = `
.eq-preview-scroll { overflow: auto; background: #EEEEE9; padding: 24px; display: flex; justify-content: center; align-items: flex-start; }
.eq-print-sheet {
  width: 210mm; min-height: 297mm; margin: 0 auto; padding: 14mm 16mm 12mm; background: #FFF; color: #000;
  font-family: 'Calibri', 'Segoe UI', 'Inter', sans-serif; font-size: 10pt; line-height: 1.35;
  box-shadow: 0 4px 20px rgba(0,0,0,0.12); box-sizing: border-box; flex-shrink: 0;
}
.eq-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4mm; }
.eq-logo-wrap { width: 60mm; height: 20mm; display: flex; align-items: center; }
.eq-logo { max-height: 20mm; max-width: 60mm; object-fit: contain; }
.eq-header-right { text-align: right; font-size: 9.5pt; }
.eq-title { text-align: center; font-weight: 700; font-size: 12pt; letter-spacing: 0.5pt; border-bottom: 1.2pt solid #000; padding: 2mm 0; margin-bottom: 4mm; }
.eq-kv { border-collapse: collapse; font-size: 9.5pt; width: 100%; margin-bottom: 4mm; }
.eq-kv td { padding: 0.6mm 0; vertical-align: top; }
.eq-kv-l { width: 28mm; color: #1C1C1C; }
.eq-kv td:nth-child(2) { width: 4mm; }
.eq-section { font-weight: 700; font-size: 10pt; margin: 4mm 0 1.5mm 0; }
.eq-empty { font-size: 9pt; color: #6B6B68; padding: 2mm 0 3mm; }
.eq-table { width: 100%; border-collapse: collapse; border: 1pt solid #000; font-size: 9pt; margin-bottom: 3mm; }
.eq-table th { background: #F4F4F1; border: 0.5pt solid #000; padding: 1.5mm 2mm; font-weight: 700; text-align: left; color: #000; }
.eq-table td { border: 0.5pt solid #000; padding: 1.3mm 2mm; vertical-align: middle; color: #000; }
.eq-table td.c { text-align: center; }
.eq-footer { text-align: center; font-size: 8pt; color: #1C1C1C; line-height: 1.45; margin-top: 6mm; padding-top: 2mm; border-top: 0.5pt solid #D8D8D2; }

/* Saltos de página */
.eq-table { page-break-inside: auto; break-inside: auto; }
.eq-table thead { display: table-header-group; }
.eq-table tr { page-break-inside: avoid; break-inside: avoid; }
.eq-header, .eq-title, .eq-kv, .eq-section, .eq-footer { page-break-inside: avoid; break-inside: avoid; }
.eq-section { page-break-after: avoid; break-after: avoid; }

@media print {
  html, body { background: #FFF !important; margin: 0; padding: 0; }
  @page { size: A4; margin: 0; }
  .eq-preview-scroll { background: #FFF !important; padding: 0 !important; }
  .eq-print-sheet { box-shadow: none !important; margin: 0; }
}
`;
