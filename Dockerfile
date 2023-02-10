FROM node:18-alpine AS base

FROM base AS pruner
# Prepare work directory
WORKDIR /app

# Prepare pnpm https://pnpm.io/installation#using-corepack
RUN corepack enable && \
    corepack prepare --activate pnpm@latest

# Prepare deps
RUN apk add --no-cache libc6-compat
RUN apk update
RUN apk add git --no-cache
RUN npm install -g turbo



# Prepare build deps ( ignore postinstall scripts for now )
COPY . .
RUN turbo prune --scope=@vucod/server --docker

FROM base AS builder

WORKDIR /app


# Prepare pnpm https://pnpm.io/installation#using-corepack
RUN corepack enable && \
    corepack prepare --activate pnpm@latest

# Prepare deps
RUN apk add --no-cache libc6-compat
RUN apk update
RUN apk add git --no-cache
RUN npm install -g turbo


# First install the dependencies (as they change less often)
COPY .gitignore .gitignore
COPY tsconfig.json tsconfig.json
COPY .npmrc .npmrc
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-*.yaml ./
RUN rm -rf ./apps/node_modules

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm install

# Build the project
COPY --from=pruner /app/out/full/ ./
COPY turbo.json turbo.json
COPY tsconfig.json tsconfig.json
RUN pnpm turbo run build --filter=@vucod/server...


FROM base AS runner

# ENV NODE_ENV=production

WORKDIR /app

RUN addgroup --system --gid 1001 server
RUN adduser --system --uid 1001 server
RUN chown -R server:server /app

COPY --from=builder --chown=server:server /app/ ./
# RUN chmod 777 ./apps/server/schema.graphql
USER server


EXPOSE 3001/tcp

ENV PORT=3001

CMD ["node", "apps/server/dist/index.js"]