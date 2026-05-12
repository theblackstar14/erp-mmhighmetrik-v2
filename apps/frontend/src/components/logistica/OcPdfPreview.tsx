import { useQuery } from '@tanstack/react-query';
import { Download, Loader2, Printer, X } from 'lucide-react';
import { useRef } from 'react';
import { api } from '@/lib/api.js';

// Empresa emisora · MM HIGH METRIK
const EMISOR = {
  razonSocial: 'MM HIGH METRIK ENGINEERS S.A.C.',
  ruc: '20603456789',
  direccion: 'Av. La Marina 2355, Of. 502',
  distrito: 'San Miguel',
  departamento: 'Lima',
  telefono: '+51 1 555 1234',
  telefono2: '987 654 321',
  email: 'contabilidad@mmhighmetrik.com',
};

export function OcPdfPreview({ ocId, onClose }: { ocId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['logistica-oc-detail', ocId],
    queryFn: () => api.logistica.getOc(ocId),
  });
  const sheetRef = useRef<HTMLDivElement>(null);

  const printPdf = () => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${data?.oc.numero ?? 'OC'}</title>
          <style>${PRINT_STYLES}</style>
        </head>
        <body>${sheet.outerHTML}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 300);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-0"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full h-full flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-line px-5 py-2.5 bg-bg-elev shadow-sm shrink-0">
          <div>
            <h2 className="text-[13px] font-semibold">
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
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-line text-[11.5px] text-ink-2 hover:bg-bg-sunken disabled:opacity-50"
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
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded text-ink-3 hover:bg-bg-sunken"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scroll viewport · sheet centered with padding */}
        <div className="flex-1 overflow-auto bg-neutral-300 dark:bg-neutral-900">
          <div className="min-h-full flex items-start justify-center py-8 px-4">
            {isLoading || !data ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <div
                ref={sheetRef}
                className="oc-print-sheet bg-white shadow-2xl"
                style={{ width: '210mm', minHeight: '297mm' }}
              >
                <style>{PRINT_STYLES}</style>
                <OcSheet data={data} />
              </div>
            )}
          </div>
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
      {/* Header · logo izq + fecha emisión der · línea roja */}
      <div className="oc-header">
        <div className="oc-logo-wrap">
          <div className="oc-logo-mm">MM</div>
          <div className="oc-logo-sub">
            <span className="oc-logo-hm">HIGH METRIK</span>
            <span className="oc-logo-eng">ENGINEERS</span>
          </div>
        </div>
        <div className="oc-header-right">
          <div className="oc-header-row">
            <span className="oc-header-lbl">Fecha de emision</span>
            <span className="oc-header-val">{formatDateEs(oc.fechaEmision)}</span>
          </div>
        </div>
      </div>
      <div className="oc-header-line" />

      {/* Título principal */}
      <div className="oc-title">ORDEN DE COMPRA N° {oc.numero}</div>

      {/* Facturar a */}
      <div className="oc-section-title">Facturar a</div>
      <div className="oc-two-col">
        <table className="oc-kv">
          <tbody>
            <tr>
              <td className="oc-kv-label">Nombre de</td>
              <td className="oc-kv-colon">:</td>
              <td>{EMISOR.razonSocial}</td>
            </tr>
            <tr>
              <td className="oc-kv-label">Direccion</td>
              <td className="oc-kv-colon">:</td>
              <td>
                {EMISOR.direccion.toUpperCase()}, {EMISOR.distrito.toUpperCase()} - {EMISOR.departamento.toUpperCase()}
              </td>
            </tr>
            <tr>
              <td className="oc-kv-label">RUC</td>
              <td className="oc-kv-colon">:</td>
              <td>{EMISOR.ruc}</td>
            </tr>
            <tr>
              <td className="oc-kv-label">Telefono</td>
              <td className="oc-kv-colon">:</td>
              <td>{EMISOR.telefono2}</td>
            </tr>
          </tbody>
        </table>
        <table className="oc-kv oc-kv-right">
          <tbody>
            <tr>
              <td className="oc-kv-label-bold">Moneda</td>
              <td className="oc-kv-colon">:</td>
              <td>{oc.moneda === 'PEN' ? 'Soles' : 'Dólares'}</td>
            </tr>
            <tr>
              <td className="oc-kv-label-bold">Medio de pago</td>
              <td className="oc-kv-colon">:</td>
              <td>{oc.medioPago ?? '—'}</td>
            </tr>
            <tr>
              <td className="oc-kv-label-bold">Forma de pago</td>
              <td className="oc-kv-colon">:</td>
              <td>{oc.formaPago ?? '—'}</td>
            </tr>
            {oc.cotizacion && (
              <tr>
                <td className="oc-kv-label-bold">Cotización</td>
                <td className="oc-kv-colon">:</td>
                <td>{oc.cotizacion}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Proveedor */}
      <div className="oc-section-title">Proveedor</div>
      <div className="oc-two-col">
        <table className="oc-kv">
          <tbody>
            <tr>
              <td className="oc-kv-label">Nombre</td>
              <td className="oc-kv-colon">:</td>
              <td>{proveedor?.razonSocial ?? '—'}</td>
            </tr>
            <tr>
              <td className="oc-kv-label">Direccion</td>
              <td className="oc-kv-colon">:</td>
              <td>{proveedor?.domicilio ?? '—'}</td>
            </tr>
            <tr>
              <td className="oc-kv-label">RUC</td>
              <td className="oc-kv-colon">:</td>
              <td>{proveedor?.ruc ?? '—'}</td>
            </tr>
          </tbody>
        </table>
        <table className="oc-kv oc-kv-right">
          <tbody>
            <tr>
              <td className="oc-kv-label-bold">Lugar de entrega</td>
              <td className="oc-kv-colon">:</td>
              <td>{oc.lugarEntrega ?? '—'}</td>
            </tr>
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
            <th style={{ width: 42 }}>Item</th>
            <th>Descripción</th>
            <th style={{ width: 50 }}>Unid.</th>
            <th style={{ width: 56 }}>Cant.</th>
            <th style={{ width: 90 }}>Precio Unitario</th>
            <th style={{ width: 90 }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((l) => {
            const cant = Number(l.cantidad);
            const pu = Number(l.precioUnitario);
            const tot = cant * pu;
            return (
              <tr key={l.id}>
                <td className="oc-cell-center mono">{l.numero.toFixed(2).padStart(4, '0')}</td>
                <td className="oc-cell-desc">{l.descripcion}</td>
                <td className="oc-cell-center mono">{l.unidad}</td>
                <td className="oc-cell-right mono">
                  {cant.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="oc-cell-right mono">
                  {monedaSym}&nbsp;{pu.toLocaleString('es-PE', { minimumFractionDigits: 5, maximumFractionDigits: 5 })}
                </td>
                <td className="oc-cell-right mono">
                  {monedaSym}&nbsp;{tot.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Total · proyecto + total inc igv */}
      <table className="oc-total-table">
        <tbody>
          <tr>
            <td className="oc-cell-proyecto">
              PROYECTO: <b>{data.proyecto?.codigo ?? '—'}</b>
            </td>
            <td className="oc-cell-total-label">TOTAL (INC. IGV)</td>
            <td className="oc-cell-total-val mono">
              {monedaSym}&nbsp;
              {total.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </td>
          </tr>
          {oc.aplicaDetraccion && Number(oc.montoDetraccion) > 0 && (
            <>
              <tr>
                <td className="oc-cell-proyecto">Detracción SUNAT ({oc.pctDetraccion}%)</td>
                <td className="oc-cell-total-label">DETRACCIÓN</td>
                <td className="oc-cell-total-val mono" style={{ color: '#b45309' }}>
                  - {monedaSym}&nbsp;
                  {Number(oc.montoDetraccion).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
              <tr>
                <td className="oc-cell-proyecto" />
                <td className="oc-cell-total-label">
                  <b>NETO A PAGAR</b>
                </td>
                <td className="oc-cell-total-val mono" style={{ fontSize: '11pt' }}>
                  {monedaSym}&nbsp;
                  {Number(oc.montoNetoPagar ?? oc.total).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>

      {/* Generales + Firma */}
      <div className="oc-section-title oc-section-mt">Generales</div>
      <div className="oc-generales-block">
        <div className="oc-generales-body">{oc.terminos ?? ''}</div>
        <div className="oc-firma-wrap">
          <div className="oc-firma-box">
            <span className="oc-firma-label">FIRMA</span>
          </div>
          <div className="oc-firma-caption">
            {EMISOR.razonSocial}
            <br />
            <b>{(oc.gestorNombre ?? 'MARIO A. GARCÍA CALDERÓN').toUpperCase()}</b>
            <br />
            SUB GERENTE
          </div>
        </div>
      </div>

      {/* Legal */}
      <div className="oc-legal">
        Estimado proveedor no olvidar adjuntar los sustentos necesarios (orden de servicio/compra debidamente firmada y guía de remisión)
        para poder presentar su factura en nuestra oficina {EMISOR.direccion}, {EMISOR.distrito} - {EMISOR.departamento} y no estar
        sujetos a demora en su pago. Una vez confirmada la recepción de la Orden de Compra se dará por aceptada la misma si no recibimos
        ninguna observación luego de 24 horas. Si la cantidad o especificaciones del producto no corresponde a lo solicitado, el producto
        no será recibido y/o será devuelto al proveedor sin cargo alguno para la empresa. Al entregar la mercadería, indicar en las Guías
        de Remisión el número de Orden de Compra correspondiente. El proveedor es responsable de entregar la factura en Mesa de Partes de
        caso contrario no se procederá a registrar la factura para el respectivo pago. Si la venta del producto o prestación del servicio
        se encuentra afecta a detracción, deberá indicarse el importe afecto a esta y los datos de la cuenta corriente bancaria donde se
        debe realizar el depósito.
      </div>

      {/* Bottom · creado por + footer empresa */}
      <div className="oc-bottom-group">
        <div className="oc-creado-row">
          <div className="oc-creado-block">
            <span className="oc-creado-lbl">Creado por</span>
            <span className="oc-creado-val oc-creado-email">{oc.creadoPorEmail ?? EMISOR.email}</span>
          </div>
          <div className="oc-creado-block oc-creado-block-right">
            <span className="oc-creado-lbl">Gestión:</span>
            <span className="oc-creado-val">{oc.gestorNombre ?? 'Mario A. García Calderón'}</span>
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
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${Number(day)}/${Number(m)}/${y}`;
}

const PRINT_STYLES = `
.oc-print-sheet {
  width: 210mm;
  min-height: 297mm;
  padding: 14mm 16mm 12mm;
  background: white;
  color: #1a1a1a;
  font-family: 'Helvetica', 'Arial', sans-serif;
  font-size: 9.5pt;
  line-height: 1.4;
  box-sizing: border-box;
}
.oc-content { display: flex; flex-direction: column; }

/* Header · logo izq + fecha der */
.oc-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 5pt;
}
.oc-logo-wrap {
  display: flex;
  align-items: center;
  gap: 8pt;
}
.oc-logo-mm {
  font-size: 30pt;
  font-weight: 900;
  letter-spacing: -2pt;
  color: #b91c1c;
  line-height: 0.85;
  background: #b91c1c;
  color: white;
  padding: 4pt 8pt;
  border-radius: 1pt;
}
.oc-logo-sub {
  display: flex;
  flex-direction: column;
  gap: 1pt;
}
.oc-logo-hm {
  font-size: 11pt;
  font-weight: 800;
  letter-spacing: 1.5pt;
  color: #1a1a1a;
}
.oc-logo-eng {
  font-size: 8pt;
  font-weight: 600;
  letter-spacing: 4pt;
  color: #4a5568;
}
.oc-header-right { text-align: right; }
.oc-header-row { display: flex; gap: 12pt; align-items: baseline; }
.oc-header-lbl {
  font-size: 9pt;
  color: #4a5568;
  font-weight: 400;
}
.oc-header-val {
  font-size: 10.5pt;
  font-weight: 700;
  color: #1a1a1a;
}
.oc-header-line {
  height: 2pt;
  background: #b91c1c;
  margin-bottom: 8pt;
}

/* Título */
.oc-title {
  font-size: 14pt;
  font-weight: 800;
  text-align: center;
  margin: 6pt 0 12pt;
  letter-spacing: 0.5pt;
  color: #1a1a1a;
}

/* Section title con barra azul izq */
.oc-section-title {
  font-size: 9.5pt;
  font-weight: 700;
  color: #1a1a1a;
  padding: 4pt 8pt;
  margin-top: 6pt;
  margin-bottom: 4pt;
  background: #f1f5f9;
  border-left: 3pt solid #1d4ed8;
}
.oc-section-mt { margin-top: 12pt; }

/* Tablas KV */
.oc-two-col {
  display: flex;
  gap: 14pt;
  margin-bottom: 2pt;
}
.oc-kv {
  font-size: 9pt;
  flex: 1;
  border-collapse: collapse;
}
.oc-kv td {
  padding: 1.5pt 4pt;
  vertical-align: top;
  line-height: 1.35;
}
.oc-kv-label {
  color: #4a5568;
  white-space: nowrap;
  font-weight: 500;
  width: 70pt;
}
.oc-kv-label-bold {
  color: #1a1a1a;
  white-space: nowrap;
  font-weight: 700;
  width: 80pt;
}
.oc-kv-colon { width: 6pt; color: #4a5568; }
.oc-kv-right { padding-left: 8pt; }

/* Concepto */
.oc-concepto-row {
  display: flex;
  gap: 4pt;
  align-items: baseline;
  margin: 6pt 0 4pt;
  padding: 0 8pt;
}
.oc-concepto-lbl {
  font-weight: 700;
  font-size: 9pt;
  color: #1a1a1a;
}
.oc-concepto-colon { color: #4a5568; }
.oc-concepto-val { font-weight: 600; font-size: 9pt; }

/* Tabla ítems */
.oc-items-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 6pt;
  font-size: 8.5pt;
  border: 0.5pt solid #94a3b8;
}
.oc-items-table thead { background: #f8fafc; }
.oc-items-table thead th {
  padding: 4pt 5pt;
  text-align: left;
  font-weight: 700;
  font-size: 8.5pt;
  color: #1a1a1a;
  border-bottom: 0.5pt solid #94a3b8;
  border-right: 0.5pt solid #cbd5e1;
}
.oc-items-table thead th:last-child { border-right: none; }
.oc-items-table tbody td {
  padding: 3pt 5pt;
  border-bottom: 0.25pt solid #e2e8f0;
  border-right: 0.25pt solid #e2e8f0;
  vertical-align: top;
  line-height: 1.35;
}
.oc-items-table tbody td:last-child { border-right: none; }
.oc-items-table tbody tr:last-child td { border-bottom: 0.5pt solid #94a3b8; }
.oc-cell-center { text-align: center; }
.oc-cell-right { text-align: right; }
.oc-cell-desc { color: #1a1a1a; }
.mono { font-family: 'Courier New', monospace; }

/* Tabla total */
.oc-total-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9pt;
}
.oc-total-table td {
  padding: 4pt 6pt;
  border: 0.5pt solid #94a3b8;
}
.oc-cell-proyecto {
  background: #f8fafc;
  font-weight: 500;
}
.oc-cell-total-label {
  background: #fef3c7;
  font-weight: 700;
  font-size: 9pt;
  width: 110pt;
  text-align: right;
}
.oc-cell-total-val {
  background: #fef3c7;
  font-weight: 800;
  font-size: 10pt;
  text-align: right;
  width: 110pt;
}

/* Generales + firma */
.oc-generales-block {
  display: flex;
  gap: 14pt;
  margin-top: 4pt;
  padding: 0 8pt;
}
.oc-generales-body {
  flex: 1;
  white-space: pre-wrap;
  font-size: 8.5pt;
  color: #2d3748;
  line-height: 1.45;
}
.oc-firma-wrap {
  width: 180pt;
  text-align: center;
  margin-top: 8pt;
}
.oc-firma-box {
  border-bottom: 0.75pt solid #1a1a1a;
  height: 55pt;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 4pt;
  margin-bottom: 4pt;
  background: #fafafa;
}
.oc-firma-label {
  font-size: 8pt;
  color: #94a3b8;
  letter-spacing: 1pt;
  font-weight: 600;
}
.oc-firma-caption {
  font-size: 8pt;
  line-height: 1.35;
  color: #1a1a1a;
}

/* Legal */
.oc-legal {
  font-size: 7pt;
  color: #4a5568;
  line-height: 1.5;
  margin-top: 10pt;
  text-align: justify;
  padding: 0 4pt;
}

/* Bottom · creado por + footer */
.oc-bottom-group { margin-top: 8pt; }
.oc-creado-row {
  display: flex;
  justify-content: space-between;
  padding: 4pt 8pt;
  border-top: 0.5pt solid #cbd5e1;
}
.oc-creado-block {
  display: flex;
  flex-direction: column;
}
.oc-creado-block-right { text-align: right; align-items: flex-end; }
.oc-creado-lbl {
  font-size: 7.5pt;
  color: #4a5568;
}
.oc-creado-val {
  font-size: 9pt;
  font-weight: 600;
}
.oc-creado-email {
  font-family: 'Courier New', monospace;
  font-size: 8pt;
  color: #1d4ed8;
}
.oc-footer-empresa {
  font-size: 7.5pt;
  color: #4a5568;
  text-align: center;
  padding: 6pt 0 0;
  border-top: 0.5pt solid #cbd5e1;
  line-height: 1.45;
}

@media print {
  body { margin: 0; padding: 0; background: white; }
  .oc-print-sheet {
    box-shadow: none !important;
    margin: 0;
    padding: 14mm 16mm 12mm;
  }
  .oc-items-table { page-break-inside: auto; }
  .oc-items-table tr { page-break-inside: avoid; page-break-after: auto; }
  .oc-bottom-group, .oc-generales-block { page-break-inside: avoid; }
}
`;
