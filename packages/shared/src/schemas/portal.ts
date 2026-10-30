import { z } from 'zod';
import { PORTAL_QUOTE_TABS } from '../status';
import { optionalText, pageQuerySchema } from './common';

// ---------- 供应商门户（M08） ----------

/** GET /api/portal/quotes（R08-1） */
export const portalQuoteListQuerySchema = pageQuerySchema.extend({
  /** 不传 = 全部 */
  tab: z.enum(PORTAL_QUOTE_TABS).optional(),
  /** 匹配正式询价号、标题 */
  keyword: optionalText(100),
});
export type PortalQuoteListQuery = z.infer<typeof portalQuoteListQuerySchema>;
export type PortalQuoteListParams = z.input<typeof portalQuoteListQuerySchema>;
