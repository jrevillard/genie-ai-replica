#!/bin/sh
set -e

URL="$1"
echo "Waiting for $URL ..."

until curl -fsS "$URL" >/dev/null; do
  sleep 2
done

echo "$URL is available"
exec "${@:2}"