import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { ClockService } from '../../common/clock/clock.service';
import { AppConfig } from '../../config/app-config';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ParamsService } from '../params/params.service';
import { layout, type MailLang, type MailLanguage, type RenderedMail } from './mail-layout';
import { MAIL_TEMPLATES, type MailTemplateDataMap, type MailTemplateKey } from './mail-templates';

type Client = PrismaService | Prisma.TransactionClient;

export interface EnqueueInput<K extends MailTemplateKey> {
  templateKey: K;
  language: MailLanguage;
  to: string[];
  cc?: string[];
  data: MailTemplateDataMap[K];
  supplierId?: string | null;
  userId?: string | null;
  inquiryId?: string | null;
  /** 幂等键：相同 bizKey 只会入队一次 */
  bizKey?: string;
}

/** 收件人语言：内部用户按账号语言，供应商按首选语言（R02-8） */
export function userMailLanguage(user: { locale: string }): MailLanguage {
  return user.locale === 'en-US' ? 'en-US' : 'zh-CN';
}

export function supplierMailLanguage(supplier: { preferredLanguage: string }): MailLanguage {
  const v = supplier.preferredLanguage;
  return v === 'en-US' || v === 'bilingual' ? v : 'zh-CN';
}

@Injectable()
export class MailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly params: ParamsService,
    private readonly config: AppConfig,
    private readonly clock: ClockService,
  ) {}

  async render<K extends MailTemplateKey>(
    templateKey: K,
    language: MailLanguage,
    data: MailTemplateDataMap[K],
  ): Promise<RenderedMail> {
    const company = await this.params.get('company.profile');
    const ctx = { company, baseUrl: this.config.get('APP_BASE_URL') };
    const template = MAIL_TEMPLATES[templateKey];
    const langs: MailLang[] = language === 'bilingual' ? ['zh-CN', 'en-US'] : [language];
    return layout(
      langs.map((lang) => ({ lang, part: template.render(lang, data, ctx) })),
      ctx,
    );
  }

  /**
   * 入队：在调用方的事务里写入发件箱，入队即渲染（R02-7）。
   * 用 createMany + skipDuplicates，bizKey 重复时静默跳过，不会让事务失败。
   */
  async enqueue<K extends MailTemplateKey>(client: Client, input: EnqueueInput<K>): Promise<void> {
    const to = [...new Set(input.to.map((a) => a.trim().toLowerCase()).filter(Boolean))];
    if (to.length === 0) return;
    const cc = [...new Set((input.cc ?? []).map((a) => a.trim().toLowerCase()))].filter((a) => a && !to.includes(a));
    const rendered = await this.render(input.templateKey, input.language, input.data);
    await client.emailMessage.createMany({
      data: [
        {
          type: MAIL_TEMPLATES[input.templateKey].type,
          language: input.language,
          toAddresses: to,
          ccAddresses: cc,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          status: 'PENDING',
          nextAttemptAt: this.clock.now(),
          supplierId: input.supplierId ?? null,
          userId: input.userId ?? null,
          inquiryId: input.inquiryId ?? null,
          bizKey: input.bizKey ?? null,
        },
      ],
      skipDuplicates: true,
    });
  }
}

/** 实际发送：smtp 连 Mailpit 或真实 SMTP；log 只写日志（e2e 测试用） */
@Injectable()
export class MailTransport {
  private readonly logger = new Logger('Mail');
  private transporter: Transporter | null = null;

  constructor(private readonly config: AppConfig) {}

  async send(message: { toAddresses: string[]; ccAddresses: string[]; subject: string; html: string; text: string }): Promise<void> {
    if (this.config.get('MAIL_TRANSPORT') === 'log') {
      this.logger.debug(`[log transport] to=${message.toAddresses.join(',')} subject=${message.subject}`);
      return;
    }
    const user = this.config.get('SMTP_USER');
    this.transporter ??= createTransport({
      host: this.config.get('SMTP_HOST'),
      port: this.config.get('SMTP_PORT'),
      secure: this.config.get('SMTP_SECURE'),
      auth: user ? { user, pass: this.config.get('SMTP_PASS') ?? '' } : undefined,
    });
    await this.transporter.sendMail({
      from: this.config.get('MAIL_FROM'),
      to: message.toAddresses.join(', '),
      cc: message.ccAddresses.length ? message.ccAddresses.join(', ') : undefined,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }
}
