#!/bin/sh
set -eu

echo "[startup] Applying Prisma migrations..."
node ./node_modules/prisma/build/index.js migrate deploy

exec "$@"
