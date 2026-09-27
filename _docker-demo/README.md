# ERP MM High Metrik · paquete Docker

Sistema completo (backend + frontend) con la base **`erp_mmh_test`** ya cargada, más el mockup HTML de la reestructuración de Finanzas.

| Incluye | Dónde |
|---|---|
| App (API + frontend compilado, un solo puerto) | imagen `erp-demo:latest`, se construye con `Dockerfile` |
| Postgres 18 con la data de `erp_mmh_test` (Fase 1 de finanzas aplicada) | `db-init/01-restore.sql` (se restaura sola la primera vez) |
| Mockup de la reestructuración de Finanzas | `mockup/finanzas-reestructurado.html` |

> ⚠️ La base contiene **datos reales de la empresa** (gastos, proveedores, obras). No subir este paquete a repositorios públicos ni compartirlo fuera del equipo.

---

## 1. Requisitos (solo la primera vez)

1. **Docker Desktop** instalado y abierto (la ballena en verde): https://www.docker.com/products/docker-desktop/
2. **Internet** la primera vez (descarga Node, Postgres y librerías). Luego funciona sin internet.
3. Unos **4 GB libres** en disco.

## 2. Levantar el sistema

1. Copia la carpeta completa del proyecto (`erp-mmhighmetrik-v2`) a la PC. El `Dockerfile` construye desde la raíz, no basta con `_docker-demo`.
2. Entra a la subcarpeta `_docker-demo`.
3. Copia `.env.example` y renómbralo a `.env`. No hace falta editarlo para arrancar.
4. Abre una terminal (PowerShell, CMD o Terminal de Mac) **dentro de `_docker-demo`** y ejecuta:

   ```bash
   docker compose up -d --build
   ```

   La primera vez tarda entre 5 y 15 minutos (instala dependencias, compila el frontend y restaura la base).

5. Comprueba que ambos contenedores estén arriba:

   ```bash
   docker compose ps
   ```

   `erp-demo-db` debe decir **healthy** y `erp-demo-app` **running**.

6. Abre **http://localhost:3001** e ingresa con:

   - Usuario: `admin@mmhighmetrik.com`
   - Clave: `admin`

## 3. Ver el mockup de Finanzas

Abre `mockup/finanzas-reestructurado.html` con doble clic (Chrome, Edge o Firefox). No necesita Docker ni servidor. Con internet carga las fuentes Inter/JetBrains Mono; sin internet usa las del sistema.

## 4. Modo desarrollo (opcional)

Frontend Vite con recarga en caliente y API aparte (puertos 5173 y 3001). Usa **un modo a la vez**: ambos comparten la misma base.

```bash
docker compose down
docker compose -f docker-compose.dev.yml up -d --build
# abrir http://localhost:5173
```

## 5. Comandos útiles (dentro de `_docker-demo`)

| Acción | Comando |
|---|---|
| Ver estado | `docker compose ps` |
| Ver logs de la app | `docker compose logs -f app` |
| Apagar (conserva la data) | `docker compose down` |
| Volver a prender | `docker compose up -d` |
| Apagar y **borrar la data** (vuelve a restaurar desde cero al subir) | `docker compose down -v` |
| Consola SQL | `docker compose exec db psql -U erp -d erp_mmh_test` |

## 6. Problemas frecuentes

- **`Cannot connect to the Docker daemon`**: Docker Desktop no está abierto. Ábrelo y reintenta.
- **Puerto 3001 ocupado** (`port is already allocated`): levanta en otro puerto con la variable `APP_PORT` y entra a http://localhost:8080.

  PowerShell:
  ```powershell
  $env:APP_PORT=8080; docker compose up -d --build
  ```
  CMD:
  ```bat
  set APP_PORT=8080 && docker compose up -d --build
  ```
  Mac / Linux:
  ```bash
  APP_PORT=8080 docker compose up -d --build
  ```
- **El login se queda girando o la página no carga**: recarga forzada (`Ctrl+Shift+R` en Windows, `Cmd+Shift+R` en Mac) o ventana de incógnito. El navegador guarda en caché una versión anterior de la app.
- **`relation "users" does not exist` o no deja entrar**: la base arrancó vacía. Reinicio limpio:

  ```bash
  docker compose down -v
  docker compose up -d --build
  ```

- **`ECONNREFUSED 127.0.0.1:5432` en los logs**: se coló un `.env` de desarrollo en la imagen. Verifica que `.env` esté listado en `.dockerignore` de la raíz y repite el reinicio limpio.
- **Ya tenías una demo anterior**: esta versión usa el volumen `erp-mmh-test-data`, distinto del antiguo `erp-demo-data`, así que no se mezclan. Para liberar espacio: `docker volume rm erp-demo-data`.

## 7. Notas

- Las llaves de IA (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`) en `.env` son **opcionales**: solo sirven para leer PDFs nuevos en vivo. Todo lo demás funciona sin ellas.
- El NAS de documentos no está disponible fuera de la red de la empresa; los valores del `.env.example` son de relleno.
- Versión del código: commit `563587b` (rama `feat/rbac-multiempresa`). Finanzas incluye la Fase 0 completa (catálogos SUNAT, tasas de detracción, PCGE 2010, tipo de cambio manual, lector de XML de comprobantes) y el inicio de la Fase 1: tablas de líneas de compra, detracción por documento, cuentas por pagar/cobrar con pagos aplicados (Tasks 1 y 2). Las pantallas nuevas del mockup todavía no están en el sistema; el mockup se ve aparte (punto 3).

## 8. Regenerar el paquete (para quien mantiene el sistema)

Desde la raíz del repo, con Postgres local:

```bash
"C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -U postgres -d erp_mmh_test --no-owner --no-privileges -f _docker-demo/db-init/01-restore.sql
cp docs/mockups/finanzas-reestructurado.html _docker-demo/mockup/
```

Luego, dentro de `_docker-demo`: `docker compose down -v && docker compose up -d --build` para probar desde cero.
