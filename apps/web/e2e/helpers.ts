import { expect, type Browser, type Locator, type Page } from '@playwright/test';
import enUS from '../src/locales/en-US';
import zhCN from '../src/locales/zh-CN';

/** 界面文案直接取 locale 对象：文案改了测试跟着变，不在测试里抄中文 */
export const L = zhCN;
export const EN = enUS;
export const PASSWORD = 'Passw0rd!';

/** {name} 这类插值换成具体值 */
export function fmt(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const exact = (s: string) => new RegExp(`^\\s*${escape(s)}\\s*$`);

const sessions = new Map<string, Page>();

/**
 * 每个用户一个浏览器上下文（会话互不影响），第一次登录后复用：同一 IP 每分钟最多 10 次登录尝试（R01-15，成功的也算）。
 * 每次返回前回到该用户的首页
 */
export async function login(browser: Browser, username: string): Promise<Page> {
  const cached = sessions.get(username);
  if (cached && !cached.isClosed()) {
    await cached.goto(username.includes('@') ? '/portal' : '/workbench');
    return cached;
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/login');
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/(workbench|portal)/);
  sessions.set(username, page);
  return page;
}

/** 按标签找表单项（标签完全一致，避免"负责人"匹配到"PD 负责人"） */
export function formItem(scope: Page | Locator, label: string): Locator {
  // has: 里的定位器要相对页面写，不能带上外层的范围
  const page = 'page' in scope && typeof scope.page === 'function' ? scope.page() : (scope as Page);
  return scope
    .locator('.el-form-item')
    .filter({ has: page.locator('.el-form-item__label').filter({ hasText: exact(label) }) });
}

/** 当前弹出的下拉（el-select / el-tree-select） */
export function dropdown(page: Page): Locator {
  return page.locator('.el-select-dropdown, .el-select__popper').locator('visible=true').last();
}

/** 打开下拉并点选一项（普通下拉的选项或树形下拉的节点） */
export async function pick(page: Page, field: Locator, option: string): Promise<void> {
  await field.locator('.el-select__wrapper').click();
  const menu = dropdown(page);
  await menu
    .locator('.el-select-dropdown__item, .el-tree-node__content')
    .filter({ hasText: option })
    .first()
    .click();
  await expect(menu).toBeHidden();
}

/** 清空可清空的下拉 */
export async function clearSelect(field: Locator): Promise<void> {
  await field.locator('.el-select__wrapper').hover();
  await field.locator('.el-select__clear').click();
}

/** 确认框（ElMessageBox）点主按钮；有输入框时先填 */
export async function confirmBox(page: Page, input?: string): Promise<void> {
  const box = page.locator('.el-message-box').locator('visible=true');
  if (input !== undefined) await box.locator('input, textarea').first().fill(input);
  await box.locator('.el-button--primary').click();
  await expect(box).toBeHidden();
}

/** 等成功提示出现 */
export async function toast(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.locator('.el-message').filter({ hasText: text }).first()).toBeVisible();
}

/** 当前可见的对话框 */
export function dialog(page: Page, title?: string): Locator {
  const all = page.locator('.el-dialog').locator('visible=true');
  return title ? all.filter({ has: page.locator('.el-dialog__title', { hasText: title }) }) : all.last();
}

export function pdf(lines: string[] = ['QuoteFlow browser test']): Buffer {
  return Buffer.from(`%PDF-1.4\n${lines.join('\n')}\n%%EOF`);
}
