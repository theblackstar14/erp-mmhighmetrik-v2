# ERP MM HIGH METRIK · imagen de DEMO (1 contenedor = backend + frontend compilado)
# Build context = raíz del repo. Backend corre con tsx (sin compilar), sirve el frontend estático.
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
# manifests primero (cache de capas)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
RUN pnpm install --frozen-lockfile
# código + build del frontend
COPY . .
RUN pnpm --filter @erp/frontend build

FROM node:22-bookworm-slim AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production \
    SERVE_STATIC=1 \
    FRONTEND_DIST=/app/apps/frontend/dist \
    PORT=3001
COPY --from=build /app /app
EXPOSE 3001
# corre el backend con tsx (mismo runtime que dev) sirviendo también el frontend
CMD ["pnpm", "--filter", "@erp/backend", "exec", "tsx", "src/server.ts"]
