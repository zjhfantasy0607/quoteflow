import { describe, expect, it } from 'vitest';
import type { RouteRecordRaw } from 'vue-router';
import { buildMenu } from './menu';

const Dummy = { template: '<div />' };

const layout: RouteRecordRaw = {
  path: '/',
  component: Dummy,
  children: [
    { path: 'workbench', component: Dummy, meta: { titleKey: 'nav.workbench', menu: { order: 0 } } },
    {
      path: 'system/roles',
      component: Dummy,
      meta: { titleKey: 'nav.roles', perm: 'system:role:view', menu: { order: 901, groupKey: 'nav.system' } },
    },
    {
      path: 'system/users',
      component: Dummy,
      meta: { titleKey: 'nav.users', perm: 'system:user:view', menu: { order: 900, groupKey: 'nav.system' } },
    },
    { path: 'hidden', component: Dummy, meta: { titleKey: 'nav.login' } },
  ],
};

describe('buildMenu（M01 菜单按权限过滤）', () => {
  it('按 order 排序，同组归入子菜单，没有 meta.menu 的不显示', () => {
    const menu = buildMenu(layout, () => true);
    expect(menu.map((m) => m.titleKey)).toEqual(['nav.workbench', 'nav.system']);
    expect(menu[1].children!.map((c) => c.path)).toEqual(['/system/users', '/system/roles']);
  });

  it('没有权限的菜单项被过滤，组内为空时整组不出现', () => {
    const granted = new Set(['system:user:view']);
    const onlyUsers = buildMenu(layout, (r) => !r.meta?.perm || granted.has(r.meta.perm as string));
    expect(onlyUsers[1].children!.map((c) => c.titleKey)).toEqual(['nav.users']);

    const none = buildMenu(layout, (r) => !r.meta?.perm);
    expect(none.map((m) => m.titleKey)).toEqual(['nav.workbench']);
  });
});
