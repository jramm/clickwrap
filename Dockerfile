# clickwrap-server — multi-stage build.
# Final image contains the compiled backend (served on :3000) and the admin-ui
# production build at /app/admin-ui-dist (NOT served by the backend — put it behind
# any static host / reverse proxy, see README "Deployment").

# ---------- backend build ----------
FROM node:26-slim AS backend-build
WORKDIR /app
RUN corepack enable
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
FROM node:26-slim AS adminui-build
WORKDIR /ui
RUN corepack enable
COPY admin-ui/package.json admin-ui/pnpm-lock.yaml admin-ui/pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile
COPY admin-ui/ ./
# VITE_API_URL is baked at build time; override with a build arg when needed.
ARG VITE_API_URL=/
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm build

# ---------- admin-ui reverse proxy (optional target) ----------
# Serves the built admin-ui SPA and proxies the admin-facing backend paths (see
# deploy/nginx/clickwrap-admin.conf). Placed BEFORE the runtime stage so the DEFAULT build target
# stays the backend image (`docker build .` and release.yml are unaffected); build this image
# explicitly with `--target adminui-nginx`.
FROM nginx:1.27-alpine AS adminui-nginx
COPY --from=adminui-build /ui/dist /usr/share/nginx/html
COPY deploy/nginx/clickwrap-admin.conf /etc/nginx/conf.d/default.conf

# ---------- runtime ----------
FROM node:26-slim
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
COPY --from=adminui-build /ui/dist ./admin-ui-dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
