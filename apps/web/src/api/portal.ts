import type {
  Paginated,
  PortalQuoteDetailDto,
  PortalQuoteListItemDto,
  PortalQuoteListParams,
  SupplierProfileDto,
} from '@quoteflow/shared';
import { get } from './http';

/** 供应商门户（M08） */
export const portalApi = {
  quotes: (query: Partial<PortalQuoteListParams>) =>
    get<Paginated<PortalQuoteListItemDto>>('/portal/quotes', query),
  /** 404 由页面自己提示 */
  quote: (id: string) => get<PortalQuoteDetailDto>(`/portal/quotes/${id}`, undefined, { silent: true }),
  profile: () => get<SupplierProfileDto>('/portal/profile'),
};
