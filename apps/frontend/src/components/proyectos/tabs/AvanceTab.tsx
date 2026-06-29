import { useState } from 'react';
import { cn } from '@/lib/utils.js';
import { CurvaSTab } from './CurvaSTab.js';
import { ReconciliacionTab } from './ReconciliacionTab.js';
import { ValorizacionesTab } from './ValorizacionesTab.js';

type SubTab = 'curva-s' | 'valorizaciones' | 'reconciliacion';

const SUBTABS: { key: SubTab; label: string }[] = [
  { key: 'curva-s', label: 'Curva S' },
  { key: 'valorizaciones', label: 'Valorizaciones' },
  { key: 'reconciliacion', label: 'Reconciliación' },
];

/**
 * Tab unificada "Avance" · fusiona Curva S (EVM dual obra+inversión),
 * Valorizaciones (upload + detalle) y Reconciliación (cuadre de montos).
 */
export function AvanceTab({ proyectoId }: { proyectoId: string }) {
  const [sub, setSub] = useState<SubTab>('curva-s');

  return (
    <div className="space-y-4">
      {/* Sub-navegación */}
      <div className="inline-flex rounded-md border border-line p-0.5 bg-bg-sunken">
        {SUBTABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSub(t.key)}
            className={cn(
              'h-8 px-4 rounded-[5px] text-[12px] font-medium transition-colors',
              sub === t.key ? 'bg-bg-elev text-foreground shadow-sm' : 'text-ink-3 hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenido */}
      {sub === 'curva-s' && <CurvaSTab proyectoId={proyectoId} />}
      {sub === 'valorizaciones' && <ValorizacionesTab proyectoId={proyectoId} />}
      {sub === 'reconciliacion' && <ReconciliacionTab proyectoId={proyectoId} />}
    </div>
  );
}
