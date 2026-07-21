#!/bin/sh
set -eu

node scripts/validate-env.mjs
npx prisma migrate deploy
npm run db:seed
# The web process must remain available if the worker is intentionally stopped
# between scheduled sync windows or needs a supervised restart.
exec npx concurrently --kill-others-on-fail --success all "npm run start" "npm run worker:supervised"
