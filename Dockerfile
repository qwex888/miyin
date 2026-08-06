FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim
WORKDIR /app
ENV HOST=0.0.0.0 PORT=3000 NODE_ENV=production
RUN corepack enable
COPY --from=build /app/.output ./.output
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
RUN mkdir -p /data /downloads
VOLUME ["/data", "/downloads"]
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
