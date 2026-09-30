# ==============================================================================
# SynapseJS Production Dockerfile (Multi-stage Bun on Alpine)
# Ultra-lightweight (~90MB), non-root execution, native health check
# ==============================================================================

FROM oven/bun:alpine AS builder
WORKDIR /app

# Install dependencies with lockfile caching
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy application source code
COPY . .

# Run whole-app verification & pre-compile client bundles
RUN bun run build

# ==============================================================================
# Production Runner Stage
# ==============================================================================
FROM oven/bun:alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    SYNAPSE_LOG=json \
    SYNAPSE_ROOT=/app/examples/enterprise-crm

# Copy production artifacts and workspaces from builder
COPY --from=builder /app/.synapse /app/.synapse
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/packages /app/packages
COPY --from=builder /app/examples /app/examples
COPY --from=builder /app/apps /app/apps
COPY --from=builder /app/tsconfig.json /app/tsconfig.json

# Run as non-root user
USER bun

EXPOSE 3000

# Native health check against SynapseJS machine health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/_synapse/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "run", "start"]
