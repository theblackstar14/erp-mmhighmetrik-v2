# Clasificación de gastos CD / GG_OBRA / GG_CORP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clasificar cada gasto como Costo Directo (CD), Gasto General de Obra (GG_OBRA) o Gasto Corporativo (GG_CORP) para calcular el resultado real por obra y reconciliar con contabilidad.

**Architecture:** Dos columnas nuevas en `gastos` (`destino`, `clasificacion`) + `clasificacionOrigen` + `prorrateable`. La clase se autocompleta desde una columna `clase` sugerida en la tabla config `gasto_cuenta_map`, con override en el form. Un endpoint agrega CD/GG ejecutado vs presupuesto por obra. Los asientos ya derivan de `gastos`, así que la vista operacional y la contable reconcilian por construcción.

**Tech Stack:** Backend Express + Drizzle + postgres.js (corre con `tsx`, NO compila con tsc). Frontend Vite + React 18 + TanStack Query + Tailwind (tsc DEBE estar limpio). Postgres local (2 DBs: `erp_mmh` activa, `erp_mmh_f4d` auditoría). Migraciones se aplican a mano por psql.

## Global Constraints

- Frontend `npx tsc --noEmit` DEBE salir exit 0 tras cada tarea con cambios de frontend. Backend NO compila con tsc (deuda type-only) — no correr tsc en backend.
- Migraciones a mano por psql en AMBAS DBs (`erp_mmh` y `erp_mmh_f4d`). Password `MiClave123`. Binario: `C:\Program Files\PostgreSQL\18\bin\psql.exe`. `export PGCLIENTENCODING=UTF8` antes de queries con acentos.
- Backend corre en :3001, frontend :5173. Login por cookie: `POST /api/auth/login {"email":"admin@mmhighmetrik.com","password":"admin"}` → guardar cookie jar. tsx recarga solo al editar.
- Valores internos EXACTOS (no cambiar): `destino` = `'proyecto' | 'corporativo'`; `clasificacion` = `'CD' | 'GG_OBRA' | 'GG_CORP'`; `clasificacionOrigen` = `'AUTOMATICO' | 'USUARIO' | 'BACKFILL'`.
- UI muestra labels bonitos: CD→"Costo Directo", GG_OBRA→"Gasto General de Obra", GG_CORP→"Gasto Administrativo Corporativo". Nunca llamar "utilidad" al resultado de obra → usar "Resultado de obra (sin gastos de oficina)".
- NO implementar prorrateo. `prorrateable` es solo un boolean flag.

---

### Task 1: Schema — columnas en `gastos` y `gasto_cuenta_map` + migración + backfill

**Files:**
- Modify: `packages/db/src/schema.ts` (tabla `gastos` ~line 630-657; tabla `gastoCuentaMap`)
- Create (temporal, borrar al final): `_tmp_clase.sql`

**Interfaces:**
- Produces: columnas `gastos.destino`, `gastos.clasificacion`, `gastos.clasificacion_origen`, `gastos.prorrateable`; `gasto_cuenta_map.clase`.

- [ ] **Step 1: Editar schema.ts — agregar columnas a `gastos`**

En la definición de la tabla `gastos`, después de `tipoGasto: varchar('tipo_gasto', ...)`, agregar:

```ts
    destino: varchar('destino', { length: 12 }).notNull().default('proyecto'), // proyecto | corporativo
    clasificacion: varchar('clasificacion', { length: 10 }).notNull().default('CD'), // CD | GG_OBRA | GG_CORP
    clasificacionOrigen: varchar('clasificacion_origen', { length: 12 }).notNull().default('AUTOMATICO'), // AUTOMATICO | USUARIO | BACKFILL
    prorrateable: boolean('prorrateable').notNull().default(false), // flag futuro · sin lógica de prorrateo aún
```

- [ ] **Step 2: Editar schema.ts — agregar `clase` a `gastoCuentaMap`**

En la definición de `gastoCuentaMap`, después de `esGasto`, agregar:

```ts
    clase: varchar('clase', { length: 10 }).notNull().default('CD'), // CD | GG_OBRA | GG_CORP · sugerencia para el form
```

