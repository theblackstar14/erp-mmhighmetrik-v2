# ERP MM HIGH METRIK · v2

ERP empresarial para constructora MM HIGH METRIK ENGINEERS S.A.C. (RUC 20610639764).

Stack producción · TypeScript end-to-end · multi-usuario · PostgreSQL · monorepo pnpm.

## Stack

**Frontend**: Vite + React 18 + TypeScript + Tailwind + shadcn/ui + React Router + Zustand + TanStack Query
**Backend**: Node.js 20 + Express + Drizzle ORM + Lucia Auth + Pino
**DB**: PostgreSQL 16 (Docker dev · Neon prod)
**Storage**: NAS Synology DS425+ via WebDAV
**Lint/Format**: Biome (10x más rápido que ESLint+Prettier)

## Estructura

```
erp-mmhighmetrik-v2/
├── apps/
│   ├── backend/              · Express + Drizzle + Lucia
│   └── frontend/             · Vite + React + TS + Tailwind
├── packages/
│   ├── db/                   · Drizzle schema + migrations
│   └── shared/               · Zod schemas compartidos FE+BE
├── docker-compose.yml        · PostgreSQL local
├── pnpm-workspace.yaml
└── biome.json
```

## Setup primera vez

### 1. Prerequisitos

- **Node.js 20+** · https://nodejs.org
- **pnpm 9+** · `npm install -g pnpm`
- **Docker Desktop** · https://docker.com/products/docker-desktop

Verificar:
```cmd
node --version
pnpm --version
docker --version
```

### 2. Instalar dependencias

```cmd
cd erp-mmhighmetrik-v2
pnpm install
```

### 3. Configurar variables entorno

```cmd
copy .env.example .env
notepad .env
```

Completá:
- `NAS_URL` · IP del NAS Synology
- `NAS_USER`, `NAS_PASS` · credenciales NAS
- `SESSION_SECRET` · cambia por string aleatorio 32+ chars
- `ANTHROPIC_API_KEY` · opcional · solo si usás IA parser

### 4. Levantar PostgreSQL

```cmd
pnpm docker:up
```

Espera 5 segundos para que Postgres arranque.

### 5. Aplicar migrations + seed inicial

```cmd
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

= crea tablas + usuario admin (`admin@mmhighmetrik.com` / `admin`).

### 6. Arrancar dev

```cmd
pnpm dev
```

= corre frontend (5173) + backend (3001) en paralelo.

Browser: http://localhost:5173

## Comandos útiles

```cmd
pnpm dev              · arranca frontend + backend
pnpm build            · build prod
pnpm typecheck        · verifica TypeScript todo el monorepo
pnpm lint             · biome check
pnpm format           · biome format

pnpm db:generate      · genera migration desde schema
pnpm db:migrate       · aplica migrations a DB
pnpm db:seed          · datos iniciales (admin user, empresa)
pnpm db:studio        · GUI Drizzle Studio para ver/editar DB

pnpm docker:up        · arranca PostgreSQL
pnpm docker:down      · detiene PostgreSQL
pnpm docker:logs      · ver logs DB
```

## Login inicial

```
Email:    admin@mmhighmetrik.com
Password: admin
```


## Diseño responsive

Breakpoints Tailwind:
- `sm` 640px · mobile horizontal
- `md` 768px · tablet
- `lg` 1024px · laptop
- `xl` 1280px · desktop
- `2xl` 1536px · monitor grande
- `3xl` 1920px · custom · pantalla extra grande
- `4xl` 2560px · custom · 4K

Sidebar comportamiento:
- < 768px → drawer (hamburger menu)
- 768-1280px → colapsado (solo iconos)
- ≥ 1280px → expandido

## Próximos pasos

Día 2-7 · migrar features del v1:
- Tab Resumen con KPIs proyecto
- Tab Partidas con árbol + edit avance
- Tab Cronograma (parser MS Project XML)
- Tab Curva S (EVM)
- Tab Documentos (NAS)
- Tab Valorizaciones (generador + PDF)
- Tab Equipo (profesional + obra)
- Tab Liquidación (Excel del gerente)
- Tab Compras (OC/OS)
- Tab Contractual (FP + adicionales + ampliaciones + garantías)

## Deploy producción

Próximamente:
- Backend → Synology Container Manager (Docker)
- Frontend → Vercel
- DB → Neon serverless o Postgres en Synology

## Troubleshooting

**`pnpm install` falla**
- Verificá Node 20+ y pnpm 9+
- `pnpm store prune` y reintentá

**`pnpm docker:up` falla**
- Docker Desktop no está corriendo
- Puerto 5432 ocupado · cambia en docker-compose.yml

**Migración falla "DATABASE_URL not found"**
- Verificá `.env` existe y tiene `DATABASE_URL`

**Frontend no conecta backend**
- Verificá backend corriendo en 3001 (`pnpm --filter @erp/backend dev`)
- CORS · verificá `CORS_ORIGIN` en `.env`

## Soporte

Issues: GitHub repo
Docs: `docs/` (próximamente)

## Licencia

Propietaria · MM HIGH METRIK ENGINEERS S.A.C.
