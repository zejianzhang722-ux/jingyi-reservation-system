#!/bin/sh
set -eu

compose_file="${COMPOSE_FILE:-deploy/docker-compose.production.yml}"
active_file="${ACTIVE_UPSTREAM_FILE:-deploy/nginx/active-upstream.conf}"

for name in API_IMAGE ADMIN_IMAGE RELEASE_TAG RELEASE_ID GIT_SHA; do
  eval "value=\${$name-}"
  if [ -z "${value:-}" ]; then
    echo "$name is required" >&2
    exit 64
  fi
done

if ! docker compose -f "$compose_file" config >/dev/null; then
  echo "Docker Compose configuration is invalid" >&2
  exit 65
fi

active_slot=$(sed -n 's/.*server api-\(blue\|green\):3000.*/\1/p' "$active_file" | head -n 1)
if [ -z "$active_slot" ]; then
  echo "Cannot determine active deployment slot" >&2
  exit 65
fi

active_service="api-$active_slot"
if docker compose -f "$compose_file" ps --status running --services | grep -qx "$active_service"; then
  echo "Creating verified pre-release backup through $active_service"
  docker compose -f "$compose_file" exec -T "$active_service" node scripts/run-backup.js
else
  echo "Active service is not running; refusing migration without pre-release backup" >&2
  exit 69
fi

backup_file=$(docker compose -f "$compose_file" exec -T "$active_service" sh -c \
  'find "$BACKUP_DIR" -maxdepth 1 -type f -name "*.jybak" -printf "%T@ %p\n" | sort -nr | head -n1 | cut -d" " -f2-')
if [ -z "$backup_file" ]; then
  echo "Pre-release backup file was not found" >&2
  exit 70
fi
docker compose -f "$compose_file" exec -T "$active_service" node scripts/verify-backup.js "$backup_file"

echo "Running additive database migrations"
docker compose -f "$compose_file" --profile migration run --rm migrate

echo "Release gate passed for $RELEASE_ID"
