import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, Loader2, Sparkles, Upload, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ParsedContract, api } from '@/lib/api.js';
import { cn } from '@/lib/utils.js';

type Step = 'upload' | 'review' | 'creating';

type Props = { onClose: () => void };

export function CrearProyectoWizard({ onClose }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedContract | null>(null);
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState('');

  const parseMut = useMutation({
    mutationFn: (f: File) => api.ia.parseContract(f),
    onSuccess: async (r) => {
      setParsed(r.data);
      setNombre(r.data.proyecto?.nombre ?? '');
      // Auto-genera siguiente código PG#### consultando lista actual
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
      setStep('review');
    },
    onError: (e: Error) => {
      setError(e.message);
      setStep('upload');
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

  const handleFile = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.includes('pdf')) {
      setError('Solo PDFs');
      return;
    }
    setFile(f);
    setError('');
    parseMut.mutate(f);
  };

  const skipIA = async () => {
    setParsed({});
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
    setStep('review');
  };

  const submitCreate = () => {
    if (!codigo || !nombre) {
      setError('Código y nombre son obligatorios');
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-md border border-line bg-bg-elev shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold">Nuevo proyecto</h2>
            <p className="text-[11px] text-ink-3 mt-0.5">
              {step === 'upload' && 'Sube el contrato PDF · IA extrae los datos'}
              {step === 'review' && 'Revisa los datos extraídos · puedes corregir'}
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

        {/* Stepper */}
        <div className="flex items-center gap-2 border-b border-line px-5 py-3 text-[11px]">
          <Step n={1} active={step === 'upload'} done={step !== 'upload'} label="Subir contrato" />
          <div className="flex-1 h-px bg-line" />
          <Step n={2} active={step === 'review'} done={step === 'creating'} label="Revisar datos" />
          <div className="flex-1 h-px bg-line" />
          <Step n={3} active={step === 'creating'} done={false} label="Crear" />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {step === 'upload' && (
            <div className="space-y-4">
              {parseMut.isPending ? (
                <div className="flex flex-col items-center py-12">
                  <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
                  <p className="text-[13px] font-medium">Analizando contrato con Gemini IA</p>
                  <p className="text-[11px] text-ink-3 mt-1">~10-20 segundos</p>
                </div>
              ) : (
                <>
                  <label className="block">
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={(e) => handleFile(e.target.files?.[0])}
                    />
                    <div className="flex flex-col items-center justify-center rounded-md border-2 border-dashed border-line p-12 text-center cursor-pointer hover:border-primary hover:bg-primary-soft/30 transition-colors">
                      <Upload className="h-10 w-10 text-ink-3 mb-3" />
                      <p className="text-[13px] font-medium">Click para subir contrato PDF</p>
                      <p className="text-[11px] text-ink-3 mt-1">Máx 25MB · IA extrae datos automático</p>
                    </div>
                  </label>

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={skipIA}
                      className="text-[12px] text-ink-3 hover:text-foreground underline"
                    >
                      Saltar IA · ingresar datos manualmente
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

          {step === 'review' && parsed && (
            <ReviewStep
              codigo={codigo}
              nombre={nombre}
              setCodigo={setCodigo}
              setNombre={setNombre}
              parsed={parsed}
              setParsed={setParsed}
            />
          )}

          {step === 'creating' && (
            <div className="flex flex-col items-center py-12">
              <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
              <p className="text-[13px] font-medium">Creando proyecto...</p>
            </div>
          )}
        </div>

        {/* Footer · acciones */}
        {step === 'review' && (
          <div className="flex justify-between gap-2 border-t border-line px-5 py-3">
            <button
              type="button"
              onClick={() => {
                setStep('upload');
                setParsed(null);
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
                onClick={submitCreate}
                disabled={!codigo || !nombre}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" /> Crear proyecto
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Step({ n, active, done, label }: { n: number; active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold',
          active && 'bg-primary text-primary-foreground',
          done && 'bg-ok text-white',
          !active && !done && 'bg-bg-sunken text-ink-3',
        )}
      >
        {done ? <Check className="h-3 w-3" /> : n}
      </div>
      <span className={cn('font-medium', active ? 'text-foreground' : 'text-ink-3')}>{label}</span>
    </div>
  );
}

function ReviewStep({
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
      {/* IA badge */}
      {Object.keys(parsed).length > 0 && (
        <div className="flex items-center gap-2 rounded-md bg-primary-soft px-3 py-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] text-primary-ink font-medium">
            Datos extraídos por Gemini IA · revisá y corrigí si es necesario
          </span>
        </div>
      )}

      {/* Identificación */}
      <Section title="Identificación">
        <Field
          label="Código proyecto *"
          value={codigo}
          onChange={setCodigo}
          placeholder="PG0001"
          mono
        />
        <Field label="Nombre obra *" value={nombre} onChange={setNombre} multiline />
        <Field
          label="N° contrato"
          value={parsed.contrato?.numeroContrato ?? ''}
          onChange={(v) =>
            setParsed({ ...parsed, contrato: { ...parsed.contrato, numeroContrato: v } })
          }
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

      {/* Entidad contratante */}
      <Section title="Entidad contratante">
        <div className="grid grid-cols-[2fr_1fr] gap-3">
          <Field
            label="Razón social"
            value={parsed.entidadContratante?.razonSocial ?? ''}
            onChange={(v) =>
              setParsed({
                ...parsed,
                entidadContratante: { ...parsed.entidadContratante, razonSocial: v },
              })
            }
          />
          <Field
            label="RUC"
            value={parsed.entidadContratante?.ruc ?? ''}
            onChange={(v) =>
              setParsed({ ...parsed, entidadContratante: { ...parsed.entidadContratante, ruc: v } })
            }
            mono
          />
        </div>
      </Section>

      {/* Económico */}
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
              setParsed({
                ...parsed,
                contrato: { ...parsed.contrato, diasPlazo: Number.parseInt(v) || 0 },
              })
            }
            placeholder="120"
            mono
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field
            label="Adelanto directo %"
            value={String((parsed.adelantos?.directoPct ?? 0) * 100)}
            onChange={(v) =>
              setParsed({
                ...parsed,
                adelantos: { ...parsed.adelantos, directoPct: Number.parseFloat(v) / 100 },
              })
            }
            placeholder="10"
            mono
          />
          <Field
            label="Adelanto materiales %"
            value={String((parsed.adelantos?.materialesPct ?? 0) * 100)}
            onChange={(v) =>
              setParsed({
                ...parsed,
                adelantos: { ...parsed.adelantos, materialesPct: Number.parseFloat(v) / 100 },
              })
            }
            placeholder="20"
            mono
          />
          <Field
            label="Adelanto avance %"
            value={String((parsed.adelantos?.avancePct ?? 0) * 100)}
            onChange={(v) =>
              setParsed({
                ...parsed,
                adelantos: { ...parsed.adelantos, avancePct: Number.parseFloat(v) / 100 },
              })
            }
            placeholder="10"
            mono
          />
        </div>
      </Section>

      {/* Fechas */}
      <Section title="Fechas clave">
        <div className="grid grid-cols-3 gap-3">
          <Field
            label="Buena Pro"
            type="date"
            value={parsed.contrato?.fechaBuenaPro ?? ''}
            onChange={(v) =>
              setParsed({ ...parsed, contrato: { ...parsed.contrato, fechaBuenaPro: v } })
            }
          />
          <Field
            label="Firma contrato"
            type="date"
            value={parsed.contrato?.fechaFirmaContrato ?? ''}
            onChange={(v) =>
              setParsed({ ...parsed, contrato: { ...parsed.contrato, fechaFirmaContrato: v } })
            }
          />
          <Field
            label="Inicio obra"
            type="date"
            value={parsed.contrato?.fechaInicio ?? ''}
            onChange={(v) =>
              setParsed({ ...parsed, contrato: { ...parsed.contrato, fechaInicio: v } })
            }
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
