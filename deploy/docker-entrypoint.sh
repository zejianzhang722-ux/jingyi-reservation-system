#!/bin/sh
set -eu

load_secret() {
  name="$1"
  eval "current=\${$name-}"
  eval "file=\${${name}_FILE-}"
  if [ -n "${current:-}" ] && [ -n "${file:-}" ]; then
    echo "Both $name and ${name}_FILE are set" >&2
    exit 64
  fi
  if [ -n "${file:-}" ]; then
    if [ ! -r "$file" ]; then
      echo "Secret file for $name is not readable" >&2
      exit 66
    fi
    value=$(cat "$file")
    export "$name=$value"
    unset "${name}_FILE"
  fi
}

for secret_name in \
  JWT_SECRET MYSQL_PASSWORD REDIS_PASSWORD OPS_MONITOR_TOKEN \
  AUDIT_IP_HASH_SALT BACKUP_ENCRYPTION_KEY WECHAT_APPSECRET; do
  load_secret "$secret_name"
done

umask 077
exec "$@"
