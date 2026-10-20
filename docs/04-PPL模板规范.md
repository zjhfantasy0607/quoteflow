# 04 PPL 模板规范

## 1. 概念

需求 #6："主模板 PPL 70 列在线填报；或导入锁定 Excel；变体不脱离主模板族"。客户的真实 PPL 模板**还没拿到**，所以报价模块按**元数据驱动**实现：列的定义（键、中英标签、类型、必填、公式等）存在数据库里，界面、校验、Excel、比价矩阵、报表都按定义动态生成。v0 是按灯具行业常见报价字段整理的 70 列占位定义（[ppl-v0.json](ppl-v0.json)），拿到真实模板后替换定义即可，不改代码（§9）。

- **模板集**（`PplTemplateSet`）：一个版本号 = 一份主模板 + 若干变体，整体版本化。同一时间只有一个激活版本。
- **主模板**（`PPL-MASTER`）：完整的 70 列。
- **变体**（如 `PPL-LED`、`PPL-PERIPH`）：从主模板**排除**若干列、把若干列**改为必填**。不能新增列、不能改列的类型和标签，这就是"变体不脱离主模板族"。
- **分类绑定**：材料分类上可以设置 `pplVariantCode`，不设则继承上级，顶级也没设就用主模板。询价单的材料类别决定该单使用哪个变体。

## 2. 版本冻结

- 轮次发布时把"当前激活版本号 + 解析出的变体代码"写进 `InquiryRound.pplTemplateVersion / pplVariantCode`，之后这一轮的填报、校验、Excel、比价都用这个冻结的版本。激活新版本不影响进行中的轮次。
- `QuoteVersion` 也记录 `templateVersion / variantCode`；合同快照里存解析后的列定义，所以历史单据永远能正确显示。

## 3. 定义结构

```ts
interface PplDefinition {
  schemaVersion: 1;
  label: string;                                   // 如 "PPL v0（占位定义…）"
  groups: Array<{ key: string; labelZh: string; labelEn: string }>;
  master: { code: 'PPL-MASTER'; nameZh: string; nameEn: string; columns: PplColumn[] };
  variants: Array<{
    code: string;          // ^PPL-[A-Z0-9-]+$
    nameZh: string; nameEn: string;
    exclude: string[];     // 从主模板排除的列 key
    required: string[];    // 在本变体里改为必填的列 key
  }>;
}
```

zod schema 和类型放在 `packages/shared/src/ppl/definition.ts`；解析函数 `resolveColumns(definition, variantCode | null): PplResolvedColumn[]` 返回该变体实际使用的列（保持主模板顺序，`required` 已合并）。

## 4. 列元数据

| 字段 | 必需 | 说明 |
|---|---|---|
| `key` | 是 | 稳定的英文键，`^[a-z][a-z0-9_]*$`，存值、导出、报表都用它 |
| `group` | 是 | 所属分组 key（表单分组、Excel 第 1 行合并表头） |
| `labelZh` / `labelEn` | 是 | 中英标签，界面按当前语言显示，Excel 表头写"中文 / English" |
| `type` | 是 | `text` / `textarea` / `int` / `decimal` / `money` / `percent` / `date` / `bool` / `enum` / `multiEnum` |
| `source` | 是 | `prefill`（从询价行或询价单带出，只读）/ `supplier`（供应商填写）/ `formula`（系统计算，只读） |
| `required` | 否 | 仅 `supplier` 列可设 |
| `precision` | 小数类必需 | decimal/money/percent 的小数位数 |
| `min` / `max` | 否 | 数值范围 |
| `maxLength` | 文本类 | text 默认 200，textarea 默认 1000 |
| `dictType` | 枚举类必需 | 选项来自该字典类型的启用项 |
| `formula` | 公式列必需 | 公式名，见 §6 |
| `prefillFrom` | 预填列必需 | `lineNo` / `materialCode` / `name` / `categoryName` / `spec` / `unitName` / `quantity` / `drawingRef` / `currency` |
| `default` | 否 | 新建草稿时的默认值（如税率 `"13"`） |
| `sensitive` | 否 | 金额类，受字段权限 `quote.amount` 控制 |
| `inMatrix` | 否 | 在比价矩阵明细中显示 |
| `keyField` | 否 | 在报价行列表中直接显示（其余字段在抽屉表单里填） |
| `logistics` | 否 | 进入"物流报价明细"报表（#26，A-09） |
| `width` | 否 | 列宽（px） |

