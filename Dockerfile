FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    WA_WEB_AUTH_DIR=/data/wwebjs-auth \
    XDG_CONFIG_HOME=/tmp/.chromium \
    XDG_CACHE_HOME=/tmp/.chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium ca-certificates dumb-init gosu python3 make g++ \
    fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system webworker \
    && useradd --system --create-home --gid webworker webworker

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build && npm run worker:build \
    && mkdir -p /tmp/.chromium \
    && chown -R webworker:webworker /app /tmp/.chromium
USER webworker
RUN npm run worker:verify

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder --chown=webworker:webworker /app/package.json ./package.json
COPY --from=builder --chown=webworker:webworker /app/node_modules ./node_modules
COPY --from=builder --chown=webworker:webworker /app/.next ./.next
COPY --from=builder --chown=webworker:webworker /app/prisma ./prisma
COPY --from=builder --chown=webworker:webworker /app/scripts ./scripts
COPY --from=builder --chown=webworker:webworker /app/dist ./dist
COPY --from=builder --chown=webworker:webworker /app/lib ./lib
RUN chmod +x ./scripts/start.sh ./scripts/container-entrypoint.sh && mkdir -p /tmp/.chromium /data/wwebjs-auth && chown -R webworker:webworker /tmp/.chromium /data/wwebjs-auth
EXPOSE 3000
ENTRYPOINT ["/usr/bin/dumb-init", "--", "./scripts/container-entrypoint.sh"]
CMD ["./scripts/start.sh"]
