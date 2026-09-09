FROM node:26.5.0-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb AS base

ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--no-experimental-webstorage
WORKDIR /app
RUN npm install --global npm@12.0.1 --no-audit --no-fund

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_BENDYSTRAW_URL
ARG NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL
ARG NEXT_PUBLIC_PARA_API_KEY
ARG NEXT_PUBLIC_PARA_ENV
ARG NEXT_PUBLIC_PARA_ONRAMP_PROVIDER
ARG NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID
ARG NEXT_PUBLIC_TELLIGENCE_FACTORY_ADDRESS
ARG NEXT_PUBLIC_VERSION
ARG RAILWAY_GIT_COMMIT_SHA

ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_BENDYSTRAW_URL=$NEXT_PUBLIC_BENDYSTRAW_URL \
    NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL=$NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL \
    NEXT_PUBLIC_PARA_API_KEY=$NEXT_PUBLIC_PARA_API_KEY \
    NEXT_PUBLIC_PARA_ENV=$NEXT_PUBLIC_PARA_ENV \
    NEXT_PUBLIC_PARA_ONRAMP_PROVIDER=$NEXT_PUBLIC_PARA_ONRAMP_PROVIDER \
    NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=$NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID \
    NEXT_PUBLIC_TELLIGENCE_FACTORY_ADDRESS=$NEXT_PUBLIC_TELLIGENCE_FACTORY_ADDRESS \
    NEXT_PUBLIC_VERSION=${NEXT_PUBLIC_VERSION:-${RAILWAY_GIT_COMMIT_SHA}}

RUN npm run build

FROM base AS runner
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

ARG NEXT_PUBLIC_VERSION
ARG RAILWAY_GIT_COMMIT_SHA
ENV NEXT_PUBLIC_VERSION=${NEXT_PUBLIC_VERSION:-${RAILWAY_GIT_COMMIT_SHA}}

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --home-dir /app nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/scripts/validate-env.mjs ./scripts/validate-env.mjs

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/healthz').then(r=>{if(!r.ok)throw new Error(String(r.status))}).catch(()=>process.exit(1))"]

CMD ["sh", "-c", "export NEXT_PUBLIC_VERSION=\"${NEXT_PUBLIC_VERSION:-$RAILWAY_GIT_COMMIT_SHA}\" && node scripts/validate-env.mjs runtime && exec node server.js"]
