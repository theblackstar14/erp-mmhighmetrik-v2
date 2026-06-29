import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Download, File, FileSpreadsheet, FileText, Folder, FolderPlus, Image, LayoutGrid, List, RefreshCw, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import type { NasFile } from '@/lib/api.js';
import { cn } from '@/lib/utils.js';

// Explorador de archivos NAS · look v1 (migas, grilla/lista, NAS LIVE).
// Genérico: recibe adaptadores para listar/subir/descargar → sirve global y por proyecto.
export type NasExplorerProps = {
  rootName: string;
  rootPath: string;
  listPath: (path: string) => Promise<NasFile[]>;
  downloadHref: (path: string) => string;
  uploadFile?: (dest: string, file: File) => Promise<unknown>;
  createFolder?: (parentPath: string, name: string) => Promise<unknown>;
  initStructure?: () => Promise<unknown>; // botón "crear estructura" en estado vacío (solo en raíz)
  onExit?: () => void;
  queryKey: string; // namespace para react-query
};

const ext = (name: string) => name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
const fmtSize = (s: number) => (!s ? '—' : s > 1e6 ? `${(s / 1e6).toFixed(1)} MB` : s > 1e3 ? `${(s / 1e3).toFixed(0)} KB` : `${s} B`);
const fmtDate = (m: number | null) => (m ? new Date(m).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');

const EXT_META: Record<string, { color: string; Icon: typeof File }> = {
  pdf: { color: 'text-rose-500', Icon: FileText },
  xlsx: { color: 'text-emerald-600', Icon: FileSpreadsheet },
  xls: { color: 'text-emerald-600', Icon: FileSpreadsheet },
  csv: { color: 'text-emerald-600', Icon: FileSpreadsheet },
  doc: { color: 'text-blue-600', Icon: FileText },
  docx: { color: 'text-blue-600', Icon: FileText },
  png: { color: 'text-violet-500', Icon: Image },
  jpg: { color: 'text-violet-500', Icon: Image },
  jpeg: { color: 'text-violet-500', Icon: Image },
  mpp: { color: 'text-amber-600', Icon: FileText },
};
const metaOf = (f: NasFile) => (f.isDir ? { color: 'text-amber-500', Icon: Folder } : (EXT_META[ext(f.name)] ?? { color: 'text-ink-3', Icon: File }));

export function NasExplorer({ rootName, rootPath, listPath, downloadHref, uploadFile, createFolder, initStructure, onExit, queryKey }: NasExplorerProps) {
  const [path, setPath] = useState(rootPath);
  const [grid, setGrid] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const q = useQuery({ queryKey: [queryKey, path], queryFn: () => listPath(path) });
  const files = q.data ?? [];
  const folders = files.filter((f) => f.isDir);
  const docs = files.filter((f) => !f.isDir);

  // Migas relativas a rootPath
  const rel = path.startsWith(rootPath) ? path.slice(rootPath.length).replace(/^\/+/, '') : '';
  const parts = rel ? rel.split('/').filter(Boolean) : [];
  const crumbs = [{ label: rootName, path: rootPath }, ...parts.map((p, i) => ({ label: p, path: `${rootPath}/${parts.slice(0, i + 1).join('/')}` }))];

  const open = (f: NasFile) => {
    if (f.isDir) setPath(f.path.replace(/\/+$/, ''));
    else window.open(downloadHref(f.path), '_blank');
  };

  const doUpload = async (file: File | undefined) => {
    if (!file || !uploadFile) return;
    setUploading(true);
    try {
      await uploadFile(path, file);
      q.refetch();
    } catch (e) {
      alert(`No se pudo subir: ${(e as Error).message}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const doCreateFolder = async () => {
    if (!createFolder) return;
    const name = window.prompt('Nombre de la carpeta:');
    if (!name?.trim()) return;
    try { await createFolder(path, name.trim()); q.refetch(); }
    catch (e) { alert(`No se pudo crear: ${(e as Error).message}`); }
  };

  const doInit = async () => {
    if (!initStructure) return;
    try { await initStructure(); q.refetch(); }
    catch (e) { alert(`No se pudo inicializar: ${(e as Error).message}`); }
  };

  return (
    <div className="flex flex-col rounded-md border border-line bg-bg-elev overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        {onExit && (
          <button onClick={onExit} className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-bg-sunken" title="Volver"><ArrowLeft className="h-4 w-4" /></button>
        )}
        <div className="flex flex-1 flex-wrap items-center gap-1 text-[12px] min-w-0">
          {crumbs.map((c, i) => (
            <span key={c.path} className="inline-flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-ink-4" />}
              <button onClick={() => setPath(c.path)} className={cn('rounded px-1 py-0.5 hover:bg-bg-sunken', i === crumbs.length - 1 ? 'font-semibold text-foreground' : 'text-primary')}>{c.label}</button>
            </span>
          ))}
        </div>
        <span className="inline-flex items-center gap-1.5 rounded bg-emerald-50 dark:bg-emerald-950/30 px-2 py-1 font-mono text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> NAS · LIVE
        </span>
        <button onClick={() => q.refetch()} className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-bg-sunken" title="Refrescar"><RefreshCw className={cn('h-3.5 w-3.5', q.isFetching && 'animate-spin')} /></button>
        <div className="flex rounded-md border border-line">
          <button onClick={() => setGrid(true)} className={cn('flex h-7 w-7 items-center justify-center rounded-l-md', grid ? 'bg-primary text-primary-foreground' : 'text-ink-3 hover:bg-bg-sunken')}><LayoutGrid className="h-3.5 w-3.5" /></button>
          <button onClick={() => setGrid(false)} className={cn('flex h-7 w-7 items-center justify-center rounded-r-md', !grid ? 'bg-primary text-primary-foreground' : 'text-ink-3 hover:bg-bg-sunken')}><List className="h-3.5 w-3.5" /></button>
        </div>
        {createFolder && (
          <button onClick={doCreateFolder} className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-line text-[11.5px] text-ink-2 hover:bg-bg-sunken"><FolderPlus className="h-3.5 w-3.5" /> Carpeta</button>
        )}
        {uploadFile && (
          <>
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => doUpload(e.target.files?.[0])} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium hover:opacity-90 disabled:opacity-50">
              <Upload className="h-3.5 w-3.5" /> {uploading ? 'Subiendo…' : 'Subir'}
            </button>
          </>
        )}
      </div>

      {/* Contenido */}
      <div className="min-h-[300px] p-3 bg-bg-sunken/20">
        {q.isLoading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-ink-3">
            <RefreshCw className="h-6 w-6 animate-spin text-primary" /><span className="font-mono text-[12px]">Conectando al NAS…</span>
          </div>
        ) : q.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-[12px] text-destructive">
            <div className="font-semibold">Error al conectar con el NAS</div>
            <div className="font-mono text-[11px] mt-1">{(q.error as Error).message}</div>
            <div className="mt-2 text-[11px] text-ink-3">Verifica que el NAS esté encendido, el WebDAV activo y el túnel arriba.</div>
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-ink-4">
            <Folder className="h-8 w-8" /><span className="text-[12px] text-ink-3">Carpeta vacía</span>
            {initStructure && path === rootPath && (
              <button onClick={doInit} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-[11.5px] font-medium hover:opacity-90"><FolderPlus className="h-3.5 w-3.5" /> Crear estructura (14 carpetas)</button>
            )}
          </div>
        ) : grid ? (
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
            {[...folders, ...docs].map((f) => {
              const { color, Icon } = metaOf(f);
              return (
                <button key={f.path} onClick={() => open(f)} className="group flex flex-col rounded-md border border-line bg-bg-elev p-2.5 text-left hover:border-primary/50 hover:shadow-sm transition-all">
                  <div className="mb-2 flex h-16 items-center justify-center rounded bg-bg-sunken/60 relative">
                    <Icon className={cn('h-7 w-7', color)} />
                    {!f.isDir && ext(f.name) && <span className={cn('absolute top-1 right-1 font-mono text-[8px] font-bold uppercase', color)}>{ext(f.name)}</span>}
                    {!f.isDir && <Download className="absolute bottom-1 right-1 h-3 w-3 text-ink-4 opacity-0 group-hover:opacity-100" />}
                  </div>
                  <div className="text-[11.5px] font-medium leading-tight line-clamp-2 mb-1">{f.name}</div>
                  <div className="flex justify-between font-mono text-[9px] text-ink-4"><span>{f.isDir ? 'carpeta' : fmtSize(f.size)}</span><span>{fmtDate(f.mtime)}</span></div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-line bg-bg-elev">
            <table className="w-full">
              <thead><tr className="border-b border-line bg-bg-sunken">
                {['Nombre', 'Tipo', 'Tamaño', 'Modificado', ''].map((h, i) => <th key={i} className={cn('px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-4', i >= 2 && i <= 3 ? 'text-right' : 'text-left')}>{h}</th>)}
              </tr></thead>
              <tbody>
                {[...folders, ...docs].map((f) => {
                  const { color, Icon } = metaOf(f);
                  return (
                    <tr key={f.path} onClick={() => open(f)} className="border-b border-line/60 cursor-pointer hover:bg-bg-sunken/50">
                      <td className="px-3 py-1.5"><div className="flex items-center gap-2"><Icon className={cn('h-4 w-4 shrink-0', color)} /><span className={cn('text-[12px]', f.isDir && 'font-medium')}>{f.name}</span></div></td>
                      <td className={cn('px-3 py-1.5 font-mono text-[10px] uppercase', color)}>{f.isDir ? 'DIR' : ext(f.name) || 'file'}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-[11px] tabular-nums text-ink-3">{f.isDir ? '—' : fmtSize(f.size)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-[11px] text-ink-4">{fmtDate(f.mtime)}</td>
                      <td className="px-3 py-1.5 text-ink-4">{f.isDir ? <ChevronRight className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