- [ ] **Step 3: Escribir `_tmp_clase.sql`** (migración + seed clase + backfill)

```sql
-- columnas en gastos
ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS destino varchar(12) NOT NULL DEFAULT 'proyecto',
  ADD COLUMN IF NOT EXISTS clasificacion varchar(10) NOT NULL DEFAULT 'CD',
  ADD COLUMN IF NOT EXISTS clasificacion_origen varchar(12) NOT NULL DEFAULT 'AUTOMATICO',
  ADD COLUMN IF NOT EXISTS prorrateable boolean NOT NULL DEFAULT false;

-- columna clase en el mapa config
ALTER TABLE gasto_cuenta_map
  ADD COLUMN IF NOT EXISTS clase varchar(10) NOT NULL DEFAULT 'CD';

-- seed clase por tipo (GG_OBRA para lo indirecto de obra; el resto queda CD por default)
UPDATE gasto_cuenta_map SET clase='GG_OBRA'
  WHERE tipo_gasto IN ('Alquileres','Servicio','Servicios básicos','Mantenimiento','Movilidad','Viáticos','Seguro','Seguros','seguros');
UPDATE gasto_cuenta_map SET clase='GG_CORP'
  WHERE tipo_gasto IN ('Impuestos','Comisión','Gasto Bancario','Financiero');

-- backfill de los gastos existentes
UPDATE gastos SET
  destino = CASE WHEN proyecto_id IS NULL THEN 'corporativo' ELSE 'proyecto' END,
  clasificacion = CASE
      WHEN proyecto_id IS NULL THEN 'GG_CORP'
      ELSE COALESCE((SELECT m.clase FROM gasto_cuenta_map m WHERE m.tipo_gasto = gastos.tipo_gasto), 'CD')
    END,
  clasificacion_origen = 'BACKFILL';

-- verificación
SELECT destino, clasificacion, clasificacion_origen, count(*) FROM gastos GROUP BY 1,2,3 ORDER BY 1,2;
```

- [ ] **Step 4: Aplicar en AMBAS DBs**

```bash
export PGCLIENTENCODING=UTF8
for DB in erp_mmh erp_mmh_f4d; do
  echo "=== $DB ==="
  PGPASSWORD=MiClave123 "/c/Program Files/PostgreSQL/18/bin/psql.exe" -U postgres -h localhost -d $DB -f "C:/Users/gabri/Desktop/erp-mmhighmetrik-v2/_tmp_clase.sql"
done
```
Expected: `ALTER TABLE` ×2, varios `UPDATE`, y una tabla final donde `destino=proyecto` domina con `clasificacion` mayormente CD + algunas GG_OBRA, y `clasificacion_origen=BACKFILL` en todas.

- [ ] **Step 5: Borrar el temporal + commit**

```bash
rm -f /c/Users/gabri/Desktop/erp-mmhighmetrik-v2/_tmp_clase.sql
git add packages/db/src/schema.ts
git commit -m "feat(gastos): schema clasificacion CD/GG_OBRA/GG_CORP + clase en config + backfill"
```

---

### Task 2: Backend — config `clase` en `/cuentas-tipo` (GET devuelve, PUT acepta)

**Files:**
- Modify: `apps/backend/src/routes/contabilidad.ts` (ruta `GET /cuentas-tipo` ~1930; `PUT /cuentas-tipo/:tipo` ~1937)

**Interfaces:**
- Consumes: `schema.gastoCuentaMap.clase` (Task 1).
- Produces: `GET /contabilidad/cuentas-tipo` incluye `clase` en cada fila del `mapa`; `PUT /contabilidad/cuentas-tipo/:tipo` acepta `{clase}`.

- [ ] **Step 1: GET ya hace `select().from(gastoCuentaMap)`** — devuelve todas las columnas, así que `clase` ya viaja. Confirmar leyendo la ruta (no requiere cambio si usa `db.select().from(schema.gastoCuentaMap)` sin proyección). Si usa proyección explícita, agregar `clase: schema.gastoCuentaMap.clase`.

- [ ] **Step 2: Editar el PUT para aceptar `clase`**

En `PUT /cuentas-tipo/:tipo`, cambiar el body y el `set`:

