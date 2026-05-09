import { Wrench } from 'lucide-react';

type Props = {
  title: string;
  description?: string;
};

export function EmptyModulePage({ title, description }: Props) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{title}</h1>
        {description && <p className="text-[13px] text-ink-3 mt-0.5">{description}</p>}
      </header>

      <div className="rounded-md border border-line bg-bg-elev p-12 text-center">
        <Wrench className="mx-auto mb-4 h-10 w-10 text-ink-4" />
        <h3 className="text-[14px] font-semibold mb-2">Módulo en construcción</h3>
        <p className="text-[12px] text-ink-3 max-w-md mx-auto">
          Esta sección se agregará en próximas iteraciones · por ahora trabajaremos primero en el módulo de
          Proyectos.
        </p>
      </div>
    </div>
  );
}
