# 部署手册（不使用 Docker）

适用于不能使用 Docker 的服务器：在 Linux 上直接安装 Node.js、PostgreSQL 和 nginx，API 由 systemd 管理。代码、数据库结构和备份格式都与[部署手册](部署手册.md)（Docker）相同，两种部署之间可以用备份互相迁移。

本文命令以 Ubuntu 24.04 为例。2026-11-02 在一台全新的 Ubuntu 24.04 上按本文从头做过一遍：安装、HTTP 与 HTTPS 访问、上传文件、备份（含 cron）与恢复、升级与回滚、服务器重启后自动恢复，全部正常。RHEL 系（Rocky Linux、AlmaLinux、openEuler、麒麟服务器版等）的差异见 §4.4，这一节按官方文档整理，没有实测。Windows Server 不在本文范围。

## 1. 组成与目录

| 组件 | 说明 |
|---|---|
| nginx | 托管前端静态文件，`/api` 反代到本机的 API，负责 HTTPS；上传上限 60 MB |
| quoteflow-api | systemd 服务：Node.js 24，以 `quoteflow` 用户运行，只监听 `127.0.0.1:3000`。定时任务（发邮件、截止、催报、清理）在进程内运行，**只能起一个实例** |
| PostgreSQL 15 | 数据库，可以和 API 装在同一台，也可以单独一台 |
| 邮件服务 | 公司现有的 SMTP 服务，不随系统安装 |

| 路径 | 内容 |
|---|---|
| `/opt/quoteflow/releases/<版本>/` | 每个版本一个目录：代码、运行依赖、前端文件、部署脚本，属主 root |
| `/opt/quoteflow/current` | 指向正在运行的版本；升级、回滚就是切换它 |
| `/etc/quoteflow/quoteflow.env` | 配置（含密码和密钥），`root:quoteflow`，权限 640 |
| `/var/lib/quoteflow/storage/` | 上传文件，属主 quoteflow |
| `/var/backups/quoteflow/` | 备份，只有 root 能读 |
| 日志 | `journalctl -u quoteflow-api`；nginx 的日志在 `/var/log/nginx/` |

## 2. 服务器要求

- 64 位 Linux（x86_64 或 aarch64），glibc 2.28 及以上（Node.js 24 的要求，CentOS 7 不满足），使用 systemd。
- 2 核 4 GB 起；磁盘按上传文件量预留（规格书单个最大 50 MB），数据库和上传文件最好放在单独的数据盘上。
- 安装和升级时要能访问 npm 仓库、Prisma 引擎下载地址（`binaries.prisma.sh`）以及 Node.js、PostgreSQL 的下载源，都可以换成国内镜像（§6.1）；完全不能上网的服务器见 §8。
- 对外只开放 80、443 端口；3000（API）和 5432（数据库）只在本机使用。
- 服务器时间必须准确（`timedatectl` 显示 `System clock synchronized: yes`）：报价截止、催报、开标都按服务器时间判断。

## 3. 准备发布包（在开发机上）

在仓库根目录执行（开发环境已经 `npm install` 过；Windows 也可以）：

```bash
npm run release
```

生成 `release/quoteflow-<版本>-<日期>-<时分>-<提交>.tar.gz`，大约 2 MB。包里有编译好的 API、基础数据和演示数据脚本、前端静态文件、数据库迁移文件和 `deploy/` 下的部署文件（§11），不含 `node_modules`：运行依赖在服务器上安装，Prisma 引擎按服务器平台下载。工作区有未提交的改动时，包名末尾带 `-dirty`，正式交付前先提交再打包。

把包拷到服务器上，例如 `scp release/quoteflow-*.tar.gz 用户@服务器:~/`。

## 4. 安装运行环境（每台服务器一次）

用有 sudo 权限的账号执行。

### 4.1 Node.js 24

用官方二进制包装到 `/opt/node`，版本与开发环境一致：

