# Task 3 Report — Boleta PDF generator

## Verify output
```
len 3445 pdf? %PDF
```

## Commit
`b3df88c` — feat(oficina): generador de boleta PDF (pdfkit) con layout exacto + stub email

## Files created
- `apps/backend/src/lib/boletaOficinaPdf.ts` — `generarBoletaPdf()` with full A4 layout
- `apps/backend/src/lib/boletaEmail.ts` — stub throwing "email de boletas no configurado"

## Concerns
- None blocking. `len 3445` is compact for a single-page PDF (no embedded images); valid %PDF header confirmed.
- The `continued: true` chaining in pdfkit resets X position after the call, so right-column text on the same `y` is placed by absolute coordinates — pattern matches `ocPdf.ts` usage.
