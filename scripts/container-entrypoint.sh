#!/bin/sh
set -eu

AUTH_DIR="${WA_WEB_AUTH_DIR:-/data/wwebjs-auth}"
case "$AUTH_DIR" in
  /data/*) ;;
  *) echo "WA_WEB_AUTH_DIR debe estar dentro de /data en producción." >&2; exit 1 ;;
esac

mkdir -p "$AUTH_DIR" /tmp/.chromium
chown -R webworker:webworker "$AUTH_DIR" /tmp/.chromium
exec gosu webworker "$@"
