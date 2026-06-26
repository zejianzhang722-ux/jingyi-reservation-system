#!/bin/sh
set -eu

compose_file="${COMPOSE_FILE:-deploy/docker-compose.production.yml}"
active_file="${ACTIVE_UPSTREAM_FILE:-deploy/nginx/active-upstream.conf}"
state_file="${RELEASE_STATE_DIR:-deploy/state}/release-state.env"
lock_dir="${RELEASE_LOCK_DIR:-/tmp/jingyi-release.lock}"

if ! mkdir "$lock_dir" 2>/dev/null; then
  echo "Another deployment or rollback is running" >&2
  exit 75
fi
cleanup() { rmdir "$lock_dir" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

if [ ! -r "$state_file" ]; then
  echo "Release state file is missing" >&2
  exit 66
fi

previous_slot=$(sed -n 's/^PREVIOUS_SLOT=//p' "$state_file" | head -n 1)
previous_release=$(sed -n 's/^PREVIOUS_RELEASE=//p' "$state_file" | head -n 1)
current_slot=$(sed -n 's/^CURRENT_SLOT=//p' "$state_file" | head -n 1)
current_release=$(sed -n 's/^CURRENT_RELEASE=//p' "$state_file" | head -n 1)

case "$previous_slot" in blue|green) ;; *) echo "Previous slot is invalid" >&2; exit 65 ;; esac
previous_service="api-$previous_slot"
COMPOSE_FILE="$compose_file" sh deploy/scripts/wait-ready.sh "$previous_service" 60

upstream_tmp=$(mktemp)
printf 'upstream jingyi_api {\n  least_conn;\n  server api-%s:3000 max_fails=3 fail_timeout=10s;\n  keepalive 32;\n}\n' "$previous_slot" > "$upstream_tmp"
cat "$upstream_tmp" > "$active_file"
rm -f "$upstream_tmp"

docker compose -f "$compose_file" exec -T gateway nginx -t
docker compose -f "$compose_file" exec -T gateway nginx -s reload

cat > "$state_file" <<EOF
CURRENT_SLOT=$previous_slot
CURRENT_RELEASE=$previous_release
CURRENT_GIT_SHA=unknown
PREVIOUS_SLOT=$current_slot
PREVIOUS_RELEASE=$current_release
UPDATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
chmod 0600 "$state_file"

echo "Application traffic rolled back to release $previous_release on slot $previous_slot"
echo "Database migrations were not reversed; releases must remain backward compatible during the rollback window"
