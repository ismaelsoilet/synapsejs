# ==============================================================================
# SynapseJS Production Dockerfile (Multi-stage Bun on Alpine)
# Non-root execution, a writable working directory, and a runtime layer that holds
# the framework plus the application it serves — not the whole monorepo.
# ==============================================================================

FROM oven/bun:alpine AS builder
WORKDIR /app

# The application served is selectable at build time instead of hardcoded.
ARG SYNAPSE_APP=examples/enterprise-crm

# The manifests first: a frozen install needs every workspace the lockfile names,
# and copying them alone keeps the dependency layer cacheable.
COPY package.json bun.lock ./
COPY packages/synapse/package.json ./packages/synapse/package.json
COPY apps/crm/package.json ./apps/crm/package.json
COPY examples/enterprise-crm/package.json ./examples/enterprise-crm/package.json
COPY examples/helpdesk-slices/package.json ./examples/helpdesk-slices/package.json
COPY examples/helpdesk-conventional/package.json ./examples/helpdesk-conventional/package.json
RUN bun install --frozen-lockfile

# Named paths, never the whole build context: an accidental `COPY . .` drags
# secrets, coverage output and test reports into a layer.
COPY packages ./packages
COPY apps ./apps
COPY examples ./examples
COPY tsconfig.json ./tsconfig.json

# The repository's own verification gates run in CI, not in the image build. The
# runtime compiles a slice's browser bundle on first request, so no build step is
# required here — and none is claimed.

# Stage a pruned framework: the runtime image must not carry the framework's test
# suite. Copying it and deleting it later would leave it in an intermediate layer.
RUN mkdir -p /out/packages/synapse && cp -r /app/packages/synapse/src /app/packages/synapse/bin /app/packages/synapse/package.json /out/packages/synapse/

# ==============================================================================
# Production Runner Stage
# ==============================================================================
FROM oven/bun:alpine AS runner

# The same selection reaches the runner stage.
ARG SYNAPSE_APP=examples/enterprise-crm

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    SYNAPSE_LOG=json \
    SYNAPSE_ROOT=/app/${SYNAPSE_APP}

# Only the framework (source + CLI), the selected application and the dependency
# graph are copied: no test suite, no other applications, no build context.
COPY --from=builder --chown=bun:bun /app/node_modules /app/node_modules
COPY --from=builder --chown=bun:bun /out/packages/synapse /app/packages/synapse
COPY --from=builder --chown=bun:bun /app/${SYNAPSE_APP} /app/${SYNAPSE_APP}
COPY --from=builder --chown=bun:bun /app/package.json /app/package.json

# The working directory belongs to the unprivileged user, so the database and the
# queue store it creates at startup can actually be created.
RUN chown -R bun:bun /app

USER bun

EXPOSE 3000

# Native health check against the machine health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/_synapse/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "run", "start"]