`name`、`categoryName`、`unitName` 这三个预填源按当前语言取中文或英文名称（英文为空回退中文）。

## 5. 类型与取值编码

| type | 存储（`PplValue`） | 界面控件 | Excel |
|---|---|---|---|
| `text` | string | el-input | 文本，长度校验 |
| `textarea` | string | el-input textarea | 文本，长度校验 |
| `int` | number | el-input-number（整数） | 整数校验 |
| `decimal` | string（按 precision） | 数字输入，失焦时格式化 | 小数校验 |
| `money` | string（按 precision） | 同上，前缀币种 | 小数校验，单元格数字格式 |
| `percent` | string（0–100） | 同上，后缀 % | 小数校验 |
| `date` | `"YYYY-MM-DD"` | el-date-picker | 日期校验；文本 `YYYY-MM-DD` 也接受 |
| `bool` | boolean | el-switch | 下拉"是 / Yes, 否 / No" |
| `enum` | 字典编码 | DictSelect | 下拉（选项文本"中文 / English"），导入时接受选项文本或编码 |
| `multiEnum` | 字典编码数组 | DictSelect multiple | 无下拉，填英文逗号分隔的编码（如 `CE,UL`） |

空值不写入（或写 null）。服务端对 decimal/money/percent 拒绝超过 precision 的小数位（提示"最多 N 位小数"），不偷偷四舍五入。

## 6. 公式

实现在 `packages/shared/src/ppl/formulas.ts`（decimal.js，ROUND_HALF_UP），前端实时预览和后端保存用同一份代码；**后端保存时一律重算，忽略客户端传来的公式列值。**

| 公式名 | 结果列 | 计算 | 输入不全时 |
|---|---|---|---|
| `exclTax` | `unit_price_excl_tax` | `round(unit_price_incl_tax / (1 + tax_rate / 100), 4)` | 空 |
| `lineTotal` | `total_price_incl_tax` | `round(unit_price_incl_tax × 数量, 2)`；数量取报价取值里的 `quantity`（议价改过数量时才有），否则取询价行数量 | 空 |
| `cbm` | `carton_cbm` | `round(carton_l_cm × carton_w_cm × carton_h_cm / 1,000,000, 4)` | 空 |

报价版本合计 `totalAmount = Σ 各行 total_price_incl_tax`（2 位小数）。议价成交时允许在取值里写 `quantity`（见 05 §5），这是唯一允许在报价取值里出现预填列 key 的情况。

## 7. 锁定 Excel 模板

由 `PplExcelService`（M05）生成和解析，供应商在门户下载与导入（M09）。

### 7.1 工作簿结构

| 工作表 | 可见性 | 内容 |
|---|---|---|
| `报价 Quote` | 可见 | 报价表 |
| `说明 Instructions` | 可见 | 中英填写说明：不要改结构；必填列；多选、是否、日期的写法；截止时间（UTC+8）；导入后需在系统里点"提交报价"才生效 |
| `_lists` | veryHidden | 每个枚举列一列选项（"中文 / English"），供数据验证引用 |
| `_meta` | veryHidden | 两列 key/value，见 §7.3 |

### 7.2 `报价 Quote` 表

