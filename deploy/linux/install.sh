#!/usr/bin/env bash
# QuoteFlow 安装 / 升级（不使用 Docker，docs/交付/部署手册-不使用Docker.md）。解包后用 root 执行包里的这个脚本：
#
#   tar -xzf quoteflow-<版本>.tar.gz
#   sudo bash quoteflow-<版本>/deploy/install.sh              # 首次安装或升级
#   sudo bash quoteflow-<版本>/deploy/install.sh --seed       # 首次安装时一并写入基础数据（只在空库上用一次）
#   sudo bash quoteflow-<版本>/deploy/install.sh --no-backup  # 升级前不导出数据库（不建议）
#
# 步骤：建系统用户和目录 → 复制到 /opt/quoteflow/releases/<版本> → npm ci 安装运行依赖（包里已带 node_modules 时跳过）
# → 升级时先导出一份数据库 → prisma migrate deploy → （--seed）基础数据 → 切换 /opt/quoteflow/current
# → 安装并重启 systemd 服务 quoteflow-api → 检查 /api/health。保留最近 5 个版本，回滚见部署手册 §7。
set -euo pipefail

APP_ROOT=/opt/quoteflow
DATA_DIR=/var/lib/quoteflow
ENV_FILE=/etc/quoteflow/quoteflow.env
BACKUP_DIR=/var/backups/quoteflow
SERVICE=quoteflow-api
APP_USER=quoteflow
KEEP_RELEASES=5

SEED=false
BACKUP=true
for arg in "$@"; do
  case "$arg" in
    --seed) SEED=true ;;
    --no-backup) BACKUP=false ;;
    -h | --help)
      sed -n '2,11p' "$0"
      exit 0
      ;;
    *)
      echo "install: unknown option $arg (see --help)" >&2
      exit 2
      ;;
  esac
done

