// 系统参数（docs/05-状态机与权限.md §8）：key、默认值、校验规则、中英说明。
// 数据库 SystemParam 没有记录时取默认值。
import { z } from 'zod';

export const SYSTEM_PARAMS = {
  'company.profile': {
    schema: z.object({
      nameZh: z.string().trim().min(1).max(100),
      nameEn: z.string().trim().min(1).max(200),
      address: z.string().trim().max(200),
      phone: z.string().trim().max(50),
    }),
    defaultValue: { nameZh: '示例照明科技有限公司', nameEn: 'Example Lighting Co., Ltd.', address: '', phone: '' },
    descZh: '公司信息，显示在邮件抬头和供应商门户',
    descEn: 'Company profile shown in email headers and the supplier portal',
  },
  'seal.preOpenViewRoles': {
    schema: z.array(z.string().min(1).max(32)).max(20),
    defaultValue: [] as string[],
    descZh: '开标前可以查看报价内容的角色（默认没有任何角色）',
    descEn: 'Roles allowed to view quotation content before bid opening (none by default)',
  },
  'inquiry.minDeadlineHours': {
    schema: z.number().int().min(0).max(720),
    defaultValue: 1,
    descZh: '发布或延期时，截止时间至少比现在晚几小时',
    descEn: 'Minimum hours between now and the deadline when publishing or extending',
  },
  'reminder.autoHoursBeforeDeadline': {
    schema: z.number().int().min(0).max(720),
    defaultValue: 24,
    descZh: '截止前几小时自动催报未响应的供应商，0 表示关闭',
    descEn: 'Hours before the deadline to remind suppliers who have not responded (0 = off)',
  },
  'notify.sendResultToLosers': {
    schema: z.boolean(),
    defaultValue: true,
    descZh: '定标后是否给未中标供应商发送结果通知',
    descEn: 'Send a result notice to suppliers who were not awarded',
  },
  'points.rules': {
    schema: z.object({
      quoteOnTime: z.number().int().min(-100).max(100),
      fastResponse: z.number().int().min(-100).max(100),
      fastResponseHours: z.number().int().min(1).max(720),
      won: z.number().int().min(-100).max(100),
      noResponse: z.number().int().min(-100).max(100),
    }),
    defaultValue: { quoteOnTime: 2, fastResponse: 1, fastResponseHours: 24, won: 5, noResponse: -2 },
    descZh: '供应商积分规则',
    descEn: 'Supplier points rules',
  },
  'upload.limits': {
    schema: z.object({
      specDocMaxMB: z.number().int().min(1).max(200),
      imageMaxMB: z.number().int().min(1).max(50),
      attachmentMaxMB: z.number().int().min(1).max(200),
      imagesPerLine: z.number().int().min(1).max(50),
    }),
    defaultValue: { specDocMaxMB: 50, imageMaxMB: 10, attachmentMaxMB: 50, imagesPerLine: 10 },
    descZh: '上传限制',
    descEn: 'Upload limits',
  },
  'security.sessionHours': {
    schema: z.number().int().min(1).max(720),
    defaultValue: 12,
    descZh: '登录会话有效期（小时，有操作时自动续期）',
    descEn: 'Session lifetime in hours (renewed while active)',
  },
} as const;

export type SystemParamKey = keyof typeof SYSTEM_PARAMS;
export type SystemParamValue<K extends SystemParamKey> = z.infer<(typeof SYSTEM_PARAMS)[K]['schema']>;

export const SYSTEM_PARAM_KEYS = Object.keys(SYSTEM_PARAMS) as SystemParamKey[];

export function isSystemParamKey(value: string): value is SystemParamKey {
  return Object.prototype.hasOwnProperty.call(SYSTEM_PARAMS, value);
}