- 第 1 行：分组表头，按分组合并单元格，文字"基本信息 / Basic Info"。
- 第 2 行：列标签"含税单价 *⏎Unit Price (incl. tax)"，必填列带 `*`，自动换行。
- 第 3 行：列 key（隐藏行，小号灰字）。
- 第 4 行起：每个询价行一行，按 `lineNo` 排序。冻结窗格在 D4（前三行、前三列）。
- 预填列：写入询价行数据，锁定，灰底。
- 供应商列：不锁定，白底；如果已有草稿或当前版本，预先写入这些值（再次下载时不丢已填内容）。
- 公式列：锁定，浅蓝底，写 Excel 公式便于供应商核对（如 `=IF(AND(ISNUMBER(P4),ISNUMBER(Q4)),ROUND(P4/(1+Q4/100),4),"")`）。导入时忽略这些单元格的值，由服务端重算。
- 数据验证：enum 引用 `_lists` 区域；bool 用"是 / Yes,否 / No"；int、decimal、money、percent 按类型和 min/max；date 用日期验证；text 用长度验证；multiEnum 只加输入提示。
- 工作表保护：`protect(EXCEL_SHEET_PASSWORD, { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true })`，其余（插入/删除行列、排序、筛选、改行格式）全部禁止。Excel 的保护强度有限，**服务端校验才是最终防线**。

### 7.3 `_meta` 与签名

| key | 值 |
|---|---|
| `kind` | `QF_PPL_QUOTE` |
| `quoteId` / `roundId` / `formalNo` / `roundNo` | 目标报价单与轮次 |
| `templateVersion` / `variantCode` | 该轮冻结的模板 |
| `columnKeys` | 解析后的列 key，按顺序用逗号连接 |
| `lineIds` | 询价行 id，按行顺序用逗号连接 |
| `generatedAt` | 生成时间 ISO |
| `signature` | `HMAC-SHA256(EXCEL_SIGNING_SECRET, kind|quoteId|roundId|templateVersion|variantCode|columnKeys|lineIds)` 的 hex |

### 7.4 导入算法

1. 文件 ≤ 10MB，ExcelJS 能打开，否则 `EXCEL_PARSE_FAILED`。
2. 读 `_meta`：缺失或 `kind` 不对 → `EXCEL_TEMPLATE_MISMATCH`（不是本系统模板）。
3. 校验签名 → 不符则 `EXCEL_TEMPLATE_MISMATCH`（模板被篡改）。
4. `quoteId` 必须是当前报价单，`roundId`、`templateVersion`、`variantCode`、`lineIds` 必须与当前轮次一致 → 否则 `EXCEL_TEMPLATE_MISMATCH`（不是本单/本轮的模板或已过期，请重新下载）。
5. 表头：第 3 行 key 必须与 `columnKeys` 完全一致，第 2 行标签规范化后与期望一致 → 否则 `EXCEL_HEADER_MISMATCH`，details 列出差异，整表拒绝（#29）。
6. 数据行：必须恰好 N 行，且行号与询价行一一对应；下方出现多余的非空行也报错。
7. 逐个供应商列单元格按类型转换（数字、文本、日期、富文本都要处理），记录"第几行、哪一列、什么问题"。
8. 用 shared 的 `validateQuoteValues()` 做必填与类型校验。
9. 有任何错误 → `EXCEL_ROWS_INVALID`（422），返回全部错误（最多 200 条），**一行都不写入**。
10. 全部通过 → 写入 `Quote.draftValues`（`source = 'EXCEL'`，覆盖各行取值，保留备注和附件），返回草稿。**导入不等于提交**，供应商在页面核对后点"提交报价"才生成版本。

## 8. 校验

### 8.1 定义校验（`validateDefinition()`，保存模板集时执行）

