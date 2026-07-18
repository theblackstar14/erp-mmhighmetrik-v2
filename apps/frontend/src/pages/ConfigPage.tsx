import { useQuery } from '@tanstack/react-query';
import { Building, ScrollText, User, Users } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { EmpresasSection, PerfilSection, UsuariosRolesSection } from '@/components/config/ConfigSections.js';
import { api, type AuditEvento } from '@/lib/api.js';
import { useAuthStore } from '@/lib/auth-store.js';
import { cn } from '@/lib/utils.js';

const SECCIONES = [
  { key: 'registro', label: 'Registro', icon: ScrollText, admin: true },
  { key: 'usuarios', label: 'Usuarios y roles', icon: Users, admin: true },
  { key: 'empresas', label: 'Empresas', icon: Building, admin: true },
  { key: 'perfil', label: 'Mi perfil', icon: User, admin: false },
] as const;

export function ConfigPage() {
  const esAdmin = useAuthStore((s) => s.can)('usuarios', 'edicion');
  const loc = useLocation();
  const navigate = useNavigate();

  const visibles = SECCIONES.filter((s) => esAdmin || !s.admin);
  const seg = loc.pathname.split('/')[2] || '';
  const active = visibles.find((s) => s.key === seg)?.key ?? visibles[0]?.key ?? 'perfil';

  return (
    <div className="space-y-5 p-6">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Configuración</h1>
        <p className="mt-1 text-[13px] text-ink-3">{esAdmin ? 'Registro de actividad · usuarios · roles · empresas' : 'Tu perfil'}</p>
      </header>

      <nav className="flex flex-wrap gap-1 border-b border-line">
        {visibles.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => navigate(`/config/${s.key}`)}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition-colors',
              active === s.key ? 'border-primary font-medium text-ink-1' : 'border-transparent text-ink-3 hover:text-ink-1',
            )}
          >
            <s.icon className="h-3.5 w-3.5" />
            {s.label}
          </button>
        ))}
      </nav>

      {active === 'registro' && <RegistroTab />}
      {active === 'usuarios' && <UsuariosRolesSection />}
      {active === 'empresas' && <EmpresasSection />}
      {active === 'perfil' && <PerfilSection />}
    </div>
  );
}

function RegistroTab() {
  const hoy = new Date().toISOString().slice(0, 10);
  const [accion, setAccion] = useState('');
  const [entidad, setEntidad] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit', accion, entidad, desde, hasta],
    queryFn: () => api.admin.audit({ action: accion || undefined, entityType: entidad || undefined, from: desde || undefined, to: hasta || undefined, limit: 300 }),
  });
  const eventos = data?.eventos ?? [];
  const hayFiltro = accion || entidad || desde || hasta;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={accion} onChange={(e) => setAccion(e.target.value)} className="h-8 rounded-md border border-line bg-bg-elev px-2.5 text-[12px]">
          <option value="">Todas las acciones</option>
          {(data?.acciones ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={entidad} onChange={(e) => setEntidad(e.target.value)} className="h-8 rounded-md border border-line bg-bg-elev px-2.5 text-[12px]">
          <option value="">Todas las entidades</option>
          {(data?.entidades ?? []).map((en) => <option key={en} value={en}>{en}</option>)}
        </select>
        <input type="date" value={desde} max={hasta || hoy} onChange={(e) => setDesde(e.target.value)} className="h-8 rounded-md border border-line bg-bg-elev px-2.5 text-[12px]" title="Desde" />
        <input type="date" value={hasta} min={desde} max={hoy} onChange={(e) => setHasta(e.target.value)} className="h-8 rounded-md border border-line bg-bg-elev px-2.5 text-[12px]" title="Hasta" />
        {hayFiltro && (
          <button type="button" onClick={() => { setAccion(''); setEntidad(''); setDesde(''); setHasta(''); }} className="h-8 rounded-md border border-line px-2.5 text-[12px] hover:bg-bg-sunken">Limpiar</button>
        )}
        <span className="text-[11px] text-ink-4">{eventos.length} eventos · quién hizo qué y cuándo</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-bg-elev">
        {isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-6 animate-pulse rounded bg-bg-sunken" />)}</div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="border-b border-line bg-bg-sunken">
              <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-ink-4">
                <th className="w-40 px-3 py-2">Fecha</th>
                <th className="w-44 px-3 py-2">Usuario</th>
                <th className="w-40 px-3 py-2">Acción</th>
                <th className="w-28 px-3 py-2">Entidad</th>
                <th className="w-28 px-3 py-2">IP</th>
                <th className="px-3 py-2">Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {eventos.map((e) => (
                <tr key={e.id} className="hover:bg-bg-sunken/30">
                  <td className="px-3 py-2 font-mono text-[10.5px] text-ink-3">{new Date(e.createdAt).toLocaleString('es-PE')}</td>
                  <td className="px-3 py-2 text-[11px]">{e.userNombres ?? e.userEmail ?? <span className="text-ink-4">sistema</span>}</td>
                  <td className="px-3 py-2">
                    <span className={cn('font-mono text-[10.5px]', /anular|delete|fail/.test(e.action) && 'text-destructive', /login|create|update|reset/.test(e.action) && 'text-ink-2')}>{e.action}</span>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-ink-3">{e.entityType ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-ink-4">{e.ip ?? '—'}</td>
                  <td className="max-w-[360px] truncate px-3 py-2 text-[11px] text-ink-3" title={resumen(e)}>{resumen(e)}</td>
                </tr>
              ))}
              {eventos.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-[12px] text-ink-3">Sin eventos con estos filtros.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-[10.5px] text-ink-4">Read-only · registro inmutable de eventos de auth, administración y operaciones (login, alta/edición/baja, roles, cierres, etc.).</p>
    </div>
  );
}

function resumen(e: AuditEvento): string {
  const c = e.changes;
  if (c?.motivo) return `motivo: ${c.motivo}`;
  const a = c?.after as Record<string, unknown> | undefined;
  if (a) return Object.entries(a).slice(0, 3).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v).slice(0, 30) : String(v)}`).join(' · ');
  if (e.entityId) return `id: ${e.entityId}`;
  return '—';
}
