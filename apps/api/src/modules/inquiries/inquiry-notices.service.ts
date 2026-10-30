import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import type { Inquiry, Prisma, Supplier } from '../../generated/prisma/client';
import type { SupplierNotice } from '../../infra/mail/mail-templates';
import { MailService, supplierMailLanguage } from '../../infra/mail/mail.service';

/** 要通知的报价单连同供应商 */
export interface NoticeQuote {
  id: string;
  supplier: Supplier;
}

type NoticeInquiry = Pick<Inquiry, 'id' | 'formalNo' | 'title' | 'ownerId'>;

/**
 * 发给受邀供应商的询价通知（M07）：收件人是联系邮箱、抄送抄送邮箱，语言按首选语言（R07-5）；
 * 只带正式询价号和标题，不含项目号、其他供应商和金额。都在调用方的事务里入队（I-10）
 */
@Injectable()
export class InquiryNoticesService {
  constructor(
    private readonly mail: MailService,
    private readonly config: AppConfig,
  ) {}

  /** R07-4、R07-7：每家一封；同一张报价单只发一次邀请 */
  async invitation(
    tx: Prisma.TransactionClient,
    inquiry: NoticeInquiry,
    quotes: NoticeQuote[],
    data: { deadline: Date; lineCount: number },
  ): Promise<void> {
    const buyer = await this.buyer(tx, inquiry);
    for (const q of quotes) {
      await this.mail.enqueue(tx, {
        ...this.envelope(inquiry, q, `INVITATION:${q.id}`),
        templateKey: 'invitation',
        data: { ...this.base(inquiry, q, buyer), ...data, link: this.link(q) },
      });
    }
  }

  /** R07-8 手动催报每次都发；R07-9 自动催报传 bizKey 防重复 */
  async reminder(
    tx: Prisma.TransactionClient,
    inquiry: NoticeInquiry,
    quotes: NoticeQuote[],
    data: { deadline: Date },
    bizKey?: (q: NoticeQuote) => string,
  ): Promise<void> {
    const buyer = await this.buyer(tx, inquiry);
    for (const q of quotes) {
      await this.mail.enqueue(tx, {
        ...this.envelope(inquiry, q, bizKey?.(q)),
        templateKey: 'reminder',
        data: { ...this.base(inquiry, q, buyer), ...data, link: this.link(q) },
      });
    }
  }

  /** R07-10 延期 */
  async deadlineChanged(
    tx: Prisma.TransactionClient,
    inquiry: NoticeInquiry,
    quotes: NoticeQuote[],
    data: { previousDeadline: Date; deadline: Date },
  ): Promise<void> {
    const buyer = await this.buyer(tx, inquiry);
    for (const q of quotes) {
      await this.mail.enqueue(tx, {
        ...this.envelope(inquiry, q),
        templateKey: 'change.deadline',
        data: { ...this.base(inquiry, q, buyer), ...data, link: this.link(q) },
      });
    }
  }

  /** R07-11 发布后取消；同一张报价单只发一次 */
  async cancelled(
    tx: Prisma.TransactionClient,
    inquiry: NoticeInquiry,
    quotes: NoticeQuote[],
    reason: string,
  ): Promise<void> {
    const buyer = await this.buyer(tx, inquiry);
    for (const q of quotes) {
      await this.mail.enqueue(tx, {
        ...this.envelope(inquiry, q, `CHANGE:CANCEL:${q.id}`),
        templateKey: 'change.cancel',
        data: { ...this.base(inquiry, q, buyer), reason },
      });
    }
  }

  /** R10-5 开标：只发给进入评标的供应商；同一张报价单只发一次 */
  async opening(
    tx: Prisma.TransactionClient,
    inquiry: NoticeInquiry,
    quotes: NoticeQuote[],
    data: { openedAt: Date },
  ): Promise<void> {
    const buyer = await this.buyer(tx, inquiry);
    for (const q of quotes) {
      await this.mail.enqueue(tx, {
        ...this.envelope(inquiry, q, `OPENING:${q.id}`),
        templateKey: 'opening',
        data: { ...this.base(inquiry, q, buyer), ...data, link: this.link(q) },
      });
    }
  }

  /** 采购联系人：询价负责人的姓名和邮箱（没有邮箱时只写姓名） */
  private async buyer(
    tx: Prisma.TransactionClient,
    inquiry: NoticeInquiry,
  ): Promise<SupplierNotice['buyer']> {
    return tx.user.findUniqueOrThrow({ where: { id: inquiry.ownerId }, select: { name: true, email: true } });
  }

  private envelope(inquiry: NoticeInquiry, q: NoticeQuote, bizKey?: string) {
    return {
      language: supplierMailLanguage(q.supplier),
      to: [q.supplier.contactEmail],
      cc: q.supplier.ccEmails,
      supplierId: q.supplier.id,
      inquiryId: inquiry.id,
      ...(bizKey ? { bizKey } : {}),
    };
  }

  private base(inquiry: NoticeInquiry, q: NoticeQuote, buyer: SupplierNotice['buyer']): SupplierNotice {
    return {
      contactName: q.supplier.contactName,
      supplier: { nameZh: q.supplier.nameZh, nameEn: q.supplier.nameEn },
      // 只有审批通过（有正式询价号）的询价单才能发布
      inquiry: { formalNo: inquiry.formalNo!, title: inquiry.title },
      buyer,
    };
  }

  /** 门户里的报价单（R07-5） */
  private link(q: NoticeQuote): string {
    return `${this.config.get('APP_BASE_URL')}/portal/quotes/${q.id}`;
  }
}