- `schemaVersion = 1`；分组 key 唯一；列 key 唯一且符合格式；每列的分组存在；type、source 合法。
- 预填列必须有合法的 `prefillFrom`；公式列必须有已注册的 `formula`，且其输入列存在（`exclTax` 需要 `unit_price_incl_tax`、`tax_rate`；`lineTotal` 需要 `unit_price_incl_tax`、`quantity`；`cbm` 需要三个外箱尺寸列）。
- 主模板必须包含 `unit_price_incl_tax`、`tax_rate`，且两者必填（系统靠它们算合计）。
- 枚举类必须有 `dictType`；`required` 只能出现在 supplier 列；小数类必须有 `precision`。
- 变体：code 唯一且符合格式；`exclude` ⊆ 主模板列，且不能排除预填列、公式列、公式输入列、主模板必填列；`required` ⊆ 变体剩余的 supplier 列。
- 错误以 `PPL_DEFINITION_INVALID` 返回，details 是 `[{ path, message }]`。

### 8.2 取值校验（`validateQuoteValues(columns, lines, values, dict)`）

- 对每一行、每个 supplier 列：按类型校验格式、精度、范围、长度、字典编码是否存在且启用；必填列不能为空。
- 未知 key、预填列 key（议价版本的 `quantity` 除外）、公式列的值都会被丢弃，不报错。
- 返回 `[{ lineId, lineNo, key, code, message }]`；后端以 `QUOTE_VALUES_INVALID` 返回。草稿保存时只校验格式不校验必填，提交时全部校验。

## 9. 替换为真实 PPL

1. 拿到客户的 PPL Excel，逐列整理成列元数据（标签直接用 PPL 上的中英文，与 PPL 保持一致是 #18 的验收点）。语义相同的列沿用 v0 的 key，这样比价矩阵、物流报表不受影响。
2. 按真实情况设置 `sensitive`、`inMatrix`、`keyField`、`logistics` 标记，整理变体和分类绑定。
3. 新定义放到 `docs/ppl-v1.json`，在"系统设置 → PPL 模板"上传（或写进 seed），系统校验通过后生成新版本（未激活）。
4. 管理员核对列表后激活。只有之后发布的轮次使用新版本。
5. 只有出现新的公式或新的字段类型时才需要改代码：在 shared 里注册公式或类型，并补测试。
6. 更新本文 §10、§11。

## 10. v0 列定义（70 列）

由脚本从 [ppl-v0.json](ppl-v0.json) 生成并校验：70 列（预填 9、供应商填写 58、公式 3），金额敏感 8 列，比价矩阵 15 列，列表列 9 个，物流 13 列。

