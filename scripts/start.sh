#!/bin/sh
set -eu

node scripts/validate-env.mjs
npx prisma migrate deploy
npm run db:seed
exec npx concurrently --kill-others --success first "npm run start" "npm run worker"
