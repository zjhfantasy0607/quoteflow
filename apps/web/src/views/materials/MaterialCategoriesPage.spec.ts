import * as ElementPlusIcons from '@element-plus/icons-vue';
import type { MaterialCategoryNodeDto, MeDto } from '@quoteflow/shared';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus, { ElSelect } from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLocale, i18n } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import MaterialCategoriesPage from './MaterialCategoriesPage.vue';

const mocks = vi.hoisted(() => {
  const node = (id: string, parentId: string | null, nameZh: string, opts: Record<string, unknown> = {}) => ({
    id,
    parentId,
    code: id,
    nameZh,
    nameEn: `${id} en`,
    sort: 1,
    status: 'ENABLED',
    effectiveEnabled: true,
    isPreset: true,
    remark: null,
    pplVariantCode: null,
    materialCount: 0,
    children: [] as unknown[],
    ...opts,
  });
  const cc = node('DRV-CC', 'PER-DRV', '恒流电源', { effectiveEnabled: false });
  const drv = node('PER-DRV', 'PER', '驱动电源', { status: 'DISABLED', effectiveEnabled: false, children: [cc] });
  const tree = [
    node('LED', null, '灯珠', { children: [node('LED-2835', 'LED', '2835 灯珠', { sort: 3 })] }),
    node('PER', null, '灯外设', { sort: 2, pplVariantCode: 'PPL-PERIPH', children: [drv] }),
  ];
  return {
    tree,
    create: vi.fn(async (body: { code: string }) => ({ ...node(body.code, 'LED', 'x'), id: 'new-id' })),
    update: vi.fn(async (id: string) => node(id, null, 'x')),
    variants: [
      { code: 'PPL-MASTER', nameZh: 'PPL 主模板', nameEn: 'PPL Master Template', columnCount: 70 },
      { code: 'PPL-LED', nameZh: '灯珠报价模板', nameEn: 'LED Beads Template', columnCount: 67 },
      { code: 'PPL-PERIPH', nameZh: '灯外设报价模板', nameEn: 'Lamp Peripherals Template', columnCount: 66 },
    ],
  };
});