```bash
sudo apt-get update && sudo apt-get install -y curl ca-certificates xz-utils
NODE_VERSION=24.22.1
ARCH=x64                          # aarch64 服务器改成 arm64
cd /tmp
curl -fsSLO https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$ARCH.tar.xz
curl -fsSLO https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt
grep " node-v$NODE_VERSION-linux-$ARCH.tar.xz\$" SHASUMS256.txt | sha256sum -c -
sudo mkdir -p /opt/node
sudo tar -xJf node-v$NODE_VERSION-linux-$ARCH.tar.xz -C /opt/node --strip-components=1
sudo ln -sf /opt/node/bin/node /opt/node/bin/npm /opt/node/bin/npx /usr/local/bin/
node -v                           # v24.22.1
```

nodejs.org 慢时，把两个下载地址里的 `https://nodejs.org/dist/` 换成国内镜像 `https://cdn.npmmirror.com/binaries/node/`。以后升级 Node.js 的小版本：换掉 `NODE_VERSION` 重做一遍，再 `sudo systemctl restart quoteflow-api`。

### 4.2 PostgreSQL 15

用 PostgreSQL 官方软件源（PGDG）安装：

```bash
sudo apt-get install -y gnupg
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
. /etc/os-release
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $VERSION_CODENAME-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt-get update
sudo apt-get install -y postgresql-15
sudo systemctl enable --now postgresql
```

建数据库用户和库（密码随机生成，记下来，§5 要用）：

```bash
DB_PASSWORD=$(openssl rand -hex 16)
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE quoteflow LOGIN PASSWORD '$DB_PASSWORD';
CREATE DATABASE quoteflow OWNER quoteflow ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;
SQL
echo "数据库密码：$DB_PASSWORD"
```

数据库装在另一台服务器上时：在那台上同样建用户和库，`postgresql.conf` 的 `listen_addresses` 加上它的内网地址，`pg_hba.conf` 加一行 `host quoteflow quoteflow <应用服务器 IP>/32 scram-sha-256`，防火墙只对应用服务器开放 5432；应用服务器上装 `postgresql-client-15`（备份要用 `pg_dump`）。

### 4.3 nginx

```bash
sudo apt-get install -y nginx
sudo rm -f /etc/nginx/sites-enabled/default
sudo systemctl enable --now nginx
```

开启了 ufw 防火墙的，再执行 `sudo ufw allow 'Nginx Full'`。站点配置在 §6.4。

### 4.4 RHEL 系的差异

Rocky Linux、AlmaLinux、openEuler、麒麟服务器版等用 `dnf`，与上面不同的地方：

- **Node.js**：同 §4.1，第一行换成 `sudo dnf install -y curl xz tar`。
- **PostgreSQL 15**（以 EL9 为例，EL8 把地址里的 `EL-9` 换成 `EL-8`；PGDG 不支持的发行版用系统自带软件源里的 PostgreSQL 15）：

  ```bash
  sudo dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-x86_64/pgdg-redhat-repo-latest.noarch.rpm
  sudo dnf -qy module disable postgresql
  sudo dnf install -y postgresql15-server
  sudo /usr/pgsql-15/bin/postgresql-15-setup initdb
  sudo systemctl enable --now postgresql-15
  ```

  如果 `/var/lib/pgsql/15/data/pg_hba.conf` 里 `127.0.0.1/32` 那一行的认证方式是 `ident`，改成 `scram-sha-256` 后 `sudo systemctl reload postgresql-15`，否则 API 用密码连不上。建库的 SQL 同 §4.2。备份脚本会自动在 `/usr/pgsql-15/bin` 下找 `pg_dump`。
- **nginx**：`sudo dnf install -y nginx && sudo systemctl enable --now nginx`；站点文件同样放在 `/etc/nginx/conf.d/`。
- **SELinux**（默认开启）：允许 nginx 反代到本机端口、读取 `/opt/quoteflow` 下的前端文件（`install.sh` 每次安装后会自动执行 `restorecon`）：

  ```bash
  sudo dnf install -y policycoreutils-python-utils
  sudo setsebool -P httpd_can_network_connect 1
  sudo semanage fcontext -a -t httpd_sys_content_t '/opt/quoteflow(/.*)?'
  ```

- **防火墙**：`sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload`。

## 5. 配置

解包后第一次运行安装脚本：它创建系统用户 `quoteflow` 和各个目录，从模板生成 `/etc/quoteflow/quoteflow.env`，然后停下来等你填写：

