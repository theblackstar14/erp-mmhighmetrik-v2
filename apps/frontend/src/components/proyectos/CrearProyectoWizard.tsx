import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, FileSpreadsheet, FileText, Loader2, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type CvPreviewResponse, type ParsedContract, api } from '@/lib/api.js';
import { cn, fmtPEN } from '@/lib/utils.js';

type Step = 'upload' | 'review-pdf' | 'review-xlsx' | 'creating';

type Props = { onClose: () => void };

export function CrearProyectoWizard({ onClose }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('upload');
  const [parsed, setParsed] = useState<ParsedContract | null>(null);
  const [xlsxPreview, setXlsxPreview] = useState<CvPreviewResponse | null>(null);
  const [xlsxFile, setXlsxFile] = useState<File | null>(null);
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [tipoEntidad, setTipoEntidad] = useState('gobierno_regional');
  const [error, setError] = useState('');

  // ─── PDF · IA Gemini ───────────────────────────────────────
  const parsePdfMut = useMutation({
    mutationFn: (f: File) => api.ia.parseContract(f),
    onSuccess: async (r) => {
      setParsed(r.data);
      setNombre(r.data.proyecto?.nombre ?? '');
      await autoCodigo();
      setStep('review-pdf');
    },
    onError: (e: Error) => {
      setError(e.message);
      setStep('upload');
    },
  });

  // ─── XLSX · Cronograma Valorizado ──────────────────────────
  const previewXlsxMut = useMutation({
    mutationFn: (f: File) => api.proyectos.previewXlsx(f),
    onSuccess: (r) => {
      setXlsxPreview(r);
      setCodigo(r.sugerencia.codigo);
      setNombre(r.header.obra ?? '');
      setStep('review-xlsx');
    },
    onError: (e: Error) => {
      setError(e.message);
      setStep('upload');
    },
  });

  const importXlsxMut = useMutation({
    mutationFn: () =>
      api.proyectos.importXlsx(xlsxFile!, { codigo, nombre, tipoEntidad }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['proyectos'] });
      navigate(`/proyectos/${r.proyectoId}`);
      onClose();
    },
    onError: (e: Error) => {
      setError(e.message);
      setStep('review-xlsx');
    },
  });

  const createMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.proyectos.create(payload),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['proyectos'] });
      navigate(`/proyectos/${r.proyecto.id}`);
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  async function autoCodigo() {
    try {
      const list = await api.proyectos.list();
      const nums = list.proyectos
        .map((p) => {
          const m = p.codigo.match(/^PG(\d+)$/i);
          return m ? Number.parseInt(m[1]!, 10) : 0;
        })
        .filter((n) => n > 0);
      const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
      setCodigo(`PG${String(next).padStart(4, '0')}`);
    } catch {
      setCodigo('PG0001');
    }
  }

  const handlePdfFile = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.includes('pdf')) {
      setError('Solo PDFs');
      return;
    }
    setError('');
    parsePdfMut.mutate(f);
  };

  const handleXlsxFile = (f: File | undefined) => {
    if (!f) return;
    const name = f.name.toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
      setError('Solo .xlsx');
      return;
    }
    setError('');
    setXlsxFile(f);
    previewXlsxMut.mutate(f);
  };

  const skipIA = async () => {
    setParsed({});
    await autoCodigo();
    setStep('review-pdf');
  };

  const submitCreatePdf = () => {
    if (!codigo || !nombre) {
      setError('Código y nombre obligatorios');
      return;
    }
    setStep('creating');
    const payload: Record<string, unknown> = {
      codigo,
      nombre,
      ubicacion: parsed?.proyecto?.ubicacion ?? undefined,
      tipo: 'Edificación',
      modalidad: parsed?.contrato?.tipoModalidad ?? 'suma_alzada',
      status: 'adjudicado',
      fechaInicio: parsed?.contrato?.fechaInicio ?? undefined,
      fechaFin: parsed?.contrato?.fechaFin ?? undefined,
      pctAdelantoDirecto: parsed?.adelantos?.directoPct ?? undefined,
      pctAdelantoMateriales: parsed?.adelantos?.materialesPct ?? undefined,
      pctFielCumplimiento: parsed?.garantias?.fielCumplimientoPct ?? undefined,
      pctPenalidadTope: parsed?.penalidades?.topePct ?? undefined,
    };
    createMut.mutate(payload);
  };

  const submitImportXlsx = () => {
    if (!codigo || !nombre) {
      setError('Código y nombre obligatorios');
      return;
    }
    setStep('creating');
    importXlsxMut.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-3xl max-h-[92vh] overflow-hidden rounded-md border border-line bg-bg-elev shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold">Nuevo proyecto</h2>
            <p className="text-[11px] text-ink-3 mt-0.5">
              {step === 'upload' && 'Elige cómo cargar el proyecto'}
              {step === 'review-pdf' && 'Datos extraídos del contrato · revisa y corrige'}
              {step === 'review-xlsx' && 'Datos extraídos del Cronograma Valorizado · confirma'}
              {step === 'creating' && 'Creando proyecto...'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-bg-sunken"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {step === 'upload' && (
            <div className="space-y-3">
              {(parsePdfMut.isPending || previewXlsxMut.isPending) ? (
                <div className="flex flex-col items-center py-12">
                  <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
                  <p className="text-[13px] font-medium">
                    {parsePdfMut.isPending ? 'Analizando contrato con Gemini IA' : 'Parseando Cronograma XLSX'}
                  </p>
                  <p className="text-[11px] text-ink-3 mt-1">
                    {parsePdfMut.isPending ? '~10-20 segundos' : '~2-5 segundos'}
                  </p>
                </div>
              ) : (
                <>
                  {/* PDF */}
                  <label className="block">
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={(e) => handlePdfFile(e.target.files?.[0])}
                    />
                    <div className="flex items-center gap-3 rounded-md border-2 border-dashed border-line p-4 cursor-pointer hover:border-primary hover:bg-primary-soft/30 transition-colors">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-primary-soft">
                        <FileText className="h-6 w-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold">Subir contrato PDF</p>
                        <p className="text-[11px] text-ink-3 mt-0.5">
                          IA Gemini extrae montos, plazos, garantías, adelantos · ~15s
                        </p>
                      </div>
                      <Sparkles className="h-4 w-4 text-primary shrink-0" />
                    </div>
                  </label>

                  {/* XLSX · Cronograma Valorizado */}
                  <label className="block">
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(e) => handleXlsxFile(e.target.files?.[0])}
                    />
                    <div className="flex items-center gap-3 rounded-md border-2 border-dashed border-line p-4 cursor-pointer hover:border-ok hover:bg-ok-soft/30 transition-colors">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-ok-soft">
                        <FileSpreadsheet className="h-6 w-6 text-ok" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold">Subir Cronograma Valorizado XLSX</p>
                        <p className="text-[11px] text-ink-3 mt-0.5">
                          Formato CAPECO/S10 · auto-extrae partidas, plazo, costos · sin contrato necesario
                        </p>
                      </div>
                      <span className="chip green shrink-0">Recomendado</span>
                    </div>
                  </label>

                  <div className="text-center pt-2">
                    <button
                      type="button"
                      onClick={skipIA}
                      className="text-[12px] text-ink-3 hover:text-foreground underline"
                    >
                      Crear vacío · ingresar datos manualmente
                    </button>
                  </div>

                  {error && (
                    <div className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-[12px] text-destructive">
                      {error}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {step === 'review-pdf' && parsed && (
            <ReviewPdfStep
              codigo={codigo}
              nombre={nombre}
              setCodigo={setCodigo}
              setNombre={setNombre}
              parsed={parsed}
              setParsed={setParsed}
            />
          )}

          {step === 'review-xlsx' && xlsxPreview && (
            <ReviewXlsxStep
              preview={xlsxPreview}
              codigo={codigo}
              nombre={nombre}
              tipoEntidad={tipoEntidad}
              setCodigo={setCodigo}
              setNombre={setNombre}
              setTipoEntidad={setTipoEntidad}
              error={error}
            />
          )}

          {step === 'creating' && (
            <div className="flex flex-col items-center py-12">
              <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
              <p className="text-[13px] font-medium">Creando proyecto...</p>
              <p className="text-[11px] text-ink-3 mt-1">
                Insertando partidas en lotes... esto puede tomar 5-10s
              </p>
            </div>
          )}
        </div>

        {/* Footer · acciones */}
        {(step === 'review-pdf' || step === 'review-xlsx') && (
          <div className="flex justify-between gap-2 border-t border-line px-5 py-3">
            <button
              type="button"
              onClick={() => {
                setStep('upload');
                setParsed(null);
                setXlsxPreview(null);
                setXlsxFile(null);
                setError('');
              }}
              className="px-3 py-1.5 rounded-md text-[12px] text-ink-2 hover:bg-bg-sunken"
            >
              ← Volver
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-md border border-line text-[12px] text-ink-2 hover:bg-bg-sunken"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={step === 'review-pdf' ? submitCreatePdf : submitImportXlsx}
                disabled={!codigo || !nombre}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                {step === 'review-xlsx' ? 'Importar proyecto + partidas' : 'Crear proyecto'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewXlsxStep({
  preview,
  codigo,
  nombre,
  tipoEntidad,
  setCodigo,
  setNombre,
  setTipoEntidad,
  error,
}: {
  preview: CvPreviewResponse;
  codigo: string;
  nombre: string;
  tipoEntidad: string;
  setCodigo: (s: string) => void;
  setNombre: (s: string) => void;
  setTipoEntidad: (s: string) => void;
  error: string;
}) {
  const cuadre = preview.stats.cuadre;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md bg-ok-soft px-3 py-2">
        <FileSpreadsheet className="h-3.5 w-3.5 text-ok" />
        <span className="text-[11px] text-ok font-medium">
          XLSX parseado · {preview.stats.totalPartidas} partidas ({preview.stats.totalHojas} hojas, {preview.stats.totalTitulos} títulos) · {preview.meses.length} meses · cuadre {cuadre ? '✓' : '✗ diff S/ ' + preview.stats.diferenciaCuadre.toFixed(2)}
        </span>
      </div>

      <Section title="Identificación">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Código proyecto *" value={codigo} onChange={setCodigo} placeholder="PG0010" mono />
          <Field
            label="Tipo entidad"
            value={tipoEntidad}
            onChange={setTipoEntidad}
            placeholder="gobierno_regional"
          />
        </div>
        <Field label="Nombre obra *" value={nombre} onChange={setNombre} multiline />
      </Section>

      <Section title="Datos extraídos">
        <div className="rounded-md border border-line bg-bg-sunken/40 p-3 space-y-1.5 text-[11.5px]">
          <Row k="Ubicación" v={preview.header.ubicacion ?? '—'} />
          <Row k="Cliente" v={preview.header.cliente ?? '—'} />
          <Row k="Costo base" v={preview.header.costoBase ?? '—'} />
          <Row k="Plazo" v={preview.header.diasPlazo ? `${preview.header.diasPlazo} días` : '—'} />
          <Row
            k="Período"
            v={preview.meses.length ? `${preview.meses[0]!.label} → ${preview.meses.at(-1)!.label}` : '—'}
          />
        </div>
      </Section>

      <Section title="Totales del expediente">
        <div className="rounded-md border border-line bg-bg-sunken/40 p-3 space-y-1.5 text-[11.5px]">
          <Row k="Costo Directo" v={fmtPEN(preview.totales.costoDirecto ?? 0)} mono />
          <Row k={`GG (${((preview.totales.pctGg ?? 0) * 100).toFixed(0)}%)`} v={fmtPEN(preview.totales.montoGg ?? 0)} mono />
          <Row k={`Utilidad (${((preview.totales.pctUtilidad ?? 0) * 100).toFixed(0)}%)`} v={fmtPEN(preview.totales.montoUtilidad ?? 0)} mono />
          <Row k="Sub Total" v={fmtPEN(preview.totales.subTotal ?? 0)} mono bold />
          {preview.totales.mobiliario != null && preview.totales.mobiliario > 0 && (
            <Row k="Mobiliario y equipamiento" v={fmtPEN(preview.totales.mobiliario)} mono />
          )}
          <Row k={`IGV (${((preview.totales.pctIgv ?? 0) * 100).toFixed(0)}%)`} v={fmtPEN(preview.totales.montoIgv ?? 0)} mono />
          <Row k="Presupuesto Total Ejecución" v={fmtPEN(preview.totales.presupuestoTotal ?? 0)} mono bold accent />
          {preview.totales.supervision != null && preview.totales.supervision > 0 && (
            <Row k="Supervisión de obra" v={fmtPEN(preview.totales.supervision)} mono />
          )}
          {preview.totales.valorReferencial != null && (
            <Row k="VALOR REFERENCIAL" v={fmtPEN(preview.totales.valorReferencial)} mono bold accent />
          )}
        </div>
      </Section>

      {preview.warnings.length > 0 && (
        <div className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[11.5px] text-warn-ink space-y-1">
          {preview.warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-[12px] text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}

function Row({
  k,
  v,
  mono,
  bold,
  accent,
}: {
  k: string;
  v: string;
  mono?: boolean;
  bold?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-3">{k}</span>
      <span
        className={cn(
          'text-foreground tabular-nums',
          mono && 'font-mono',
          bold && 'font-semibold',
          accent && 'text-primary',
        )}
      >
        {v}
      </span>
    </div>
  );
}

function ReviewPdfStep({
  codigo,
  nombre,
  setCodigo,
  setNombre,
  parsed,
  setParsed,
}: {
  codigo: string;
  nombre: string;
  setCodigo: (s: string) => void;
  setNombre: (s: string) => void;
  parsed: ParsedContract;
  setParsed: (p: ParsedContract) => void;
}) {
  return (
    <div className="space-y-5">
      {Object.keys(parsed).length > 0 && (
        <div className="flex items-center gap-2 rounded-md bg-primary-soft px-3 py-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] text-primary-ink font-medium">
            Datos extraídos por Gemini IA · revisá y corrigí
          </span>
        </div>
      )}

      <Section title="Identificación">
        <Field label="Código proyecto *" value={codigo} onChange={setCodigo} placeholder="PG0001" mono />
        <Field label="Nombre obra *" value={nombre} onChange={setNombre} multiline />
        <Field
          label="N° contrato"
          value={parsed.contrato?.numeroContrato ?? ''}
          onChange={(v) => setParsed({ ...parsed, contrato: { ...parsed.contrato, numeroContrato: v } })}
          placeholder="037-2025-GAF-MSS"
          mono
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="CUI (obra pública)"
            value={parsed.proyecto?.codigoCui ?? ''}
            onChange={(v) => setParsed({ ...parsed, proyecto: { ...parsed.proyecto, codigoCui: v } })}
            mono
          />
          <Field
            label="Etapa"
            value={parsed.proyecto?.etapa ?? ''}
            onChange={(v) => setParsed({ ...parsed, proyecto: { ...parsed.proyecto, etapa: v } })}
          />
        </div>
        <Field
          label="Ubicación"
          value={parsed.proyecto?.ubicacion ?? ''}
          onChange={(v) => setParsed({ ...parsed, proyecto: { ...parsed.proyecto, ubicacion: v } })}
        />
      </Section>

      <Section title="Entidad contratante">
        <div className="grid grid-cols-[2fr_1fr] gap-3">
          <Field
            label="Razón social"
            value={parsed.entidadContratante?.razonSocial ?? ''}
            onChange={(v) =>
              setParsed({ ...parsed, entidadContratante: { ...parsed.entidadContratante, razonSocial: v } })
            }
          />
          <Field
            label="RUC"
            value={parsed.entidadContratante?.ruc ?? ''}
            onChange={(v) => setParsed({ ...parsed, entidadContratante: { ...parsed.entidadContratante, ruc: v } })}
            mono
          />
        </div>
      </Section>

      <Section title="Datos económicos">
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Monto contractual S/"
            value={String(parsed.contrato?.montoContractual ?? '')}
            onChange={(v) =>
              setParsed({
                ...parsed,
                contrato: { ...parsed.contrato, montoContractual: Number.parseFloat(v) || 0 },
              })
            }
            placeholder="1730120.84"
            mono
          />
          <Field
            label="Días plazo"
            value={String(parsed.contrato?.diasPlazo ?? '')}
            onChange={(v) =>
              setParsed({ ...parsed, contrato: { ...parsed.contrato, diasPlazo: Number.parseInt(v) || 0 } })
            }
            placeholder="120"
            mono
          />
        </div>
      </Section>

      <Section title="Fechas clave">
        <div className="grid grid-cols-3 gap-3">
          <Field
            label="Buena Pro"
            type="date"
            value={parsed.contrato?.fechaBuenaPro ?? ''}
            onChange={(v) => setParsed({ ...parsed, contrato: { ...parsed.contrato, fechaBuenaPro: v } })}
          />
          <Field
            label="Firma contrato"
            type="date"
            value={parsed.contrato?.fechaFirmaContrato ?? ''}
            onChange={(v) => setParsed({ ...parsed, contrato: { ...parsed.contrato, fechaFirmaContrato: v } })}
          />
          <Field
            label="Inicio obra"
            type="date"
            value={parsed.contrato?.fechaInicio ?? ''}
            onChange={(v) => setParsed({ ...parsed, contrato: { ...parsed.contrato, fechaInicio: v } })}
          />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 font-medium">{title}</h3>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  mono,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
  multiline?: boolean;
}) {
  return (
    <label className="block">
      <span className="block font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4 font-medium mb-1">
        {label}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className={cn(
            'w-full rounded-md border border-line bg-bg-elev px-3 py-2 text-[12.5px] outline-none placeholder:text-ink-4 focus:border-primary focus:ring-1 focus:ring-primary',
            mono && 'font-mono',
          )}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            'w-full h-9 rounded-md border border-line bg-bg-elev px-3 text-[12.5px] outline-none placeholder:text-ink-4 focus:border-primary focus:ring-1 focus:ring-primary',
            mono && 'font-mono',
          )}
        />
      )}
    </label>
  );
}
