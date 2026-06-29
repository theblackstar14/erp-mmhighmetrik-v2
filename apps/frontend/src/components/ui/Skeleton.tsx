import { cn } from '@/lib/utils.js';

// Placeholder pulsante · mantiene el layout mientras carga (evita el "pop" del primer load).
export function Skel({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-bg-sunken', className)} />;
}

// Filas de tabla skeleton (para listados mientras cargan).
export function SkelRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('p-3 space-y-2', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skel key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

// Grid de cards skeleton (KPIs / paneles).
export function SkelCards({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-md border border-line bg-bg-elev p-3.5">
          <Skel className="h-2.5 w-24" />
          <Skel className="h-6 w-32 mt-2.5" />
          <Skel className="h-2.5 w-20 mt-2" />
        </div>
      ))}
    </div>
  );
}

// Envuelve el contenido de un tab · fade corto al cambiar (key = tab activo). Sin deslizamiento.
export function TabFade({ tabKey, children, className }: { tabKey: string; children: React.ReactNode; className?: string }) {
  return (
    <div key={tabKey} className={cn('animate-dataIn', className)}>
      {children}
    </div>
  );
}