```bash
tar -xzf quoteflow-<版本>.tar.gz
sudo bash quoteflow-<版本>/deploy/install.sh
sudo vi /etc/quoteflow/quoteflow.env
```

模板里标了 `CHANGE_ME` 的都要改，有一处没改安装脚本就不会继续：

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | 把 `CHANGE_ME` 换成 §4.2 记下的数据库密码；数据库在别的服务器上时，同时改主机地址 |
| `APP_BASE_URL` | 用户访问系统的地址，例如 `https://quote.example.com`；邮件里的链接以它开头 |
| `COOKIE_SECURE` | 通过 HTTPS 访问时为 `true`（默认）。内网只用 HTTP 试用时改成 `false`，否则浏览器不回传会话 cookie，无法登录 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | 公司的邮件服务；`MAIL_FROM` 要与 SMTP 账号匹配 |
| `EXCEL_SIGNING_SECRET` / `EXCEL_SHEET_PASSWORD` | 锁定报价 Excel 的签名密钥和工作表保护密码，用 `openssl rand -hex 24` 生成。**上线后不要更换**：换了以后，之前下载的报价 Excel 都不能再导入 |
| `STORAGE_DIR` | 上传文件目录，默认 `/var/lib/quoteflow/storage`。改到别的位置时，还要用 `sudo systemctl edit quoteflow-api` 加上 `[Service]` 和 `ReadWritePaths=<新目录>`（服务只允许写这个目录） |
| 其他 | `API_HOST=127.0.0.1`、`API_PORT=3000`、`TRUST_PROXY=loopback`（信任本机 nginx 转发的客户端 IP，登录限流和操作日志按真实 IP 记录）、`JOBS_ENABLED=true`，一般不用改 |

格式与 systemd 的 EnvironmentFile 相同：每行 `KEY=值`；值里有空格时整体加双引号；密码里有 `$`、`\`、引号等特殊字符时整体用单引号括起来。以后改了配置，执行 `sudo systemctl restart quoteflow-api` 生效。

## 6. 首次安装

### 6.1 安装并启动 API

```bash
sudo bash quoteflow-<版本>/deploy/install.sh --seed
```

脚本依次：把发布包复制到 `/opt/quoteflow/releases/<版本>` → 安装运行依赖（`npm ci --omit=dev`，同时下载与服务器平台匹配的 Prisma 引擎）→ 迁移数据库 → 写入基础数据 → 让 `/opt/quoteflow/current` 指向这个版本 → 安装并启动 systemd 服务 `quoteflow-api`（开机自启）→ 检查 `/api/health`。网络正常时约 1 分钟，最后显示 `is running` 和 `first installation done`。

`--seed` 写入的基础数据包括：角色、数据字典、内部账号、PPL 模板、材料分类与材料、供应商与门户账号。演示账号的密码都是 `Passw0rd!`，见 §6.5。基础数据只在首次安装时写一次，升级时脚本不接受 `--seed`。

npm 仓库或 Prisma 引擎下载慢时改用国内镜像：

```bash
sudo npm config set registry https://registry.npmmirror.com --location=global
sudo env PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma bash quoteflow-<版本>/deploy/install.sh --seed
```

### 6.2 检查

```bash
systemctl status quoteflow-api
curl -s http://127.0.0.1:3000/api/health      # {"status":"ok","db":"ok",...}
journalctl -u quoteflow-api -n 50             # 启动失败时看这里，多半是配置写错
```

### 6.3 演示数据（可选，只用于演示环境）

```bash
sudo bash /opt/quoteflow/current/deploy/run.sh env NODE_ENV=development JOBS_ENABLED=false node dist-seed/prisma/seed-demo.js
```

写入 D1–D8 演示场景和 60 张历史询价（与[验收清单](验收清单.md)一致），约 15 秒。只能在刚装好、还没有询价单的库上执行一次。**正式环境不要执行。**

### 6.4 nginx 站点

正式环境用 HTTPS。把证书（含完整证书链）和私钥放到 `/etc/nginx/ssl/quoteflow.crt`、`/etc/nginx/ssl/quoteflow.key`，然后：

```bash
sudo cp /opt/quoteflow/current/deploy/nginx-quoteflow-https.conf /etc/nginx/conf.d/quoteflow.conf
sudo sed -i 's/quote.example.com/实际域名/g' /etc/nginx/conf.d/quoteflow.conf
sudo nginx -t && sudo systemctl reload nginx
```

HTTP 访问会自动跳转到 HTTPS。证书可以用公司现有的证书；有公网域名时也可以用 Let's Encrypt（certbot）。

只在内网用 HTTP 试用时，改用 `nginx-quoteflow-http.conf`，并把配置里的 `COOKIE_SECURE` 改成 `false`、`APP_BASE_URL` 改成 `http://` 开头的地址，再 `sudo systemctl restart quoteflow-api`：

