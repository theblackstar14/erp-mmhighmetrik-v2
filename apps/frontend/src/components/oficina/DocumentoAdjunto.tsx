import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, Upload } from 'lucide-react';
import { useRef } from 'react';
import { api } from '@/lib/api.js';
import { cn } from '@/lib/utils.js';

export function DocumentoAdjunto({
  entidadTipo,
  entidadId,
  docTipo = 'comprobante_pago',
  label,
}: {
  entidadTipo: string;
  entidadId: string;
  docTipo?: string;
  label?: string;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['docs-detalle', entidadId],
    queryFn: () => api.oficina.docsDetalleOficina(entidadId),
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('entidadTipo', entidadTipo);
      form.append('entidadId', entidadId);
      form.append('docTipo', docTipo);
      form.append('file', file);
      return api.oficina.subirDocumentoOficina(form);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['docs-detalle', entidadId] });
    },
  });

  const hasComprobante = data?.comprobante ?? false;
  const chipLabel = label ?? 'comprobante';

  return (
    <div className="inline-flex items-center gap-1.5">
      {isLoading ? (
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] bg-bg-sunken text-ink-4">
          <Loader2 className="w-3 h-3 animate-spin" />
          cargando…
        </span>
      ) : (
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
            hasComprobante
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
          )}
        >
          {hasComprobante ? (
            <CheckCircle2 className="w-3 h-3" />
          ) : (
            <AlertTriangle className="w-3 h-3" />
          )}
          {hasComprobante ? chipLabel : `falta ${chipLabel}`}
        </span>
      )}

      <button
        onClick={() => fileRef.current?.click()}
        disabled={upload.isPending}
        className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-line bg-bg-elev text-[11px] text-ink-3 hover:text-foreground hover:bg-bg-sunken transition-colors disabled:opacity-50"
        title="Subir documento"
      >
        {upload.isPending ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin" />
            subiendo…
          </>
        ) : (
          <>
            <Upload className="w-3 h-3" />
            subir
          </>
        )}
      </button>

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
