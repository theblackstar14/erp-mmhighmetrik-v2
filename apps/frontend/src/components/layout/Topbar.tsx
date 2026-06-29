import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, FileUp, Menu, Moon, PanelLeft, Search, Sparkles, Sun, X } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCopilotoStore } from '@/components/copiloto/copiloto-store.js';
import { api } from '@/lib/api.js';
import { useThemeStore } from '@/lib/theme-store.js';
import { cn } from '@/lib/utils.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ROUTE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  proyectos: 'Proyectos',
  licitaciones: 'Licitaciones',
  seace: 'SEACE',
  finanzas: 'Finanzas',
  contabilidad: 'Contabilidad',
  compras: 'Compras',
  inventario: 'Inventario',
  personal: 'Personal',
  documentos: 'Documentos',
  config: 'Configuración',
  empresa: 'Empresa',
  usuarios: 'Usuarios',
};

type Props = {
  onToggleSidebar: () => void;
  isMobile?: boolean;
};

export function Topbar({ onToggleSidebar, isMobile }: Props) {
  const location = useLocation();
  const { theme, toggle: toggleTheme } = useThemeStore();
  const { open: openCopiloto } = useCopilotoStore();
  const qc = useQueryClient();

  const segments = location.pathname.split('/').filter(Boolean);
  const labelOf = (s: string): string => {
    if (UUID_RE.test(s)) {
      // Buscar proyecto en cache de React Query
      const cached = qc.getQueryData<{ proyecto: { codigo: string; nombre: string } }>([
        'proyecto',
        s,
      ]);
      return cached?.proyecto?.codigo ?? s.slice(0, 8) + '…';
    }
    return ROUTE_LABELS[s] ?? s;
  };
  const breadcrumbs = ['Principal', ...segments.map(labelOf)];

  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-bg-elev px-4">
      {/* Toggle sidebar */}
      <button
        type="button"
        onClick={onToggleSidebar}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-bg-sunken hover:text-foreground"
      >
        {isMobile ? <Menu className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
      </button>

      {/* Breadcrumbs */}
      <nav className="hidden md:flex items-center gap-1.5 text-[13px] min-w-0">
        {breadcrumbs.map((crumb, i) => (
          <div key={`${crumb}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-ink-4">/</span>}
            <span
              className={cn(
                'truncate',
                i === breadcrumbs.length - 1
                  ? 'font-semibold text-foreground'
                  : 'text-ink-3',
              )}
            >
              {crumb}
            </span>
          </div>
        ))}
      </nav>

      {/* Search · decorativo */}
      <div className="relative ml-auto hidden md:block w-full max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-4" />
        <input
          type="text"
          placeholder="Buscar proyectos, partidas, OC, facturas..."
          className="h-9 w-full rounded-md border border-line bg-bg-sunken pl-9 pr-12 text-[13px] outline-none placeholder:text-ink-4 focus:bg-bg-elev focus:border-primary focus:ring-1 focus:ring-primary"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line bg-bg-elev px-1.5 py-0.5 font-mono text-[10px] text-ink-4">
          ⌘K
        </kbd>
      </div>

      {/* Importar Excel · stub */}
      <button
        type="button"
        onClick={() => alert('Importar Excel · próximamente')}
        className="hidden lg:flex items-center gap-1.5 h-9 px-3 rounded-md border border-line bg-bg-elev text-[12px] font-medium text-ink-2 hover:bg-bg-sunken transition-colors"
      >
        <FileUp className="h-3.5 w-3.5" />
        Importar Excel
      </button>

      {/* Dark mode toggle */}
      <button
        type="button"
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-bg-sunken hover:text-foreground"
      >
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      {/* Notifications */}
      <Notificaciones />

      {/* Copiloto IA */}
      <button
        type="button"
        onClick={openCopiloto}
        className="flex items-center gap-1.5 h-9 px-3 rounded-md text-[12px] font-medium text-white transition-all hover:opacity-90"
        style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), #6B84E8)' }}
      >
        <Sparkles className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Copiloto IA</span>
      </button>
    </div>
  );
}

const SEV_DOT: Record<string, string> = { alta: 'bg-destructive', media: 'bg-amber-500', baja: 'bg-ink-4' };
const hace = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `hace ${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)}h`;
  return `hace ${Math.floor(s / 86400)}d`;
};

// Campana global · vive en el Topbar persistente → sigue al usuario por todas las páginas.
function Notificaciones() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['notificaciones'], queryFn: () => api.notificaciones.list(), refetchInterval: 60_000 });
  const items = data?.items ?? [];
  const noLeidas = data?.noLeidas ?? 0;
  const inval = () => qc.invalidateQueries({ queryKey: ['notificaciones'] });
  const leer = useMutation({ mutationFn: (id: string) => api.notificaciones.leer(id), onSuccess: inval });
  const leerTodo = useMutation({ mutationFn: () => api.notificaciones.leerTodo(), onSuccess: inval });

  const abrir = (id: string, url: string | null) => {
    leer.mutate(id);
    setOpen(false);
    if (url) navigate(url);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-bg-sunken hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {noLeidas > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
            {noLeidas > 9 ? '9+' : noLeidas}
          </span>
        )}
      </button>
      {open && createPortal(
        <>
          <button type="button" className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-label="Cerrar" />
          <div className="fixed right-3 top-14 z-50 w-[380px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-line bg-bg-elev shadow-2xl animate-pageEnter">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <div className="text-[13px] font-semibold inline-flex items-center">Notificaciones {noLeidas > 0 && <span className="ml-1.5 rounded bg-destructive px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{noLeidas}</span>}</div>
              <div className="flex items-center gap-2">
                {noLeidas > 0 && <button onClick={() => leerTodo.mutate()} className="text-[11px] text-primary hover:underline">Marcar todo leído</button>}
                <button onClick={() => setOpen(false)} className="h-6 w-6 rounded-md border border-line inline-flex items-center justify-center text-ink-3 hover:bg-bg-sunken"><X className="h-3 w-3" /></button>
              </div>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {items.length === 0 ? (
                <div className="py-10 text-center text-[12px] text-ink-3">Sin notificaciones</div>
              ) : items.map((n) => (
                <button key={n.id} onClick={() => abrir(n.id, n.accionUrl)}
                  className={cn('block w-full text-left px-4 py-2.5 border-b border-line/60 hover:bg-bg-sunken/50', !n.leidoEn && 'bg-primary/[0.04]')}>
                  <div className="flex items-start gap-2">
                    <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', SEV_DOT[n.severidad] ?? 'bg-ink-4')} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-semibold leading-tight truncate">{n.titulo}</span>
                        <span className="text-[10px] text-ink-4 shrink-0">{hace(n.createdAt)}</span>
                      </div>
                      {n.detalle && <div className="text-[11px] text-ink-3 mt-0.5 leading-snug">{n.detalle}</div>}
                      {n.proyectoCodigo && <span className="mt-1 inline-block rounded bg-bg-sunken px-1.5 py-0.5 font-mono text-[9.5px] text-ink-3">{n.proyectoCodigo}</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {items.length > 0 && (
              <button onClick={() => setOpen(false)} className="block w-full border-t border-line px-4 py-2.5 text-center text-[12px] text-primary hover:bg-bg-sunken/40">
                Ver historial completo
              </button>
            )}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
