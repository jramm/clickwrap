# clickwrap-server — multi-stage build producing THREE images:
#
#   --target backend    API + hosted acceptance page only.
#   --target admin-ui   nginx serving the admin SPA + reverse-proxying /api to a SEPARATE backend
#                       (upstream configurable at runtime via CLICKWRAP_BACKEND). SPA built with
#                       VITE_API_URL=/api, VITE_BASE=/.
#   --target combined   backend AND the admin SPA in one container — the backend serves the SPA
#                       under /ui (ServeStaticModule, SERVE_ADMIN_UI=true) and redirects / → /ui.
#                       SPA built with VITE_API_URL=/, VITE_BASE=/ui/.
#
# `combined` is the LAST stage, so a plain `docker build .` (and docker-compose's default) build it.
# release.yml builds all three explicitly by target with the matching build args.

# ---------- backend build ----------
FROM node:26-slim AS backend-build
WORKDIR /app
# Node 26 no longer bundles corepack, so install pnpm directly (lockfileVersion 9.0).
RUN npm install -g pnpm@11.10.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# `pnpm install` runs the postinstall hook (prisma generate), which needs prisma/ and
# prisma.config.ts present — hence they are copied before install.
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build && test -f dist/main.js

# ---------- admin-ui build ----------
# VITE_API_URL + VITE_BASE are baked at build time. Defaults target the `combined` image (the
# default build); the `admin-ui` image overrides them (VITE_API_URL=/api, VITE_BASE=/).
FROM node:26-slim AS adminui-build
WORKDIR /ui
RUN npm install -g pnpm@11.10.0
COPY admin-ui/package.json admin-ui/pnpm-lock.yaml admin-ui/pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile
COPY admin-ui/ ./
ARG VITE_API_URL=/
ARG VITE_BASE=/ui/
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_BASE=$VITE_BASE
RUN pnpm build

# ---------- image: admin-ui (nginx + SPA, proxies /api to a separate backend) ----------
# Build: --target admin-ui --build-arg VITE_API_URL=/api --build-arg VITE_BASE=/
# The upstream backend is set at runtime via CLICKWRAP_BACKEND; the nginx official image runs
# envsubst on /etc/nginx/templates/*.template at startup. NGINX_ENVSUBST_FILTER limits substitution
# to CLICKWRAP_* so nginx's own $host/$uri/... are left intact.
FROM nginx:1.27-alpine AS admin-ui
ENV CLICKWRAP_BACKEND=http://backend:3000
ENV NGINX_ENVSUBST_FILTER=CLICKWRAP_
COPY --from=adminui-build /ui/dist /usr/share/nginx/html
COPY deploy/nginx/clickwrap-admin.conf.template /etc/nginx/templates/default.conf.template

# ---------- image: backend (API + hosted acceptance page only) ----------
FROM node:26-slim AS backend
WORKDIR /app
ENV NODE_ENV=production
# Prisma engines need OpenSSL at runtime.
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
# Full node_modules from the build stage (includes the generated Prisma client).
# Trade-off: contains dev dependencies — robust with pnpm's symlink layout; slim it
# later with `pnpm deploy --prod` once the image size matters.
COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
COPY --from=backend-build /app/prisma ./prisma
# prisma.config.ts holds the Prisma 7 datasource URL (from DATABASE_URL) used by the CLI — needed
# so the image can run `prisma db push` itself (docker-compose `migrate` service, k8s pre-deploy Job).
COPY prisma.config.ts ./
COPY package.json ./
COPY openapi.admin.json openapi.integration.json ./
# Legal-entities config — reconciled at boot (LEGAL_ENTITIES_CONFIG overrides the path).
COPY config ./config
# Drop-in plugins: mount a volume of plugin subdirs at /app/plugins and they are auto-loaded at
# boot (each subdir = a package.json with a "clickwrap" manifest + compiled entry). No rebuild.
ENV CLICKWRAP_PLUGIN_DIR=/app/plugins
EXPOSE 3000
CMD ["node", "dist/main.js"]

# ---------- image: combined (backend + admin SPA under /ui, one container) ----------
# Build: --target combined --build-arg VITE_API_URL=/ --build-arg VITE_BASE=/ui/
FROM backend AS combined
# The SPA build (base=/ui) is served by the backend under /ui via ServeStaticModule; a bare / → /ui.
COPY --from=adminui-build /ui/dist ./admin-ui-dist
ENV SERVE_ADMIN_UI=true
EXPOSE 3000
CMD ["node", "dist/main.js"]
