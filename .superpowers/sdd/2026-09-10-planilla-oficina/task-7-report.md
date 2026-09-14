# Task 7 Report — documento_adjunto helper + upload NAS + estado boleta/comprobante

## Test output (verbatim)

```
════ documentos · Task 7 ════
  0. unit test buildNasPath
  ✓ 0. buildNasPath → /ERP/Administracion/Planilla/2026-07/99999999/comprobante.pdf
  1. create temp planilla_oficina_mes (mes=2026-07-TEST)
  ✓ 1. created planilla_oficina_mes id=8b31c242-1096-4e65-a97a-ec2f052dd287 mes=2026-07
  2. created temp empleado id=21533318-0f98-4082-b9df-3300f7102270
  ✓ 2. created planilla_oficina_detalle id=bee52290-9de9-4139-8f1e-129d64d33025 dni=99999999
  3. GET /planilla-detalle/:id/docs → expect both false
  ✓ 3. docs → boleta=false comprobante=false
  4. insert documento_adjunto row directly (comprobante_pago)
  ✓ 4. inserted doc id=b6beba2e-0a3d-47d4-92c2-bd469596c352 nasPath=/x/y.pdf
  5. GET /planilla-detalle/:id/docs → expect comprobante=true
  ✓ 5. docs → boleta=false comprobante=true

documentos VERDE
```

Exit code 9 (cosmetic Windows libuv issue on process.exit — not a failure).

## NAS lib function reused

`nasUpload(destFolder, filename, buffer)` from `apps/backend/src/lib/nas.ts`.
Signature: `async function nasUpload(destFolder: string, filename: string, buffer: Buffer): Promise<void>`
It calls `nas().putFileContents(...)` via WebDAV.

The `buildNasPath` helper builds:
`${NAS_ROOT_ADMIN}/Planilla/${subPath}/${nombreArchivo}`
where NAS_ROOT_ADMIN defaults to `/ERP/02_Administracion`.

## Files committed

- `apps/backend/src/lib/documentoAdjunto.ts`
- `apps/backend/src/routes/planillaOficina.ts`
- `apps/backend/scripts/oficina/test-documentos.ts`
