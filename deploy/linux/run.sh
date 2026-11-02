#!/usr/bin/env bash
# 以 quoteflow-api 服务的身份执行一条维护命令：quoteflow 用户、/etc/quoteflow/quoteflow.env 里的配置、工作目录 apps/api。
# 用 root 执行（docs/交付/部署手册-不使用Docker.md §10），例如：
#
#   sudo bash /opt/quoteflow/current/deploy/run.sh node ../../node_modules/prisma/build/index.js migrate status
#   sudo bash /opt/quoteflow/current/deploy/run.sh env NODE_ENV=development JOBS_ENABLED=false node dist-seed/prisma/seed-demo.js
#
# 第二条是演示数据（D1–D8 与 60 张历史询价），只用于演示环境，正式环境不要执行。
set -euo pipefail

DEPLOY_DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$DEPLOY_DIR/lib.sh"

if [ "$(id -u)" -ne 0 ]; then
  echo "run: run as root: sudo bash $0 <command>" >&2
  exit 1
fi
if [ $# -eq 0 ]; then
  sed -n '2,8p' "$0"
  exit 2
fi
# RHEL 系 sudo 的 secure_path 不含 /usr/local/bin（Node.js 按手册装在那里）
export PATH="/usr/local/bin:$PATH"
qf_load_env /etc/quoteflow/quoteflow.env
cd "$DEPLOY_DIR/../apps/api"
exec runuser -u quoteflow -- env HOME=/var/lib/quoteflow PATH="$PATH" "$@"
