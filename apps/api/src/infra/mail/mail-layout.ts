// 邮件公共版式：公司名抬头 + 正文 + 页脚。bilingual 时中文在上、英文在下（docs/01 §10）。

export type MailLang = 'zh-CN' | 'en-US';
export type MailLanguage = MailLang | 'bilingual';

export interface MailContext {
  company: { nameZh: string; nameEn: string };
  baseUrl: string;
}

/** 单一语言的渲染结果：body 是 HTML 片段，text 是纯文本 */
export interface MailPart {
  subject: string;
  body: string;
  text: string;
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** 插入 HTML 的业务数据一律转义 */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function button(href: string, label: string): string {
  return `<p style="margin:20px 0"><a href="${esc(href)}" style="display:inline-block;padding:10px 20px;background:#0f766e;color:#ffffff;text-decoration:none;border-radius:4px">${esc(label)}</a></p><p style="color:#6b7280;font-size:12px;word-break:break-all">${esc(href)}</p>`;
}

const FOOTER: Record<MailLang, string> = {
  'zh-CN': '本邮件由 QuoteFlow 系统自动发送，请勿直接回复。',
  'en-US': 'This is an automated message from QuoteFlow. Please do not reply directly.',
};

export function layout(parts: { lang: MailLang; part: MailPart }[], ctx: MailContext): RenderedMail {
  const bilingual = parts.length > 1;
  const company = bilingual
    ? `${ctx.company.nameZh} / ${ctx.company.nameEn}`
    : parts[0].lang === 'zh-CN'
      ? ctx.company.nameZh
      : ctx.company.nameEn;
  const subject = parts.map((p) => p.part.subject).join(' / ');
  const body = parts
    .map((p) => p.part.body)
    .join('<hr style="margin:28px 0;border:none;border-top:1px dashed #d1d5db">');
  const footer = parts.map((p) => FOOTER[p.lang]).join('<br>');

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:24px 0;background:#f5f7fa;font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:6px;overflow:hidden">
<tr><td style="background:#0b1f3a;color:#ffffff;padding:16px 24px;font-size:16px;font-weight:600">${esc(company)}</td></tr>
<tr><td style="padding:24px;font-size:14px;line-height:1.7;color:#1f2937">${body}</td></tr>
<tr><td style="padding:12px 24px;color:#6b7280;font-size:12px;border-top:1px solid #eeeeee">${footer}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    company,
    '',
    parts.map((p) => p.part.text).join('\n\n----------------------------------------\n\n'),
    '',
    parts.map((p) => FOOTER[p.lang]).join('\n'),
  ].join('\n');

  return { subject, html, text };
}
