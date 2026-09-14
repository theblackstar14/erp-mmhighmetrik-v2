# Task 10 Report — Gate planilla/asistencia a admin+contabilidad

## Role-gate mechanism chosen

**Backend:** `requireOficinaEdit` middleware inline in `planillaOficina.ts`. It queries
`usuario_empresa` JOIN `roles` for the authenticated user and checks whether any membership
has `rolNombre` in `{'admin', 'contabilidad'}`. This uses the new RBAC table (not the legacy
`users.role` enum), which is the correct source of truth per the sprint. Applied to all 7
mutating routes: `POST /planilla`, `POST /planilla/:mesId/calcular`, `POST /planilla/:mesId/cerrar`,
`POST /planilla/:mesId/reabrir`, `PATCH /planilla-detalle/:id`, `POST /adelantos`,
`POST /documentos/upload`, `PUT /config-planilla`.

**Frontend:** Renamed `isAdminOrContadora` → `isAdminOrContab`; changed role check from
`'contadora'` (non-existent role) to `'contabilidad'`. The `empresaActiva.rol` field is
compared against role **names** (`'admin'` / `'contabilidad'`) as required.

## Verify output (admin passes)

```
admin RBAC memberships: [{"rolNombre":"admin"},{"rolNombre":"admin"}]
requireOficinaEdit PASS for admin: true
```

Admin user `af36a9b1-3b8e-4471-99d0-d08cf271187d` has `admin` role in 2 empresas.
`requireOficinaEdit` returns `next()` (200).

## TypeScript result

```
Exit code: 0
```

`cd apps/frontend && npx tsc --noEmit` → 0 errors.

## Files changed

- `apps/frontend/src/pages/OficinaPage.tsx` — role name fix (`contadora` → `contabilidad`)
- `apps/backend/src/routes/planillaOficina.ts` — `requireOficinaEdit` middleware + applied to 8 mutating routes
