# QuoteFlow API 镜像（M17 §2.2）。一般通过 docker/compose.staging.yml 构建；单独构建时在仓库根目录执行：
#   docker build -f docker/api.Dockerfile --build-context npm-seed=docker/.npm-seed -t quoteflow-api .
# 依赖一律在镜像里 npm ci：开发机是 Windows，本机 node_modules 里的原生二进制（Prisma 引擎等）不能用（根目录 .dockerignore）。
#
# 阶段：
#   build    全量依赖 + 构建 shared 与 api；同时作为一次性工具镜像（基础数据、演示数据，见 compose.staging.yml 的 api-tools）
#   prod-deps 只装生产依赖（含 Prisma CLI，启动时要执行 migrate deploy）
#   runtime  运行镜像：生产依赖 + 构建产物 + 迁移文件，非 root 用户运行
#
# 构建上下文 npm-seed（docker/.npm-seed）：可选的 npm 缓存种子。执行过 scripts/docker-npm-seed.mjs 时里面是本机缓存里的
# 全部 tarball，npm ci 基本不用联网；没执行过就是空目录，照常从 npm 仓库下载。各阶段共用 npm 缓存（cache mount），
# 下载超时失败后重新构建会接着用已下载的包

FROM node:24-alpine AS base
# Prisma 的 schema 引擎需要 OpenSSL
RUN apk add --no-cache openssl
WORKDIR /app
# Node 的 happy eyeballs 默认每个地址只等 250 ms：延迟高的网络里 npm 下载、Prisma 引擎下载、SMTP 连接都会 ETIMEDOUT
ENV NODE_OPTIONS=--network-family-autoselection-attempt-timeout=5000 \
    PRISMA_HIDE_UPDATE_MESSAGE=true \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NPM_CONFIG_FETCH_RETRIES=10 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=180000 \
    NPM_CONFIG_FETCH_TIMEOUT=600000 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma/schema.prisma apps/api/prisma/

# ---------- 全量依赖与构建 ----------
FROM base AS build
# 只装 api 与 shared 的依赖；api 的 postinstall 会执行 prisma generate（只需要 schema）
RUN --mount=type=bind,from=npm-seed,target=/npm-seed \
    --mount=type=cache,target=/root/.npm \
    if [ -d /npm-seed/_cacache ]; then cp -rn /npm-seed/_cacache /root/.npm/; fi \
 && npm ci --prefer-offline -w @quoteflow/api -w @quoteflow/shared
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
# 演示数据脚本也预先编译（工具容器以 node 用户运行，不能再往镜像里写文件）
RUN npm run build -w @quoteflow/shared \
 && npm run build -w @quoteflow/api \
 && cd apps/api && npx tsc -p tsconfig.seed.json

# ---------- 生产依赖 ----------
FROM base AS prod-deps
RUN --mount=type=bind,from=npm-seed,target=/npm-seed \
    --mount=type=cache,target=/root/.npm \
    if [ -d /npm-seed/_cacache ]; then cp -rn /npm-seed/_cacache /root/.npm/; fi \
 && npm ci --prefer-offline --omit=dev -w @quoteflow/api \
 && mkdir -p apps/api/node_modules packages/shared/node_modules

# ---------- 运行 ----------
FROM base AS runtime
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3000 \
    STORAGE_DIR=/app/storage
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/apps/api/node_modules apps/api/node_modules
COPY --from=prod-deps /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY apps/api/prisma/migrations apps/api/prisma/migrations
COPY --from=build /app/apps/api/dist apps/api/dist
RUN mkdir -p /app/storage && chown -R node:node /app/storage
USER node
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# 先把数据库迁移到最新（已是最新时什么都不做），再启动
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/main.js"]
