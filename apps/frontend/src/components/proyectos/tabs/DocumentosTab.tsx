import { useQuery } from '@tanstack/react-query';
import { NasExplorer } from '@/components/documentos/NasExplorer.js';
import { api } from '@/lib/api.js';

export function DocumentosTab({ proyectoId }: { proyectoId: string }) {
  // Resuelve la carpeta base del proyecto en el NAS (una llamada para el rootPath).
  const baseQ = useQuery({ queryKey: ['documentos-base', proyectoId], queryFn: () => api.documentos.list(proyectoId), retry: false });

  if (baseQ.isLoading) return <div className="py-12 text-center text-[12px] text-ink-3">Conectando al NAS…</div>;
  if (baseQ.isError) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-6">
        <div className="text-[13px] font-semibold text-destructive">No se pudo conectar al NAS</div>
        <p className="text-[12px] text-ink-3 mt-1.5">{(baseQ.error as Error).message}</p>
        <p className="text-[11px] text-ink-4 mt-2">Verifica NAS_URL/USER/PASS y que el Synology/túnel esté accesible.</p>
      </div>
    );
  }

  const base = baseQ.data?.base ?? '';
  return (
    <NasExplorer
      rootName="Proyecto"
      rootPath={base}
      queryKey={`documentos-${proyectoId}`}
      listPath={(p) => api.documentos.list(proyectoId, p).then((r) => r.files)}
      downloadHref={(p) => api.documentos.downloadUrl(proyectoId, p)}
      uploadFile={(dest, file) => api.documentos.upload(proyectoId, dest, file)}
      createFolder={(parent, name) => api.documentos.createFolder(proyectoId, parent, name)}
      initStructure={() => api.documentos.init(proyectoId)}
    />
  );
}