```ts
  const b = req.body as { cuenta?: string; esActivo?: boolean; esGasto?: boolean; clase?: string };
  if (!b.cuenta) return res.status(400).json({ error: 'cuenta requerida' });
  const claseOk = ['CD', 'GG_OBRA', 'GG_CORP'].includes(b.clase ?? '') ? b.clase! : 'CD';
  const set = { cuenta: b.cuenta, esActivo: !!b.esActivo, esGasto: b.esGasto ?? true, clase: claseOk, actualizadoEn: new Date() };
```
(el `.values({ tipoGasto: tipo, ...set })` y el `onConflictDoUpdate({ set })` ya propagan `clase`).

- [ ] **Step 3: Verificar (login + curl)**

```bash
cd /tmp && curl -s -c jar.txt -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@mmhighmetrik.com","password":"admin"}' -o /dev/null
curl -s -b jar.txt "http://localhost:3001/api/contabilidad/cuentas-tipo" | grep -o '"clase":"[A-Z_]*"' | sort -u
```
Expected: aparecen `"clase":"CD"`, `"clase":"GG_OBRA"`, `"clase":"GG_CORP"`.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/routes/contabilidad.ts
git commit -m "feat(contab): clase CD/GG en config cuentas-tipo (GET/PUT)"
```

---

### Task 3: Backend — `gastoSchema` + auto-clasificación al crear gasto

**Files:**
- Modify: `apps/backend/src/routes/finanzas.ts` (`gastoSchema` ~66; `toValues` ~111; rutas POST ~157 y ~383)

**Interfaces:**
- Consumes: `gasto_cuenta_map.clase` (Task 1).
- Produces: las rutas de creación de gasto aceptan `destino`, `clasificacion`, `prorrateable` opcionales; si `clasificacion` no viene, se deriva de la config (origen AUTOMATICO); si viene del usuario, origen USUARIO.

- [ ] **Step 1: Extender `gastoSchema`** (después de `inventariable`):

```ts
  destino: z.enum(['proyecto', 'corporativo']).optional(),
  clasificacion: z.enum(['CD', 'GG_OBRA', 'GG_CORP']).optional(),
  prorrateable: z.boolean().optional(),
```

- [ ] **Step 2: Helper de clasificación** (arriba de las rutas, tras `crearDraftInventario`):

```ts
// Deriva destino+clasificacion+origen. Si el usuario mandó clasificacion → USUARIO; si no → default de config (AUTOMATICO).
async function resolverClase(d: { proyectoId?: string | null; tipoGasto?: string | null; destino?: string; clasificacion?: string }) {
  const destino = d.destino ?? (d.proyectoId ? 'proyecto' : 'corporativo');
  if (destino === 'corporativo') return { destino, clasificacion: 'GG_CORP', clasificacionOrigen: 'AUTOMATICO' as const };
  if (d.clasificacion) return { destino, clasificacion: d.clasificacion, clasificacionOrigen: 'USUARIO' as const };
  const [m] = await db.select({ clase: schema.gastoCuentaMap.clase }).from(schema.gastoCuentaMap).where(eq(schema.gastoCuentaMap.tipoGasto, d.tipoGasto ?? '')).limit(1);
  return { destino, clasificacion: m?.clase ?? 'CD', clasificacionOrigen: 'AUTOMATICO' as const };
}
```
(confirmar que `eq` está importado en finanzas.ts; si no, agregarlo al import de `drizzle-orm`).

- [ ] **Step 3: Cablear en `toValues`** — agregar los 4 campos al objeto que retorna:

```ts
    destino: d.destino ?? null,           // se sobreescribe abajo
    clasificacion: d.clasificacion ?? null,
    prorrateable: d.prorrateable ?? false,
```
Y en cada ruta POST, ANTES del `db.insert`, resolver y mezclar:

En `POST /proyectos/:id/gastos` (~157) y en `POST /gastos` (~383), tras `const values = toValues(parse.data)` (o equivalente), agregar:

```ts
  const cls = await resolverClase({ proyectoId: values.proyectoId, tipoGasto: values.tipoGasto, destino: parse.data.destino, clasificacion: parse.data.clasificacion });
  const [gasto] = await db.insert(schema.gastos).values({ ...values, ...cls }).returning();
