import type {
  AttachInquiryFileInput,
  AuditLogDto,
  CopyLineFilesInput,
  CreateInquiryInput,
  CreateLineParams,
  FileAccessLogDto,
  ImportResultDto,
  InquiryApprovalDto,
  InquiryDetailDto,
  InquiryFileDto,
  InquiryInviteeDto,
  InquiryLineDto,
  InquiryListItemDto,
  InquiryListParams,
  InquiryRoundDto,
  InquiryUserOptionDto,
  InviteeCandidateDto,
  InviteeCandidatesParams,
  NegotiationOfferParams,
  NegotiationThreadDto,
  Paginated,
  QuoteVersionDto,
  RoundMatrixDto,
  RoundQuoteDetailDto,
  RoundResponsesDto,
  UpdateInquiryInput,
  UpdateLineParams,
} from '@quoteflow/shared';
import { del, get, http, post, put } from './http';

const roundPath = (id: string, roundNo: number) => `/inquiries/${id}/rounds/${roundNo}`;

export const inquiriesApi = {
  list: (query: Partial<InquiryListParams>) => get<Paginated<InquiryListItemDto>>('/inquiries', query),
  /** 待我审批 */
  pending: (query: { page?: number; pageSize?: number }) =>
    get<Paginated<InquiryListItemDto>>('/inquiries/approvals/pending', query),
  /** 负责人、PD 负责人下拉（需要 inquiry:create） */
  userOptions: () => get<InquiryUserOptionDto[]>('/inquiries/user-options'),
  /** 404 由页面自己提示 */
  get: (id: string) => get<InquiryDetailDto>(`/inquiries/${id}`, undefined, { silent: true }),
  create: (body: CreateInquiryInput) => post<InquiryDetailDto>('/inquiries', body, { silent: true }),
  update: (id: string, body: UpdateInquiryInput) =>
    put<InquiryDetailDto>(`/inquiries/${id}`, body, { silent: true }),
  submit: (id: string) => post<InquiryDetailDto>(`/inquiries/${id}/submit`),
  approve: (id: string, comment?: string) => post<InquiryDetailDto>(`/inquiries/${id}/approve`, { comment }),
  reject: (id: string, comment: string) => post<InquiryDetailDto>(`/inquiries/${id}/reject`, { comment }),
  cancel: (id: string, reason: string) => post<InquiryDetailDto>(`/inquiries/${id}/cancel`, { reason }),
  approvals: (id: string) => get<InquiryApprovalDto[]>(`/inquiries/${id}/approvals`),
  timeline: (id: string) => get<AuditLogDto[]>(`/inquiries/${id}/timeline`),
  /** 规格下载日志（需要 inquiry:accessLog） */
  accessLogs: (id: string, query: { page: number; pageSize: number }) =>
    get<Paginated<FileAccessLogDto>>(`/inquiries/${id}/file-access-logs`, query),

  round: (id: string, roundNo: number) => get<InquiryRoundDto>(roundPath(id, roundNo)),
  addLine: (id: string, roundNo: number, body: CreateLineParams) =>
    post<InquiryLineDto>(`${roundPath(id, roundNo)}/lines`, body, { silent: true }),
  addFromMaterials: (id: string, roundNo: number, items: { materialId: string; quantity: string }[]) =>
    post<InquiryLineDto[]>(`${roundPath(id, roundNo)}/lines/from-materials`, { items }, { silent: true }),
  updateLine: (id: string, roundNo: number, lineId: string, body: UpdateLineParams) =>
    put<InquiryLineDto>(`${roundPath(id, roundNo)}/lines/${lineId}`, body, { silent: true }),
  removeLine: (id: string, roundNo: number, lineId: string) =>
    del<InquiryRoundDto>(`${roundPath(id, roundNo)}/lines/${lineId}`),
  reorderLines: (id: string, roundNo: number, lineIds: string[]) =>
    put<InquiryRoundDto>(`${roundPath(id, roundNo)}/lines/order`, { lineIds }),
  /** 导入模板地址（ExcelImportDialog 用链接下载） */
  lineTemplateUrl: '/api/inquiries/lines/import-template',
  /** 错误由 ExcelImportDialog 展示 */
  importLines: async (id: string, roundNo: number, file: File): Promise<ImportResultDto> => {
    const form = new FormData();
    form.append('file', file);
    return (
      await http.post<ImportResultDto>(`${roundPath(id, roundNo)}/lines/import`, form, { silent: true })
    ).data;
  },

  attachFile: (id: string, roundNo: number, body: AttachInquiryFileInput) =>
    post<InquiryFileDto>(`${roundPath(id, roundNo)}/files`, body, { silent: true }),
  removeFile: (id: string, roundNo: number, inquiryFileId: string) =>
    del<{ ok: true }>(`${roundPath(id, roundNo)}/files/${inquiryFileId}`),
  copyFiles: (id: string, roundNo: number, body: CopyLineFilesInput) =>
    post<InquiryRoundDto>(`${roundPath(id, roundNo)}/files/copy`, body, { silent: true }),

  /** 受邀名单（M07） */
  invitees: (id: string) => get<InquiryInviteeDto[]>(`/inquiries/${id}/invitees`),
  /** 候选供应商（需要 inquiry:invite） */
  candidates: (id: string, query: Partial<InviteeCandidatesParams>) =>
    get<Paginated<InviteeCandidateDto>>(`/inquiries/${id}/invitee-candidates`, query),
  saveInvitees: (id: string, supplierIds: string[]) =>
    put<InquiryInviteeDto[]>(`/inquiries/${id}/invitees`, { supplierIds }),
  /** deadline 是 ISO 字符串（UTC） */
  publish: (id: string, roundNo: number, deadline: string) =>
    post<InquiryDetailDto>(`${roundPath(id, roundNo)}/publish`, { deadline }),
  lateInvite: (id: string, roundNo: number, supplierIds: string[]) =>
    post<InquiryDetailDto>(`${roundPath(id, roundNo)}/late-invite`, { supplierIds }),
  remind: (id: string, roundNo: number, quoteIds: string[]) =>
    post<InquiryDetailDto>(`${roundPath(id, roundNo)}/remind`, { quoteIds }),
  extendDeadline: (id: string, roundNo: number, deadline: string) =>
    put<InquiryDetailDto>(`${roundPath(id, roundNo)}/deadline`, { deadline }),
  /** 供应商响应（密封时只有状态字段，开标后另含合计） */
  responses: (id: string, roundNo: number) => get<RoundResponsesDto>(`${roundPath(id, roundNo)}/responses`),
  /** 提前截止、开标（M10，需要 inquiry:open） */
  closeEarly: (id: string, roundNo: number) =>
    post<InquiryDetailDto>(`${roundPath(id, roundNo)}/close-early`),
  open: (id: string, roundNo: number) => post<InquiryDetailDto>(`${roundPath(id, roundNo)}/open`),
  /** 采购方看某家的报价（需要 inquiry:evaluate）；密封、404 由页面自己提示 */
  quote: (id: string, roundNo: number, quoteId: string) =>
    get<RoundQuoteDetailDto>(`${roundPath(id, roundNo)}/quotes/${quoteId}`, undefined, { silent: true }),
  quoteVersion: (id: string, roundNo: number, quoteId: string, versionNo: number) =>
    get<QuoteVersionDto>(`${roundPath(id, roundNo)}/quotes/${quoteId}/versions/${versionNo}`),

  /** 比价矩阵（M11，需要 inquiry:evaluate）；密封由页签自己提示 */
  matrix: (id: string, roundNo: number) =>
    get<RoundMatrixDto>(`${roundPath(id, roundNo)}/matrix`, undefined, { silent: true }),
  /** 导出地址（downloadFile 用，需要 inquiry:export） */
  matrixExportUrl: (id: string, roundNo: number) => `${roundPath(id, roundNo)}/matrix/export`,
  /** 整份替换入围名单，返回调整后的矩阵 */
  shortlist: (id: string, roundNo: number, quoteIds: string[]) =>
    put<RoundMatrixDto>(`${roundPath(id, roundNo)}/shortlist`, { quoteIds }),

  /** 议价（M11，需要 inquiry:evaluate）：每个动作返回最新的议价线程 */
  negotiation: (quoteId: string) => get<NegotiationThreadDto>(`/quotes/${quoteId}/negotiation`),
  offer: (quoteId: string, body: NegotiationOfferParams) =>
    post<NegotiationThreadDto>(`/quotes/${quoteId}/negotiation/offer`, body),
  acceptCounter: (quoteId: string, messageId: string) =>
    post<NegotiationThreadDto>(`/quotes/${quoteId}/negotiation/accept`, { messageId }),
  closeNegotiation: (quoteId: string, content?: string) =>
    post<NegotiationThreadDto>(`/quotes/${quoteId}/negotiation/close`, { content }),
};
