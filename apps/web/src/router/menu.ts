import type { RouteRecordRaw } from 'vue-router';

export interface MenuItem {
  key: string;
  titleKey: string;
  icon?: string;
  path?: string;
  children?: MenuItem[];
}

function joinPath(parent: string, child: string): string {
  if (child.startsWith('/')) return child;
  const base = parent.endsWith('/') ? parent : `${parent}/`;
  return child ? `${base}${child}` : parent;
}

/**
 * 由布局路由的子路由生成菜单：meta.menu 存在才显示；同 groupKey 的放进一个子菜单。
 * canAccess 决定是否有权限看到（M01 起按权限过滤）。
 */
export function buildMenu(layout: RouteRecordRaw, canAccess: (route: RouteRecordRaw) => boolean): MenuItem[] {
  const entries = (layout.children ?? [])
    .filter((r) => r.meta?.menu && r.meta.titleKey && canAccess(r))
    .sort((a, b) => (a.meta?.menu?.order ?? 0) - (b.meta?.menu?.order ?? 0));

  const result: MenuItem[] = [];
  const groups = new Map<string, MenuItem>();
  for (const r of entries) {
    const menu = r.meta!.menu!;
    const item: MenuItem = {
      key: joinPath(layout.path, r.path),
      path: joinPath(layout.path, r.path),
      titleKey: r.meta!.titleKey!,
      icon: menu.icon,
    };
    if (!menu.groupKey) {
      result.push(item);
      continue;
    }
    let group = groups.get(menu.groupKey);
    if (!group) {
      group = { key: `group:${menu.groupKey}`, titleKey: menu.groupKey, icon: menu.groupIcon, children: [] };
      groups.set(menu.groupKey, group);
      result.push(group);
    }
    group.children!.push(item);
  }
  return result;
}
