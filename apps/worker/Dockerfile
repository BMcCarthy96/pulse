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
RUN pnpm --filter @pulse/worker build

# Drop dev dependencies from the tree that gets copied forward.
RUN pnpm --filter @pulse/worker --prod deploy /prune

# ── Stage 2: runtime ────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /prune/node_modules ./node_modules
COPY --from=build /app/apps/worker/dist ./dist
COPY --from=build /app/apps/worker/package.json ./package.json

# The migration files ship with the image so `prisma migrate deploy` can run at boot without
# needing the repository present.
COPY --from=build /app/packages/db/prisma ./prisma

# The simulator's port. It is also the container healthcheck target — the simulator only starts
# listening once the worker has connected to Postgres and Redis, which makes it a genuine
# readiness signal rather than a liveness formality.
ENV SIMULATOR_PORT=4001
EXPOSE 4001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SIMULATOR_PORT||4001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node

# Migrations run as part of boot rather than as a separate release step: the worker is the only
# service that owns the schema, and a web deploy that races ahead of a migration is exactly the
# failure this project is supposed to be able to talk about.
CMD ["sh", "-c", "npx prisma migrate deploy --schema ./prisma/schema.prisma && node dist/index.js"]
