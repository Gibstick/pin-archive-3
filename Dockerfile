# syntax=docker/dockerfile:1.3

FROM node:16-alpine AS build

RUN npm install -g pnpm
RUN apk upgrade --no-cache && apk add --no-cache dumb-init \
    sqlite \
    python3 \
    python2 \
    make \
    g++

WORKDIR /build

COPY pnpm-lock.yaml ./
RUN pnpm fetch

COPY package.json ./
RUN pnpm install --offline

COPY tsconfig.json ./
COPY src ./src/

RUN pnpm run build

FROM node:16-alpine AS runner

RUN npm install -g pnpm
RUN apk upgrade --no-cache && apk add --no-cache dumb-init \
    sqlite \
    python3 \
    python2 \
    make \
    g++

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /build/dist ./dist

COPY migrations ./migrations/

EXPOSE 3000
RUN mkdir /app/db && chown node:node /app/db
USER node
ENV NODE_ENV=production

VOLUME /app/db
ENV PIN_ARCHIVE_DB=/app/db/pin-archive-3.sqlite3

CMD ["dumb-init", "node", "./dist/main.js"]
