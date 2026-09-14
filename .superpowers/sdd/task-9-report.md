# Task 9 Report — destino proyecto/corporativo en form global de gasto

**Status:** DONE  
**Case:** B  
**Commit hash:** none  
**TSC exit code:** 0  
**Concern:** none

---

## Finding

### Grep evidence

`createGastoGlobal` appears in only ONE place in the entire frontend tree:

```
apps/frontend/src/lib/api.ts:263:
  createGastoGlobal: (data: GastoInput & { proyectoId?: string | null }) =>
    req<{ gasto: Gasto }>('/api/gastos', { method: 'POST', body: JSON.stringify(data) }),
```

It is **never called** in any page or component. There is no modal, form, or button anywhere in `FinanzasPage.tsx` or its imported components that creates a gasto from the global view.

### What FinanzasPage gastos sub-tab actually does

The `GlobalLedger` component (rendered for `kind="gastos"`) is a **read-only list** with:
- Search, year/month filters
- CSV export
- A click-to-detail modal (`GastoItemsModal`) that shows inventory items for an existing gasto

The footer note on the list explicitly says:
> "Para registrar con detalle usa el módulo por obra."

### Where gasto creation lives

The only create-gasto form is `GastoForm` inside `apps/frontend/src/components/proyectos/tabs/FinanzasTab.tsx` (line 133), which is project-scoped and calls `api.finanzas.createGasto(proyectoId, ...)`. A prior task handled the CD/GG_OBRA selector for that form.

---

## Conclusion

**CASE B — no global gasto form exists.** Corporativo gastos (GG_CORP) are created via the backend default when `proyectoId` is null; no UI change was needed in this task.

**Recommendation (future task):** Add a "Registrar gasto corporativo" button in the GlobalLedger gastos toolbar that opens a modal calling `api.finanzas.createGastoGlobal(...)` with `destino: 'corporativo'` pre-selected and no project selector. This would enable overhead entries (HQ rent, accounting, etc.) from the global Finanzas view.

---

## TSC verification

```
cd apps/frontend && npx tsc --noEmit
EXIT: 0
```

No TypeScript errors. No files were modified.
