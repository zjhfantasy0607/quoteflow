import type { RouteRecordRaw } from 'vue-router';
import BlankLayout from '@/layouts/BlankLayout.vue';
import BuyerLayout from '@/layouts/BuyerLayout.vue';
import PortalLayout from '@/layouts/PortalLayout.vue';

/** 采购方门户（内部用户）。子路由的 meta.menu 决定是否出现在左侧菜单，meta.perm 决定谁能进 */
export const buyerRoute: RouteRecordRaw = {
  path: '/',
  component: BuyerLayout,
  redirect: '/workbench',
  children: [
    {
      path: 'workbench',
      name: 'workbench',
      component: () => import('@/views/workbench/WorkbenchPage.vue'),
      meta: { titleKey: 'nav.workbench', userType: 'INTERNAL', menu: { icon: 'House', order: 0 } },
    },
    {
      path: 'materials',
      name: 'materials',
      component: () => import('@/views/materials/MaterialsPage.vue'),
      meta: {
        titleKey: 'nav.materials',
        userType: 'INTERNAL',
        perm: 'material:view',
        menu: { icon: 'Goods', order: 400, groupKey: 'nav.materialsGroup', groupIcon: 'Box' },
      },
    },
    {
      path: 'materials/categories',
      name: 'material-categories',
      component: () => import('@/views/materials/MaterialCategoriesPage.vue'),
      meta: {
        titleKey: 'nav.materialCategories',
        userType: 'INTERNAL',
        perm: 'material:view',
        menu: { icon: 'FolderOpened', order: 401, groupKey: 'nav.materialsGroup', groupIcon: 'Box' },
      },
    },
    {
      path: 'system/users',
      name: 'system-users',
      component: () => import('@/views/system/UsersPage.vue'),
      meta: {
        titleKey: 'nav.users',
        userType: 'INTERNAL',
        perm: 'system:user:view',
        menu: { icon: 'User', order: 900, groupKey: 'nav.system', groupIcon: 'Setting' },
      },
    },
    {
      path: 'system/roles',
      name: 'system-roles',
      component: () => import('@/views/system/RolesPage.vue'),
      meta: {
        titleKey: 'nav.roles',
        userType: 'INTERNAL',
        perm: 'system:role:view',
        menu: { icon: 'Lock', order: 901, groupKey: 'nav.system', groupIcon: 'Setting' },
      },
    },
    {
      path: 'system/dicts',
      name: 'system-dicts',
      component: () => import('@/views/system/DictsPage.vue'),
      meta: {
        titleKey: 'nav.dicts',
        userType: 'INTERNAL',
        perm: 'system:dict:view',
        menu: { icon: 'Collection', order: 902, groupKey: 'nav.system', groupIcon: 'Setting' },
      },
    },
    {
      path: 'system/params',
      name: 'system-params',
      component: () => import('@/views/system/ParamsPage.vue'),
      meta: {
        titleKey: 'nav.params',
        userType: 'INTERNAL',
        perm: 'system:param:manage',
        menu: { icon: 'Tools', order: 903, groupKey: 'nav.system', groupIcon: 'Setting' },
      },
    },
    {
      path: 'system/emails',
      name: 'system-emails',
      component: () => import('@/views/system/EmailsPage.vue'),
      meta: {
        titleKey: 'nav.emails',
        userType: 'INTERNAL',
        perm: 'system:email:view',
        menu: { icon: 'Message', order: 905, groupKey: 'nav.system', groupIcon: 'Setting' },
      },
    },
    {
      path: 'system/audit',
      name: 'system-audit',
      component: () => import('@/views/system/AuditPage.vue'),
      meta: {
        titleKey: 'nav.audit',
        userType: 'INTERNAL',
        perm: 'system:audit:view',
        menu: { icon: 'Document', order: 906, groupKey: 'nav.system', groupIcon: 'Setting' },
      },
    },
  ],
};

/** 供应商门户 */
export const portalRoute: RouteRecordRaw = {
  path: '/portal',
  component: PortalLayout,
  children: [
    {
      path: '',
      name: 'portal-home',
      component: () => import('@/views/portal/PortalHomePage.vue'),
      meta: { titleKey: 'nav.portalHome', userType: 'SUPPLIER', menu: { icon: 'House', order: 0 } },
    },
  ],
};

export const routes: RouteRecordRaw[] = [
  buyerRoute,
  portalRoute,
  {
    path: '/login',
    component: BlankLayout,
    children: [
      {
        path: '',
        name: 'login',
        component: () => import('@/views/auth/LoginPage.vue'),
        meta: { titleKey: 'nav.login', userType: 'PUBLIC' },
      },
    ],
  },
  {
    path: '/forgot-password',
    component: BlankLayout,
    children: [
      {
        path: '',
        name: 'forgot-password',
        component: () => import('@/views/auth/ForgotPasswordPage.vue'),
        meta: { titleKey: 'nav.forgotPassword', userType: 'PUBLIC' },
      },
    ],
  },
  {
    path: '/reset-password',
    component: BlankLayout,
    children: [
      {
        path: '',
        name: 'reset-password',
        component: () => import('@/views/auth/ResetPasswordPage.vue'),
        meta: { titleKey: 'nav.resetPassword', userType: 'PUBLIC' },
      },
    ],
  },
  {
    path: '/403',
    component: BlankLayout,
    children: [
      {
        path: '',
        name: 'forbidden',
        component: () => import('@/views/errors/ForbiddenPage.vue'),
        meta: { titleKey: 'common.page.forbidden.title', userType: 'PUBLIC' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    component: BlankLayout,
    children: [
      {
        path: '',
        name: 'not-found',
        component: () => import('@/views/errors/NotFoundPage.vue'),
        meta: { titleKey: 'common.page.notFound.title', userType: 'PUBLIC' },
      },
    ],
  },
];
