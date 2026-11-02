#!/usr/bin/env bash
# QuoteFlow 备份（不使用 Docker，docs/交付/部署手册-不使用Docker.md §9）：pg_dump 导出数据库，复制上传文件目录，
# 删除超过保留天数的旧备份。用 root 执行（cron 见 quoteflow-backup.cron）：
#
#   bash /opt/quoteflow/current/deploy/backup.sh [输出目录，默认 /var/backups/quoteflow] [保留天数，默认 30]
#
# 输出 <输出目录>/quoteflow-<时间>/：quoteflow.dump（pg_restore 恢复）、storage/（上传文件）。
# 与 Docker 部署的 scripts/backup.sh 格式相同，两种部署之间可以互相恢复。
set -euo pipefail
umask 077

# shellcheck source=lib.sh
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"
ENV_FILE=${QF_ENV_FILE:-/etc/quoteflow/quoteflow.env}
OUT_ROOT=${1:-/var/backups/quoteflow}
KEEP_DAYS=${2:-30}

fail() {
  echo "backup: $*" >&2
  exit 1
}
[ -r "$ENV_FILE" ] || fail "cannot read $ENV_FILE (run as root)"
qf_load_env "$ENV_FILE"
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL not found in $ENV_FILE"
STORAGE_DIR=${STORAGE_DIR:-/var/lib/quoteflow/storage}
PG_DUMP=$(qf_pg_dump)
[ -x "$PG_DUMP" ] || fail "pg_dump not found (install the PostgreSQL 15 client)"

OUT=$OUT_ROOT/quoteflow-$(date +%Y%m%d-%H%M%S)
mkdir -p "$OUT"
echo "backup: database → $OUT/quoteflow.dump"
# libpq 不认识 Prisma 连接串里的 ?schema= 参数
"$PG_DUMP" -Fc -d "${DATABASE_URL%%\?*}" -f "$OUT/quoteflow.dump"
echo "backup: uploads → $OUT/storage"
cp -a "$STORAGE_DIR" "$OUT/storage"
echo "backup: done ($(du -sh "$OUT" | cut -f1))"

# 只删输出目录下一层、名为 quoteflow-<时间> 的旧备份
find "$OUT_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'quoteflow-*' -mtime +"$KEEP_DAYS" -print -exec rm -rf {} + |
  sed 's/^/backup: removed old backup /'
