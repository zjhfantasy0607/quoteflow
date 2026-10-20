# 开发隧道容器：本机 socat 通过 `docker exec -i <容器> pipe <主机> <端口>` 把 TCP 流转发到 compose 网络里的服务。
# 用 pipe 脚本包一层，避免本机 socat 的 EXEC 地址里出现需要转义的冒号。
FROM alpine:latest
RUN apk add --no-cache socat \
 && printf '#!/bin/sh\nexec socat STDIO "TCP:$1:$2"\n' > /usr/local/bin/pipe \
 && chmod +x /usr/local/bin/pipe
CMD ["sleep", "infinity"]
