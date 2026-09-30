#!/usr/bin/env bash
#
# SynapseJS - every gate this repository defines, one line each, exit code checked.
#
# Reading a command's output instead of its exit code is how a red lint passed review twice in
# this repository; this script only ever reports `$?`.
#
# Usage:
#   bash scripts/run-gates.sh              # gates that need no external service
#   bash scripts/run-gates.sh --with-docker  # also PostgreSQL parity/adapters and the image
#
# The suite and the drift/coverage gates assume a non-production environment, which is what CI
# uses: NODE_ENV is unset for every gate below.
set -u

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
export ROOT
WITH_DOCKER=0
[ "${1:-}" = "--with-docker" ] && WITH_DOCKER=1

PASSED=0
FAILED=0
FAILED_NAMES=()

run() {
  local name="$1"
  shift
  local slug
  slug="$(echo "$name" | tr ' /:()' '______')"
  local start=$SECONDS

  if env -u NODE_ENV "$@" > "/tmp/gate-$slug.log" 2>&1; then
    printf '%-46s PASS  %ss\n' "$name" "$((SECONDS - start))"
    PASSED=$((PASSED + 1))
  else
    printf '%-46s FAIL  %ss  (/tmp/gate-%s.log)\n' "$name" "$((SECONDS - start))" "$slug"
    FAILED=$((FAILED + 1))
    FAILED_NAMES+=("$name")
  fi
}

echo "== SynapseJS gates =="

run "lint"                         bun run lint
run "framework suite"              bun test packages/synapse/test
run "typecheck (monorepo)"         bun run check
run "starter template as consumer" bun run check:template
run "documentation drift"          bun run docs:check
run "coverage threshold"           bun run coverage:check
run "splitter gates (3 apps)"      bun run split
run "slice oracles (reference app)" bun run test:slices
run "oracles (adoption app)"       bun run test:crm
run "oracles (help-desk slices)"   bun run test:helpdesk
run "oracles (help-desk conventional)" bun run test:helpdesk-conventional
run "live end-to-end"              bun run test:e2e
run "context-surface benchmark"    bun run bench
run "concurrency benchmark"        bun run bench:concurrency
run "repo map drift"               bash -c "bun --cwd examples/enterprise-crm skeleton >/dev/null && git diff --exit-code -- examples/enterprise-crm/.codebase .codebase"
run "publish rehearsal"            bun run rehearse:publish

# Negative cases: the repository's own rule is that nothing may report an empty success.
run "negative: no slices is a failure" bash -c '
  dir="$(mktemp -d)"
  out="$(cd "$dir" && bun run "$ROOT/packages/synapse/bin/synapse.ts" test 2>/dev/null)"
  code=$?
  rm -rf "$dir"
  [ "$code" -ne 0 ] && echo "$out" | grep -q NO_SLICES_DIR
'
run "negative: leaky fixture trips the gate" bash -c '
  bun test packages/synapse/test/slice-splitter.test.ts >/dev/null 2>&1 &&
    bun -e "
      const { splitSlice, verifySplit, writeSplitArtifacts, artifactDirectory } = await import(\"$ROOT/packages/synapse/src/compiler/slice-splitter.ts\");
      const fixtures = \"$ROOT/packages/synapse/test/fixtures\";
      const result = splitSlice(fixtures + \"/slices/reports/leaky-report.slice.tsx\", fixtures);
      if (!result.ok) process.exit(1);
      const outDir = artifactDirectory(fixtures, result.value.sliceName);
      writeSplitArtifacts(result.value, outDir);
      process.exit(verifySplit(result.value, outDir).status === \"FAIL\" ? 0 : 1);
    "
'
run "negative: unknown flag refused" bash -c '
  ! bun run packages/synapse/bin/synapse.ts impact --banana >/dev/null 2>&1
'
run "negative: unknown command refused" bash -c '
  ! bun run packages/synapse/bin/synapse.ts banana >/dev/null 2>&1
'
run "negative: broken config is fatal" bash -c '
  dir="$(mktemp -d)"
  printf "export default { isto nao e typescript" > "$dir/synapse.config.ts"
  bun -e "
    const { loadSynapseConfig } = await import(\"$ROOT/packages/synapse/src/core/config.ts\");
    try { await loadSynapseConfig(\"$dir\"); process.exit(1); } catch { process.exit(0); }
  "
  code=$?
  rm -rf "$dir"
  exit $code
'

if [ "$WITH_DOCKER" = "1" ]; then
  echo "== docker gates =="
  docker rm -f synapse-gates-pg >/dev/null 2>&1
  docker run -d --name synapse-gates-pg -e POSTGRES_USER=pg -e POSTGRES_PASSWORD=pg -e POSTGRES_DB=synapse -p 0:5432 postgres:16-alpine >/dev/null
  for _ in $(seq 1 30); do docker exec synapse-gates-pg pg_isready -U pg -d synapse >/dev/null 2>&1 && break; done

  PG_URL="postgres://pg:pg@localhost:$(docker port synapse-gates-pg 5432 | head -1 | sed 's/.*://')/synapse"

  run "postgres parity (live engine)" env TEST_DATABASE_URL="$PG_URL" bun run test:postgres
  run "postgres adapters (live engine)" env TEST_DATABASE_URL="$PG_URL" bun test packages/synapse/test/postgres-adapters.test.ts
  run "container: build, run, health, SSR" bash -c '
    docker build -q -t synapsejs-gates . >/dev/null &&
      docker rm -f synapse-gates-run >/dev/null 2>&1
      docker run -d --name synapse-gates-run -p 0:3000 -e SYNAPSE_SESSION_SECRET=gate-run-secret-min-32-characters synapsejs-gates >/dev/null &&
      sleep 8 &&
      port="$(docker port synapse-gates-run 3000 | head -1 | sed "s/.*://")" &&
      curl -sf "http://localhost:$port/_synapse/api/health" >/dev/null &&
      curl -sf "http://localhost:$port/customers/create-customer" >/dev/null
  '

  docker rm -f synapse-gates-pg synapse-gates-run >/dev/null 2>&1
fi

echo
if [ "$FAILED" -eq 0 ]; then
  echo "ALL GATES PASS ($PASSED/$PASSED)"
  exit 0
fi

printf 'GATES FAILED: %s\n' "${FAILED_NAMES[*]}"
echo "$PASSED passed, $FAILED failed"
exit 1