```
(ajustar al patrón exacto de cada ruta — ambas ya hacen un insert con `.returning()`).

- [ ] **Step 3b: Cubrir los otros 2 flujos que insertan gastos** (auditoría: son 4 en total, no 2)

En `logistica.ts:736` (pago OC → auto-gasto, dentro de `tx.insert(schema.gastos)`), resolver antes del insert y mezclar:
```ts
      const cls = await resolverClase({ proyectoId: oc.proyectoId, tipoGasto: oc.concepto === 'SERVICIO' ? 'Servicio Terceros' : 'Compra Materiales' });
      const [gasto] = await tx.insert(schema.gastos).values({
        proyectoId: oc.proyectoId,
        ...cls,
        // ...resto de campos existentes sin cambios...
```
(importar `resolverClase` desde finanzas.ts, o duplicar el helper en un módulo compartido `lib/clasificacion.ts` — preferir extraerlo a `apps/backend/src/lib/clasificacion.ts` y que finanzas.ts + logistica.ts + oficina.ts lo importen. `resolverClase` recibe `db`/`tx`? Usa `db` global — para el caso tx de logistica está bien usar `db` para el SELECT de config, no necesita la tx.)

En `oficina.ts:38` (rendición → gasto), igual antes del insert:
```ts
  const cls = await resolverClase({ proyectoId: r.proyectoId, tipoGasto: r.tipo });
  const [g] = await db.insert(schema.gastos).values({
    codigo: r.codigo, proyectoId: r.proyectoId, ...cls,
    // ...resto de campos existentes sin cambios...
```
Nota: si `resolverClase` se extrae a `lib/clasificacion.ts`, Task 3 Step 2 define el helper ahí y finanzas.ts lo importa en vez de declararlo local.

- [ ] **Step 4: Verificar (crear gasto proyecto sin clasificacion → AUTOMATICO)**

```bash
cd /tmp
# usar un proyectoId real:
PID=$(PGPASSWORD=MiClave123 "/c/Program Files/PostgreSQL/18/bin/psql.exe" -U postgres -h localhost -d erp_mmh -t -A -c "SELECT id FROM proyectos WHERE codigo='PG0001'")
curl -s -b jar.txt -X POST "http://localhost:3001/api/proyectos/$PID/gastos" -H "Content-Type: application/json" \
  -d '{"fecha":"2026-07-01","tipoGasto":"Alquileres","subtotal":100,"igv":18,"total":118}' | grep -o '"clasificacion":"[A-Z_]*","clasificacionOrigen":"[A-Z_]*"'
```
Expected: `"clasificacion":"GG_OBRA","clasificacionOrigen":"AUTOMATICO"` (Alquileres → GG_OBRA por config). Borrar ese gasto de prueba después:
```bash
PGPASSWORD=MiClave123 "/c/Program Files/PostgreSQL/18/bin/psql.exe" -U postgres -h localhost -d erp_mmh -c "DELETE FROM gastos WHERE tipo_gasto='Alquileres' AND total=118 AND fecha='2026-07-01'"
```

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/routes/finanzas.ts
git commit -m "feat(gastos): auto-clasificacion CD/GG al crear (destino+config+origen)"
```

---

### Task 4: Backend — endpoint reporte costos por obra

**Files:**
- Modify: `apps/backend/src/routes/proyectos.ts` (agregar ruta cerca de las otras `GET /:id/...`)

**Interfaces:**
- Consumes: `gastos.clasificacion`, `gastos.prorrateable`, `proyectos.costoDirectoSinIgv/pctGg/ggUtModo`, valorización (Σ montoCd de valos aprobadas+).
- Produces: `GET /proyectos/:id/costos-obra` → objeto `CostosObra` (ver shape en el código).

- [ ] **Step 1: Agregar la ruta**

```ts
// Reporte de costos de obra · CD / GG_OBRA ejecutado vs presupuesto + resultado de obra
router.get('/:id/costos-obra', async (req, res) => {
  const id = req.params.id!;
  const [proy] = await db.select().from(schema.proyectos).where(eq(schema.proyectos.id, id)).limit(1);
  if (!proy) return res.status(404).json({ error: 'Proyecto no encontrado' });

  // ejecutado por clasificacion (solo gastos de este proyecto)
  const rows = await db.select({
      clasificacion: schema.gastos.clasificacion,
      prorrateable: schema.gastos.prorrateable,
      total: dsql<number>`coalesce(sum(${schema.gastos.total}),0)::float8`,
    }).from(schema.gastos)
    .where(and(eq(schema.gastos.proyectoId, id), eq(schema.gastos.destino, 'proyecto')))
    .groupBy(schema.gastos.clasificacion, schema.gastos.prorrateable);

  const sumBy = (clase: string, comp: boolean) => rows.filter(r => r.clasificacion === clase && r.prorrateable === comp).reduce((s, r) => s + r.total, 0);
  const cdEjec = sumBy('CD', false) + sumBy('CD', true);
  const ggEjec = sumBy('GG_OBRA', false) + sumBy('GG_OBRA', true);
  const compartidos = sumBy('CD', true) + sumBy('GG_OBRA', true); // línea "sin distribuir" (informativa)

  // presupuesto (respeta ggUtModo)
  const cdPres = Number(proy.costoDirectoSinIgv ?? proy.costoDirecto ?? 0);
  const ggSeparado = proy.ggUtModo === 'separado';
  const ggPres = ggSeparado ? cdPres * Number(proy.pctGg ?? 0) : null; // null = embebido/simple → no separable

  // valorización reconocida (devengado: aprobada en adelante) · Σ montoCd
  const [val] = await db.select({ v: dsql<number>`coalesce(sum(${schema.valorizaciones.montoCd}),0)::float8` })
    .from(schema.valorizaciones)
    .where(and(eq(schema.valorizaciones.proyectoId, id), inArray(schema.valorizaciones.status, ['aprobada', 'conformidad_supervision', 'facturada', 'cobrada'])));
  const valorizacion = val?.v ?? 0;

  const costoTotal = cdEjec + ggEjec;
  const resultadoObra = valorizacion - costoTotal;

  res.json({
    cd: { presupuesto: cdPres, ejecutado: cdEjec },
    ggObra: { presupuesto: ggPres, ejecutado: ggEjec, separable: ggSeparado },
    costoTotal, valorizacion, resultadoObra,
    compartidosSinDistribuir: compartidos,
    ggUtModo: proy.ggUtModo,
  });
});
```
(confirmar imports en proyectos.ts: `dsql` — buscar cómo se importa `sql` en ese archivo; si se llama distinto, usar el alias existente. `and`, `eq`, `inArray` ya están importados.)

- [ ] **Step 2: Verificar**

```bash
cd /tmp
PID=$(PGPASSWORD=MiClave123 "/c/Program Files/PostgreSQL/18/bin/psql.exe" -U postgres -h localhost -d erp_mmh -t -A -c "SELECT id FROM proyectos WHERE codigo='PG0001'")
curl -s -b jar.txt "http://localhost:3001/api/proyectos/$PID/costos-obra"
```
Expected: JSON con `cd.ejecutado` > 0, `ggObra`, `valorizacion` > 0, `resultadoObra` = valorizacion − costoTotal. Sin error 500.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/routes/proyectos.ts
git commit -m "feat(proyectos): endpoint costos-obra (CD/GG ejecutado vs presupuesto + resultado)"
```

---

### Task 5: Frontend — tipos y métodos en api.ts

**Files:**
- Modify: `apps/frontend/src/lib/api.ts` (`GastoInput`; `GastoCuentaMapRow`; `updateCuentaTipo`; agregar `CostosObra` + `proyectos.getCostosObra`)

**Interfaces:**
- Produces: `GastoInput` con `destino?/clasificacion?/prorrateable?`; `GastoCuentaMapRow` con `clase`; `api.proyectos.getCostosObra(id)`; `api.contabilidad.updateCuentaTipo` acepta `clase`.

- [ ] **Step 1: `GastoInput`** — agregar campos opcionales:
```ts
  destino?: 'proyecto' | 'corporativo';
  clasificacion?: 'CD' | 'GG_OBRA' | 'GG_CORP';
  prorrateable?: boolean;
```

- [ ] **Step 2: `GastoCuentaMapRow`** — agregar `clase`:
```ts
export type GastoCuentaMapRow = { tipoGasto: string; cuenta: string; esActivo: boolean; esGasto: boolean; clase: 'CD' | 'GG_OBRA' | 'GG_CORP' };
```

- [ ] **Step 3: `updateCuentaTipo`** — agregar `clase` al body param:
```ts
    updateCuentaTipo: (tipo: string, v: { cuenta: string; esActivo: boolean; esGasto: boolean; clase: string }) =>
      req<{ ok: boolean; row: GastoCuentaMapRow }>(`/api/contabilidad/cuentas-tipo/${encodeURIComponent(tipo)}`, { method: 'PUT', body: JSON.stringify(v) }),
```

- [ ] **Step 4: Tipo + método `getCostosObra`** (cerca de los otros métodos `proyectos.*`):
```ts
export type CostosObra = {
  cd: { presupuesto: number; ejecutado: number };
  ggObra: { presupuesto: number | null; ejecutado: number; separable: boolean };
  costoTotal: number; valorizacion: number; resultadoObra: number;
  compartidosSinDistribuir: number; ggUtModo: string;
};
```
```ts
    getCostosObra: (id: string) => req<CostosObra>(`/api/proyectos/${id}/costos-obra`),
```

- [ ] **Step 5: Verificar tsc + commit**
```bash
cd /c/Users/gabri/Desktop/erp-mmhighmetrik-v2/apps/frontend && npx tsc --noEmit; echo "EXIT: $?"
```
Expected: EXIT 0.
```bash
git add apps/frontend/src/lib/api.ts && git commit -m "feat(api): tipos clase gasto + CostosObra + getCostosObra"
```

---

### Task 6: Frontend — selector clasificación en el form de gasto (proyecto)

**Files:**
- Modify: `apps/frontend/src/components/proyectos/tabs/FinanzasTab.tsx` (`GastoForm` ~133)

**Interfaces:**
- Consumes: `GastoInput.clasificacion` (Task 5); `api.contabilidad.getCuentasTipo` para el default por tipo.

- [ ] **Step 1: Cargar defaults de clase por tipo** (dentro de `GastoForm`, con las otras queries):
```ts
  const claseMapQ = useQuery({ queryKey: ['cuentas-tipo'], queryFn: () => api.contabilidad.getCuentasTipo() });
  const claseDe = (tipo: string): 'CD' | 'GG_OBRA' => {
    const m = claseMapQ.data?.mapa.find((x) => x.tipoGasto === tipo);
    return m?.clase === 'GG_OBRA' ? 'GG_OBRA' : 'CD'; // en obra solo CD/GG_OBRA
  };
```

- [ ] **Step 2: `empty` incluye clasificacion + destino** (línea ~138):
```ts
    descripcionItem: '', subtotal: 0, igv: 0, exonerado: 0, total: 0, tipoGasto: 'Compra Materiales', observaciones: '', inventariable: false,
    destino: 'proyecto', clasificacion: 'CD',
```

- [ ] **Step 3: Al cambiar tipoGasto, pre-llenar clasificacion desde config** (línea ~156):
```tsx
        <Sel value={f.tipoGasto ?? ''} onChange={(v) => set({ tipoGasto: v, inventariable: TIPOS_INVENTARIABLES.has(v), clasificacion: claseDe(v) })} opts={TIPOS_GASTO} />
```

- [ ] **Step 4: Agregar los 2 botones de clasificación** (después del `Sel` de tipoGasto, antes del checkbox inventario):
```tsx
        <div className="col-span-2">
          <span className="text-[10.5px] font-mono uppercase tracking-wider text-ink-4">¿A qué parte de la obra corresponde?</span>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => set({ clasificacion: 'CD' })}
              className={cn('rounded-md border p-2 text-left text-[11.5px]', f.clasificacion === 'CD' ? 'border-primary bg-primary/5' : 'border-line hover:bg-bg-sunken')}>
              <div className="font-medium">Costo Directo</div>
              <div className="text-[10px] text-ink-4">Va a una tarea del presupuesto (cemento, fierro, mano de obra)</div>
            </button>
            <button type="button" onClick={() => set({ clasificacion: 'GG_OBRA' })}
              className={cn('rounded-md border p-2 text-left text-[11.5px]', f.clasificacion === 'GG_OBRA' ? 'border-primary bg-primary/5' : 'border-line hover:bg-bg-sunken')}>
              <div className="font-medium">Gasto General de Obra</div>
              <div className="text-[10px] text-ink-4">Gasto del terreno en general (vigilante, campamento, viáticos)</div>
            </button>
          </div>
        </div>
```
(confirmar que `cn` está importado en FinanzasTab.tsx; si no, importarlo de `../../../lib/cn` o el path que use el resto del repo.)

- [ ] **Step 5: Verificar tsc + commit**
```bash
cd /c/Users/gabri/Desktop/erp-mmhighmetrik-v2/apps/frontend && npx tsc --noEmit; echo "EXIT: $?"
```
Expected: EXIT 0.
```bash
git add apps/frontend/src/components/proyectos/tabs/FinanzasTab.tsx && git commit -m "feat(gastos): selector CD/GG_OBRA en form de gasto de obra"
```

---

### Task 7: Frontend — columna `clase` editable en CuentasTipoTab

**Files:**
- Modify: `apps/frontend/src/pages/ContabilidadPage.tsx` (`CuentasTipoTab` ~1500)

**Interfaces:**
- Consumes: `GastoCuentaMapRow.clase` (Task 5), `api.contabilidad.updateCuentaTipo` con `clase`.

- [ ] **Step 1: Agregar header de columna "Clase"** en la tabla (junto a Cuenta/Activo/Gasto).

- [ ] **Step 2: Agregar el dropdown por fila** (el `upd.mutate` ya existe; agregar `clase` a la llamada):
```tsx
              <td className="px-3 py-2">
                <select value={row.clase} onChange={(e) => upd.mutate({ tipo: row.tipoGasto, cuenta: row.cuenta, esActivo: row.esActivo, esGasto: row.esGasto, clase: e.target.value })}
                  className="h-7 px-2 rounded-md border border-line bg-bg-elev text-[11.5px]">
                  <option value="CD">Costo Directo</option>
                  <option value="GG_OBRA">Gasto General de Obra</option>
                  <option value="GG_CORP">Gasto Corporativo</option>
                </select>
              </td>
```
(actualizar la firma de `upd.mutate` — el `mutationFn` debe aceptar `clase` y pasarlo a `api.contabilidad.updateCuentaTipo`. Editar el tipo del mutation para incluir `clase: string`.)

- [ ] **Step 3: Verificar tsc + commit**
```bash
cd /c/Users/gabri/Desktop/erp-mmhighmetrik-v2/apps/frontend && npx tsc --noEmit; echo "EXIT: $?"
```
Expected: EXIT 0.
```bash
git add apps/frontend/src/pages/ContabilidadPage.tsx && git commit -m "feat(contab): columna clase CD/GG editable en Cuentas por tipo"
```

---

### Task 8: Frontend — bloque "Resultado de obra" en EconomicoTab

**Files:**
- Modify: `apps/frontend/src/components/proyectos/tabs/EconomicoTab.tsx`

**Interfaces:**
- Consumes: `api.proyectos.getCostosObra(proyectoId)` (Task 5).

- [ ] **Step 1: Query** (con las otras queries del tab):
```ts
  const costosQ = useQuery({ queryKey: ['costos-obra', proyectoId], queryFn: () => api.proyectos.getCostosObra(proyectoId) });
```

- [ ] **Step 2: Bloque de reporte** (agregar una sección; `fmtPEN` o el formateador que use el tab):
```tsx
      {costosQ.data && (
        <div className="rounded-lg border border-line bg-bg-elev p-4 space-y-1.5">
          <h3 className="text-[13px] font-semibold mb-1">Resultado de obra (sin gastos de oficina)</h3>
          <Row t="Valorización reconocida" m={costosQ.data.valorizacion} />
          <Row t="(−) Costo Directo ejecutado" m={-costosQ.data.cd.ejecutado} sub={costosQ.data.cd.presupuesto ? `presup. ${fmtPEN(costosQ.data.cd.presupuesto)}` : undefined} />
          <Row t="(−) Gasto General de Obra ejecutado" m={-costosQ.data.ggObra.ejecutado} sub={costosQ.data.ggObra.separable && costosQ.data.ggObra.presupuesto != null ? `presup. ${fmtPEN(costosQ.data.ggObra.presupuesto)}` : 'GG embebido en CD'} />
          <Row t="Resultado de obra" m={costosQ.data.resultadoObra} bold />
          {costosQ.data.compartidosSinDistribuir > 0 && (
            <p className="text-[10.5px] text-amber-600 pt-1">Incluye {fmtPEN(costosQ.data.compartidosSinDistribuir)} de costos compartidos aún sin distribuir entre obras.</p>
          )}
        </div>
      )}
```
Definir un mini-componente `Row` local si no existe (t: string, m: number, bold?, sub?) que muestre label izquierda + monto derecha con `fmtPEN`. Reusar el patrón de filas que ya tenga el tab.

- [ ] **Step 3: Verificar tsc + navegador**
```bash
cd /c/Users/gabri/Desktop/erp-mmhighmetrik-v2/apps/frontend && npx tsc --noEmit; echo "EXIT: $?"
```
Expected: EXIT 0. Luego abrir `http://localhost:5173/proyectos/<id-PG0001>/financiero` y confirmar que el bloque muestra Valorización − CD − GG = Resultado.

- [ ] **Step 4: Commit**
```bash
git add apps/frontend/src/components/proyectos/tabs/EconomicoTab.tsx && git commit -m "feat(obra): bloque Resultado de obra (valorizacion - CD - GG_OBRA)"
```

---

### Task 9: Form de gasto global (Finanzas) — destino proyecto/corporativo

**Files:**
- Modify: `apps/frontend/src/pages/FinanzasPage.tsx` (el form de gasto global — buscar el componente que usa `api.finanzas` para `POST /gastos` con proyecto opcional)

**Interfaces:**
- Consumes: `GastoInput.destino/clasificacion` (Task 5).

- [ ] **Step 1: Localizar el form global de gasto** (busca `tipoGasto` / creación de gasto sin proyectoId fijo en FinanzasPage.tsx). Si NO existe un form global (los gastos siempre se crean desde el tab de proyecto), **saltar esta tarea** y anotar que los gastos corporativos se cargan marcando destino en el mismo form — en ese caso agregar el toggle destino al GastoForm de Task 6.

- [ ] **Step 2: Toggle destino** (si el form global existe): un selector `Proyecto | Oficina / Administración`. Si `Oficina` → ocultar el selector de obra y el de CD/GG, fijar `destino:'corporativo'` (el backend pone GG_CORP). Si `Proyecto` → mostrar obra + los 2 botones CD/GG_OBRA de Task 6.

- [ ] **Step 3: Verificar tsc + commit** (igual patrón que tareas anteriores).

---

## Self-Review

- **Spec coverage:** §1 modelo → Task 1 (enums). §2 registro/form → Tasks 6, 9. §3 config sugerencia → Tasks 2, 7. §4 campos gasto → Task 1. §5 backfill → Task 1 Step 3. §6 presupuesto/ggUtModo → Task 4 (respeta ggUtModo). §7 reportes obra + resultado → Tasks 4, 8. §7 reporte empresa + reconciliación contable → **NO cubierto en este plan** (fase 2 · requiere cruzar con el Estado de Resultados ya construido; sale como plan aparte). §8 futuro prorrateo → `prorrateable` flag (Task 1), sin lógica.
- **Gap consciente:** el reporte **nivel empresa (Σ resultados − GG_CORP) y la reconciliación con el ER contable** quedan como fase 2 — un plan separado, porque tocan el módulo de contabilidad (EE.FF) y no bloquean el núcleo obra. Anotado.
- **Placeholder scan:** sin TBD/TODO; cada step tiene código o comando real.
- **Type consistency:** `clasificacion`/`destino`/`clasificacionOrigen`/`clase` con los mismos literales en schema, zod, api.ts y componentes. `CostosObra` con el shape que devuelve Task 4.
