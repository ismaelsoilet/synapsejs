# ==============================================================================
# SynapseJS Production Dockerfile (Starter Template)
# Ultra-lightweight (~90MB), non-root execution, native health check
# ==============================================================================

FROM oven/bun:alpine AS builder
WORKDIR /app

# Install dependencies with lockfile caching
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy application source code
COPY . .

# Pre-build client bundles and standalone distribution
RUN bun run build:standalone

# ==============================================================================
# Production Runner Stage
# ==============================================================================
FROM oven/bun:alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    SYNAPSE_LOG=json

# Copy standalone distribution and production dependencies from builder
COPY --from=builder /app/.synapse/standalone ./
COPY --from=builder /app/node_modules ./node_modules

USER bun

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/_synapse/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "run", "server.ts"]
