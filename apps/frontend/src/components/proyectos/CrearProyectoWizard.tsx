import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, FileSpreadsheet, FileText, Loader2, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type CvPreviewResponse, type Inversion, type ParsedContract, api } from '@/lib/api.js';
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
  const [contratoFile, setContratoFile] = useState<File | null>(null);
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [tipoEntidad, setTipoEntidad] = useState('gobierno_regional');
  const [inversionId, setInversionId] = useState<string>(''); // '' = sin inversión-padre
  const [codigoIe, setCodigoIe] = useState('');
  const [showInv, setShowInv] = useState(false); // P4 · inversión-padre colapsada (caso colegios/OxI · no aplica a proyecto independiente)
  const [error, setError] = useState('');

  const inversionesQuery = useQuery({
    queryKey: ['inversiones'],
    queryFn: () => api.inversiones.list(),
  });
  const inversiones = inversionesQuery.data?.inversiones ?? [];

  // Vincular proyecto recién creado a la inversión-padre (no destructivo)
  async function linkSiCorresponde(proyectoId: string) {
    if (!inversionId) return;
    try {
      const inv = inversiones.find((i) => i.id === inversionId);
      await api.inversiones.linkProyecto(inversionId, {
        proyectoId,
        cui: inv?.cui,
        codigoIe: codigoIe || undefined,
      });
      qc.invalidateQueries({ queryKey: ['inversiones'] });
    } catch {
      // no bloquea la navegación · vínculo se puede rehacer desde detalle inversión
    }
  }

  // ─── Contrato PDF · IA Gemini (best-effort · no auto-avanza paso) ───
  const parsePdfMut = useMutation({
    mutationFn: (f: File) => api.ia.parseContract(f),
    onSuccess: (r) => setParsed(r.data),
    onError: (e: Error) => setError(`Contrato IA no disponible (se archivará igual): ${e.message}`),
  });

  // ─── Cronograma Valorizado XLSX (no auto-avanza paso) ──────
  const previewXlsxMut = useMutation({
    mutationFn: (f: File) => api.proyectos.previewXlsx(f),
    onSuccess: (r) => {
      setXlsxPreview(r);
      setCodigo(r.sugerencia.codigo);
      setNombre(r.header.obra ?? '');
      if (r.sugerencia.tipoEntidad) setTipoEntidad(r.sugerencia.tipoEntidad); // P2 · default inferido del cliente
    },
    onError: (e: Error) => setError(e.message),
  });

  // Crear: cronograma → proyecto+partidas · luego aplica datos del contrato + lo archiva (best-effort)
  const submitImportXlsx = async () => {
    if (!codigo || !nombre) { setError('Código y nombre obligatorios'); return; }
    if (!xlsxFile || !contratoFile) { setError('Cronograma y contrato son obligatorios'); return; }
    setStep('creating');
    try {
      const r = await api.proyectos.importXlsx(xlsxFile, { codigo, nombre, tipoEntidad, inversionId: inversionId || undefined, codigoIe: codigoIe || undefined });
      // Aplicar datos contractuales extraídos por IA (los que el cronograma no trae)
      if (parsed && Object.keys(parsed).length > 0) {
        const c = parsed.contrato;
        const patch: Record<string, unknown> = {};
        if (c?.numeroContrato) patch.numeroContrato = c.numeroContrato;
        if (c?.fechaBuenaPro) patch.fechaBuenaPro = c.fechaBuenaPro;
        if (c?.fechaFirmaContrato) patch.fechaFirmaContrato = c.fechaFirmaContrato;
        if (c?.fechaInicio) patch.fechaInicio = c.fechaInicio;
        if (c?.fechaFin) patch.fechaFin = c.fechaFin;
        if (parsed.adelantos?.directoPct != null) patch.pctAdelantoDirecto = parsed.adelantos.directoPct;
        if (parsed.adelantos?.materialesPct != null) patch.pctAdelantoMateriales = parsed.adelantos.materialesPct;
        if (parsed.garantias?.fielCumplimientoPct != null) patch.pctFielCumplimiento = parsed.garantias.fielCumplimientoPct;
        if (parsed.penalidades?.topePct != null) patch.pctPenalidadTope = parsed.penalidades.topePct;
        if (Object.keys(patch).length) { try { await api.proyectos.update(r.proyectoId, patch); } catch { /* no bloquea */ } }
      }
      // Archivar el contrato PDF al NAS (01_Contrato)
      try { await api.proyectos.uploadContrato(r.proyectoId, contratoFile); } catch { /* best-effort */ }
      qc.invalidateQueries({ queryKey: ['proyectos'] });
      qc.invalidateQueries({ queryKey: ['inversiones'] });
      navigate(`/proyectos/${r.proyectoId}`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setStep('review-xlsx');
    }
  };

  const createMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.proyectos.create(payload),
    onSuccess: async (r) => {
      await linkSiCorresponde(r.proyecto.id);
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
      setError('El contrato debe ser PDF');
      return;
    }
    setError('');
    setContratoFile(f);
    parsePdfMut.mutate(f); // IA en background · best-effort
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[1px] p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-2xl max-h-[82vh] overflow-hidden rounded-md border border-line bg-bg-elev shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div>
            <h2 className="text-[15px] font-semibold">Nuevo proyecto</h2>
            <p className="text-[11px] text-ink-3 mt-0.5">
              {step === 'upload' && 'Sube el cronograma valorizado y el contrato'}
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
        <div className="flex-1 overflow-y-auto p-4">
          {step === 'upload' && (
            <div className="space-y-3">
              <p className="text-[12px] text-ink-3">Para crear el proyecto sube <b>ambos</b>: el cronograma valorizado (arma las partidas) y el contrato (datos contractuales + respaldo).</p>

              <FileDrop
                accept=".xlsx,.xls"
                onPick={handleXlsxFile}
                Icon={FileSpreadsheet}
                iconCls="bg-ok-soft text-ok"
                title="Cronograma Valorizado (XLSX)"
                hint="Formato CAPECO/S10 · arma partidas, plazo y costos"
                loading={previewXlsxMut.isPending}
                loadingTxt="Parseando cronograma…"
                done={!!xlsxPreview}
                doneTxt={xlsxPreview ? `${xlsxFile?.name ?? ''} · ${xlsxPreview.stats.totalPartidas} partidas` : ''}
              />

              <FileDrop
                accept="application/pdf"
                onPick={handlePdfFile}
                Icon={FileText}
                iconCls="bg-primary-soft text-primary"
                title="Contrato (PDF)"
                hint="IA extrae N° contrato, fechas, garantías y adelantos · se archiva en 01_Contrato"
                loading={parsePdfMut.isPending}
                loadingTxt="Analizando contrato con IA…"
                done={!!contratoFile}
                doneTxt={contratoFile ? `${contratoFile.name}${parsed && Object.keys(parsed).length ? ' · IA ✓' : parsePdfMut.isError ? ' · se archivará sin IA' : ''}` : ''}
              />

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-[12px] text-destructive">{error}</div>
              )}

              <button
                type="button"
                disabled={!xlsxPreview || !contratoFile || previewXlsxMut.isPending || parsePdfMut.isPending}
                onClick={() => { setError(''); setStep('review-xlsx'); }}
                className="w-full flex items-center justify-center gap-1.5 h-10 rounded-md bg-primary text-primary-foreground text-[13px] font-medium hover:opacity-90 disabled:opacity-50"
              >
                <Check className="h-4 w-4" /> Continuar
              </button>

              <div className="text-center pt-1">
                <button type="button" onClick={skipIA} className="text-[11.5px] text-ink-4 hover:text-foreground underline">Crear vacío · ingresar datos manualmente</button>
              </div>
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

          {step === 'review-xlsx' && xlsxPreview && contratoFile && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/[0.04] px-3 py-2">
              <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-[11px] text-ink-2">
                Contrato adjunto: <b>{contratoFile.name}</b>
                {parsed && Object.keys(parsed).length > 0
                  ? ' · IA aplicará N° contrato, fechas, garantías y adelantos al crear'
                  : ' · se archivará en 01_Contrato (sin IA)'}
              </span>
            </div>
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

          {(step === 'review-pdf' || step === 'review-xlsx') && (
            <div className="mt-5 border-t border-line pt-3">
              {!showInv && !inversionId ? (
                <button
                  type="button"
                  onClick={() => setShowInv(true)}
                  className="text-[11.5px] text-ink-4 hover:text-foreground underline"
                >
                  ¿Es un colegio agrupado bajo una inversión-padre (Obras por Impuestos)? · vincular
                </button>
              ) : (
                <InversionPicker
                  inversiones={inversiones}
                  inversionId={inversionId}
                  setInversionId={setInversionId}
                  codigoIe={codigoIe}
                  setCodigoIe={setCodigoIe}
                />
              )}
            </div>
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
          <div className="flex justify-between gap-2 border-t border-line px-5 py-2.5">
            <button
              type="button"
              onClick={() => { setStep('upload'); setError(''); }}
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
  const val = preview.validation;
  const ggUt = {
    separado: { txt: 'GG + Utilidad separados (% sobre CD + mobiliario)', cls: 'bg-primary-soft text-primary-ink' },
    embebido_cd: { txt: 'GG + Utilidad EMBEBIDOS en el CD (sin % desglosado)', cls: 'bg-warn-soft text-warn-ink' },
    simple_pct: { txt: 'Desglose simple (% sobre CD, sin mobiliario)', cls: 'bg-ok-soft text-ok' },
  }[preview.ggUtModo];
  return (
    <div className="space-y-2.5">
      {/* Resumen compacto del parseo · 1 línea cuando todo OK (antes eran 3 banners) */}
      <div className="rounded-md bg-ok-soft px-3 py-1.5 flex items-center gap-x-2 gap-y-0.5 flex-wrap text-[11px] font-medium text-ok">
        <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
        <span>{preview.stats.totalPartidas} partidas · {preview.meses.length} meses · cuadre {cuadre ? '✓' : '✗ S/ ' + preview.stats.diferenciaCuadre.toFixed(2)}</span>
        {val?.ok && <span className="text-primary-ink">· IA {val.passed}/{val.totalChecks} ✓</span>}
        <span className="text-ok/70">· {ggUt.txt}</span>
      </div>

      {val && !val.ok && (
        <div className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2.5 space-y-1.5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-warn-ink shrink-0" />
            <span className="text-[11.5px] font-semibold text-warn-ink">
              {val.discrepancias.length} discrepancia(s) detectadas por IA validación cruzada
            </span>
          </div>
          <div className="space-y-0.5 pl-5">
            {val.discrepancias.map((d) => (
              <div key={d.campo} className="text-[10.5px] text-warn-ink/90 font-mono tabular-nums">
                <span className="font-semibold">{d.campo}</span>: deterministic={d.deterministic ?? 'null'} · IA={d.llm ?? 'null'}
                {d.diff != null && d.diff > 0 && <span className="ml-2 text-warn-ink/70">diff {d.diff.toFixed(2)}</span>}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-warn-ink/70 pl-5 mt-1">
            Revisa Excel manualmente antes de importar · o continúa si confías en parser deterministic.
          </p>
        </div>
      )}
      {!val && preview.llmError && (
        <div className="rounded-md border border-line bg-bg-sunken/30 px-3 py-2 text-[10.5px] text-ink-3">
          <span className="font-medium">⊘ Validación IA no disponible:</span> {preview.llmError}
        </div>
      )}

      <Section title="Identificación">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Código proyecto *" value={codigo} onChange={setCodigo} placeholder="PG0010" mono />
          <label className="block">
            <span className="block font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4 font-medium mb-1">Tipo entidad</span>
            <select
              value={tipoEntidad}
              onChange={(e) => setTipoEntidad(e.target.value)}
              className="w-full h-9 rounded-md border border-line bg-bg-elev px-3 text-[12.5px] outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              <option value="municipalidad">Municipalidad</option>
              <option value="gobierno_regional">Gobierno Regional</option>
              <option value="ministerio">Ministerio / Gobierno Nacional</option>
              <option value="privado">Privado</option>
            </select>
          </label>
        </div>
        <Field label="Nombre obra *" value={nombre} onChange={setNombre} multiline />
      </Section>

      <Section title="Datos extraídos">
        <div className="rounded-md border border-line bg-bg-sunken/40 p-2.5 space-y-1 text-[11px]">
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
        <div className="rounded-md border border-line bg-bg-sunken/40 p-2.5 space-y-1 text-[11px]">
          <Row k="Costo Directo" v={fmtPEN(preview.totales.costoDirecto ?? 0)} mono />
          {preview.ggUtModo === 'embebido_cd' ? (
            <Row k="GG + Utilidad" v="incluidos en el CD" mono />
          ) : (
            <>
              <Row k={`GG (${((preview.totales.pctGg ?? 0) * 100).toFixed(0)}%)`} v={fmtPEN(preview.totales.montoGg ?? 0)} mono />
              <Row k={`Utilidad (${((preview.totales.pctUtilidad ?? 0) * 100).toFixed(0)}%)`} v={fmtPEN(preview.totales.montoUtilidad ?? 0)} mono />
            </>
          )}
          {(() => {
            const cd = preview.totales.costoDirecto ?? 0;
            const mob = preview.totales.mobiliario ?? 0;
            // Sub Total: en embebido el CD ya es el subtotal (GG+UT dentro)
            const subTotal = preview.totales.subTotal ?? (preview.ggUtModo === 'embebido_cd' ? cd : 0);
            const igvMonto = preview.totales.montoIgv ?? 0;
            const baseIgv = subTotal + mob;
            // IGV %: usar el declarado, o derivar de montos si el parser lo dejó null
            const igvPct = preview.totales.pctIgv ?? (baseIgv > 0 ? igvMonto / baseIgv : 0);
            return (
              <>
                <Row k="Sub Total" v={fmtPEN(subTotal)} mono bold />
                {mob > 0 && <Row k="Mobiliario y equipamiento" v={fmtPEN(mob)} mono />}
                <Row k={`IGV (${(igvPct * 100).toFixed(0)}%)`} v={fmtPEN(igvMonto)} mono />
              </>
            );
          })()}
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

function InversionPicker({
  inversiones,
  inversionId,
  setInversionId,
  codigoIe,
  setCodigoIe,
}: {
  inversiones: Inversion[];
  inversionId: string;
  setInversionId: (s: string) => void;
  codigoIe: string;
  setCodigoIe: (s: string) => void;
}) {
  return (
    <Section title="Inversión-padre (opcional · agrupa colegios bajo 1 CUI)">
      <div className="rounded-md border border-line bg-bg-sunken/40 p-3 space-y-3">
        <label className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4 font-medium mb-1">
            Inversión / CUI
          </span>
          <select
            value={inversionId}
            onChange={(e) => setInversionId(e.target.value)}
            className="w-full h-9 rounded-md border border-line bg-bg-elev px-3 text-[12.5px] outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          >
            <option value="">— Sin inversión-padre (proyecto independiente) —</option>
            {inversiones.map((i) => (
              <option key={i.id} value={i.id}>
                {i.cui} · {i.nombre.slice(0, 60)}
              </option>
            ))}
          </select>
        </label>
        {inversionId && (
          <Field
            label="Código IE (institución educativa)"
            value={codigoIe}
            onChange={setCodigoIe}
            placeholder="16647"
            mono
          />
        )}
        <p className="text-[10px] text-ink-3">
          Vincula este proyecto-colegio a una inversión existente. Crea la inversión primero desde
          el módulo Inversiones si aún no existe. No destructivo: solo agrega el vínculo.
        </p>
      </div>
    </Section>
  );
}

function FileDrop({ accept, onPick, Icon, iconCls, title, hint, loading, loadingTxt, done, doneTxt }: {
  accept: string;
  onPick: (f: File | undefined) => void;
  Icon: typeof FileText;
  iconCls: string;
  title: string;
  hint: string;
  loading: boolean;
  loadingTxt: string;
  done: boolean;
  doneTxt: string;
}) {
  return (
    <label className="block">
      <input type="file" accept={accept} className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
      <div className={cn('flex items-center gap-3 rounded-md border-2 border-dashed p-4 cursor-pointer transition-colors', done ? 'border-ok bg-ok-soft/20' : 'border-line hover:border-primary hover:bg-primary-soft/20')}>
        <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-md', iconCls)}>
          {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : done ? <Check className="h-6 w-6 text-ok" /> : <Icon className="h-6 w-6" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold">{title} <span className="text-destructive">*</span></p>
          <p className="text-[11px] text-ink-3 mt-0.5 truncate">{loading ? loadingTxt : done ? doneTxt : hint}</p>
        </div>
      </div>
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
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
