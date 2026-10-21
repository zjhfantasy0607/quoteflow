# QuoteFlow 询盘报价平台

按《询盘报价平台_需求确认书_30工作日_V2.3》（31 条）定制开发的 B/S 询盘报价系统：采购方门户 + 供应商门户，中英双语。由 Claude Code 按模块开发，不按日历排期，能做多快做多快。

## 文档（规格以 docs/ 为准）

- 开始工作前先读 `docs/进度.md` 顶部的"当前状态（交接）"，确定当前阶段和下一项任务；需要细节再看 `git log`。
- 做一个模块前读：`docs/modules/Mxx-*.md`、`docs/03-接口与编码约定.md`、`docs/05-状态机与权限.md`；涉及表结构读 `docs/02-数据模型.md`，涉及报价读 `docs/04-PPL模板规范.md`。索引在 `docs/README.md`。
- 根目录的 PPT 只是需求来源。其中的 UI 示意图是 AI 生成的，不是界面规格；示意图里有、31 条里没有的功能不做（`docs/00-项目总览.md` §5）。
- 规格有歧义时，按文档写明的默认做法实现，把问题追加到 `docs/待确认事项.md`，并在回复里告诉用户。

## 技术栈（版本已锁定，不升级大版本）

TypeScript 5.9.3 全栈 monorepo，npm workspaces，Node 24：

- `packages/shared`：zod 4.6（`import { z } from 'zod'`，v4 API）+ decimal.js；前后端共享的枚举、错误码、权限码、schema、状态表、PPL 引擎。
- `apps/api`：NestJS 11.2.7 + Prisma 7.10.1（客户端生成到 `src/generated/prisma`，经 `@prisma/adapter-pg` 连库）+ PostgreSQL 15；jest + supertest。
- `apps/web`：Vue 3.5 + Vite 8.3（Rolldown）+ Element Plus 2.14 + Pinia 4 + Vue Router 5.4 + vue-i18n 11 + ECharts 6；vitest 5。

精确版本见 `docs/01-技术架构.md` §1，依赖一律写精确版本。TypeScript 7、NestJS 12、nodemailer 10、Prisma 8 暂不使用（原因见 01 §1）；Prisma CLI 的升级提示忽略。新增依赖前在 `docs/待确认事项.md` 写理由。

## 开发环境

- 依赖跑在本机 Docker，Node 直接跑在本机。不要安装或修改 Docker 本身。
  1. `docker compose -f docker/compose.dev.yml up -d`（PostgreSQL 15、Mailpit，端口只绑定 127.0.0.1）：`127.0.0.1:15432` → PostgreSQL（库/用户 `quoteflow`，密码 `quoteflow_dev`），`127.0.0.1:11025` → SMTP，`http://127.0.0.1:18025` → Mailpit
  2. `cp apps/api/.env.example apps/api/.env` → `npm install` → `npm run db:migrate` → `npm run db:seed` → `npm run dev`（api `:3000`，web `http://127.0.0.1:5173`）
- 报 `P1001` 连不上数据库时先用 `docker compose -f docker/compose.dev.yml ps` 看容器是否在运行。e2e 用 `quoteflow_test` 库（globalSetup 跑 `prisma migrate deploy`，各测试文件自己 TRUNCATE），绝不能连开发库。
- 开发机是 Windows：npm 脚本由 cmd.exe 执行，`package.json` 里不要写 `VAR=x cmd`、`rm -rf`、单引号等 POSIX 写法，需要时写成 Node 脚本（参考 `scripts/check-i18n.mjs`）。装依赖（`npm install`）前先停掉 `npm run dev`，否则 Windows 可能锁住正在使用的原生文件报 `EPERM`。
- 不要自己运行 `npm run db:reset` / `prisma migrate reset`：Prisma 会拦截 AI 代理执行的破坏性命令，必须由用户执行或得到用户明确同意。
- Docker 上只操作 `quoteflow-` 前缀的容器、卷、网络和镜像；禁止 prune，禁止动其他项目的资源。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | shared watch + api + web |
| `npm run verify` | lint + typecheck + check:i18n + test + test:e2e；宣告完成前必须全绿 |
| `npm run test` / `npm run test:e2e` | 单元测试 / e2e（e2e 需要先启动 Docker 依赖） |
| `npm run db:migrate` / `db:reset` / `db:seed` / `db:seed:demo` | 数据库迁移、重置、基础数据、演示数据 |

## 工作方式

1. 按 `docs/进度.md` 的顺序一次做一个模块：shared（类型、schema）→ api（service → controller → e2e）→ web（页面 + 中英文案）→ `npm run verify` → 勾选进度和模块验收项。
2. 模块文档里每条规则（如 R06-3）至少一个测试，用例名引用规则编号。
3. 改了 schema：生成迁移，并在 `docs/02-数据模型.md` §8 记一行。
4. 做完一个模块向用户简短汇报：完成了什么、怎么验证的、有什么遗留。
5. git：到了合适的节点（一个模块或一组独立的改动完成、`npm run verify` 全绿）就自行提交，不用等用户要求；按逻辑拆成独立的提交，提交信息用 `feat(M06): …` 这种格式。push 和改写已有历史仍要先问用户。
6. 每次工作结束（包括中途停下）：更新 `docs/进度.md` 的"当前状态（交接）"（正在做什么、按顺序的下一步、等用户决定的事），在"记录"追加一行（日期、模块、做了什么、怎么验证、提交号；记录所在的提交写"本提交"），然后提交。接手的 agent 只靠这些文件和 git 历史了解进度。

## 硬性规则

- **开标前密封**：轮次未开标时，任何内部用户（包括管理员）通过任何接口、导出、报表、邮件、日志都拿不到报价金额和报价内容，只能看到提交状态和时间；唯一例外是系统参数 `seal.preOpenViewRoles` 里的角色。新接口只要返回报价数据，就必须经过 `SealService`，并加进密封测试集。
- **供应商隔离**：`/api/portal/*` 一律按当前用户的 `supplierId` 过滤，只能访问自己受邀的已发布轮次、自己的报价和议价；供应商访问内部接口一律 403。
- **权限**：每个内部接口声明 `@RequirePermissions(...)`；询价相关查询叠加 `ScopeService` 数据权限，查不到返回 404；敏感字段经 `FieldMaskService` 脱敏。
- **状态流转**：只按 `docs/05-状态机与权限.md` 的表执行；轮次状态只能由 `RoundStateService` 修改；用条件更新防并发；多表写入（含邮件入队、审计）放在同一个事务里。
- **金额与时间**：金额用 Prisma Decimal 或字符串，计算只用 shared 里的 decimal 函数，禁止用 JS number 算金额；取当前时间只用 `ClockService.now()`；数据库存 UTC，界面和邮件按 UTC+8 显示并注明时区。
- **多语言**：前端不准硬编码中英文文案，全部走 vue-i18n，zh-CN 和 en-US 的键必须一致；后端只返回错误码；业务数据按 `nameZh` / `nameEn` 显示。
- **范围**：不做订单、发货、对账、库存、租赁、综合评分、公开招标、电子签、供应商准入/绩效/黑名单、站内信、移动端、ERP 对接。
- 不要修改根目录的 PPT。

## 完成标准

模块验收项全部满足；`npm run verify` 全绿；新错误码有中英翻译并登记在 `docs/03-接口与编码约定.md` §3.1；新文案中英齐全；`docs/进度.md` 已更新；遗留问题写进 `docs/待确认事项.md` 或进度记录。
