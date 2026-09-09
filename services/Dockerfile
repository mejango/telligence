FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS dependencies
WORKDIR /app/services
COPY services/package.json services/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS runtime
ENV NODE_ENV=production
WORKDIR /app/services
COPY --from=dependencies /app/services/node_modules ./node_modules
COPY --chown=node:node services ./
COPY --chown=node:node packages /app/packages
ARG SERVICE=gateway
ENV TELLIGENCE_SERVICE=${SERVICE}
USER node
EXPOSE 8080
CMD ["sh", "-c", "exec node \"${TELLIGENCE_SERVICE}/server.mjs\""]
