import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock, FileText, ShoppingCart, Truck, Users } from 'lucide-react';
import { Suspense, lazy } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from '@/lib/api.js';
import { cn, fmtPEN } from '@/lib/utils.js';

// Sub-páginas lazy · cada una (+ modales OC) en su chunk · solo baja la tab abierta
const LogisticaOrdenesPage = lazy(() => import('@/components/logistica/LogisticaOrdenesPage.js').then((m) => ({ default: m.LogisticaOrdenesPage })));
const LogisticaProveedoresPage = lazy(() => import('@/components/logistica/LogisticaProveedoresPage.js').then((m) => ({ default: m.LogisticaProveedoresPage })));

const TABS = [
  { key: 'ordenes', label: 'Órdenes', icon: ShoppingCart },
  { key: 'proveedores', label: 'Proveedores', icon: Truck },
];

function HeaderKpis() {
  // misma key que la tab Órdenes sin filtro → se dedupe (antes era key aparte = listOcs 2×)
  const ocsQ = useQuery({ queryKey: ['logistica-ocs', '', ''], queryFn: () => api.logistica.listOcs({}) });
  const provQ = useQuery({ queryKey: ['logistica-proveedores'], queryFn: () => api.logistica.listProveedores(), staleTime: 5 * 60 * 1000 });
  const stats = ocsQ.data?.stats;
  const ordenes = ocsQ.data?.ordenes ?? [];
  const provCount = provQ.data?.proveedores?.filter((p) => p.activo !== false).length ?? 0;

  // Lead time promedio real · OCs con emisión + entrega
  const conEntrega = ordenes.filter((o) => o.emitidaEn && o.entregadaEn);
  const leadProm = conEntrega.length
    ? conEntrega.reduce((s, o) => s + (new Date(o.entregadaEn!).getTime() - new Date(o.emitidaEn!).getTime()) / 86400000, 0) / conEntrega.length
    : null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Kpi label="Monto OC / OS" value={fmtPEN(stats?.montoTotal ?? 0)} icon={<ShoppingCart className="h-4 w-4" />} accent="info" sub={`${stats?.total ?? 0} órdenes`} />
      <Kpi label="Pendientes aprobar" value={String(stats?.pendientesAprobar ?? 0)} icon={<AlertTriangle className="h-4 w-4" />} accent={stats?.pendientesAprobar ? 'warn' : undefined} sub={stats?.pendientesPago ? `${stats.pendientesPago} por pagar` : 'al día'} />
      <Kpi label="Lead time prom." value={leadProm != null ? `${leadProm.toFixed(1)} días` : '—'} icon={<Clock className="h-4 w-4" />} sub={leadProm != null ? `${conEntrega.length} con entrega` : 'sin entregas aún'} />
      <Kpi label="Proveedores activos" value={String(provCount)} icon={<Users className="h-4 w-4" />} accent="ok" />
    </div>
  );
}

export function LogisticaPage() {
  return (
    <div className="space-y-5">
      <header>
        <div className="flex items-center gap-2 mb-1">
          <FileText className="h-4 w-4 text-ink-3" />
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3 font-bold">Administración · Logística</span>
        </div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] leading-tight">Compras y logística</h1>
        <p className="mt-0.5 text-[12.5px] text-ink-3">Órdenes de compra y servicio · proveedores</p>
      </header>

      <HeaderKpis />

      {/* Tabs nav */}
      <div className="border-b border-line">
        <nav className="flex gap-1 overflow-x-auto -mb-px">
          {TABS.map((t) => (
            <NavLink
              key={t.key}
              to={`/logistica/${t.key}`}
              end
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-[12.5px] font-medium border-b-2 transition-colors',
                  isActive ? 'border-primary text-primary' : 'border-transparent text-ink-3 hover:text-foreground hover:border-line-strong',
                )
              }
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Sub-routes · fade al cambiar de tab (sin re-montar el módulo) */}
      <div key={useLocation().pathname} className="animate-dataIn">
      <Suspense fallback={<div className="py-10 text-center text-[12px] text-ink-3">Cargando…</div>}>
      <Routes>
        <Route index element={<Navigate to="ordenes" replace />} />
        <Route path="ordenes" element={<LogisticaOrdenesPage />} />
        <Route path="proveedores" element={<LogisticaProveedoresPage />} />
        {/* rutas viejas/removidas · redirect a órdenes */}
        <Route path="*" element={<Navigate to="ordenes" replace />} />
      </Routes>
      </Suspense>
      </div>
    </div>
  );
}

function Kpi({ label, value, icon, accent, sub }: { label: string; value: string; icon: React.ReactNode; accent?: 'ok' | 'warn' | 'info'; sub?: string }) {
  const border = accent === 'ok' ? 'border-l-emerald-500' : accent === 'warn' ? 'border-l-red-500' : accent === 'info' ? 'border-l-primary' : 'border-l-zinc-400';
  const iconTone = accent === 'ok' ? 'text-emerald-500' : accent === 'warn' ? 'text-red-500' : accent === 'info' ? 'text-primary' : 'text-ink-4';
  return (
    <div className={cn('rounded-lg border border-line border-l-[3px] bg-bg-elev p-3.5', border)}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4">{label}</span>
        <span className={iconTone}>{icon}</span>
      </div>
      <div className="mt-1 text-[20px] font-bold tracking-[-0.02em] tabular-nums">{value}</div>
      {sub && <div className="text-[10.5px] text-ink-4 mt-0.5">{sub}</div>}
    </div>
  );
}
