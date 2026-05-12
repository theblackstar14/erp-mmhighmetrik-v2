import { useQuery } from '@tanstack/react-query';
import { Download, Loader2, Printer, X } from 'lucide-react';
import { useRef } from 'react';
import { api } from '@/lib/api.js';
import { cn } from '@/lib/utils.js';

// Empresa emisora (MM HIGH METRIK)
const EMISOR = {
  razonSocial: 'MM HIGH METRIK ENGINEERS S.A.C.',
  ruc: '20603456789',
  direccion: 'Av. La Marina 2355, Of. 502',
  distrito: 'San Miguel',
  departamento: 'Lima',
  telefono: '+51 1 555 1234',
  telefono2: '987 654 321',
  email: 'contacto@mmhighmetrik.com',
};

export function OcPdfPreview({ ocId, onClose }: { ocId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['logistica-oc-detail', ocId],
    queryFn: () => api.logistica.getOc(ocId),
  });
  const sheetRef = useRef<HTMLDivElement>(null);

  const printPdf = () => {
    // Imprime usando window.print con CSS @media print
    const sheet = sheetRef.current;
    if (!sheet) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>${data?.oc.numero ?? 'OC'}</title>
          <style>${PRINT_STYLES}</style>
        </head>
        <body>${sheet.outerHTML}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-5xl max-h-[96vh] overflow-hidden rounded-md border border-line bg-bg-elev shadow-xl flex flex-col">
        <div className="flex items-center justify-between border-b border-line px-5 py-3 bg-bg-sunken">
          <div>
            <h2 className="text-[14px] font-semibold">
              Vista previa OC · {data?.oc.numero ?? '...'}
            </h2>
            <p className="text-[10.5px] text-ink-3 mt-0.5">
              {data ? `${data.proveedor?.razonSocial ?? '—'} · ${data.proyecto?.codigo ?? '—'}` : 'Cargando...'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={printPdf}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-line text-[11.5px] text-ink-2 hover:bg-bg-elev disabled:opacity-50"
            >
              <Printer className="h-3.5 w-3.5" />
              Imprimir
            </button>
            <button
              type="button"
              onClick={printPdf}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium hover:opacity-90 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Guardar PDF
            </button>
            <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded text-ink-3 hover:bg-bg-elev">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-gray-100 dark:bg-gray-950 p-6">
          {isLoading || !data ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <div ref={sheetRef} className="oc-print-sheet mx-auto bg-white shadow-lg">
              <style>{PRINT_STYLES}</style>
              <OcSheet data={data} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OcSheet({ data }: { data: NonNullable<Awaited<ReturnType<typeof api.logistica.getOc>>> }) {
  const { oc, lineas, proveedor } = data;
  const monedaSym = oc.moneda === 'PEN' ? 'S/' : '$';
  const total = Number(oc.total);

  return (
    <div className="oc-content">
      {/* Header · logo + fecha */}
      <div className="oc-header">
        <div className="oc-logo-wrap">
          <div className="oc-logo-mm">MM</div>
          <div className="oc-logo-sub">HIGH METRIK ENGINEERS</div>
        </div>
        <div className="oc-header-right">
          <div className="oc-header-row">
            <span className="oc-header-lbl">Fecha de emision</span>
            <span className="oc-header-val">{formatDateEs(oc.fechaEmision)}</span>
          </div>
        </div>
      </div>

      {/* Título */}
      <div className="oc-title">ORDEN DE COMPRA N° {oc.numero}</div>

      {/* Facturar a */}
      <div className="oc-section-title">Facturar a</div>
      <div className="oc-two-col">
        <table className="oc-kv">
          <tbody>
            <tr><td className="oc-kv-label">Nombre de</td><td>:</td><td>{EMISOR.razonSocial}</td></tr>
            <tr><td className="oc-kv-label">Dirección</td><td>:</td><td>{EMISOR.direccion.toUpperCase()}, {EMISOR.distrito.toUpperCase()} - {EMISOR.departamento.toUpperCase()}</td></tr>
            <tr><td className="oc-kv-label">RUC</td><td>:</td><td>{EMISOR.ruc}</td></tr>
            <tr><td className="oc-kv-label">Teléfono</td><td>:</td><td>{EMISOR.telefono2}</td></tr>
          </tbody>
        </table>
        <table className="oc-kv">
          <tbody>
            <tr><td className="oc-kv-label-bold">Moneda</td><td>{oc.moneda === 'PEN' ? 'Soles' : 'Dólares'}</td></tr>
            <tr><td className="oc-kv-label-bold">Medio de pago</td><td>{oc.medioPago ?? '—'}</td></tr>
            <tr><td className="oc-kv-label-bold">Forma de pago</td><td>{oc.formaPago ?? '—'}</td></tr>
            {oc.cotizacion && <tr><td className="oc-kv-label-bold">Cotización</td><td>{oc.cotizacion}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="oc-hr" />

      {/* Proveedor */}
      <div className="oc-section-title">Proveedor</div>
      <div className="oc-two-col">
        <table className="oc-kv">
          <tbody>
            <tr><td className="oc-kv-label">Nombre</td><td>:</td><td>{proveedor?.razonSocial ?? '—'}</td></tr>
            <tr><td className="oc-kv-label">Dirección</td><td>:</td><td>{proveedor?.domicilio ?? '—'}</td></tr>
            <tr><td className="oc-kv-label">RUC</td><td>:</td><td>{proveedor?.ruc ?? '—'}</td></tr>
          </tbody>
        </table>
        <table className="oc-kv" style={{ alignSelf: 'flex-end' }}>
          <tbody>
            <tr><td className="oc-kv-label-bold">Lugar de entrega</td><td>{oc.lugarEntrega ?? '—'}</td></tr>
          </tbody>
        </table>
      </div>

      {/* Concepto */}
      <div className="oc-concepto-row">
        <span className="oc-concepto-lbl">Concepto</span>
        <span className="oc-concepto-colon">:</span>
        <span className="oc-concepto-val">{oc.concepto}</span>
      </div>

      {/* Tabla ítems */}
      <table className="oc-items-table">
        <thead>
          <tr>
            <th style={{ width: 50 }}>Item</th>
            <th>Descripción</th>
            <th style={{ width: 60 }}>Unid.</th>
            <th style={{ width: 70 }}>Cant.</th>
            <th style={{ width: 90 }}>Precio Unitario</th>
            <th style={{ width: 110 }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((l) => {
            const cant = Number(l.cantidad);
            const pu = Number(l.precioUnitario);
            const tot = cant * pu;
            return (
              <tr key={l.id}>
                <td className="oc-cell-center mono">{(l.numero).toFixed(2).padStart(4, '0')}</td>
                <td className="oc-cell-desc">{l.descripcion}</td>
                <td className="oc-cell-center">{l.unidad}</td>
                <td className="oc-cell-right mono">{cant.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="oc-cell-right mono">{monedaSym}&nbsp;{pu.toLocaleString('es-PE', { minimumFractionDigits: 5, maximumFractionDigits: 5 })}</td>
                <td className="oc-cell-right mono">{monedaSym}&nbsp;{tot.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Total */}
      <table className="oc-items-total-table">
        <tbody>
          <tr>
            <td colSpan={4} className="oc-cell-label">PROYECTO: <b>{data.proyecto?.codigo ?? '—'}</b></td>
            <td className="oc-cell-right oc-cell-label" style={{ width: 90 }}><b>TOTAL (INC. IGV)</b></td>
            <td className="oc-cell-right oc-cell-total mono" style={{ width: 110 }}>{monedaSym}&nbsp;{total.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          </tr>
          {oc.aplicaDetraccion && Number(oc.montoDetraccion) > 0 && (
            <>
              <tr>
                <td colSpan={4} className="oc-cell-label">Detracción SUNAT ({oc.pctDetraccion}%):</td>
                <td className="oc-cell-right oc-cell-label"><b>DETRACCIÓN</b></td>
                <td className="oc-cell-right mono">- {monedaSym}&nbsp;{Number(oc.montoDetraccion).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
              <tr>
                <td colSpan={4} className="oc-cell-label"></td>
                <td className="oc-cell-right oc-cell-label"><b>NETO A PAGAR</b></td>
                <td className="oc-cell-right oc-cell-total mono">{monedaSym}&nbsp;{Number(oc.montoNetoPagar ?? oc.total).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>

      {/* Generales + Firma */}
      <div className="oc-generales-block">
        <div>
          <div className="oc-generales-title">Generales</div>
          <div className="oc-generales-body">{oc.terminos ?? ''}</div>
        </div>
        <div className="oc-firma-wrap">
          <div className="oc-firma-box">
            <span className="oc-firma-label">FIRMA</span>
          </div>
          <div className="oc-firma-caption">
            {EMISOR.razonSocial}
            <br />
            <b>{oc.gestorNombre ?? 'GERENTE'}</b>
            <br />
            SUB GERENTE
          </div>
        </div>
      </div>

      {/* Texto legal */}
      <div className="oc-legal">
        Estimado proveedor no olvidar adjuntar los sustentos necesarios (orden de servicio/compra debidamente firmada y guía de remisión) para poder presentar su factura en nuestra oficina {EMISOR.direccion}, {EMISOR.distrito} - {EMISOR.departamento} y no estar sujetos a demora en su pago. Una vez confirmada la recepción de la Orden de Compra se dará por aceptada la misma si no recibimos ninguna observación luego de 24 horas. Si la cantidad o especificaciones del producto no corresponde a lo solicitado, el producto no será recibido y/o será devuelto al proveedor sin cargo alguno para la empresa. Al entregar la mercadería, indicar en las Guías de Remisión el número de Orden de Compra correspondiente. El proveedor es responsable de entregar la factura en Mesa de Partes de caso contrario no se procederá a registrar la factura para el respectivo pago. Si la venta del producto o prestación del servicio se encuentra afecta a detracción, deberá indicarse el importe afecto a esta y los datos de la cuenta corriente bancaria donde se debe realizar el depósito.
      </div>

      <div className="oc-bottom-group">
        <div className="oc-creado-row">
          <div className="oc-creado-block">
            <span className="oc-creado-lbl">Creado por</span>
            <span className="oc-creado-val oc-creado-email">{oc.creadoPorEmail ?? '—'}</span>
          </div>
          <div className="oc-creado-block oc-creado-block-right">
            <span className="oc-creado-lbl">Gestion:</span>
            <span className="oc-creado-val">{oc.gestorNombre ?? '—'}</span>
          </div>
        </div>
        <div className="oc-footer-empresa">
          {EMISOR.direccion} - {EMISOR.distrito} - {EMISOR.departamento}
          <br />
          Telf. {EMISOR.telefono}
          <br />
          e-mail: {EMISOR.email}
        </div>
      </div>
    </div>
  );
}

function formatDateEs(d: string): string {
  // YYYY-MM-DD → DD/MM/YYYY
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

const PRINT_STYLES = `
.oc-print-sheet {
  width: 210mm;
  min-height: 297mm;
  padding: 14mm 16mm;
  background: white;
  color: #1a1a1a;
  font-family: 'Helvetica', 'Arial', sans-serif;
  font-size: 10pt;
  line-height: 1.35;
}
.oc-content { display: flex; flex-direction: column; }
.oc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12pt; border-bottom: 2pt solid #b91c1c; padding-bottom: 6pt; }
.oc-logo-wrap { display: flex; align-items: center; gap: 8pt; }
.oc-logo-mm { font-size: 26pt; font-weight: 900; letter-spacing: -2pt; color: #b91c1c; line-height: 1; }
.oc-logo-sub { font-size: 7.5pt; font-weight: 700; letter-spacing: 1pt; color: #4a5568; }
.oc-header-right { text-align: right; }
.oc-header-row { display: flex; gap: 8pt; align-items: baseline; }
.oc-header-lbl { font-size: 9pt; color: #4a5568; }
.oc-header-val { font-size: 10pt; font-weight: 700; }
.oc-title { font-size: 13pt; font-weight: 800; text-align: center; margin: 8pt 0 12pt; letter-spacing: 0.5pt; }
.oc-section-title { font-size: 10pt; font-weight: 700; background: #f1f5f9; padding: 3pt 6pt; margin-top: 8pt; margin-bottom: 4pt; border-left: 3pt solid #b91c1c; }
.oc-two-col { display: flex; gap: 16pt; align-items: flex-start; }
.oc-kv { font-size: 9pt; flex: 1; }
.oc-kv td { padding: 1.5pt 4pt; vertical-align: top; }
.oc-kv-label { color: #4a5568; white-space: nowrap; font-weight: 500; }
.oc-kv-label-bold { color: #1a1a1a; white-space: nowrap; font-weight: 700; }
.oc-hr { border-top: 1pt dashed #cbd5e1; margin: 8pt 0; }
.oc-concepto-row { display: flex; gap: 4pt; align-items: baseline; margin-top: 4pt; }
.oc-concepto-lbl { font-weight: 700; }
.oc-concepto-colon { color: #4a5568; }
.oc-concepto-val { font-weight: 600; }
.oc-items-table { width: 100%; border-collapse: collapse; margin-top: 8pt; font-size: 9pt; }
.oc-items-table thead { background: #1e293b; color: white; }
.oc-items-table th { padding: 4pt 6pt; text-align: left; font-weight: 700; font-size: 8.5pt; }
.oc-items-table td { padding: 3pt 6pt; border-bottom: 0.5pt solid #e2e8f0; vertical-align: top; }
.oc-cell-center { text-align: center; }
.oc-cell-right { text-align: right; }
.oc-cell-desc { color: #1a1a1a; }
.oc-cell-label { background: #f8fafc; font-weight: 600; }
.oc-cell-total { font-weight: 800; font-size: 10pt; background: #fef3c7; }
.mono { font-family: 'Courier New', monospace; }
.oc-items-total-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
.oc-items-total-table td { padding: 4pt 6pt; border: 0.5pt solid #e2e8f0; }
.oc-generales-block { display: flex; gap: 16pt; margin-top: 14pt; }
.oc-generales-block > div:first-child { flex: 1; }
.oc-generales-title { font-weight: 700; font-size: 9pt; margin-bottom: 3pt; }
.oc-generales-body { white-space: pre-wrap; font-size: 8.5pt; color: #2d3748; line-height: 1.4; }
.oc-firma-wrap { width: 180pt; text-align: center; }
.oc-firma-box { border: 0.75pt solid #1a1a1a; height: 55pt; display: flex; align-items: flex-end; justify-content: center; padding: 4pt; margin-bottom: 4pt; }
.oc-firma-label { font-size: 8pt; color: #94a3b8; letter-spacing: 1pt; }
.oc-firma-caption { font-size: 8pt; line-height: 1.3; }
.oc-legal { font-size: 7pt; color: #4a5568; line-height: 1.4; margin-top: 10pt; text-align: justify; }
.oc-bottom-group { margin-top: 8pt; }
.oc-creado-row { display: flex; justify-content: space-between; padding: 4pt 0; border-top: 0.5pt solid #cbd5e1; }
.oc-creado-block { display: flex; flex-direction: column; }
.oc-creado-block-right { text-align: right; }
.oc-creado-lbl { font-size: 7.5pt; color: #4a5568; }
.oc-creado-val { font-size: 9pt; font-weight: 600; }
.oc-creado-email { font-family: 'Courier New', monospace; font-size: 8pt; }
.oc-footer-empresa { font-size: 7.5pt; color: #4a5568; text-align: center; padding: 6pt 0; border-top: 0.5pt solid #cbd5e1; line-height: 1.4; }
@media print {
  body { margin: 0; padding: 0; }
  .oc-print-sheet { box-shadow: none; margin: 0; }
}
`;

void cn;
