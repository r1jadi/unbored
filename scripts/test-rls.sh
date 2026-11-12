#!/usr/bin/env bash
#
# Applies the Supabase stub, every migration, the seed and the RLS test suite to
# a throwaway Postgres database.
#
#   ./scripts/test-rls.sh                       # ephemeral Docker container
#   DATABASE_URL=postgres://... ./scripts/test-rls.sh   # an existing database
#
# With DATABASE_URL the database must be empty and disposable: the suite runs the
# migrations and the fixture transaction (which rolls back).
#
# Never point DATABASE_URL at a hosted Supabase project. tests/security/rls_test.sql
# refuses to run where the `supabase_admin` role exists.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Unique per run, so two concurrent runs (or a leftover container) cannot
# collide on the name and fail the suite for the wrong reason.
CONTAINER_NAME="unbored-rls-test-$$"
PG_IMAGE="postgres:16-alpine"
PG_PASSWORD="rls-test-password"
PG_DATABASE="unbored_rls_test"

log() { printf '\n\033[1m%s\033[0m\n' "$*"; }

run_file() {
  local file="$1"
  echo "  → $(basename "$file")"
  if [[ -n "${DATABASE_URL:-}" ]]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$file"
  else
    docker exec -i "$CONTAINER_NAME" psql -U postgres -d "$PG_DATABASE" -v ON_ERROR_STOP=1 -q <"$file"
  fi
}

cleanup() {
  if [[ -z "${DATABASE_URL:-}" ]]; then
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ -z "${DATABASE_URL:-}" ]]; then
  command -v docker >/dev/null 2>&1 || {
    echo "docker is required when DATABASE_URL is not set" >&2
    exit 1
  }
  log "Starting $PG_IMAGE as $CONTAINER_NAME"
  docker run --rm -d \
    --name "$CONTAINER_NAME" \
    -e POSTGRES_PASSWORD="$PG_PASSWORD" \
    -e POSTGRES_DB="$PG_DATABASE" \
    -e POSTGRES_INITDB_ARGS="--encoding=UTF8" \
    "$PG_IMAGE" >/dev/null

  echo "  waiting for Postgres to accept connections"
  for _ in $(seq 1 60); do
    if docker exec "$CONTAINER_NAME" pg_isready -U postgres -d "$PG_DATABASE" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null)" != "true" ]]; then
    echo "the Postgres container is not running" >&2
    docker logs "$CONTAINER_NAME" >&2 || true
    exit 1
  fi
  docker exec "$CONTAINER_NAME" pg_isready -U postgres -d "$PG_DATABASE" >/dev/null 2>&1 || {
    echo "Postgres did not become ready" >&2
    docker logs "$CONTAINER_NAME" >&2 || true
    exit 1
  }
else
  command -v psql >/dev/null 2>&1 || {
    echo "psql is required when DATABASE_URL is set" >&2
    exit 1
  }
  log "Using \$DATABASE_URL"
fi

log "Applying Supabase-compatible stub"
run_file "$ROOT_DIR/tests/security/supabase_stub.sql"

log "Applying migrations"
for migration in "$ROOT_DIR"/supabase/migrations/*.sql; do
  run_file "$migration"
done

if [[ -f "$ROOT_DIR/supabase/seed.sql" ]]; then
  log "Applying seed"
  run_file "$ROOT_DIR/supabase/seed.sql"
fi

log "Running RLS and authorization suite"
run_file "$ROOT_DIR/tests/security/rls_test.sql"

# The verifiers are SQL copies of each game's rules; these are the engines' own
# results, which the database must reproduce (src/test/verifier-vectors.test.ts
# checks the same rows against the engines).
log "Checking the game verifiers against the engines' vectors"
run_file "$ROOT_DIR/tests/security/verifier_vectors.sql"
run_file "$ROOT_DIR/tests/security/platform_features_test.sql"
run_file "$ROOT_DIR/tests/security/streaks_test.sql"
run_file "$ROOT_DIR/tests/security/engagement_test.sql"
run_file "$ROOT_DIR/tests/security/content_filter_test.sql"
run_file "$ROOT_DIR/tests/security/avatar_screening_test.sql"

log "Database security suite passed."
