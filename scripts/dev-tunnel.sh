#!/usr/bin/env bash
# 本机 127.0.0.1 端口 → 远程 Docker 上的开发依赖。
# 走 docker exec 隧道（Docker API 的 TLS 连接），服务端不需要开放任何端口。
#
#   127.0.0.1:15432 → postgres:5432
#   127.0.0.1:11025 → mailpit:1025   SMTP
#   127.0.0.1:18025 → mailpit:8025   Mailpit Web UI
#
# 用法：scripts/dev-tunnel.sh        前台运行，Ctrl+C 结束
# 前提：本机有 socat；已执行 docker compose -f docker/compose.dev.yml up -d --build
set -euo pipefail

CONTAINER="${TUNNEL_CONTAINER:-quoteflow-dev-tunnel-1}"

command -v socat >/dev/null || { echo "缺少 socat" >&2; exit 1; }
if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" != "true" ]; then
  echo "隧道容器 $CONTAINER 未运行，先执行：docker compose -f docker/compose.dev.yml up -d --build" >&2
  exit 1
fi

forward() { # <本机端口> <容器内主机名> <容器内端口>
  socat "TCP-LISTEN:$1,bind=127.0.0.1,reuseaddr,fork" "EXEC:docker exec -i $CONTAINER pipe $2 $3" &
}

trap 'kill $(jobs -p) 2>/dev/null || true' EXIT INT TERM

forward 15432 postgres 5432
forward 11025 mailpit 1025
forward 18025 mailpit 8025

echo "隧道已建立：PostgreSQL 127.0.0.1:15432 | SMTP 127.0.0.1:11025 | Mailpit http://127.0.0.1:18025"
wait
