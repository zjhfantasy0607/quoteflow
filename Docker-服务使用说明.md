# Docker 开发服务

本机使用标准 Docker 客户端管理服务端的 Linux 容器。当前默认 context 为 `physical-host`，连接 `tcp://docker.home.arpa:2376`，采用双向 TLS 证书认证。

## 常用命令

```bash
docker context show
docker version
docker ps -a
docker images
docker compose version
docker buildx version
docker run --rm --pull=never alpine:latest echo hello-from-claude
```

普通用户 yu 可直接使用，无需 sudo。已安装 Docker CLI 26.0.0、Compose 2.26.1、Buildx 0.13.1；服务端为 Docker Desktop 4.29.0 / Engine 26.0.0 / Linux containers。需要显式选择服务时使用 `docker --context physical-host ...`。

容器、镜像、卷和网络操作直接作用于服务端。可以使用 build、exec、logs、cp 和 Compose；仅操作当前任务的资源，避免清理无关项目。

## 文件和端口

- `docker build .` / Compose build 会上传本机构建上下文，Dockerfile COPY 可读取其中的源文件。
- `docker cp 本机文件 容器:/路径` 和反向复制均可使用。
- bind mount 的源路径由服务端解释。`-v /home/yu/project:/app` 和 Compose 的 `.:/app` 不会自动传输本机目录；按需使用 build COPY、docker cp、命名卷或服务端实际可共享的目录。
- `-p 8080:80` 将端口发布到服务端。本机 localhost 与服务端 localhost 各自独立；需要从本机浏览器访问应用时，应配置对应的服务入口。容器内服务可先通过 docker exec 调用。
- 镜像拉取、构建联网命令和容器联网均使用服务端网络，与本机网络策略分别管理。

## 接入和凭据

服务端需要保持 Docker Desktop 和 Docker 接入程序运行。轻量接入程序已设置随服务端用户登录启动，断开后自动重连。服务端在接入程序所在目录执行：

```powershell
.\Start-Claude-Docker.ps1
.\Stop-Claude-Docker.ps1
```

Stop 停止接入，服务端已有容器继续运行。登录启动项名为 Claude-Docker-Access.lnk。

本机证书位于 `~/.config/docker-host/`，Docker context 另存有证书副本。目录权限 700、私钥 600。请勿展示、提交或分享私钥。证书有效期 825 天，到期前由服务维护端更新证书及 context。

## 已验证

已核对客户端连接的 Engine ID；以下测试均通过：容器运行和日志、stdin EOF 后输出、交互终端、256 KiB 双向文件复制哈希、logs/events 实时流取消、本机构建上下文上传、Compose 命名卷和隔离网络。

仅使用已有 Alpine 镜像，测试创建的容器、标签镜像、卷和网络均已清理。有效客户端证书可访问服务；缺少证书、不信任服务端证书、明文连接均被拒绝。停止 Docker 接入后，ComfyUI 文件服务和本机原有上网仍正常；恢复接入后 Docker 可用。

使用说明在 `~/docker-host/README.md` 和桌面 `Docker-服务使用说明.md`。测试结果统一保存在桌面 `~/Desktop/Docker测试结果/`。

[Docker 远程认证](https://docs.docker.com/engine/security/protect-access/) · [远程 bind mount 语义](https://docs.docker.com/engine/storage/bind-mounts/)