log() { echo "install: $*"; }
die() {
  echo "install: $*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || die "run as root: sudo bash $0"
# RHEL 系 sudo 的 secure_path 不含 /usr/local/bin（Node.js 按手册装在那里）
export PATH="/usr/local/bin:$PATH"
command -v node >/dev/null || die "node not found: install Node.js 24 first (manual §4.1)"
[ "$(node -p 'process.versions.node.split(".")[0]')" = 24 ] || die "Node.js 24 is required, found $(node -v)"
command -v npm >/dev/null || die "npm not found (it comes with Node.js)"
command -v systemctl >/dev/null || die "systemd is required"

SRC=$(cd "$(dirname "$0")/.." && pwd)
NAME=$(basename "$SRC")
if [ ! -f "$SRC/VERSION" ] || [ ! -f "$SRC/apps/api/dist/main.js" ]; then
  die "$SRC is not a QuoteFlow release package"
fi
# shellcheck source=lib.sh
. "$SRC/deploy/lib.sh"
DEST=$APP_ROOT/releases/$NAME
CURRENT=
[ -L "$APP_ROOT/current" ] && CURRENT=$(readlink -f "$APP_ROOT/current")
if $SEED && [ -n "$CURRENT" ]; then
  die "--seed is only for the first installation (already installed: $(basename "$CURRENT"))"
fi

# ---------- 系统用户、目录、配置 ----------
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin "$APP_USER"
  log "created system user $APP_USER"
fi
install -d -m 755 "$APP_ROOT" "$APP_ROOT/releases"
install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$DATA_DIR"
install -d -m 750 -o root -g "$APP_USER" "$(dirname "$ENV_FILE")"
install -d -m 700 "$BACKUP_DIR"

if [ ! -f "$ENV_FILE" ]; then
  install -m 640 -o root -g "$APP_USER" "$SRC/deploy/quoteflow.env.example" "$ENV_FILE"
  die "created $ENV_FILE from the template: fill in every CHANGE_ME (manual §5), then run this script again"
fi
if grep -v '^[[:space:]]*#' "$ENV_FILE" | grep -q CHANGE_ME; then
  die "$ENV_FILE still contains CHANGE_ME: fill in the real values first (manual §5)"
fi

qf_load_env "$ENV_FILE" || die "fix $ENV_FILE first"
[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL is missing in $ENV_FILE"
STORAGE_DIR=${STORAGE_DIR:-$DATA_DIR/storage}
install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$STORAGE_DIR"

# 以服务用户的身份执行（与 quoteflow-api 服务相同；写入上传目录的文件属主一致）
as_app() { runuser -u "$APP_USER" -- env HOME="$DATA_DIR" PATH="$PATH" "$@"; }

# ---------- 发布文件与运行依赖 ----------
if [ "$SRC" != "$DEST" ]; then
  [ "$DEST" != "$CURRENT" ] || die "$NAME is the running version; build a new package with npm run release"
  log "copying $NAME to $DEST"
  rm -rf "$DEST" "$DEST.tmp"
  cp -a "$SRC" "$DEST.tmp"
  chown -R root:root "$DEST.tmp"
  chmod -R u=rwX,go=rX "$DEST.tmp"
  mv "$DEST.tmp" "$DEST"
fi
cd "$DEST"
if [ -d node_modules ]; then
  log "node_modules already present (offline package), skipping npm ci"
else
  log "installing runtime dependencies: npm ci --omit=dev (also downloads the Prisma schema engine)"
  # 延迟高的网络里 Node 默认每个地址只等 250 ms，npm 下载容易 ETIMEDOUT
  NODE_OPTIONS="--network-family-autoselection-attempt-timeout=5000 ${NODE_OPTIONS:-}" \
    npm ci --omit=dev -w @quoteflow/api --no-audit --no-fund --loglevel=warn
  chmod -R u=rwX,go=rX node_modules
fi
# SELinux（RHEL 系）：cp -a 带过来的是解包目录的安全上下文，按部署手册 §4.4 的规则重新标记，nginx 才能读前端文件
if command -v selinuxenabled >/dev/null && selinuxenabled && command -v restorecon >/dev/null; then
  restorecon -R "$DEST"
fi

# ---------- 数据库 ----------
PG_URL=${DATABASE_URL%%\?*} # libpq 不认识 Prisma 的 ?schema= 参数
if [ -n "$CURRENT" ] && $BACKUP; then
  PG_DUMP=$(qf_pg_dump)
  [ -x "$PG_DUMP" ] || die "pg_dump not found: install the PostgreSQL 15 client, or rerun with --no-backup"
  DUMP=$BACKUP_DIR/pre-upgrade-$(date +%Y%m%d-%H%M%S)-$NAME.dump
  log "backing up the database before migrating → $DUMP"
  (umask 077 && "$PG_DUMP" -Fc -d "$PG_URL" -f "$DUMP")
fi
log "migrating the database: prisma migrate deploy"
(cd "$DEST/apps/api" && as_app node "$DEST/node_modules/prisma/build/index.js" migrate deploy)
if $SEED; then
  log "writing base data: roles, dictionaries, internal accounts, PPL template, materials, suppliers"
  (cd "$DEST/apps/api" && as_app node dist-seed/prisma/seed.js)
fi

# ---------- 切换版本并重启 ----------
ln -sfn "$DEST" "$APP_ROOT/current.new"
mv -Tf "$APP_ROOT/current.new" "$APP_ROOT/current"
install -m 644 "$DEST/deploy/quoteflow-api.service" "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable --quiet "$SERVICE"
systemctl restart "$SERVICE"

HOST=${API_HOST:-127.0.0.1}
[ "$HOST" != 0.0.0.0 ] || HOST=127.0.0.1
HEALTH="http://$HOST:${API_PORT:-3000}/api/health"
healthy=false
for _ in $(seq 1 30); do
  if node -e "fetch('$HEALTH').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"; then
    healthy=true
    break
  fi
  sleep 2
done
if ! $healthy; then
  journalctl -u "$SERVICE" -n 40 --no-pager || true
  echo >&2
  if [ -n "$CURRENT" ]; then
    die "$SERVICE did not become healthy. To roll back: ln -sfn $CURRENT $APP_ROOT/current && systemctl restart $SERVICE"
  fi
  die "$SERVICE did not become healthy; check the log above and $ENV_FILE"
fi
log "$NAME is running ($HEALTH)"

# ---------- 清理旧版本（保留最近 $KEEP_RELEASES 个，正在用的和上一个不删） ----------
mapfile -t releases < <(find "$APP_ROOT/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
for old in "${releases[@]:$KEEP_RELEASES}"; do
  if [ "$old" != "$DEST" ] && [ "$old" != "$CURRENT" ]; then
    rm -rf -- "$old"
    log "removed old release $(basename "$old")"
  fi
done

if [ -z "$CURRENT" ]; then
  log "first installation done. Next: nginx site (manual §6.4), daily backup (§9), then log in and finish §6.5"
elif [ "$CURRENT" != "$DEST" ]; then
  log "upgraded from $(basename "$CURRENT"). Roll back if needed: ln -sfn $CURRENT $APP_ROOT/current && systemctl restart $SERVICE"
fi
