# Worker image: BullMQ processors + health engine + the upstream simulator.
#
# Built from the repository root (the build context must be the repo root, not apps/worker) —
# the worker depends on two workspace packages, and pnpm needs the whole workspace to resolve
# `workspace:*` links.
#
#   docker build -f apps/worker/Dockerfile -t pulse-worker .

# ── Stage 1: install everything, generate the Prisma client, compile TypeScript ──
FROM node:22-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

# Manifests first so the dependency layer is cached independently of source changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/db/package.json      packages/db/package.json
COPY packages/shared/package.json  packages/shared/package.json
COPY apps/worker/package.json      apps/worker/package.json
COPY apps/web/package.json         apps/web/package.json

# --ignore-scripts: @prisma/client's own postinstall runs `prisma generate`, which needs the
# schema file — that is copied in the next step, so generation is done explicitly below instead.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY packages ./packages
COPY apps/worker ./apps/worker

RUN pnpm --filter @pulse/db generate

# The workspace packages must be compiled, not just the worker. Their `exports` resolve to
# `dist/*.js` for the `default` condition precisely so this image can run plain `node
# dist/index.js`; without these two builds the container starts and immediately dies with
# ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING, because Node will not strip types from a `.ts`
# file inside node_modules.
RUN pnpm --filter @pulse/shared build
RUN pnpm --filter @pulse/db build
RUN pnpm --filter @pulse/worker build

# Drop dev dependencies from the tree that gets copied forward.
RUN pnpm --filter @pulse/worker --prod deploy /prune

# Regenerate the Prisma client *inside* the pruned tree. The earlier `@pulse/db generate` wrote
# into /app's node_modules, and `pnpm deploy` builds /prune a fresh copy from the store, so the
# generated client does not come along — the container would boot, migrate, and then die with
# "@prisma/client did not initialize yet. Please run prisma generate".
#
# The schema is copied into /prune first and generated from there: Prisma resolves its output
# directory relative to the schema file, so pointing `--schema` back at /app regenerates into
# /app's node_modules and leaves /prune untouched — the same failure, silently.
RUN cp -r /app/packages/db/prisma /prune/prisma \
 && cd /prune \
 && ./node_modules/.bin/prisma generate --schema ./prisma/schema.prisma

# ── Stage 2: runtime ────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# The runtime starts with `node` and invokes the bundled Prisma CLI for Railway's release
# migration. npm, npx, Corepack, and pnpm are build-time tools only; leaving them in the image
# needlessly expands the vulnerability scan (and the production attack surface).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/pnpm /usr/local/bin/pnpx

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /prune/node_modules ./node_modules
COPY --from=build /app/apps/worker/dist ./dist
COPY --from=build /app/apps/worker/package.json ./package.json

# The migration files ship with the image so Railway's pre-deploy command can run migrations
# needing the repository present.
COPY --from=build /app/packages/db/prisma ./prisma

# The simulator's port. The container healthcheck uses the dependency-aware readiness route;
# `/livez` remains available to distinguish a live process from a ready worker.
ENV SIMULATOR_PORT=4001
EXPOSE 4001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||process.env.SIMULATOR_PORT||4001)+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node

# Railway runs migrations in its release phase before this long-lived worker command starts.
CMD ["node", "dist/index.js"]
