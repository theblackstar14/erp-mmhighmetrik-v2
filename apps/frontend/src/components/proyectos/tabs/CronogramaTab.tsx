import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronUp, FileText, Loader2, RefreshCw, Upload } from 'lucide-react';
import { useState } from 'react';
import { GanttViewer } from '@/components/proyectos/gantt/GanttViewer.js';
import { api } from '@/lib/api.js';
import { fmtPEN, partidaPresupuesto } from '@/lib/utils.js';

export function CronogramaTab({ proyectoId }: { proyectoId: string }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [uploadExpanded, setUploadExpanded] = useState(false);

  const partidasQ = useQuery({
    queryKey: ['partidas', proyectoId],
    queryFn: () => api.proyectos.listPartidas(proyectoId),
  });

  const uploadMut = useMutation({
    mutationFn: (file: File) => api.proyectos.uploadCronograma(proyectoId, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partidas', proyectoId] });
      qc.invalidateQueries({ queryKey: ['proyecto', proyectoId] });
      setError('');
      setUploadExpanded(false); // collapse después de éxito
    },
    onError: (e: Error) => setError(e.message),
  });

  const onFile = (f: File | undefined) => {
    if (!f) return;
    const name = f.name.toLowerCase();
    if (!name.endsWith('.xml') && !name.endsWith('.mpp')) {
      setError('Solo archivos .xml o .mpp');
      return;
    }
    setError('');
    uploadMut.mutate(f);
  };

  const partidas = partidasQ.data?.partidas ?? [];
  const yaTieneCronograma = partidas.length > 0;

  // Upload card · si ya tiene cronograma · arranca colapsada
  const showUploadZone = !yaTieneCronograma || uploadExpanded || uploadMut.isPending;

  return (
    <div className="space-y-5">
      {/* Upload card */}
      <div className="rounded-md border border-line bg-bg-elev">
        <div className="border-b border-line px-4 py-3 flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <h3 className="text-[13px] font-semibold">Cronograma MS Project</h3>
            {yaTieneCronograma && !uploadExpanded ? (
              <p className="text-[11px] text-ink-3 mt-0.5">
                <CheckCircle2 className="inline h-3 w-3 text-ok mr-1 -mt-0.5" />
                Cronograma cargado · {partidas.length} partidas
              </p>
            ) : (
              <p className="text-[11px] text-ink-3 mt-0.5">
                Sube directamente <strong>.mpp</strong> (binario MS Project) o <strong>.xml</strong>{' '}
                (Aspose Tasks)
              </p>
            )}
          </div>
          {yaTieneCronograma && !uploadMut.isPending && (
            <button
              type="button"
              onClick={() => setUploadExpanded(!uploadExpanded)}
              className="flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-line text-[11px] text-ink-2 hover:bg-bg-sunken"
              title={uploadExpanded ? 'Colapsar' : 'Reemplazar cronograma'}
            >
              {uploadExpanded ? (
                <>
                  <ChevronUp className="h-3 w-3" /> Colapsar
                </>
              ) : (
                <>
                  <RefreshCw className="h-3 w-3" /> Reemplazar
                </>
              )}
            </button>
          )}
        </div>

        {showUploadZone && (
          <div className="p-4">
            {uploadMut.isPending ? (
              <div className="flex flex-col items-center py-6">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
                <p className="text-[12px] font-medium">Procesando archivo...</p>
                <p className="text-[10px] text-ink-3 mt-1">
                  Si es .mpp · convirtiendo con MPXJ (3-10s) · luego parseando tareas
                </p>
              </div>
            ) : (
              <>
                {yaTieneCronograma && (
                  <div className="mb-3 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[11.5px] text-warn-ink">
                    ⚠ Reemplazar cronograma sobreescribe las {partidas.length} partidas actuales. Los avances vinculados pueden perder asociación.
                  </div>
                )}
                <label className="block">
                  <input
                    type="file"
                    accept=".xml,.mpp"
                    className="hidden"
                    onChange={(e) => onFile(e.target.files?.[0])}
                    disabled={uploadMut.isPending}
                  />
                  <div className="flex flex-col items-center justify-center rounded-md border-2 border-dashed border-line p-6 text-center cursor-pointer hover:border-primary hover:bg-primary-soft/30 transition-colors">
                    <Upload className="h-7 w-7 text-ink-3 mb-2" />
                    <p className="text-[12.5px] font-medium">
                      {yaTieneCronograma ? 'Click para subir nuevo cronograma' : 'Click para subir .mpp o .xml'}
                    </p>
                    <p className="text-[10.5px] text-ink-3 mt-1">
                      Máx 50MB · MS Project nativo (.mpp) o Aspose XML
                    </p>
                  </div>
                </label>
              </>
            )}

            {error && (
              <div className="mt-3 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-[12px] text-destructive">
                {error}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stats si ya tiene cronograma */}
      {yaTieneCronograma && (
        <div className="rounded-md border border-line bg-bg-elev">
          <div className="border-b border-line px-4 py-3 flex items-center justify-between">
            <div>
              <h3 className="text-[13px] font-semibold">Resumen del cronograma</h3>
              <p className="text-[11px] text-ink-3 mt-0.5">{partidas.length} partidas extraídas</p>
            </div>
            <FileText className="h-4 w-4 text-ink-3" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4">
            <Stat lbl="Total partidas" val={String(partidas.length)} />
            <Stat
              lbl="Capítulos (nivel 1)"
              val={String(partidas.filter((p) => p.nivel === 1).length)}
            />
            <Stat
              lbl="Hojas (sin hijos)"
              val={String(
                partidas.filter((p) => !partidas.some((c) => c.parentCodigo === p.codigo)).length,
              )}
            />
            <Stat
              lbl="Costo Contractual"
              val={fmtPEN(
                partidas
                  .filter((p) => p.nivel === 1)
                  .reduce((s, p) => s + partidaPresupuesto(p), 0),
              )}
              sub="Suma capítulos nivel 1"
            />
          </div>

        </div>
      )}

      {/* Visor Gantt SVG */}
      {yaTieneCronograma && <GanttViewer partidas={partidas} height={600} />}
    </div>
  );
}

function Stat({ lbl, val, sub }: { lbl: string; val: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[9px] uppercase tracking-wider text-ink-4 truncate">{lbl}</div>
      <div className="mt-1 text-[15px] font-bold tracking-[-0.02em] truncate">{val}</div>
      {sub && <div className="text-[10px] text-ink-3 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}
