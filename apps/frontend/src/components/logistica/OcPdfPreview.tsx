import { useQuery } from '@tanstack/react-query';
import { Download, Loader2, Printer, X } from 'lucide-react';
import { useRef } from 'react';
import { api } from '@/lib/api.js';

// Emisor real · MM HIGH METRIK ENGINEERS (de v1 data.js)
const EMISOR = {
  razonSocial: 'MM HIGH METRIK ENGINEERS S.A.C.',
  nombreComercial: 'MM HIGH METRIK ENGINEERS',
  ruc: '20610639764',
  direccion: 'Av. Republica de Colombia 625 Of. 501',
  distrito: 'San Isidro',
  provincia: 'Lima',
  departamento: 'Lima',
  email: 'mmhighmetrik@gmail.com',
  telefono: '(+51) 955 137 140',
  telefono2: '989010329',
  logoUrl: '/logo-mm.png',
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
    // Convertir img relative path a absolute para iframe nuevo
    const logoAbs = `${window.location.origin}${EMISOR.logoUrl}`;
    const html = sheet.outerHTML.replace(/src="\/logo-mm\.png"/g, `src="${logoAbs}"`);
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${data?.oc.numero ?? 'OC'}</title>
          <style>${PRINT_STYLES}</style>
        </head>
        <body>${html}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    // Wait for image load before print
    setTimeout(() => printWindow.print(), 500);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/60"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
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

      {/* Scroll viewport · sheet centrada · fondo gris claro v1 */}
      <div className="oc-preview-scroll flex-1">
        {isLoading || !data ? (
          <div className="flex items-center justify-center py-20 w-full">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div ref={sheetRef} className="oc-print-sheet">
            <style>{PRINT_STYLES}</style>
            <OcSheet data={data} />
          </div>
        )}
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
      {/* Header · logo + fecha emisión */}
      <div className="oc-header">
        <div className="oc-logo-wrap">
          <img src={EMISOR.logoUrl} alt={EMISOR.nombreComercial} className="oc-logo" />
          <div className="oc-logo-fallback">
            <div className="oc-logo-mm">MM</div>
            <div className="oc-logo-sub">HIGH METRIK ENGINEERS</div>
          </div>
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
            <tr>
              <td className="oc-kv-label">Nombre de</td>
              <td>:</td>
              <td>{EMISOR.razonSocial}</td>
            </tr>
            <tr>
              <td className="oc-kv-label">Direccion</td>
              <td>:</td>
              <td>
                {EMISOR.direccion.toUpperCase()}, {EMISOR.distrito.toUpperCase()} - {EMISOR.departamento.toUpperCase()}
              </td>
            </tr>
            <tr>
              <td className="oc-kv-label">RUC</td>
              <td>:</td>
              <td>{EMISOR.ruc}</td>
            </tr>
            <tr>
              <td className="oc-kv-label">Telefono</td>
              <td>:</td>
              <td>{EMISOR.telefono2}</td>
            </tr>
          </tbody>
        </table>
        <table className="oc-kv">
          <tbody>
            <tr>
              <td className="oc-kv-label-bold">Moneda</td>
              <td>:</td>
              <td>{oc.moneda === 'PEN' ? 'Soles' : 'Dólares'}</td>
            </tr>
            <tr>
              <td className="oc-kv-label-bold">Medio de pago</td>
              <td>:</td>
              <td>{oc.medioPago ?? '—'}</td>
            </tr>
            <tr>
              <td className="oc-kv-label-bold">Forma de pago</td>
              <td>:</td>
              <td>{oc.formaPago ?? '—'}</td>
            </tr>
            {oc.cotizacion && (
              <tr>
                <td className="oc-kv-label-bold">Cotización</td>
                <td>:</td>
                <td>{oc.cotizacion}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="oc-hr" />

      {/* Proveedor */}
      <div className="oc-section-title">Proveedor</div>
      <div className="oc-two-col">
        <table className="oc-kv">
          <tbody>
            <tr>
              <td className="oc-kv-label">Nombre</td>
              <td>:</td>
              <td>{proveedor?.razonSocial ?? '—'}</td>
            </tr>
            <tr>
              <td className="oc-kv-label">Direccion</td>
              <td>:</td>
              <td>{proveedor?.domicilio ?? '—'}</td>
            </tr>
            <tr>
              <td className="oc-kv-label">RUC</td>
              <td>:</td>
              <td>{proveedor?.ruc ?? 'S/ RUC'}</td>
            </tr>
          </tbody>
        </table>
        <table className="oc-kv">
          <tbody>
            <tr>
              <td className="oc-kv-label-bold">Lugar de entrega</td>
              <td>:</td>
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
            <th style={{ width: '14mm' }}>Item</th>
            <th>Descripción</th>
            <th style={{ width: '16mm' }}>Unid.</th>
            <th style={{ width: '18mm' }}>Cant.</th>
            <th style={{ width: '28mm' }}>Precio Unitario</th>
            <th style={{ width: '30mm' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((l) => {
            const cant = Number(l.cantidad);
            const pu = Number(l.precioUnitario);
            const tot = cant * pu;
            return (
              <tr key={l.id}>
                <td className="oc-cell-center">{l.numero.toFixed(2).padStart(4, '0')}</td>
                <td className="oc-cell-desc">{l.descripcion}</td>
                <td className="oc-cell-center">{l.unidad}</td>
                <td className="oc-cell-right">
                  {cant.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="oc-cell-right">
                  {monedaSym}&nbsp;{pu.toLocaleString('es-PE', { minimumFractionDigits: 5, maximumFractionDigits: 5 })}
                </td>
                <td className="oc-cell-right">
                  {monedaSym}&nbsp;{tot.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Total table separada · evita repetición multi-página */}
      <table className="oc-items-total-table">
        <tbody>
          <tr>
            <td className="oc-cell-label" colSpan={4}>
              PROYECTO: <b>{data.proyecto?.codigo ?? '—'}</b>
            </td>
            <td className="oc-cell-right oc-cell-label" style={{ width: '28mm' }}>
              <b>TOTAL (INC. IGV)</b>
            </td>
            <td className="oc-cell-right oc-cell-total" style={{ width: '30mm' }}>
              {monedaSym}&nbsp;
              {total.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </td>
          </tr>
          {oc.aplicaDetraccion && Number(oc.montoDetraccion) > 0 && (
            <>
              <tr>
                <td className="oc-cell-label" colSpan={4}>
                  Detracción SUNAT ({oc.pctDetraccion}%)
                </td>
                <td className="oc-cell-right oc-cell-label">
                  <b>DETRACCIÓN</b>
                </td>
                <td className="oc-cell-right" style={{ color: '#B45309' }}>
                  - {monedaSym}&nbsp;
                  {Number(oc.montoDetraccion).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
              <tr>
                <td className="oc-cell-label" colSpan={4} />
                <td className="oc-cell-right oc-cell-label">
                  <b>NETO A PAGAR</b>
                </td>
                <td className="oc-cell-right oc-cell-total">
                  {monedaSym}&nbsp;
                  {Number(oc.montoNetoPagar ?? oc.total).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
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
            <b>{(oc.gestorNombre ?? 'MARIO A. GARCÍA CALDERÓN').toUpperCase()}</b>
            <br />
            SUB GERENTE
          </div>
        </div>
      </div>

      {/* Legal */}
      <div className="oc-legal">
        Estimado proveedor no olvidar adjuntar los sustentos necesarios (orden de servicio/compra debidamente firmada y guía de
        remisión) para poder presentar su factura en nuestra oficina {EMISOR.direccion}, {EMISOR.distrito} - {EMISOR.departamento} y
        no estar sujetos a demora en su pago. Una vez confirmada la recepción de la Orden de Compra se dará por aceptada la misma
        sino recibimos ninguna observación luego de 24 horas. Si la cantidad o especificaciones del producto no corresponde a lo
        solicitado, el producto no será recibido y/o será devuelto al proveedor sin cargo alguno para la empresa. Al entregar la
        mercadería, indicar en las Guías de Remisión el número de Orden de Compra correspondiente. El proveedor es responsable de
        entregar la factura en Mesa de Partes de caso contrario no se procederá a registrar la factura para el respectivo pago. Si
        la venta del producto o prestación del servicio se encuentra afecta a detracción, deberá indicarse el importe afecto a
        esta y los datos de la cuenta corriente bancaria donde se debe realizar el depósito.
      </div>

      {/* Creado por + Gestión */}
      <div className="oc-bottom-group">
        <div className="oc-creado-row">
          <div className="oc-creado-block">
            <span className="oc-creado-lbl">Creado por</span>
            <span className="oc-creado-val oc-creado-email">{oc.creadoPorEmail ?? EMISOR.email}</span>
          </div>
          <div className="oc-creado-block oc-creado-block-right">
            <span className="oc-creado-lbl">Gestion:</span>
            <span className="oc-creado-val">{oc.gestorNombre ?? 'Mario A. García Calderón'}</span>
          </div>
        </div>

        <div className="oc-footer-empresa">
          {EMISOR.direccion} · {EMISOR.distrito} - {EMISOR.departamento}
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

// ─── CSS portado de v1 styles.css ─────────────────────────────
const PRINT_STYLES = `
.oc-preview-scroll {
  overflow: auto;
  background: #EEEEE9;
  padding: 24px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}
.oc-print-sheet {
  width: 210mm;
  min-height: 297mm;
  margin: 0 auto;
  padding: 12mm 16mm 10mm;
  background: #FFFFFF;
  color: #000000;
  font-family: 'Calibri', 'Segoe UI', 'Inter', sans-serif;
  font-size: 10pt;
  line-height: 1.35;
  box-shadow: 0 4px 20px rgba(0,0,0,0.12);
  box-sizing: border-box;
  flex-shrink: 0;
}

.oc-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 4mm;
}
.oc-logo-wrap {
  position: relative;
  width: 60mm;
  height: 20mm;
  display: flex;
  align-items: center;
}
.oc-logo {
  max-height: 20mm;
  max-width: 60mm;
  object-fit: contain;
}
.oc-logo-fallback {
  display: none;
  flex-direction: column;
  gap: 2px;
}
.oc-logo-mm {
  font-size: 30pt;
  font-weight: 900;
  color: #1C1C1C;
  letter-spacing: -2pt;
  line-height: 0.9;
}
.oc-logo-sub {
  font-size: 6.5pt;
  font-weight: 700;
  color: #3D3D3A;
  letter-spacing: 2pt;
  text-transform: uppercase;
}

.oc-header-right { text-align: right; font-size: 10pt; }
.oc-header-row { display: flex; gap: 10mm; justify-content: flex-end; }
.oc-header-lbl { font-weight: 700; }
.oc-header-val { min-width: 24mm; text-align: right; }

.oc-title {
  text-align: center;
  font-weight: 700;
  font-size: 11pt;
  letter-spacing: 0.5pt;
  border-bottom: 1.2pt solid #000;
  padding: 2mm 0;
  margin-bottom: 3mm;
}

.oc-section-title {
  font-weight: 700;
  font-size: 10pt;
  margin: 3mm 0 1mm 0;
}

.oc-two-col {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 8mm;
  margin-bottom: 2mm;
}

.oc-kv {
  border-collapse: collapse;
  font-size: 9pt;
  width: 100%;
}
.oc-kv td {
  padding: 0.5mm 0;
  vertical-align: top;
}
.oc-kv-label {
  width: 24mm;
  color: #1C1C1C;
  padding-right: 2mm;
}
.oc-kv-label-bold {
  width: 32mm;
  font-weight: 700;
  color: #1C1C1C;
  padding-right: 2mm;
}
.oc-kv td:nth-child(2) {
  width: 4mm;
  padding-right: 2mm;
  color: #1C1C1C;
}

.oc-hr {
  border-top: 0.5pt solid #D8D8D2;
  margin: 3mm 0;
}

.oc-concepto-row {
  display: flex;
  gap: 3mm;
  align-items: center;
  margin: 3mm 0 1.5mm 0;
  font-size: 9.5pt;
}
.oc-concepto-lbl { font-weight: 700; width: 22mm; }
.oc-concepto-colon { color: #1C1C1C; }
.oc-concepto-val { font-weight: 500; }

.oc-items-table {
  width: 100%;
  border-collapse: collapse;
  border: 1pt solid #000;
  font-size: 9pt;
  margin-bottom: 3mm;
}
.oc-items-table th {
  background: #FFFFFF;
  border: 0.5pt solid #000;
  padding: 1.5mm 2mm;
  font-weight: 700;
  text-align: center;
  font-size: 9pt;
  color: #000;
}
.oc-items-table td {
  border: 0.5pt solid #000;
  padding: 1.5mm 2mm;
  vertical-align: middle;
  color: #000;
}
.oc-cell-center { text-align: center; }
.oc-cell-right { text-align: right; }
.oc-cell-desc { font-size: 8.5pt; line-height: 1.25; }
.oc-cell-label { text-align: left; }
.oc-cell-total { background: #F8F7F3 !important; font-size: 10pt; }

.oc-items-total-table {
  width: 100%;
  border-collapse: collapse;
  border-left: 1pt solid #000;
  border-right: 1pt solid #000;
  border-bottom: 1pt solid #000;
  font-size: 9pt;
  margin-bottom: 3mm;
  page-break-before: avoid;
  break-before: avoid;
  page-break-inside: avoid;
  break-inside: avoid;
}
.oc-items-total-table td {
  border: 0.5pt solid #000;
  padding: 1.5mm 2mm;
  vertical-align: middle;
  color: #000;
  font-weight: 700;
  background: #FAFAFA;
}

.oc-generales-block {
  display: grid;
  grid-template-columns: 1fr 60mm;
  gap: 10mm;
  margin: 2mm 0 2mm 0;
  min-height: 26mm;
}
.oc-generales-title { font-weight: 700; font-size: 10pt; margin-bottom: 1mm; }
.oc-generales-body {
  font-size: 9pt;
  white-space: pre-line;
  line-height: 1.5;
}
.oc-firma-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2mm;
}
.oc-firma-box {
  width: 55mm;
  height: 22mm;
  border: 1pt dashed #6B6B68;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #FCFCFA;
}
.oc-firma-label {
  font-size: 9pt;
  color: #9A9A96;
  letter-spacing: 1pt;
  text-transform: uppercase;
  font-weight: 500;
}
.oc-firma-caption {
  font-size: 7.5pt;
  text-align: center;
  line-height: 1.3;
  color: #1C1C1C;
}

.oc-legal {
  font-size: 7pt;
  line-height: 1.3;
  text-align: justify;
  color: #1C1C1C;
  margin: 2mm 0 3mm 0;
}

.oc-creado-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin: 2mm 0 3mm 0;
  padding: 2mm 0;
  border-top: 0.5pt solid #D8D8D2;
  border-bottom: 0.5pt solid #D8D8D2;
  font-size: 9pt;
}
.oc-creado-block { display: flex; gap: 4mm; align-items: baseline; }
.oc-creado-block-right { text-align: right; }
.oc-creado-lbl { color: #3D3D3A; }
.oc-creado-val { font-weight: 500; }
.oc-creado-email { color: #2A44B8; text-decoration: underline; }

.oc-footer-empresa {
  text-align: center;
  font-size: 8.5pt;
  color: #1C1C1C;
  line-height: 1.45;
  margin-top: 2mm;
}

/* Page breaks */
.oc-items-table { page-break-inside: auto; break-inside: auto; }
.oc-items-table thead { display: table-header-group; }
.oc-items-table tr { page-break-inside: avoid; break-inside: avoid; }
.oc-header,
.oc-title,
.oc-two-col,
.oc-concepto-row,
.oc-generales-block,
.oc-creado-row,
.oc-footer-empresa,
.oc-bottom-group,
.oc-firma-wrap { page-break-inside: avoid; break-inside: avoid; }
.oc-legal { orphans: 3; widows: 3; }

@media print {
  html, body {
    background: #FFFFFF !important;
    margin: 0;
    padding: 0;
  }
  @page { size: A4; margin: 0; }
  .oc-preview-scroll { background: white !important; padding: 0 !important; }
  .oc-print-sheet { box-shadow: none !important; margin: 0; }
}
`;
