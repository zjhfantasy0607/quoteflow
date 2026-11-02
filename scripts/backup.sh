#!/usr/bin/env bash
# QuoteFlow 备份（M17 §2.2）：数据库用 pg_dump（自定义格式），上传文件整个目录复制出来。
#
#   scripts/backup.sh [compose 项目名，默认 quoteflow-staging] [输出目录，默认 ./backups]
#
# 输出 <输出目录>/<项目名>-<时间>/：quoteflow.dump（pg_restore 恢复）、storage/（上传文件）。
# 恢复步骤见 docs/交付/部署手册.md §6。生产每天执行一次（cron / 任务计划），备份目录另行异地保存
set -euo pipefail

PROJECT="${1:-quoteflow-staging}"
OUT_ROOT="${2:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${OUT_ROOT}/${PROJECT}-${STAMP}"
DB_CONTAINER="${PROJECT}-postgres-1"
API_CONTAINER="${PROJECT}-api-1"

for c in "$DB_CONTAINER" "$API_CONTAINER"; do
  if ! docker inspect "$c" >/dev/null 2>&1; then
    echo "backup: container $c not found (is the $PROJECT stack running?)" >&2
    exit 1
  fi
done

mkdir -p "$OUT"
echo "backup: database → $OUT/quoteflow.dump"
docker exec "$DB_CONTAINER" pg_dump -U quoteflow -d quoteflow -Fc > "$OUT/quoteflow.dump"
echo "backup: uploads → $OUT/storage"
# Git Bash 下关掉路径转换，容器内路径原样传给 docker
MSYS_NO_PATHCONV=1 docker cp "$API_CONTAINER:/app/storage" "$OUT/storage"
echo "backup: done ($(du -sh "$OUT" | cut -f1))"
