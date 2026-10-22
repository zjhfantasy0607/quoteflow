import type {
  AttachInquiryFileInput,
  AuditLogDto,
  CopyLineFilesInput,
  CreateInquiryInput,
  CreateLineParams,
  ImportResultDto,
  InquiryApprovalDto,
  InquiryDetailDto,
  InquiryFileDto,
  InquiryLineDto,
  InquiryListItemDto,
  InquiryListParams,
  InquiryRoundDto,
  InquiryUserOptionDto,
  Paginated,
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
};
