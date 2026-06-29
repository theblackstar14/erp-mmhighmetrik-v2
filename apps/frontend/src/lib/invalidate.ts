import type { QueryClient } from '@tanstack/react-query';

// Invalida el "núcleo financiero" (dashboard + flujo + notificaciones + resumen finanzas)
// tras una mutación que mueve esos datos: valo, OC aprobada/pagada, gasto, movimiento.
// → el usuario que hace el cambio lo ve al instante (sin esperar staleTime/poll).
export function invalidateResumen(qc: QueryClient): void {
  for (const queryKey of [['dashboard'], ['dashboard-salud'], ['cashflow-detalle'], ['notificaciones'], ['finanzas-resumen'], ['pnl'], ['cashflow']]) {
    qc.invalidateQueries({ queryKey });
  }
}
