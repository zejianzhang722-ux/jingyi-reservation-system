#!/bin/sh
set -eu

compose_file="${COMPOSE_FILE:-deploy/docker-compose.production.yml}"
active_file="${ACTIVE_UPSTREAM_FILE:-deploy/nginx/active-upstream.conf}"
state_dir="${RELEASE_STATE_DIR:-deploy/state}"
state_file="$state_dir/release-state.env"
lock_dir="${RELEASE_LOCK_DIR:-/tmp/jingyi-release.lock}"

if ! mkdir "$lock_dir" 2>/dev/null; then
  echo "Another deployment is already running" >&2
  exit 75
fi
cleanup() { rmdir "$lock_dir" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

for name in API_IMAGE ADMIN_IMAGE RELEASE_TAG RELEASE_ID GIT_SHA; do
  eval "value=\${$name-}"
  if [ -z "${value:-}" ]; then
    echo "$name is required" >&2
    exit 64
  fi
done

active_slot=$(sed -n 's/.*server api-\(blue\|green\):3000.*/\1/p' "$active_file" | head -n 1)
case "$active_slot" in
  blue) target_slot=green ;;
  green) target_slot=blue ;;
  *) echo "Cannot determine active slot" >&2; exit 65 ;;
esac

active_service="api-$active_slot"
target_service="api-$target_slot"
mkdir -p "$state_dir"
previous_release="unknown"
if [ -r "$state_file" ]; then
  previous_release=$(sed -n 's/^CURRENT_RELEASE=//p' "$state_file" | head -n 1)
fi

printf 'Deploying release %s to inactive slot %s\n' "$RELEASE_ID" "$target_slot"
docker compose -f "$compose_file" pull "$target_service" admin
docker compose -f "$compose_file" up -d mysql redis admin gateway

COMPOSE_FILE="$compose_file" ACTIVE_UPSTREAM_FILE="$active_file" \
  sh deploy/scripts/release-gate.sh

docker compose -f "$compose_file" up -d --no-deps --force-recreate "$target_service"
COMPOSE_FILE="$compose_file" sh deploy/scripts/wait-ready.sh "$target_service" 240

version_payload=$(docker compose -f "$compose_file" exec -T "$target_service" \
  curl --fail --silent http://127.0.0.1:3000/api/v1/ops/version)
printf '%s' "$version_payload" | grep -F "$GIT_SHA" >/dev/null || {
  echo "Target slot does not report expected GIT_SHA" >&2
  exit 70
}

upstream_tmp=$(mktemp)
printf 'upstream jingyi_api {\n  least_conn;\n  server api-%s:3000 max_fails=3 fail_timeout=10s;\n  keepalive 32;\n}\n' "$target_slot" > "$upstream_tmp"
cat "$upstream_tmp" > "$active_file"
rm -f "$upstream_tmp"

docker compose -f "$compose_file" exec -T gateway nginx -t
docker compose -f "$compose_file" exec -T gateway nginx -s reload

docker compose -f "$compose_file" up -d --no-deps --force-recreate scheduler

cat > "$state_file" <<EOF
CURRENT_SLOT=$target_slot
CURRENT_RELEASE=$RELEASE_ID
CURRENT_GIT_SHA=$GIT_SHA
PREVIOUS_SLOT=$active_slot
PREVIOUS_RELEASE=$previous_release
UPDATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
chmod 0600 "$state_file"

sleep 5
COMPOSE_FILE="$compose_file" sh deploy/scripts/wait-ready.sh "$target_service" 60
printf 'Release %s is active on slot %s; previous slot %s remains available for rollback\n' \
  "$RELEASE_ID" "$target_slot" "$active_slot"