```bash
sudo cp /opt/quoteflow/current/deploy/nginx-quoteflow-http.conf /etc/nginx/conf.d/quoteflow.conf
sudo nginx -t && sudo systemctl reload nginx
```

浏览器打开系统地址，用 `admin` / `Passw0rd!` 登录。

### 6.5 上线前

与 Docker 部署相同（[部署手册](部署手册.md) §8 第 4、7 条）：

- 修改全部演示账号的密码（系统设置 › 用户 › 重置密码），正式环境不执行演示数据。
- 在"系统设置 › 系统参数"填写公司名称、地址、电话（邮件抬头与合同打印版使用），确认密封授权角色和积分规则。
- 换成客户正式的 PPL 模板（[管理员手册](管理员手册.md) §5）。
- 发信域名配置 SPF、DKIM，先给几个内部邮箱发测试邮件。
- 配好每日备份（§9），并把备份目录同步到另一台机器。

## 7. 升级与回滚

在开发机上 `npm run release` 生成新包，拷到服务器后：

```bash
tar -xzf quoteflow-<新版本>.tar.gz
sudo bash quoteflow-<新版本>/deploy/install.sh
```

升级前脚本先把数据库导出到 `/var/backups/quoteflow/pre-upgrade-<时间>-<版本>.dump`，然后迁移数据库、切换版本、重启并检查健康状态，大约 15 秒（加上下载依赖的时间）。重启期间有几秒钟无法访问，安排在非工作时间。版本目录保留最近 5 个。

健康检查不通过时，脚本会显示最近的日志和回滚命令。手动回滚：

```bash
ls -t /opt/quoteflow/releases              # 找到上一个版本
sudo ln -sfn /opt/quoteflow/releases/<上一个版本> /opt/quoteflow/current
sudo systemctl restart quoteflow-api
```

数据库迁移只增不删，回滚后旧版本照常使用升级后的数据库；只有新版本的发布说明特别注明时，才需要恢复升级前导出的数据库。

## 8. 不能访问外网的服务器

找一台能上网、操作系统版本和 CPU 架构都与服务器相同的机器（可以是虚拟机），先装好 Node.js 24（§4.1），然后：

```bash
tar -xzf quoteflow-<版本>.tar.gz
cd quoteflow-<版本>
npm ci --omit=dev -w @quoteflow/api        # 同时下载与这台机器平台匹配的 Prisma 引擎
cd ..
tar -czf quoteflow-<版本>-offline.tar.gz quoteflow-<版本>
```

把 `quoteflow-<版本>-offline.tar.gz` 拷到服务器，解包后照常执行 `install.sh`：发现包里已有 `node_modules` 就不再联网安装。解包出来的目录名不要改，脚本用它作为版本名。Prisma 引擎与系统的 OpenSSL 版本有关，所以准备依赖的机器必须与服务器同一发行版、同一版本。

Node.js 的安装包从能上网的机器下载后拷过去；PostgreSQL 和 nginx 用公司内部的软件源，或者在同版本系统上连同依赖下载安装包（Ubuntu 用 `apt-get download`，RHEL 系用 `dnf download --resolve`）。

## 9. 备份与恢复

每天自动备份（02:30 执行，保留 30 天，日志在 `/var/log/quoteflow-backup.log`）：

