# Rewards Agent demo API (spec 07 / RCG-18) — Railway runtime image.
#
# Single long-lived container (ADR 0004: min instances = 1, no scale-to-zero).
# The Hono/TypeScript API runs under `tsx` (no build step) and spawns the Python
# hero bridge as a subprocess. The bridge talks to Postgres via `psql` (there is
# no psycopg in this project), so the image ships both Node and the Postgres
# client, plus the repo files the bridge imports (schema/, tests/integration/,
# fixtures/).
FROM node:22-bookworm-slim

# python3 runs the hero bridge; postgresql-client provides the `psql` the bridge
# and the schema/seed steps shell out to. No pip install: the bridge imports
# only the Python standard library and in-repo modules.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        postgresql-client \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install ONLY the apps/api dependencies. The root package.json is the Next.js
# web app (no workspaces) and is irrelevant to the API; installing it would only
# bloat the image. Copy the manifest + lockfile first so `npm ci` is cached
# until they change.
COPY apps/api/package.json apps/api/package-lock.json apps/api/
RUN npm --prefix apps/api ci

# Copy the rest of the repo. node_modules and caches are excluded via
# .dockerignore, so the freshly installed apps/api/node_modules survives this
# COPY. The Python bridge resolves imports against the repo root, so the full
# tree (schema/, tests/integration/, fixtures/, scripts/) must be present.
COPY . .

# Drop root. The node user (uid 1000) ships in the official Node image.
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV PYTHON_BIN=python3
# API_PORT is set by the platform (Railway service variable). The server falls
# back to 8787 only for local runs; production sets API_PORT=8080.

# Ensure an empty managed database has schema + demo seed before the API accepts
# traffic. The bootstrap is non-destructive: existing complete schemas are left
# in place and the seed load is idempotent.
CMD ["sh", "-c", "python3 scripts/ensure_schema_seed.py --include-demo-persona && npm --prefix apps/api run start"]
