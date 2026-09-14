# Task 5 Report — Boleta on-screen exact layout

**STATUS:** DONE

**Commit:** 3d21f41 feat(oficina): boleta en pantalla con layout exacto (muestra 0.00)

**tsc result:**
```
(no output — exit 0)
```

## Changes

### apps/frontend/src/lib/api.ts
- Added `fechaIngreso: string | null` and `fechaCese: string | null` to `PlanillaOficinaDetalle` type.

### apps/frontend/src/components/oficina/BoletaOficina.tsx
- Full rewrite of render body to exact Excel/PDF boleta layout:
  - Header: "BOLETA DE PAGO" centered; left company block (Razon Social, Direccion, R.U.C.) + right correlativo.
  - DATOS DEL TRABAJADOR band: 3-col grid with Nombre, Cargo, Fecha Ing., Fecha cese, DNI, A.F.P., CUSPP, Dias Trab., Horas Trab.
  - Two-column section (REMUNERACIONES | APORTES Y DESCUENTOS) with subheaders.
    - Left: 12 rows always showing 0.00 for absent values (Mensual, Dominical, Horas Extras, Destajos, Bonificaciones, Gratificaciones, Vacaciones, Comisiones, Asig. Familiar, Ley 26504, Afp 10.23%3%, Otros).
    - Right: 3-col header (Motivo | Empleador | Trabajador), 10 detail rows + Total Aporte S/. row.
  - Totals row: Total Bruto (left) + Total Dscto. (right).
  - Neto Recibido: bold, larger text.
  - Footer: Lima dd/mm/yyyy + Firma Empleador + Firma Trabajador signature lines.
- Kept modal shell (overlay click-to-close), print button (window.print()), onClose button.
- One tsc fix required: `mesMmAA()` used destructuring array access on `.split('-')` result;
  changed to index access with `?? ''` fallback (TS18048 on possibly-undefined `y`).

## Concerns
- `direccion` is not currently passed as a prop (caller `PlanillaOficinaTab` does not supply it). The component renders `—` for it. If the empresa record exposes `direccion` it can be threaded through the prop later.
- `bg-white text-black` hardcoded in the boleta content area for print fidelity — this overrides dark-mode colors inside the document. Intentional (boleta is a printed document).