| # | key | 中文 | English | 类型 | 来源 | 必填 | 说明 |
|---|---|---|---|---|---|---|---|
| 1 | `line_no` | 行号 | Line No. | int | 预填 |  | ← 行.lineNo；列表 |
| 2 | `material_code` | 物料编码 | Material Code | text | 预填 |  | ← 行.materialCode |
| 3 | `material_name` | 物料名称 | Material Name | text | 预填 |  | ← 行.name；列表 |
| 4 | `category_name` | 材料分类 | Category | text | 预填 |  | ← 行.categoryName |
| 5 | `spec` | 规格型号 | Specification | text | 预填 |  | ← 行.spec；列表 |
| 6 | `unit` | 单位 | Unit | text | 预填 |  | ← 行.unitName；列表 |
| 7 | `quantity` | 需求数量 | Required Qty | decimal | 预填 |  | 4 位小数；← 行.quantity；列表 |
| 8 | `drawing_ref` | 图纸/规格书编号 | Drawing / Spec Ref. | text | 预填 |  | ← 行.drawingRef |
| 9 | `supplier_part_no` | 供应商料号 | Supplier Part No. | text | 供应商 |  |  |
| 10 | `brand` | 品牌 | Brand | text | 供应商 |  | 比价 |
| 11 | `model` | 型号 | Model | text | 供应商 |  | 比价 |
| 12 | `manufacturer` | 制造商 | Manufacturer | text | 供应商 |  |  |
| 13 | `origin` | 产地 | Country of Origin | text | 供应商 |  |  |
| 14 | `is_alternative` | 是否替代料 | Alternative Part | bool | 供应商 |  |  |
| 15 | `deviation_note` | 规格偏差说明 | Spec Deviation | textarea | 供应商 |  | 比价 |
| 16 | `power_w` | 功率(W) | Power (W) | decimal | 供应商 |  | 2 位小数 |
| 17 | `voltage_v` | 电压(V) | Voltage (V) | text | 供应商 |  |  |
| 18 | `current_ma` | 电流(mA) | Current (mA) | decimal | 供应商 |  | 2 位小数 |
| 19 | `cct_k` | 色温(K) | CCT (K) | int | 供应商 |  |  |
| 20 | `cri_ra` | 显色指数(Ra) | CRI (Ra) | int | 供应商 |  |  |
| 21 | `luminous_flux_lm` | 光通量(lm) | Luminous Flux (lm) | decimal | 供应商 |  | 1 位小数 |
| 22 | `efficacy_lm_w` | 光效(lm/W) | Efficacy (lm/W) | decimal | 供应商 |  | 1 位小数 |
| 23 | `beam_angle_deg` | 发光角度(°) | Beam Angle (°) | decimal | 供应商 |  | 1 位小数 |
| 24 | `lifetime_h` | 寿命(h) | Lifetime (h) | int | 供应商 |  |  |
| 25 | `ip_rating` | 防护等级 | IP Rating | text | 供应商 |  |  |
| 26 | `material` | 材质 | Material | text | 供应商 |  |  |
| 27 | `color_finish` | 颜色/表面处理 | Color / Finish | text | 供应商 |  |  |
| 28 | `dimensions_mm` | 外形尺寸(mm) | Dimensions (mm) | text | 供应商 |  |  |
| 29 | `unit_weight_g` | 单重(g) | Unit Weight (g) | decimal | 供应商 |  | 2 位小数 |
| 30 | `operating_temp` | 工作温度 | Operating Temp. | text | 供应商 |  |  |
| 31 | `certifications` | 认证 | Certifications | multiEnum | 供应商 |  | 字典 certification；比价 |
| 32 | `rohs` | 符合 RoHS | RoHS Compliant | bool | 供应商 |  |  |
| 33 | `reach` | 符合 REACH | REACH Compliant | bool | 供应商 |  |  |
| 34 | `cert_expiry` | 证书有效期 | Certificate Expiry | date | 供应商 |  |  |
| 35 | `currency` | 币种 | Currency | text | 预填 |  | ← 行.currency |
| 36 | `unit_price_incl_tax` | 含税单价 | Unit Price (incl. tax) | money | 供应商 | 是 | 4 位小数；金额敏感；比价；列表 |
| 37 | `tax_rate` | 税率(%) | Tax Rate (%) | percent | 供应商 | 是 | 2 位小数；默认 13；比价；列表 |
| 38 | `unit_price_excl_tax` | 不含税单价 | Unit Price (excl. tax) | money | 公式 |  | 4 位小数；公式 exclTax；金额敏感；比价 |
| 39 | `total_price_incl_tax` | 含税总价 | Total (incl. tax) | money | 公式 |  | 2 位小数；公式 lineTotal；金额敏感；比价；列表 |
| 40 | `moq` | 最小起订量 | MOQ | int | 供应商 |  | 比价 |
| 41 | `tier1_qty` | 阶梯1数量 | Tier 1 Qty | int | 供应商 |  |  |
| 42 | `tier1_price` | 阶梯1含税单价 | Tier 1 Unit Price | money | 供应商 |  | 4 位小数；金额敏感 |
| 43 | `tier2_qty` | 阶梯2数量 | Tier 2 Qty | int | 供应商 |  |  |
| 44 | `tier2_price` | 阶梯2含税单价 | Tier 2 Unit Price | money | 供应商 |  | 4 位小数；金额敏感 |
| 45 | `tooling_cost` | 模具费 | Tooling Cost | money | 供应商 |  | 2 位小数；金额敏感；比价 |
| 46 | `sample_cost` | 样品费 | Sample Cost | money | 供应商 |  | 2 位小数；金额敏感 |
| 47 | `price_valid_until` | 报价有效期至 | Price Valid Until | date | 供应商 |  | 比价 |
| 48 | `payment_terms` | 付款条件 | Payment Terms | enum | 供应商 |  | 字典 payment_terms；比价 |
| 49 | `sample_lead_days` | 样品交期(天) | Sample Lead Time (days) | int | 供应商 |  |  |
| 50 | `lead_time_days` | 量产交期(天) | Production Lead Time (days) | int | 供应商 | 是 | 比价；列表 |
| 51 | `monthly_capacity` | 月产能 | Monthly Capacity | int | 供应商 |  |  |
| 52 | `warranty_months` | 质保期(月) | Warranty (months) | int | 供应商 |  | 比价 |
| 53 | `packing_method` | 包装方式 | Packing Method | enum | 供应商 |  | 字典 packing_method；物流 |
| 54 | `pcs_per_inner` | 内盒数量 | Qty per Inner Box | int | 供应商 |  | 物流 |
| 55 | `pcs_per_carton` | 每箱数量 | Qty per Carton | int | 供应商 |  | 物流 |
| 56 | `carton_l_cm` | 外箱长(cm) | Carton Length (cm) | decimal | 供应商 |  | 1 位小数；物流 |
| 57 | `carton_w_cm` | 外箱宽(cm) | Carton Width (cm) | decimal | 供应商 |  | 1 位小数；物流 |
| 58 | `carton_h_cm` | 外箱高(cm) | Carton Height (cm) | decimal | 供应商 |  | 1 位小数；物流 |
| 59 | `carton_cbm` | 外箱体积(m³) | Carton Volume (m³) | decimal | 公式 |  | 4 位小数；公式 cbm；物流 |
| 60 | `carton_gw_kg` | 毛重(kg) | Gross Weight (kg) | decimal | 供应商 |  | 2 位小数；物流 |
| 61 | `carton_nw_kg` | 净重(kg) | Net Weight (kg) | decimal | 供应商 |  | 2 位小数；物流 |
| 62 | `trade_term` | 贸易条款 | Trade Term | enum | 供应商 |  | 字典 trade_term；物流 |
| 63 | `ship_from` | 起运地/港口 | Ship From / Port | text | 供应商 |  | 物流 |
| 64 | `freight_cost` | 运费 | Freight Cost | money | 供应商 |  | 2 位小数；金额敏感；物流 |
| 65 | `hs_code` | 海关编码 | HS Code | text | 供应商 |  | 物流 |
| 66 | `quality_commitment` | 质量承诺 | Quality Commitment | textarea | 供应商 |  |  |
| 67 | `after_sales` | 售后服务 | After-sales Service | textarea | 供应商 |  |  |
| 68 | `attachment_note` | 附件说明 | Attachment Notes | text | 供应商 |  |  |
| 69 | `change_note` | 变更说明 | Change Notes | textarea | 供应商 |  | 比价 |
| 70 | `remark` | 备注 | Remarks | textarea | 供应商 |  |  |

## 11. v0 变体

| 变体 | 名称 | 排除的列 | 改为必填 | 列数 | 绑定分类（seed） |
|---|---|---|---|---|---|
| `PPL-MASTER` | PPL 主模板 | — | — | 70 | 未绑定的分类 |
| `PPL-LED` | 灯珠报价模板 | `ip_rating`、`color_finish`、`tooling_cost` | `power_w`、`cct_k`、`cri_ra`、`luminous_flux_lm` | 67 | 灯珠 `LED` 及其下级 |
| `PPL-PERIPH` | 灯外设报价模板 | `cct_k`、`cri_ra`、`luminous_flux_lm`、`efficacy_lm_w` | `material` | 66 | 灯外设 `PER` 及其下级 |

主模板的必填列：`unit_price_incl_tax`、`tax_rate`、`lead_time_days`。
