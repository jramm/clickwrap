# clickwrap-server — multi-stage build.
# Final image contains the compiled backend (served on :3000) and the admin-ui
# production build at /app/admin-ui-dist (NOT served by the backend — put it behind
# any static host / reverse proxy, see README "Deployment").

# ---------- backend build ----------
FROM node:22-slim AS backend-build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm exec prisma generate \
  && pnpm build \
  && test -f dist/main.js

# ---------- admin-ui build ----------
FROM node:22-slim AS adminui-build
WORKDIR /ui
RUN corepack enable
COPY admin-ui/package.json admin-ui/pnpm-lock.yaml admin-ui/pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile
COPY admin-ui/ ./
# VITE_API_URL is baked at build time; override with a build arg when needed.
ARG VITE_API_URL=/
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm build

# ---------- runtime ----------
FROM node:22-slim
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
COPY package.json ./
COPY openapi.admin.json openapi.integration.json ./
COPY --from=adminui-build /ui/dist ./admin-ui-dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
