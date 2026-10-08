FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ pkg-config libxml2-dev \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm run setup:pdf

COPY . .

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=4173 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends libxml2 \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data \
  && chown node:node /data

COPY --from=build --chown=node:node /app /app

USER node

EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('node:http').get('http://127.0.0.1:' + process.env.PORT + '/healthz', (response) => { response.resume(); process.exit(response.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1))"

CMD ["node", "server.cjs"]
