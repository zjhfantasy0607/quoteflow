# M05 PPL 模板引擎

> 覆盖：#6（主模板 PPL 70 列、变体不脱离主模板族、锁定 Excel）、#18（字段标签中英对照） | 依赖：M02、M03

## 1. 目标

按 [04-PPL模板规范](../04-PPL模板规范.md) 实现元数据驱动的报价模板：定义校验、变体解析、公式、取值校验、锁定 Excel 的生成与解析、模板集管理，以及材料分类绑定变体。本模块不做报价业务（M09），只提供引擎和管理界面，所以测试用合成的询价行数据。

## 2. 范围

**范围内**

1. shared `src/ppl/`：类型、定义 zod schema、`validateDefinition()`、`resolveColumns()`、`formulas.ts`、`validateQuoteValues()`、`buildDraftDefaults()`、`definitions/v0.ts`（由 `docs/ppl-v0.json` 转成 TS 常量，内容一致）。
2. api `modules/ppl`：模板集查询、创建（校验后保存为新版本，未激活）、激活（互斥）；`resolveVariantForCategory(categoryId)`（沿上级查找，找不到返回 null = 主模板）；`PplExcelService.build()` / `parse()`（04 §7）。
3. 分类绑定变体：M03 的分类接口校验 `pplVariantCode` 必须存在于**当前激活模板集**；分类编辑表单增加"PPL 变体"下拉，并显示"实际生效：XXX（继承自 YYY）"。
4. 前端 `/system/ppl`：模板集列表（版本、标签、激活标识、创建时间）、详情（按分组展示列表格，可切换"主模板 / 各变体"查看实际列，显示类型、来源、必填、标记）、上传新版本（JSON 文件，展示校验错误）、激活。
5. seed：模板集版本 1（激活）。

**范围外**：报价表单组件 `PplForm` / `PplLineTable`（M09）。

## 3. 规则

| 编号 | 规则 |
|---|---|
| R05-1 | 定义校验按 04 §8.1 全部条目执行，失败返回 `PPL_DEFINITION_INVALID` 和逐条问题。 |
| R05-2 | 模板集创建后不可修改，只能新建版本；版本号自增；同一时间只有一个激活版本；激活新版本不影响已发布轮次（冻结在轮次上）。 |
| R05-3 | `resolveColumns()` 保持主模板顺序，排除变体的 `exclude`，把变体的 `required` 合并进去；变体代码不存在返回 `PPL_VARIANT_NOT_FOUND`。 |
| R05-4 | 公式按 04 §6，decimal.js + ROUND_HALF_UP，输入不全时结果为空。 |
| R05-5 | 取值校验按 04 §8.2；草稿模式只校验格式，提交模式还校验必填。 |
| R05-6 | 分类变体继承：自己设置了就用自己的，否则沿上级查找，到根仍没有则用主模板。 |
| R05-7 | 锁定 Excel 的结构、保护、签名、导入步骤严格按 04 §7；导入只返回解析好的取值或错误，不写数据库（写草稿由 M09 负责）。 |
| R05-8 | Excel 和界面上的列标签与定义一致：Excel 写"中文 / English"，界面按当前语言显示。 |

## 4. 接口

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/ppl/sets` | `system:ppl:view` | 版本列表 |
| GET | `/api/ppl/sets/:version` | `system:ppl:view` | 完整定义 |
| POST | `/api/ppl/sets` | `system:ppl:manage` | `{ label, definition }` → 新版本 |
| POST | `/api/ppl/sets/:version/activate` | `system:ppl:manage` | |
| GET | `/api/ppl/resolve?version=&variant=` | `inquiry:view` | 解析后的列（内部页面用） |
| GET | `/api/material-categories/:id/ppl-variant` | `material:view` | `{ variantCode \| null, inheritedFrom }` |
| GET | `/api/ppl/variants` | `material:view` | 当前激活版本的主模板与变体（`{ version, variants: [{ code, nameZh, nameEn, columnCount }] }`），材料分类表单的"PPL 变体"下拉用；M05 实现时补充（维护分类的采购主管没有 `system:ppl:view`） |

## 5. 测试

- shared（vitest）：
  - `validateDefinition`：v0 通过；重复 key、变体排除必填列、变体排除公式输入列、预填列缺 `prefillFrom`、`required` 写在公式列上分别报错。
  - `resolveColumns`：PPL-LED 67 列、PPL-PERIPH 66 列，必填合并正确，顺序与主模板一致。
  - 公式：`exclTax(113.0000, 13) = 100.0000`、`exclTax(0.0850, 13) = 0.0752`；`lineTotal` 用议价数量覆盖；`cbm` 四舍五入；输入缺失返回空。
  - 取值校验：每种 type 的合法/非法样例；超过 precision 的小数被拒；未知 key 被丢弃；必填只在提交模式校验。
- api：
  - Excel 往返：build（3 行合成询价行）→ 用 ExcelJS 填写未锁定单元格 → parse 得到正确取值，公式列被重算。
  - 篡改 `_meta` 签名 → `EXCEL_TEMPLATE_MISMATCH`；把 quoteId 换成别的 → `EXCEL_TEMPLATE_MISMATCH`；改第 3 行 key → `EXCEL_HEADER_MISMATCH`；填非法数字 → `EXCEL_ROWS_INVALID` 且行号、列名正确。
  - 生成的工作表确实处于保护状态，预填列和公式列锁定、供应商列未锁定。
  - 激活互斥；激活新版本后已冻结的版本仍可解析。
  - 分类变体继承：`DRV-CC` 解析为 `PPL-PERIPH`（继承自 `PER`）。

## 6. 验收

- [x] "系统设置 → PPL 模板"能看到 v0 的 70 列，切到 PPL-LED 看到 67 列。
- [x] 上传一份故意写错的定义，页面逐条显示错误。
- [x] 材料分类编辑页可以绑定变体，并显示继承来源。

## 7. 实施步骤

1. shared：类型与 schema → v0 定义常量 → validateDefinition → resolveColumns → formulas → validateQuoteValues，边写边测。
2. api：模板集服务与接口 → 分类变体解析与校验 → `PplExcelService` 与测试。
3. seed → 前端模板页、分类表单补充 → verify，更新进度。
