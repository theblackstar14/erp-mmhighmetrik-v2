import { Building, ChevronUp, LogOut, Settings, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api.js';
import { useAuthStore } from '@/lib/auth-store.js';
import { cn } from '@/lib/utils.js';

type Props = { collapsed: boolean };

export function AvatarMenu({ collapsed }: Props) {
  const navigate = useNavigate();
  const { user, setUser } = useAuthStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
    navigate('/login');
  };

  const items = [
    { icon: Building, label: 'Empresa', onClick: () => navigate('/config/empresa') },
    { icon: Users, label: 'Usuarios y roles', onClick: () => navigate('/config/usuarios') },
    { icon: Settings, label: 'Configuración', onClick: () => navigate('/config') },
    { icon: LogOut, label: 'Cerrar sesión', onClick: handleLogout, danger: true },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-md transition-colors hover:bg-bg-sunken',
          collapsed ? 'justify-center p-1' : 'p-1.5',
        )}
      >
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold text-white"
          style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--warn)))' }}
        >
          {user?.nombres?.[0]}
          {user?.apellidos?.[0]}
        </div>
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1 overflow-hidden text-left leading-tight">
              <div className="truncate text-[12px] font-medium">
                {user?.nombres} {user?.apellidos}
              </div>
              <div className="truncate font-mono text-[10px] uppercase tracking-[0.05em] text-ink-3">
                {user?.role}
              </div>
            </div>
            <ChevronUp
              className={cn('h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform', open && 'rotate-180')}
            />
          </>
        )}
      </button>

      {open && (
        <div
          className={cn(
            'absolute z-50 rounded-md border border-line bg-bg-elev shadow-lg py-1 animate-fadeIn',
            collapsed ? 'bottom-0 left-full ml-2 w-56' : 'bottom-full mb-2 left-0 right-0',
          )}
        >
          <div className="border-b border-line px-3 py-2">
            <div className="text-[12px] font-medium truncate">{user?.email}</div>
            <div className="font-mono text-[10px] uppercase text-ink-3 mt-0.5">{user?.role}</div>
          </div>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                item.onClick();
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] hover:bg-bg-sunken',
                item.danger ? 'text-destructive' : 'text-ink-2',
              )}
            >
              <item.icon className="h-3.5 w-3.5 shrink-0" />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
