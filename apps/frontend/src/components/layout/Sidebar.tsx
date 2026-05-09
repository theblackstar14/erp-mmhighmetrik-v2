import {
  Briefcase,
  Building2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Globe,
  HardHat,
  LayoutDashboard,
  Package,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { AvatarMenu } from './AvatarMenu.js';
import { cn } from '@/lib/utils.js';

const NAV_GROUPS = [
  {
    label: 'Operación',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/licitaciones', icon: Briefcase, label: 'Licitaciones', badge: '9' },
      { to: '/seace', icon: Globe, label: 'SEACE', badge: '3' },
      { to: '/proyectos', icon: Building2, label: 'Proyectos', badge: '4' },
    ],
  },
  {
    label: 'Administración',
    items: [
      { to: '/finanzas', icon: TrendingUp, label: 'Finanzas' },
      { to: '/contabilidad', icon: Wallet, label: 'Contabilidad' },
      { to: '/compras', icon: ShoppingCart, label: 'Compras' },
      { to: '/inventario', icon: Package, label: 'Inventario' },
      { to: '/personal', icon: HardHat, label: 'Personal' },
    ],
  },
  {
    label: 'Archivo',
    items: [{ to: '/documentos', icon: FileText, label: 'Documentos' }],
  },
];

type Props = {
  collapsed: boolean;
  onToggle: () => void;
  onClose?: () => void;
  isMobile?: boolean;
};

export function Sidebar({ collapsed, onToggle, onClose, isMobile }: Props) {
  const isCollapsed = collapsed && !isMobile;

  return (
    <aside
      className={cn(
        'flex h-screen flex-col overflow-hidden border-r border-line bg-bg-elev transition-all duration-200',
        isCollapsed ? 'w-[60px]' : 'w-[248px]',
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          'flex h-14 shrink-0 items-center border-b border-line',
          isCollapsed ? 'justify-center px-0' : 'gap-2.5 px-4',
        )}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#0F1115] font-mono text-[11px] font-bold text-white tracking-tighter">
          MM
        </div>
        {!isCollapsed && (
          <>
            <div className="flex flex-1 flex-col overflow-hidden whitespace-nowrap leading-tight">
              <span className="text-[13px] font-semibold tracking-[-0.01em]">MMHIGHMETRIK</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
                Engineers ERP
              </span>
            </div>
            {!isMobile && (
              <button
                type="button"
                onClick={onToggle}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-bg-sunken hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Toggle when collapsed */}
      {isCollapsed && (
        <button
          type="button"
          onClick={onToggle}
          className="mx-auto mt-2 flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-bg-sunken hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className={cn('mb-3', isCollapsed && 'mb-1')}>
            {!isCollapsed && (
              <div className="px-2 pb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-ink-4">
                {group.label}
              </div>
            )}
            <div className="flex flex-col gap-px">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onClose}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-normal transition-colors',
                      isActive
                        ? 'bg-primary-soft font-medium text-primary-ink'
                        : 'text-ink-2 hover:bg-bg-sunken hover:text-foreground',
                      isCollapsed && 'justify-center px-2',
                    )
                  }
                  title={isCollapsed ? item.label : undefined}
                >
                  {({ isActive }) => (
                    <>
                      <item.icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : 'text-ink-3')} />
                      {!isCollapsed && (
                        <>
                          <span className="flex-1 truncate">{item.label}</span>
                          {item.badge && (
                            <span
                              className={cn(
                                'rounded font-mono text-[10px] px-1.5 py-px border',
                                isActive
                                  ? 'bg-bg-elev text-primary-ink border-transparent'
                                  : 'bg-bg-sunken text-ink-3 border-line',
                              )}
                            >
                              {item.badge}
                            </span>
                          )}
                        </>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer · avatar menu */}
      <div className={cn('shrink-0 border-t border-line', isCollapsed ? 'p-2' : 'p-2.5')}>
        <AvatarMenu collapsed={isCollapsed} />
      </div>
    </aside>
  );
}