vi.mock('@/api/materials', () => ({
  materialCategoriesApi: {
    tree: async () => mocks.tree as unknown as MaterialCategoryNodeDto[],
    create: mocks.create,
    update: mocks.update,
    setStatus: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('@/api/system', () => ({
  pplApi: { activeVariants: async () => ({ version: 1, variants: mocks.variants }) },
}));

function me(permissions: string[]): MeDto {
  return {
    user: {
      id: 'u1',
      username: 'u1',
      name: 'U1',
      email: null,
      userType: 'INTERNAL',
      locale: 'zh-CN',
      departmentCode: null,
      supplier: null,
    },
    roles: [],
    permissions,
    fieldPermissions: [],
    dataScope: 'SELF',
  };
}

async function mountPage(permissions: string[]): Promise<VueWrapper> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().me = me(permissions);
  const w = mount(MaterialCategoriesPage, {
    global: { plugins: [i18n, ElementPlus, pinia], components: ElementPlusIcons },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

async function clickNode(w: VueWrapper, code: string): Promise<void> {
  const content = w.findAll('.el-tree-node__content').find((n) => n.find('.code').text() === code);
  if (!content) throw new Error(`node ${code} not found`);
  await content.trigger('click');
  await flushPromises();
}

function button(w: VueWrapper, text: string) {
  return w.findAll('button').find((b) => b.text() === text);
}

const tr = (key: string, params: Record<string, unknown> = {}) => i18n.global.t(key, params);

describe('材料分类页', () => {
  beforeEach(() => {
    applyLocale('zh-CN');
    mocks.create.mockClear();
    mocks.update.mockClear();
  });

  it('预置分类树完整显示，默认选中第一个分类', async () => {
    const w = await mountPage(['material:view', 'material:category:manage']);
    const codes = w.findAll('.el-tree-node__content .code').map((c) => c.text());
    expect(codes).toEqual(['LED', 'LED-2835', 'PER', 'PER-DRV', 'DRV-CC']);
    expect((w.find('.editor-form input').element as HTMLInputElement).value).toBe(tr('materials.categories.topLevel'));
    w.unmount();
  });

  it('没有 material:category:manage 时只读：表单禁用，没有新增、保存、删除按钮', async () => {
    const w = await mountPage(['material:view']);
    expect(w.text()).toContain(tr('materials.categories.readonlyHint'));
    expect(button(w, tr('materials.categories.createTop'))).toBeUndefined();
    expect(button(w, tr('common.actions.save'))).toBeUndefined();
    expect(w.findAll('.editor-form input').every((i) => i.attributes('disabled') !== undefined)).toBe(true);
    w.unmount();
  });

  it('R03-2 上级停用后，下级显示"不能被选用"的提示，不能新增下级', async () => {
    const w = await mountPage(['material:view', 'material:category:manage']);
    await clickNode(w, 'DRV-CC');
    expect(w.text()).toContain(tr('materials.categories.inheritedHint'));
    expect(button(w, tr('materials.categories.createChild'))!.attributes('disabled')).toBeDefined();
    await clickNode(w, 'PER-DRV');
    expect(w.text()).toContain(tr('materials.categories.disabledHint'));
    expect(button(w, tr('materials.categories.enable'))).toBeDefined();
    w.unmount();
  });

  it('R03-1 新增下级：上级为当前分类，编码转大写，排序默认排在同级最后', async () => {
    const w = await mountPage(['material:view', 'material:category:manage']);
    await button(w, tr('materials.categories.createChild'))!.trigger('click');
    const inputs = w.findAll('.editor-form input');
    expect((inputs[0].element as HTMLInputElement).value).toBe('灯珠');

    await button(w, tr('common.actions.save'))!.trigger('click');
    await flushPromises();
    expect(mocks.create).not.toHaveBeenCalled();
    // el-form-item 的错误文字防抖 100ms 才出现，这里检查哪些字段被标为错误
    const invalid = w.findAll('.editor-form .el-form-item.is-error .el-form-item__label').map((l) => l.text());
    expect(invalid).toEqual([
      tr('materials.categories.fields.nameZh'),
      tr('materials.categories.fields.nameEn'),
      tr('materials.categories.fields.code'),
    ]);

    await inputs[1].setValue('3528 灯珠');
    await inputs[2].setValue('3528 SMD LED');
    await inputs[3].setValue('led-3528');
    await button(w, tr('common.actions.save'))!.trigger('click');
    await flushPromises();
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 'LED', code: 'LED-3528', nameZh: '3528 灯珠', nameEn: '3528 SMD LED', sort: 4 }),
    );
    w.unmount();
  });

  it('R05-6 PPL 变体：显示实际生效的变体与继承来源，改选后立即更新并随保存提交', async () => {
    const w = await mountPage(['material:view', 'material:category:manage']);
    const effective = (code: string, name: string) =>
      tr('materials.categories.pplEffective', { name: tr('materials.categories.pplVariantOption', { name, code }) });

    await clickNode(w, 'DRV-CC');
    expect(w.text()).toContain(
      effective('PPL-PERIPH', '灯外设报价模板') + tr('materials.categories.pplInheritedFrom', { name: '灯外设' }),
    );

    await clickNode(w, 'LED');
    expect(w.text()).toContain(effective('PPL-MASTER', 'PPL 主模板') + tr('materials.categories.pplNotSet'));

    w.findComponent(ElSelect).vm.$emit('update:modelValue', 'PPL-LED');
    await flushPromises();
    expect(w.text()).toContain(effective('PPL-LED', '灯珠报价模板'));
    expect(w.text()).not.toContain(tr('materials.categories.pplNotSet'));

    await button(w, tr('common.actions.save'))!.trigger('click');
    await flushPromises();
    expect(mocks.update).toHaveBeenCalledWith('LED', expect.objectContaining({ pplVariantCode: 'PPL-LED' }));
    w.unmount();
  });
});
