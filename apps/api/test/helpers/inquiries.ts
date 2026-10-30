import type { InquiryDetailDto, InquiryLineDto } from '@quoteflow/shared';
import type { Agent } from './auth';

/** 建单请求体（材料类别必填，其余有默认值） */
export function inquiryBody(materialCategoryId: string, extra: Record<string, unknown> = {}) {
  return {
    projectNo: 'PJ-TEST-001',
    title: '测试询价',
    materialCategoryId,
    currency: 'CNY',
    ...extra,
  };
}

/** 手工询价行请求体 */
export function manualLineBody(categoryId: string, extra: Record<string, unknown> = {}) {
  return {
    source: 'MANUAL',
    nameZh: '手工物料',
    spec: 'SPEC-1',
    unitCode: 'PCS',
    categoryId,
    quantity: '100',
    ...extra,
  };
}

export async function createDraftInquiry(
  agent: Agent,
  materialCategoryId: string,
  extra: Record<string, unknown> = {},
): Promise<InquiryDetailDto> {
  return (await agent.post('/api/inquiries').send(inquiryBody(materialCategoryId, extra)).expect(201)).body;
}

export async function addManualLine(
  agent: Agent,
  inquiryId: string,
  categoryId: string,
  extra: Record<string, unknown> = {},
): Promise<InquiryLineDto> {
  return (
    await agent
      .post(`/api/inquiries/${inquiryId}/rounds/1/lines`)
      .send(manualLineBody(categoryId, extra))
      .expect(201)
  ).body;
}

/** 建单 → 加一行手工行 → 提交 → 审批通过（M07 起发布轮次的前置条件） */
export async function createApprovedInquiry(
  creator: Agent,
  approver: Agent,
  categoryId: string,
  extra: Record<string, unknown> = {},
): Promise<InquiryDetailDto> {
  const draft = await createDraftInquiry(creator, categoryId, extra);
  await addManualLine(creator, draft.id, categoryId);
  await creator.post(`/api/inquiries/${draft.id}/submit`).expect(200);
  return (await approver.post(`/api/inquiries/${draft.id}/approve`).send({}).expect(200)).body;
}

/** 整体替换受邀名单（第 1 轮发布前） */
export async function setInvitees(agent: Agent, inquiryId: string, supplierIds: string[]): Promise<void> {
  await agent.put(`/api/inquiries/${inquiryId}/invitees`).send({ supplierIds }).expect(200);
}

/** 设好受邀名单后发布第 1 轮（询价单要已审批通过） */
export async function publishRound(
  agent: Agent,
  inquiryId: string,
  supplierIds: string[],
  deadline: Date,
): Promise<InquiryDetailDto> {
  await setInvitees(agent, inquiryId, supplierIds);
  return (
    await agent
      .post(`/api/inquiries/${inquiryId}/rounds/1/publish`)
      .send({ deadline: deadline.toISOString() })
      .expect(200)
  ).body;
}
