FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS dependencies
WORKDIR /app/services
COPY services/package.json services/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS runtime
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
