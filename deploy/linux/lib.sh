# QuoteFlow 部署脚本共用的函数（install.sh、backup.sh、run.sh 用 source 引入），不单独执行。

# 按 systemd EnvironmentFile 的规则读配置并导出：KEY=值，值可加单 / 双引号，# 或 ; 开头是注释；不经过 shell 展开
qf_load_env() {
  local file=$1 line key value
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    line=${line#"${line%%[![:space:]]*}"}
    case "$line" in '' | '#'* | ';'*) continue ;; esac
    key=${line%%=*}
    value=${line#*=}
    if ! [[ $key =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      echo "$file: bad line: $line" >&2
      return 1
    fi
    if [[ $value =~ ^\"(.*)\"$ || $value =~ ^\'(.*)\'$ ]]; then value=${BASH_REMATCH[1]}; fi
    export "$key=$value"
  done <"$file"
}

# pg_dump 的位置：Ubuntu / Debian 在 PATH 里，RHEL 系的 PGDG 包装在 /usr/pgsql-15/bin
qf_pg_dump() {
  command -v pg_dump || echo /usr/pgsql-15/bin/pg_dump
}
