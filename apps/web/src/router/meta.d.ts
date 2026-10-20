import 'vue-router';

export {};

declare module 'vue-router' {
  interface RouteMeta {
    /** 页面标题与菜单名称的 i18n key */
    titleKey?: string;
    /** 需要的权限码（全部满足） */
    perm?: string | string[];
    userType?: 'INTERNAL' | 'SUPPLIER' | 'PUBLIC';
    /** 出现在左侧菜单里 */
    menu?: { icon?: string; order?: number; groupKey?: string; groupIcon?: string };
  }
}
