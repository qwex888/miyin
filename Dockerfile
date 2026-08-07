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
RUN pnpm build && pnpm prune --prod

# 每架构独立构建，确保 better-sqlite3 原生模块匹配目标平台
FROM node:22-bookworm-slim
WORKDIR /app
ENV HOST=0.0.0.0 \
    PORT=18980 \
    NODE_ENV=production \
    DATA_DIR=/data \
    DOWNLOAD_DIR=/downloads
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/.output ./.output
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
RUN mkdir -p /data /downloads \
  && chown -R node:node /app /data /downloads
USER node
VOLUME ["/data", "/downloads"]
EXPOSE 18980
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||18980)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
