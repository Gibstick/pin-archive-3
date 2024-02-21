# syntax=docker/dockerfile:1.3

FROM node:16-bookworm-slim AS base

WORKDIR /build

# install pnpm
RUN corepack enable

RUN apt-get update && apt-get install -y dumb-init \
    sqlite3 \
    python3 \
    make \
    g++

##########

FROM base AS build

COPY pnpm-lock.yaml package.json tsconfig.json ./
COPY src ./src/

RUN pnpm fetch
RUN pnpm install --offline
RUN pnpm run build

##########

FROM base AS runner

COPY --from=build /build/dist ./dist

COPY package.json pnpm-lock.yaml ./
COPY migrations ./migrations/

RUN pnpm install --frozen-lockfile --prod

RUN mkdir -p /app/db && chown node:node /app/db

USER node

ENV PIN_ARCHIVE_DB=/app/db/pin-archive-3.sqlite3
ENV NODE_ENV=production

VOLUME /app/db

CMD ["dumb-init", "node", "./dist/main.js"]