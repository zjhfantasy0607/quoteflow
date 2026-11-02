# QuoteFlow 前端镜像（M17 §2.2）：构建静态文件，nginx 托管并把 /api 反代到 api 服务（docker/nginx.conf）。
# 一般通过 docker/compose.staging.yml 构建；单独构建时在仓库根目录执行：
#   docker build -f docker/web.Dockerfile --build-context npm-seed=docker/.npm-seed -t quoteflow-web .
# 构建上下文 npm-seed 的说明见 api.Dockerfile

FROM node:24-alpine AS build
WORKDIR /app
# Node 的 happy eyeballs 默认每个地址只等 250 ms，延迟高的网络里 npm 下载会 ETIMEDOUT（见 api.Dockerfile）
ENV NODE_OPTIONS=--network-family-autoselection-attempt-timeout=5000 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=true \
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
COPY apps/api/package.json apps/api/
# 只装前端需要的依赖（前端直接编译 shared 源码），跳过 api 的 prisma generate
RUN --mount=type=bind,from=npm-seed,target=/npm-seed \
    --mount=type=cache,target=/root/.npm \
    if [ -d /npm-seed/_cacache ]; then cp -rn /npm-seed/_cacache /root/.npm/; fi \
 && npm ci --prefer-offline -w @quoteflow/web -w @quoteflow/shared --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @quoteflow/web

FROM nginx:stable-alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