```bash
sudo cp /opt/quoteflow/current/deploy/quoteflow-backup.cron /etc/cron.d/quoteflow-backup
```

手动备份：`sudo bash /opt/quoteflow/current/deploy/backup.sh`。每次备份生成 `/var/backups/quoteflow/quoteflow-<时间>/`，里面是 `quoteflow.dump`（数据库，`pg_dump -Fc`）和 `storage/`（上传文件），与 Docker 部署的备份格式相同。备份目录要再复制到另一台机器或对象存储，并每季度做一次恢复演练。

恢复会覆盖现有数据，用 root 执行（先 `sudo -i`）：

```bash
B=/var/backups/quoteflow/quoteflow-20261102-023000        # 要恢复的那一份
bash /opt/quoteflow/current/deploy/backup.sh               # 先把当前状态也备份一份
systemctl stop quoteflow-api
sudo -u postgres pg_restore --clean --if-exists --no-owner --role=quoteflow -d quoteflow < "$B/quoteflow.dump"
mv /var/lib/quoteflow/storage /var/lib/quoteflow/storage.before-restore-$(date +%Y%m%d-%H%M%S)
cp -a "$B/storage" /var/lib/quoteflow/storage
chown -R quoteflow:quoteflow /var/lib/quoteflow/storage
systemctl start quoteflow-api
```

- 数据库在另一台服务器上时，把 `pg_restore` 那一行换成 `pg_restore --clean --if-exists --no-owner -d 'postgresql://quoteflow:密码@数据库地址:5432/quoteflow' < "$B/quoteflow.dump"`。
- 恢复的是旧版本的备份时，在 `systemctl start` 之前先补上迁移：`bash /opt/quoteflow/current/deploy/run.sh node ../../node_modules/prisma/build/index.js migrate deploy`。
- Docker 部署的备份（`scripts/backup.sh` 的输出）也按这个步骤恢复，从 Docker 迁移过来就是"在 Docker 那边备份、在这边恢复"。
- 确认恢复无误后，删除 `storage.before-restore-*` 目录。

## 10. 日常运维

| 操作 | 命令 |
|---|---|
| 状态、重启、停止 | `sudo systemctl status / restart / stop quoteflow-api` |
| 看日志 | `journalctl -u quoteflow-api -f`；nginx：`/var/log/nginx/access.log`、`error.log` |
| 改配置 | 编辑 `/etc/quoteflow/quoteflow.env`，然后 `sudo systemctl restart quoteflow-api` |
| 当前版本 | `cat /opt/quoteflow/current/VERSION` |
| 数据库迁移状态 | `sudo bash /opt/quoteflow/current/deploy/run.sh node ../../node_modules/prisma/build/index.js migrate status` |
| 磁盘占用 | `du -sh /var/lib/quoteflow/storage /var/backups/quoteflow` |
| 服务器重启 | PostgreSQL、nginx、quoteflow-api 都设为开机自启，不用手动启动 |

`run.sh` 以 quoteflow-api 服务的身份执行维护命令：`quoteflow` 用户、配置文件里的环境变量、工作目录 `apps/api`。邮件发送失败、收不到邮件的排查见[管理员手册](管理员手册.md) §6；只能起一个 API 实例，不要为了负载复制服务。

## 11. 部署文件清单

发布包的 `deploy/` 目录（仓库里在 `deploy/linux/`）：

| 文件 | 作用 |
|---|---|
| `install.sh` | 安装与升级（§5–§7）；`--seed` 写基础数据，`--no-backup` 升级前不导出数据库 |
| `backup.sh` | 备份数据库与上传文件，删除超过保留天数的旧备份（§9） |
| `run.sh` | 以服务身份执行维护命令（§6.3、§10） |
| `lib.sh` | 以上三个脚本共用的函数 |
| `quoteflow.env.example` | 配置模板（§5） |
| `quoteflow-api.service` | systemd 服务，由 `install.sh` 安装；本机调整用 `systemctl edit quoteflow-api`，不要直接改 |
| `nginx-quoteflow-https.conf` / `nginx-quoteflow-http.conf` | nginx 站点模板（§6.4） |
| `quoteflow-backup.cron` | 每日备份的 cron（§9） |
