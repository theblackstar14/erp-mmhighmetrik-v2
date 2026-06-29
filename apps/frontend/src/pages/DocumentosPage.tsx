import { Building2, FolderOpen, HardDrive, Truck } from 'lucide-react';
import { useState } from 'react';
import { NasExplorer } from '@/components/documentos/NasExplorer.js';
import { api } from '@/lib/api.js';

type Root = { name: string; path: string };

// Raíces curadas del NAS (allowlist debe coincidir con el backend).
const PINNED: Root = { name: 'Drive', path: '/Drive' };
const ROOTS: { root: Root; Icon: typeof FolderOpen; hint: string }[] = [
  { root: { name: 'Proyectos', path: '/Proyectos' }, Icon: FolderOpen, hint: 'Obras · expedientes · valorizaciones' },
  { root: { name: 'Administración', path: '/Administración' }, Icon: Building2, hint: 'Documentos corporativos' },
  { root: { name: 'Logística', path: '/Logistica' }, Icon: Truck, hint: 'Órdenes · proveedores' },
];

export default function DocumentosPage() {
  const [root, setRoot] = useState<Root | null>(null);

  if (root) {
    return (
      <div className="p-4 sm:p-6 max-w-[1400px] mx-auto w-full">
        <NasExplorer
          rootName={root.name}
          rootPath={root.path}
          queryKey="nas-global"
          listPath={(p) => api.nas.list(p).then((r) => r.files)}
          downloadHref={(p) => api.nas.downloadUrl(p)}
          uploadFile={(dest, file) => api.nas.upload(dest, file)}
          onExit={() => setRoot(null)}
        />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto w-full space-y-5">
      <div>
        <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Documentos</h1>
        <p className="text-[13px] text-ink-3 mt-0.5">Repositorio NAS · archivos de la empresa</p>
      </div>

      {/* Anclado · Drive (Google Drive del gerente) */}
      <button
        onClick={() => setRoot(PINNED)}
        className="flex w-full items-center gap-3 rounded-lg border border-primary/30 bg-primary/[0.04] p-4 text-left hover:border-primary/60 transition-colors"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary"><HardDrive className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold">Drive</span>
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-primary">Anclado</span>
          </div>
          <div className="text-[12px] text-ink-3">Google Drive del gerente · sincronizado al NAS</div>
        </div>
      </button>

      <div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-ink-4 mb-2">Carpetas</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ROOTS.map(({ root: r, Icon, hint }) => (
            <button key={r.path} onClick={() => setRoot(r)} className="flex items-center gap-3 rounded-lg border border-line bg-bg-elev p-4 text-left hover:border-primary/50 hover:shadow-sm transition-all">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-bg-sunken text-ink-2"><Icon className="h-5 w-5" /></div>
              <div className="min-w-0">
                <div className="text-[14px] font-semibold">{r.name}</div>
                <div className="text-[12px] text-ink-3 truncate">{hint}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
