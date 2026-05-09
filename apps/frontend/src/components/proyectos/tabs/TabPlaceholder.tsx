import { Wrench } from 'lucide-react';

export function TabPlaceholder({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-md border border-line bg-bg-elev p-12 text-center">
      <Wrench className="mx-auto mb-4 h-8 w-8 text-ink-4" />
      <h3 className="text-[14px] font-semibold mb-1.5">{title}</h3>
      <p className="text-[12px] text-ink-3 max-w-md mx-auto">{desc}</p>
      <p className="text-[10px] text-ink-4 mt-3 font-mono uppercase tracking-wider">
        Próxima implementación
      </p>
    </div>
  );
}
