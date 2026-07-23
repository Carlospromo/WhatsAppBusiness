#!/bin/sh
set -eu

node scripts/validate-env.mjs
npx prisma migrate deploy
npm run db:seed
# The web process and the persistent browser worker share this single service.
exec npx concurrently --kill-others-on-fail --success all "npm run start" "npm run worker:supervised"
