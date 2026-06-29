import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { api } from '@/lib/api.js';

/**
 * Wrapper para módulos GLOBALES en el sidebar (Finanzas, Inventario, Personal).
 * El proyecto es un FILTRO: eliges la obra arriba y el módulo opera sobre ella.
 * (Vista "Todas las obras" agregada · pendiente · backend ya soporta filtro.)
 */
export function GlobalModulePage({
  title,
  desc,
  render,
}: {
  title: string;
  desc: string;
  render: (proyectoId: string) => ReactNode;
}) {
  const { data } = useQuery({ queryKey: ['proyectos-list'], queryFn: () => api.proyectos.list() });
  const proyectos = data?.proyectos ?? [];
  const [sel, setSel] = useState<string>('');

  // auto-seleccionar primer proyecto
  const proyectoId = sel || proyectos[0]?.id || '';

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{title}</h1>
          <p className="text-[13px] text-ink-3 mt-0.5">{desc}</p>
        </div>
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-ink-3" />
          <select
            className="h-9 px-3 rounded-md border border-line bg-bg-elev text-[12.5px] min-w-[220px]"
            value={proyectoId}
            onChange={(e) => setSel(e.target.value)}
          >
            {proyectos.length === 0 && <option value="">Sin proyectos</option>}
            {proyectos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.codigo} · {p.nombre}
              </option>
            ))}
          </select>
        </div>
      </header>

      {proyectoId ? (
        render(proyectoId)
      ) : (
        <div className="rounded-md border border-line bg-bg-elev p-8 text-center text-[12px] text-ink-3">
          Crea un proyecto primero
        </div>
      )}
    </div>
  );
}
