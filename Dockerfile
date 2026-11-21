# syntax=docker/dockerfile:1

# The operator console as an image. Two stages, like the server's:
#
#   build    installs the workspace from the public npm registry, with no token, adds the game
#            plugins CONSOLE_PLUGINS names, if any, builds the plugin contract the console depends
#            on, then `next build` with `output: "standalone"` (next.config.ts), which emits a
#            self-contained server under apps/admin/.next/standalone.
#   runtime  carries that standalone server and the static assets, nothing else: no source, no
#            dev dependencies, no pnpm, no token. `node apps/admin/server.js` as the `node` user.
#
# The container takes no configuration: the console holds no server-side state, the operator's
# wallet lives in the browser, and the servers it manages are entered at runtime (README,
# "Deploying the console"). PORT is the one knob, 3100 by default.
#
#   docker build -t beacon-admin .
#   docker run --rm -p 3100:3100 beacon-admin
#
# With game plugins (apps/admin/README.md, "Game plugins"):
#
#   docker build --build-arg CONSOLE_PLUGINS="@example/beacon-admin-plugin@^1.2.0" -t beacon-admin .
#
# A plugin from a registry other than public npm needs that registry's config: mount an npm user
# config that maps the plugin's scope to its registry, with the token, as the optional BuildKit
# secret `npmrc` (`--secret id=npmrc,src=$HOME/.npmrc`). The secret never lands in a layer.

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build

# pnpm at the version the repo declares (package.json > packageManager).
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /repo

# Manifests and the lockfile first, so the dependency layer caches across source edits.
COPY pnpm-workspace.yaml pnpm-lock.yaml .npmrc package.json turbo.json ./
COPY packages/ ./packages/
COPY apps/admin/ ./apps/admin/

# The whole workspace against the frozen lockfile, from public npm. The npm config secret is
# optional, and no Beacon package needs it.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
  --mount=type=secret,id=npmrc,target=/root/.npmrc,required=false \
  pnpm install --frozen-lockfile

# The game plugins this build carries (apps/admin/README.md, "Game plugins"); none by default.
# Declared after the install so a change here reuses the layer above. A plugin from another
# registry reads that registry's config from the optional `npmrc` secret.
COPY scripts/check-contract-copies.mjs ./scripts/
ARG CONSOLE_PLUGINS=""
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
  --mount=type=secret,id=npmrc,target=/root/.npmrc,required=false \
  node apps/admin/scripts/add-plugins.mjs $CONSOLE_PLUGINS

ENV NEXT_TELEMETRY_DISABLED=1
ENV TURBO_TELEMETRY_DISABLED=1

# The plugin contract first (the console depends on its dist), then the console.
RUN pnpm exec turbo run build --filter=@beaconsgg/admin...

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3100
ENV HOSTNAME=0.0.0.0

WORKDIR /app

# The standalone output is rooted at the repository (next.config.ts > outputFileTracingRoot), so
# the server lives at apps/admin/server.js and its traced node_modules beside it. Next does not
# copy the static assets into it; they go where the server expects them.
COPY --from=build --chown=node:node /repo/apps/admin/.next/standalone /app
COPY --from=build --chown=node:node /repo/apps/admin/.next/static /app/apps/admin/.next/static
# Apache-2.0 asks that the license and the NOTICE go with every copy, the image included.
COPY --chown=node:node LICENSE NOTICE /app/

USER node

EXPOSE 3100

CMD ["node", "apps/admin/server.js"]
