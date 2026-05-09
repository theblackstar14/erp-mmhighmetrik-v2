import { useQueryClient } from '@tanstack/react-query';
import { Bell, FileUp, Menu, Moon, PanelLeft, Search, Sparkles, Sun } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useCopilotoStore } from '@/components/copiloto/copiloto-store.js';
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
      <button
        type="button"
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-bg-sunken hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
          3
        </span>
      </button>

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
