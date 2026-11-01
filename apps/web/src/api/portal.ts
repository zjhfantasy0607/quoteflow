import type {
  DeclineQuoteInput,
  NegotiationRespondParams,
  NegotiationThreadDto,
  Paginated,
  PortalQuoteDetailDto,
  PortalQuoteListItemDto,
  PortalQuoteListParams,
  PortalWorkbenchDto,
  QuoteFormParams,
  QuoteVersionDto,
  QuoteVersionSummaryDto,
  SupplierProfileDto,
} from '@quoteflow/shared';
import { get, http, post, put } from './http';

const quoteUrl = (id: string) => `/portal/quotes/${id}`;

/** 供应商门户（M08、M09、M11） */
export const portalApi = {
  quotes: (query: Partial<PortalQuoteListParams>) =>
    get<Paginated<PortalQuoteListItemDto>>('/portal/quotes', query),
  /** 404 由页面自己提示 */
  quote: (id: string) => get<PortalQuoteDetailDto>(quoteUrl(id), undefined, { silent: true }),
  profile: () => get<SupplierProfileDto>('/portal/profile'),
  /** 门户首页的待报价、议价待回复、最近结果（M16） */
  workbench: () => get<PortalWorkbenchDto>('/portal/workbench'),

  // 报价填报（M09）：取值校验错误（QUOTE_VALUES_INVALID）由页面定位到行和字段，所以不弹全局提示
  saveDraft: (id: string, body: QuoteFormParams) =>
    put<PortalQuoteDetailDto>(`${quoteUrl(id)}/draft`, body, { silent: true }),
  submit: (id: string, body: QuoteFormParams) =>
    post<PortalQuoteDetailDto>(`${quoteUrl(id)}/submit`, body, { silent: true }),
  decline: (id: string, body: DeclineQuoteInput) =>
    post<PortalQuoteDetailDto>(`${quoteUrl(id)}/decline`, body),
  versions: (id: string) => get<QuoteVersionSummaryDto[]>(`${quoteUrl(id)}/versions`),
  version: (id: string, versionNo: number) => get<QuoteVersionDto>(`${quoteUrl(id)}/versions/${versionNo}`),
  /** 锁定 Excel 下载地址（同源请求带会话 cookie） */
  excelTemplateUrl: (id: string) => `/api${quoteUrl(id)}/excel-template`,
  /** 错误由 ExcelImportDialog 展示 */
  importExcel: async (id: string, file: File): Promise<PortalQuoteDetailDto> => {
    const form = new FormData();
    form.append('file', file);
    return (await http.post<PortalQuoteDetailDto>(`${quoteUrl(id)}/excel-import`, form, { silent: true }))
      .data;
  },

  /** 议价（M11）：自己报价单的议价线程，回复后返回最新的线程 */
  negotiation: (id: string) => get<NegotiationThreadDto>(`${quoteUrl(id)}/negotiation`),
  respondNegotiation: (id: string, body: NegotiationRespondParams) =>
    post<NegotiationThreadDto>(`${quoteUrl(id)}/negotiation/respond`, body),
};
