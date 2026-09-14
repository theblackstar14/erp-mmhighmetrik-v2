# Boleta Redesign Report — 2026-09-10

## STATUS: DONE

## Commit
ca5f214 — feat(oficina): boleta con formato de documento formal (estilo OC · logo, bordes, bandas)
Branch: feat/rbac-multiempresa
File changed: apps/frontend/src/components/oficina/BoletaOficina.tsx (+594 / -187)

## tsc result
0 errors (npx tsc --noEmit in apps/frontend)

## What was done
- Full rewrite of BoletaOficina.tsx to mirror OcPdfPreview aesthetic:
  - createPortal + floating card + toolbar (Printer icon, close X)
  - `Imprimir / Guardar PDF` button calls `printSheet(sheetRef.current, { title: 'Boleta ' + correlativo, styles: BOLETA_STYLES, logoUrl: '/logo-mm.png', fitHeightMm: 271 })` — same wiring as OcPdfPreview
  - Scroll area with `#EEEEE9` gray background, `.bol-print-sheet` (210mm white A4 sheet, Calibri, box-shadow)
  - Scoped `<style>{BOLETA_STYLES}</style>` block with `bol-` prefixed classes
  - Logo `/logo-mm.png` top-left with MM / HIGH METRIK ENGINEERS fallback block
  - Correlativo box (bordered, CARGO hint + N° BOLETA label + value) top-right
  - Centered bold title "BOLETA DE PAGO" with bottom border (mirrors `.oc-title`)
  - "DATOS DEL TRABAJADOR" gray section band + bordered grid table (label cells `#F8F7F3`, same as OC)
  - Two-column bordered pay table (REMUNERACIONES | APORTES Y DESCUENTOS) with `bol-band-header` gray fill
  - Totals band (Total Bruto / Total Dscto.) with `#EEEEE9` fill
  - Neto Recibido row with green tint (`#F0F9F0`) and bold value
  - Footer: `Lima, <last day>` + two signature areas with top-border line
  - All existing props preserved (detalle, razonSocial, ruc, direccion, mes, onClose)
  - All field mappings and `amt()` / `fmtPEN(0)` 0.00 formatting preserved

## Concerns
- `printSheet.ts` zoom-to-fit logic targets `.oc-print-sheet` (hardcoded class selector). The boleta uses `.bol-print-sheet`, so the fitHeightMm zoom will silently no-op. Print still works correctly; it just won't auto-scale if content overflows one page. Fix: update printSheet.ts to accept a custom sheet selector, or change it to a more generic selector. Tracked as future cleanup.
