import type { NegotiationAutoCloseReason } from '@quoteflow/shared';
import type { Prisma } from '../../generated/prisma/client';

/**
 * 系统关闭这些轮次里进行中（OPEN / AGREED）的议价（05 §1 询价取消、§3 变更轮次发布、§5 定标）：每个追加一条
 * CLOSE 消息（content 是原因代码，前端翻译显示；记在触发动作的人名下），议价 → CLOSED。在调用方的事务里执行，
 * 调用方已锁住询价单。不发邮件（取消、定标、变更各有自己的通知）。返回关闭的个数
 */
export async function closeOpenNegotiations(
  tx: Prisma.TransactionClient,
  roundIds: string[],
  reason: NegotiationAutoCloseReason,
  actorId: string,
  now: Date,
): Promise<number> {
  const open = await tx.negotiation.findMany({
    where: { quote: { roundId: { in: roundIds } }, status: { in: ['OPEN', 'AGREED'] } },
    select: { id: true, messages: { select: { id: true, seq: true }, orderBy: { seq: 'desc' }, take: 1 } },
  });
  for (const n of open) {
    const last = n.messages[0];
    await tx.negotiationMessage.create({
      data: {
        negotiationId: n.id,
        seq: (last?.seq ?? 0) + 1,
        party: 'BUYER',
        type: 'CLOSE',
        content: reason,
        replyToId: last?.id ?? null,
        createdById: actorId,
        createdAt: now,
      },
    });
  }
  if (open.length > 0) {
    await tx.negotiation.updateMany({
      where: { id: { in: open.map((n) => n.id) } },
      data: { status: 'CLOSED', closedAt: now },
    });
  }
  return open.length;
}
