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
      path: 'inquiries',
      name: 'inquiries',
      component: () => import('@/views/inquiries/InquiriesPage.vue'),
      meta: {
        titleKey: 'nav.inquiries',
        userType: 'INTERNAL',
        perm: 'inquiry:view',
        menu: { icon: 'List', order: 100, groupKey: 'nav.inquiriesGroup', groupIcon: 'Memo' },
      },
    },
    {
      path: 'inquiries/approvals',
      name: 'inquiry-approvals',
      component: () => import('@/views/inquiries/InquiryApprovalsPage.vue'),
      meta: {
        titleKey: 'nav.inquiryApprovals',
        userType: 'INTERNAL',
        perm: 'inquiry:approve',
        menu: { icon: 'Stamp', order: 101, groupKey: 'nav.inquiriesGroup', groupIcon: 'Memo' },
      },
    },
    {
      path: 'inquiries/new',
      name: 'inquiry-new',
      component: () => import('@/views/inquiries/InquiryEditPage.vue'),
      meta: { titleKey: 'nav.inquiryNew', userType: 'INTERNAL', perm: 'inquiry:create' },
    },
    {
      // 页面按 allowedActions 判断能不能编辑（表头、询价行要 inquiry:create，附件要 inquiry:spec）
      path: 'inquiries/:id/edit',
      name: 'inquiry-edit',
      component: () => import('@/views/inquiries/InquiryEditPage.vue'),
      meta: { titleKey: 'nav.inquiryEdit', userType: 'INTERNAL', perm: 'inquiry:view' },
    },
    {
      path: 'inquiries/:id',
      name: 'inquiry-detail',
      component: () => import('@/views/inquiries/InquiryDetailPage.vue'),
      meta: { titleKey: 'nav.inquiryDetail', userType: 'INTERNAL', perm: 'inquiry:view' },
    },
    {
      path: 'inquiries/:id/rounds/:roundNo/quotes/:quoteId',
      name: 'inquiry-quote',
      component: () => import('@/views/inquiries/InquiryQuoteDetailPage.vue'),
      meta: { titleKey: 'nav.inquiryQuote', userType: 'INTERNAL', perm: 'inquiry:evaluate' },
    },
    {
      path: 'suppliers',
      name: 'suppliers',
      component: () => import('@/views/suppliers/SuppliersPage.vue'),
      meta: {
        titleKey: 'nav.suppliers',
        userType: 'INTERNAL',
        perm: 'supplier:view',
        menu: { icon: 'OfficeBuilding', order: 300, groupKey: 'nav.suppliersGroup', groupIcon: 'Shop' },
      },
    },
    {
      path: 'suppliers/categories',
      name: 'supplier-categories',
      component: () => import('@/views/suppliers/SupplierCategoriesPage.vue'),
      meta: {
        titleKey: 'nav.supplierCategories',
        userType: 'INTERNAL',
        perm: 'supplier:category:manage',
        menu: { icon: 'PriceTag', order: 301, groupKey: 'nav.suppliersGroup', groupIcon: 'Shop' },
      },
    },
    {
      path: 'suppliers/:id',
      name: 'supplier-detail',
      component: () => import('@/views/suppliers/SupplierDetailPage.vue'),
      meta: { titleKey: 'nav.supplierDetail', userType: 'INTERNAL', perm: 'supplier:view' },
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
      path: 'system/ppl',
      name: 'system-ppl',
      component: () => import('@/views/system/PplPage.vue'),
      meta: {
        titleKey: 'nav.ppl',
        userType: 'INTERNAL',
        perm: 'system:ppl:view',
        menu: { icon: 'Tickets', order: 904, groupKey: 'nav.system', groupIcon: 'Setting' },
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
    {
      path: 'quotes',
      name: 'portal-quotes',
      component: () => import('@/views/portal/PortalQuotesPage.vue'),
      meta: { titleKey: 'nav.portalQuotes', userType: 'SUPPLIER', menu: { icon: 'Document', order: 10 } },
    },
    {
      // 邀请、催报、延期邮件里的链接（M07 R07-5）
      path: 'quotes/:quoteId',
      name: 'portal-quote',
      component: () => import('@/views/portal/PortalQuoteDetailPage.vue'),
      meta: { titleKey: 'nav.portalQuoteDetail', userType: 'SUPPLIER' },
    },
    {
      path: 'profile',
      name: 'portal-profile',
      component: () => import('@/views/portal/PortalProfilePage.vue'),
      meta: {
        titleKey: 'nav.portalProfile',
        userType: 'SUPPLIER',
        menu: { icon: 'OfficeBuilding', order: 20 },
      },
    },
    {
      path: 'account',
      name: 'portal-account',
      component: () => import('@/views/portal/PortalAccountPage.vue'),
      meta: { titleKey: 'nav.portalAccount', userType: 'SUPPLIER', menu: { icon: 'Setting', order: 30 } },
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
    path: '/activate',
    component: BlankLayout,
    children: [
      {
        path: '',
        name: 'activate',
        component: () => import('@/views/auth/ActivatePage.vue'),
        meta: { titleKey: 'nav.activate', userType: 'PUBLIC' },
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
