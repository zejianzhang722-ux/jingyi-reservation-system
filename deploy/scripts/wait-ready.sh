#!/bin/sh
set -eu

service="${1:?service name is required}"
timeout_seconds="${2:-180}"
compose_file="${COMPOSE_FILE:-deploy/docker-compose.production.yml}"
started=$(date +%s)

while :; do
  if docker compose -f "$compose_file" exec -T "$service" \
    curl --fail --silent --show-error http://127.0.0.1:3000/api/v1/ops/ready >/dev/null 2>&1; then
    echo "$service is ready"
    exit 0
  fi
  now=$(date +%s)
  if [ $((now - started)) -ge "$timeout_seconds" ]; then
    echo "$service did not become ready within ${timeout_seconds}s" >&2
    docker compose -f "$compose_file" logs --tail=100 "$service" >&2 || true
    exit 1
  fi
  sleep 3
done
