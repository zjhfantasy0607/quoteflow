// 材料分类与材料库（docs/06-种子数据.md §2.6、§2.7），db:seed 与 e2e 测试共用。
// 只新增缺失的数据，不覆盖管理员已经修改过的内容。
import type { PrismaClient } from '../../src/generated/prisma/client';

/** [编码, 中文, English, 上级编码, PPL 变体]；上级写在下级前面 */
export const PRESET_CATEGORIES: [string, string, string, string | null, string | null][] = [
  ['LED', '灯珠', 'LED Beads', null, 'PPL-LED'],
  ['LED-2835', '2835 灯珠', '2835 SMD LED', 'LED', null],
  ['LED-3030', '3030 灯珠', '3030 SMD LED', 'LED', null],
  ['LED-COB', 'COB 灯珠', 'COB LED', 'LED', null],
  ['PER', '灯外设', 'Lamp Peripherals', null, 'PPL-PERIPH'],
  ['PER-LENS', '透镜', 'Lens', 'PER', null],
  ['PER-REFL', '反光杯', 'Reflector', 'PER', null],
  ['PER-BRKT', '支架', 'Bracket', 'PER', null],
  ['PER-DRV', '驱动电源', 'LED Driver', 'PER', null],
  ['DRV-CC', '恒流电源', 'Constant Current Driver', 'PER-DRV', null],
  ['DRV-CV', '恒压电源', 'Constant Voltage Driver', 'PER-DRV', null],
  ['PER-HS', '散热器', 'Heat Sink', 'PER', null],
  ['PER-CONN', '连接器', 'Connector', 'PER', null],
  ['PER-WIRE', '线材', 'Wire & Cable', 'PER', null],
  ['PER-OTHER', '其它配件', 'Other Accessories', 'PER', null],
];

/** [编码, 中文名, English, 规格型号, 单位, 分类编码] */
export const SEED_MATERIALS: [string, string, string, string, string, string][] = [
  ['MAT-000001', '灯珠 2835', 'LED 2835', '2835 / 0.5W / 6V / 150mA / 6500K', 'PCS', 'LED-2835'],
  ['MAT-000002', 'COB 灯珠', 'COB LED', 'COB / 10W / 30V / 300mA / 4000K / Ra80', 'PCS', 'LED-COB'],
  ['MAT-000003', 'PC 透镜 60°', 'PC Lens 60°', 'Φ20mm / 60° / PC', 'PCS', 'PER-LENS'],
  ['MAT-000004', '铝反光杯', 'Aluminum Reflector', 'Φ50 × 30mm / 24°', 'PCS', 'PER-REFL'],
  ['MAT-000005', '恒流驱动电源', 'CC LED Driver', 'AC220V / DC30–42V / 300mA / PF>0.9', 'PCS', 'DRV-CC'],
  ['MAT-000006', '恒压驱动电源', 'CV LED Driver', 'AC220V / DC24V / 100W / IP67', 'PCS', 'DRV-CV'],
  ['MAT-000007', '压铸铝散热器', 'Die-cast Heat Sink', 'Φ80 × 45mm / ADC12', 'PCS', 'PER-HS'],
  ['MAT-000008', '防水连接器 2P', 'Waterproof Connector 2P', 'IP68 / 2PIN / 10A', 'PCS', 'PER-CONN'],
  ['MAT-000009', '硅胶线 18AWG', 'Silicone Wire 18AWG', '18AWG / 200℃ / 红黑', 'M', 'PER-WIRE'],
  ['MAT-000010', '灯具支架', 'Lamp Bracket', 'SPCC 1.2mm / 白色喷涂', 'PCS', 'PER-BRKT'],
];

export async function seedMaterialCategories(prisma: PrismaClient): Promise<void> {
  const idByCode = new Map<string, string>();
  for (const [index, [code, nameZh, nameEn, parentCode, pplVariantCode]] of PRESET_CATEGORIES.entries()) {
    const parentId = parentCode ? idByCode.get(parentCode)! : null;
    const category = await prisma.materialCategory.upsert({
      where: { code },
      create: { code, nameZh, nameEn, parentId, pplVariantCode, sort: index + 1, isPreset: true },
      // 已存在时只保证预置标记，不覆盖管理员改过的名称、排序和状态
      update: { isPreset: true },
    });
    idByCode.set(code, category.id);
  }
}

/** 需要先有分类和单位字典 */
export async function seedMaterials(prisma: PrismaClient): Promise<void> {
  const categories = await prisma.materialCategory.findMany({ select: { id: true, code: true } });
  const categoryId = new Map(categories.map((c) => [c.code, c.id]));
  for (const [code, nameZh, nameEn, spec, unitCode, categoryCode] of SEED_MATERIALS) {
    await prisma.material.upsert({
      where: { code },
      create: { code, nameZh, nameEn, spec, unitCode, categoryId: categoryId.get(categoryCode)! },
      update: {},
    });
  }
  // 自动编码从 MAT-000011 开始
  await prisma.$executeRaw`
    INSERT INTO "Sequence" ("key", "value") VALUES ('MAT', ${SEED_MATERIALS.length})
    ON CONFLICT ("key") DO UPDATE SET "value" = GREATEST("Sequence"."value", ${SEED_MATERIALS.length})`;
}
