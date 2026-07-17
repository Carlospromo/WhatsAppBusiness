#!/bin/sh
set -eu

node scripts/validate-env.mjs
npx prisma migrate deploy
npm run db:seed
exec npm run start
