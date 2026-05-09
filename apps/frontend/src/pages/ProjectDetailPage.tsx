import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Calendar, Sparkles } from 'lucide-react';
import { Link, NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { CronogramaTab } from '@/components/proyectos/tabs/CronogramaTab.js';
import { CurvaSTab } from '@/components/proyectos/tabs/CurvaSTab.js';
import { PartidasTab } from '@/components/proyectos/tabs/PartidasTab.js';
import { ResumenTab } from '@/components/proyectos/tabs/ResumenTab.js';
import { TabPlaceholder } from '@/components/proyectos/tabs/TabPlaceholder.js';
import { api } from '@/lib/api.js';
import { cn } from '@/lib/utils.js';

const TABS = [
  { key: 'resumen', label: 'Resumen' },
  { key: 'partidas', label: 'Partidas' },
  { key: 'cronograma', label: 'Cronograma' },
  { key: 'curva-s', label: 'Curva S' },
  { key: 'documentos', label: 'Documentos' },
  { key: 'valorizaciones', label: 'Valorizaciones' },
  { key: 'liquidacion', label: 'Liquidación' },
  { key: 'compras', label: 'Compras' },
  { key: 'equipo', label: 'Equipo' },
  { key: 'contractual', label: 'Contractual' },
  { key: 'ia', label: '✦ Análisis IA' },
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
        <div className="flex items-center gap-2">
          <button className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-line bg-bg-elev text-[12px] font-medium text-ink-2 hover:bg-bg-sunken">
            <Calendar className="h-3.5 w-3.5" />
            Editar contrato
          </button>
          <button
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-[12px] font-medium text-white"
            style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), #6B84E8)' }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Analizar con IA
          </button>
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

      {/* Tab content · sub-routes */}
      <Routes>
        <Route index element={<Navigate to="resumen" replace />} />
        <Route path="resumen" element={<ResumenTab proyecto={p} />} />
        <Route path="partidas" element={<PartidasTab proyectoId={p.id} />} />
        <Route path="cronograma" element={<CronogramaTab proyectoId={p.id} />} />
        <Route path="curva-s" element={<CurvaSTab proyectoId={p.id} />} />
        <Route path="documentos" element={<TabPlaceholder title="Documentos" desc="Conexión NAS Synology · 13 carpetas estándar" />} />
        <Route path="valorizaciones" element={<TabPlaceholder title="Valorizaciones" desc="Generador + PDF · histórico V01 V02..." />} />
        <Route path="liquidacion" element={<TabPlaceholder title="Liquidación" desc="Gastos · utilidad · reparto socios · formato Excel gerente" />} />
        <Route path="compras" element={<TabPlaceholder title="Compras" desc="OC/OS · proveedores · vinculadas a partidas" />} />
        <Route path="equipo" element={<TabPlaceholder title="Equipo" desc="Profesional + Personal de obra CAPECO" />} />
        <Route path="contractual" element={<TabPlaceholder title="Contractual" desc="Adicionales · ampliaciones · garantías · FP · penalidades" />} />
        <Route path="ia" element={<TabPlaceholder title="✦ Análisis IA" desc="Insights con Gemini · alertas · recomendaciones" />} />
        <Route path="*" element={<Navigate to="resumen" replace />} />
      </Routes>
    </div>
  );
}
