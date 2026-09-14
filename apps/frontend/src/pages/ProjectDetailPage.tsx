import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Suspense, lazy } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { TabPlaceholder } from '@/components/proyectos/tabs/TabPlaceholder.js';
import { api } from '@/lib/api.js';
import { cn } from '@/lib/utils.js';

// Tabs lazy · cada una (+ sus deps: gantt, echarts, modales) en su chunk. Solo baja al abrirla.
const AvanceTab = lazy(() => import('@/components/proyectos/tabs/AvanceTab.js').then((m) => ({ default: m.AvanceTab })));
const ContractualTab = lazy(() => import('@/components/proyectos/tabs/ContractualTab.js').then((m) => ({ default: m.ContractualTab })));
const CronogramaTab = lazy(() => import('@/components/proyectos/tabs/CronogramaTab.js').then((m) => ({ default: m.CronogramaTab })));
const DocumentosTab = lazy(() => import('@/components/proyectos/tabs/DocumentosTab.js').then((m) => ({ default: m.DocumentosTab })));
const EconomicoTab = lazy(() => import('@/components/proyectos/tabs/EconomicoTab.js').then((m) => ({ default: m.EconomicoTab })));
const EquipoTab = lazy(() => import('@/components/proyectos/tabs/EquipoTab.js').then((m) => ({ default: m.EquipoTab })));
const PartidasTab = lazy(() => import('@/components/proyectos/tabs/PartidasTab.js').then((m) => ({ default: m.PartidasTab })));
const ResumenTab = lazy(() => import('@/components/proyectos/tabs/ResumenTab.js').then((m) => ({ default: m.ResumenTab })));

const TABS = [
  { key: 'resumen', label: 'Resumen' },
  { key: 'partidas', label: 'Partidas' },
  { key: 'cronograma', label: 'Cronograma' },
  { key: 'avance', label: 'Avance' },
  { key: 'financiero', label: 'Financiero' },
  { key: 'contractual', label: 'Contractual' },
  { key: 'equipo', label: 'Equipo' },
  { key: 'documentos', label: 'Documentos' },
  // 'liquidacion' e 'ia' ocultos de la nav hasta implementarse (rutas siguen existiendo, sin dead-end visible)
];

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ['proyecto', id],
    queryFn: () => api.proyectos.get(id!),
    enabled: !!id,
  });

  if (isLoading) return <div className="text-[13px] text-ink-3">Cargando...</div>;
  if (!data?.proyecto) return <div className="text-[13px]">Proyecto no encontrado</div>;

  const p = data.proyecto;

  return (
    <div className="space-y-5">
      {/* Back link */}
      <Link
        to="/proyectos"
        className="inline-flex items-center gap-1.5 text-[12px] text-ink-3 hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Proyectos
      </Link>

      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-ink-3 font-bold">
              {p.codigo}
            </span>
            <span className="chip blue">{p.status}</span>
            <span className="chip">{p.modalidad}</span>
            {p.risk && <span className={`chip ${p.risk === 'high' ? 'red' : p.risk === 'low' ? 'green' : 'amber'}`}>Riesgo {p.risk}</span>}
          </div>
          <h1 className="text-[20px] font-semibold tracking-[-0.02em] leading-tight">{p.nombre}</h1>
          <p className="mt-0.5 text-[12.5px] text-ink-3">{p.ubicacion ?? '—'}</p>
        </div>
      </header>

      {/* Tabs nav · paths absolutos para evitar acumulación */}
      <div className="border-b border-line">
        <nav className="flex gap-1 overflow-x-auto -mb-px">
          {TABS.map((t) => (
            <NavLink
              key={t.key}
              to={`/proyectos/${p.id}/${t.key}`}
              end
              className={({ isActive }) =>
                cn(
                  'whitespace-nowrap px-3 py-2 text-[12.5px] font-medium border-b-2 transition-colors',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-ink-3 hover:text-foreground hover:border-line-strong',
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Tab content · sub-routes (lazy · Suspense por tab) */}
      <Suspense fallback={<div className="py-10 text-center text-[12px] text-ink-3">Cargando…</div>}>
      <Routes>
        <Route index element={<Navigate to="resumen" replace />} />
        <Route path="resumen" element={<ResumenTab proyecto={p} />} />
        <Route path="partidas" element={<PartidasTab proyectoId={p.id} />} />
        <Route path="cronograma" element={<CronogramaTab proyectoId={p.id} />} />
        <Route path="avance" element={<AvanceTab proyectoId={p.id} />} />
        <Route path="financiero" element={<EconomicoTab proyectoId={p.id} />} />
        <Route path="economico" element={<Navigate to={`/proyectos/${p.id}/financiero`} replace />} />
        {/* Rutas viejas · redirect a Avance (fusión) */}
        <Route path="curva-s" element={<Navigate to={`/proyectos/${p.id}/avance`} replace />} />
        <Route path="valorizaciones" element={<Navigate to={`/proyectos/${p.id}/avance`} replace />} />
        <Route path="reconciliacion" element={<Navigate to={`/proyectos/${p.id}/avance`} replace />} />
        {/* Módulos globales movidos al sidebar · redirect */}
        <Route path="finanzas" element={<Navigate to="/finanzas" replace />} />
        <Route path="inventario" element={<Navigate to="/inventario" replace />} />
        <Route path="planilla" element={<Navigate to="/personal" replace />} />
        <Route path="compras" element={<Navigate to="/logistica/ordenes" replace />} />
        <Route path="equipo" element={<EquipoTab proyectoId={p.id} />} />
        <Route path="documentos" element={<DocumentosTab proyectoId={p.id} />} />
        <Route path="liquidacion" element={<TabPlaceholder title="Liquidación" desc="Gastos · utilidad · reparto socios · formato Excel gerente" />} />
        <Route path="contractual" element={<ContractualTab proyectoId={p.id} />} />
        <Route path="ia" element={<TabPlaceholder title="✦ Análisis IA" desc="Insights con Gemini · alertas · recomendaciones" />} />
        <Route path="*" element={<Navigate to="resumen" replace />} />
      </Routes>
      </Suspense>
    </div>
  );
}
