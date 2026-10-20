// 功能权限树（docs/05-状态机与权限.md §9）。角色编辑页按这棵树渲染，后端按 code 校验。

export interface PermissionDef {
  code: string;
  labelZh: string;
  labelEn: string;
}

export interface PermissionModule {
  key: string;
  labelZh: string;
  labelEn: string;
  permissions: readonly PermissionDef[];
}

export const PERMISSION_TREE = [
  {
    key: 'system',
    labelZh: '系统设置',
    labelEn: 'System Settings',
    permissions: [
      { code: 'system:user:view', labelZh: '查看用户', labelEn: 'View users' },
      { code: 'system:user:manage', labelZh: '管理用户', labelEn: 'Manage users' },
      { code: 'system:role:view', labelZh: '查看角色', labelEn: 'View roles' },
      { code: 'system:role:manage', labelZh: '管理角色权限', labelEn: 'Manage roles' },
      { code: 'system:dict:view', labelZh: '查看数据字典', labelEn: 'View dictionaries' },
      { code: 'system:dict:manage', labelZh: '管理数据字典', labelEn: 'Manage dictionaries' },
      { code: 'system:param:manage', labelZh: '管理系统参数', labelEn: 'Manage system parameters' },
      { code: 'system:ppl:view', labelZh: '查看 PPL 模板', labelEn: 'View PPL templates' },
      { code: 'system:ppl:manage', labelZh: '管理 PPL 模板', labelEn: 'Manage PPL templates' },
      { code: 'system:email:view', labelZh: '查看邮件记录', labelEn: 'View email log' },
      { code: 'system:audit:view', labelZh: '查看操作日志', labelEn: 'View audit log' },
    ],
  },
  {
    key: 'supplier',
    labelZh: '供应商管理',
    labelEn: 'Suppliers',
    permissions: [
      { code: 'supplier:view', labelZh: '查看供应商', labelEn: 'View suppliers' },
      { code: 'supplier:manage', labelZh: '新建、编辑、停用供应商', labelEn: 'Manage suppliers' },
      { code: 'supplier:import', labelZh: '导入供应商', labelEn: 'Import suppliers' },
      { code: 'supplier:export', labelZh: '导出供应商', labelEn: 'Export suppliers' },
      { code: 'supplier:account', labelZh: '管理门户账号', labelEn: 'Manage portal accounts' },
      { code: 'supplier:category:manage', labelZh: '管理供应商分类', labelEn: 'Manage supplier categories' },
    ],
  },
  {
    key: 'material',
    labelZh: '材料管理',
    labelEn: 'Materials',
    permissions: [
      { code: 'material:view', labelZh: '查看材料', labelEn: 'View materials' },
      { code: 'material:manage', labelZh: '新建、编辑、停用材料', labelEn: 'Manage materials' },
      { code: 'material:import', labelZh: '导入材料', labelEn: 'Import materials' },
      { code: 'material:export', labelZh: '导出材料', labelEn: 'Export materials' },
      { code: 'material:category:manage', labelZh: '管理材料分类', labelEn: 'Manage material categories' },
    ],
  },
  {
    key: 'inquiry',
    labelZh: '询价管理',
    labelEn: 'RFQs',
    permissions: [
      { code: 'inquiry:view', labelZh: '查看询价单', labelEn: 'View RFQs' },
      { code: 'inquiry:create', labelZh: '新建、编辑草稿', labelEn: 'Create and edit drafts' },
      { code: 'inquiry:spec', labelZh: '上传规格书与产品图', labelEn: 'Upload specifications and images' },
      { code: 'inquiry:submit', labelZh: '提交审批', labelEn: 'Submit for approval' },
      { code: 'inquiry:approve', labelZh: '审批询价单', labelEn: 'Approve RFQs' },
      { code: 'inquiry:invite', labelZh: '维护受邀供应商', labelEn: 'Manage invited suppliers' },
      { code: 'inquiry:publish', labelZh: '发布轮次', labelEn: 'Publish rounds' },
      { code: 'inquiry:remind', labelZh: '催报', labelEn: 'Send reminders' },
      { code: 'inquiry:deadline', labelZh: '延期', labelEn: 'Extend deadlines' },
      { code: 'inquiry:open', labelZh: '开标、提前截止', labelEn: 'Open bids / close early' },
      { code: 'inquiry:evaluate', labelZh: '比价、入围与议价', labelEn: 'Compare, shortlist and negotiate' },
      { code: 'inquiry:award', labelZh: '定标', labelEn: 'Award' },
      { code: 'inquiry:changeSpec', labelZh: '发起规格变更', labelEn: 'Change specifications' },
      { code: 'inquiry:cancel', labelZh: '取消询价单', labelEn: 'Cancel RFQs' },
      { code: 'inquiry:export', labelZh: '导出比价矩阵', labelEn: 'Export comparison matrix' },
      { code: 'inquiry:accessLog', labelZh: '查看规格下载日志', labelEn: 'View download log' },
    ],
  },
  {
    key: 'contract',
    labelZh: '合同管理',
    labelEn: 'Contracts',
    permissions: [
      { code: 'contract:view', labelZh: '查看合同', labelEn: 'View contracts' },
      { code: 'contract:edit', labelZh: '编辑与提交合同', labelEn: 'Edit and submit contracts' },
      { code: 'contract:review', labelZh: '审核合同', labelEn: 'Review contracts' },
      { code: 'contract:approve', labelZh: '批准合同', labelEn: 'Approve contracts' },
    ],
  },
  {
    key: 'stats',
    labelZh: '统计分析',
    labelEn: 'Analytics',
    permissions: [
      { code: 'stats:view', labelZh: '查看统计看板', labelEn: 'View dashboard' },
      { code: 'report:view', labelZh: '查看报表', labelEn: 'View reports' },
      { code: 'report:export', labelZh: '导出报表与统计', labelEn: 'Export reports' },
      { code: 'points:adjust', labelZh: '调整供应商积分', labelEn: 'Adjust supplier points' },
    ],
  },
] as const satisfies readonly PermissionModule[];

export type PermissionCode = (typeof PERMISSION_TREE)[number]['permissions'][number]['code'];

export const PERMISSION_CODES: readonly PermissionCode[] = PERMISSION_TREE.flatMap((m) =>
  m.permissions.map((p) => p.code),
);

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSION_CODES);

export function isPermissionCode(value: string): value is PermissionCode {
  return PERMISSION_SET.has(value);
}
