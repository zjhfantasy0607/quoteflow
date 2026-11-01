import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { EN, clearSelect, confirmBox, dialog, fmt, formItem, L, login, pdf, pick, toast } from './helpers';

/**
 * M17 §2.1 浏览器主流程：PD 建单传规格 → 采购主管审批 → 采购员邀请发布 → 供应商 A 在线报价、B 用 Excel 报价、
 * C 拒绝 → 提前截止 → 开标 → 比价 → 入围议价 → 成交 → 定标 → 合同审核、批准。
 * 供应商：A = SUP10001（中文）、B = SUP10002（中英对照）、C = SUP10006（英文账号）
 */
const SUPPLIERS = {
  a: { code: 'SUP10001', user: 'sales@huaxin.example.com' },
  b: { code: 'SUP10002', user: 'bd@zhuoyue.example.com' },
  c: { code: 'SUP10006', user: 'kevin@brightsource.example.com' },
};
const TITLE = '浏览器主流程询价';
/** PPL-LED 的必填列（灯珠分类的变体加了 4 列） */
const LED_VALUES: Record<string, string> = {
  power_w: '0.5',
  cct_k: '3000',
  cri_ra: '80',
  luminous_flux_lm: '60.5',
  unit_price_incl_tax: '0.12',
  tax_rate: '13',
  lead_time_days: '30',
};

/** 门户首页"待报价"里点开这张询价 */
async function openPortalQuote(page: Page, title: string): Promise<void> {
  await page.locator('[data-card="pendingQuotes"] .wb-item', { hasText: title }).locator('a').click();
  await page.waitForURL(/\/portal\/quotes\/\w+/);
}

test.describe.serial('主流程', () => {
  let inquiryId = '';
  let formalNo = '';
  let contractUrl = '';
  let portalQuoteUrl = '';

  const detail = (page: Page, tab?: string) =>
    page.goto(`/inquiries/${inquiryId}${tab ? `?tab=${tab}` : ''}`);

  test('PD 建单、选材料、传规格书、提交审批', async ({ browser }) => {
    const page = await login(browser, 'pd.wang');
    await page.goto('/inquiries/new');
    await formItem(page, L.inquiries.fields.projectNo).locator('input').fill('PJ-E2E-001');
    await formItem(page, L.inquiries.fields.title).locator('input').fill(TITLE);
    await pick(page, formItem(page, L.inquiries.fields.materialCategory), '2835 灯珠');
    await pick(page, formItem(page, L.inquiries.fields.owner), '张三');
    await page.getByRole('button', { name: L.inquiries.edit.saveDraft }).click();
    await page.waitForURL(/\/inquiries\/\w+\/edit/);
    inquiryId = page.url().split('/inquiries/')[1].split('/')[0];

    // 从材料库选用 MAT-000001，数量 10000
    await page.getByRole('button', { name: L.inquiries.lines.pickMaterials }).click();
    const picker = dialog(page, L.inquiries.picker.title);
    await picker.getByPlaceholder(L.inquiries.picker.searchPlaceholder).fill('MAT-000001');
    await picker.getByPlaceholder(L.inquiries.picker.searchPlaceholder).press('Enter');
    await picker.locator('.el-table__row', { hasText: 'MAT-000001' }).locator('.el-checkbox').click();
    await picker.locator('.el-input input').last().fill('10000');
    await picker.getByRole('button', { name: L.inquiries.picker.add }).click();
    await expect(picker).toBeHidden();
    await expect(
      page.locator('.el-table__row', { hasText: 'MAT-000001' }).locator('visible=true'),
    ).toHaveCount(1);

    // 整单规格书
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: '主流程规格书.pdf', mimeType: 'application/pdf', buffer: pdf() });
    await expect(page.getByText('主流程规格书.pdf').first()).toBeVisible();

    await page.getByRole('button', { name: L.inquiries.edit.submit, exact: true }).click();
    await confirmBox(page);
    await toast(page, L.inquiries.edit.submitted);
  });

  test('采购主管在"待我审批"里审批通过', async ({ browser }) => {
    const page = await login(browser, 'manager.zhang');
    await page.goto('/inquiries/approvals');
    await page.locator('.el-table__row', { hasText: TITLE }).getByRole('button').first().click();
    await page.waitForURL(new RegExp(`/inquiries/${inquiryId}`));
    await page.getByRole('button', { name: L.inquiries.detail.approve, exact: true }).click();
    await confirmBox(page);
    await expect(page.locator('.el-message').first()).toContainText('RFQ-');
    formalNo = /RFQ-\d{6}-\d{4}/.exec((await page.locator('.el-message').first().textContent()) ?? '')![0];
  });

  test('采购员选择三家供应商并发布', async ({ browser }) => {
    const page = await login(browser, 'buyer.zhang');
    await detail(page, 'invitees');
    await clearSelect(formItem(page, L.inquiries.invitees.filters.materialCategory));
    for (const s of Object.values(SUPPLIERS)) {
      await page
        .locator('.el-table__row', { hasText: s.code })
        .locator('visible=true')
        .first()
        .locator('.el-checkbox')
        .click();
    }
    await page.getByRole('button', { name: L.inquiries.invitees.save }).click();
    await toast(page, fmt(L.inquiries.invitees.saved, { count: 3 }));

    await page.getByRole('button', { name: L.inquiries.detail.actions.publish }).click();
    const publish = dialog(page, L.inquiries.publish.title);
    await publish.locator('.el-date-editor input').click();
    await page
      .locator('.el-picker-panel__shortcut')
      .filter({ hasText: fmt(L.inquiries.publish.shortcut, { days: 3 }) })
      .click();
    await publish.getByRole('button', { name: L.inquiries.publish.confirm, exact: true }).click();
    await toast(page, fmt(L.inquiries.publish.done, { count: 3 }));
    expect(formalNo).toMatch(/^RFQ-/);
  });

  test('供应商 A 在线填写报价并提交', async ({ browser }) => {
    const page = await login(browser, SUPPLIERS.a.user);
    await openPortalQuote(page, TITLE);
    await page.getByRole('button', { name: L.ppl.table.editAll }).first().click();
    const drawer = page.locator('.el-drawer.ppl-form');
    for (const header of await drawer.locator('.el-collapse-item__header:not(.is-active)').all()) {
      await header.click();
    }
    for (const [key, value] of Object.entries(LED_VALUES)) {
      await drawer.locator(`[data-field="${key}"] input`).fill(value);
    }
    await drawer.getByRole('button', { name: L.ppl.form.done }).click();
    await page.getByPlaceholder(L.portal.form.remarkPlaceholder).fill('含税含运费');
    await page.getByRole('button', { name: L.portal.form.submit, exact: true }).click();
    await confirmBox(page);
    await toast(page, fmt(L.portal.form.submitted, { no: 1 }));
  });

  test('供应商 B 下载锁定 Excel、填好后导入并提交', async ({ browser }) => {
    const page = await login(browser, SUPPLIERS.b.user);
    await openPortalQuote(page, TITLE);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: L.portal.form.downloadTemplate }).click(),
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(readFileSync((await download.path())!) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('报价 Quote')!;
    const keys = ws.getRow(3).values as unknown[];
    for (const [key, value] of Object.entries({ ...LED_VALUES, unit_price_incl_tax: '0.11' })) {
      ws.getCell(4, keys.indexOf(key)).value = Number(value);
    }
    const filled = Buffer.from(await wb.xlsx.writeBuffer());

    await page.getByRole('button', { name: L.portal.form.importExcel }).click();
    const importer = dialog(page, L.portal.form.importTitle);
    await importer.locator('input[type="file"]').setInputFiles({
      name: 'quote.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: filled,
    });
    await importer.locator('.el-dialog__footer .el-button--primary').click();
    await toast(page, L.portal.form.imported);
    await expect(importer).toBeHidden();
    await page.getByRole('button', { name: L.portal.form.submit, exact: true }).click();
    await confirmBox(page);
    await toast(page, fmt(L.portal.form.submitted, { no: 1 }));
  });

  test('供应商 C（英文账号）拒绝报价', async ({ browser }) => {
    const page = await login(browser, SUPPLIERS.c.user);
    await openPortalQuote(page, TITLE);
    await page.getByRole('button', { name: EN.portal.form.decline }).click();
    const decline = dialog(page, EN.portal.decline.title);
    await pick(page, formItem(decline, EN.portal.decline.reasonCode), 'lead time');
    await decline.getByPlaceholder(EN.portal.decline.reasonPlaceholder).fill('Fully booked this month.');
    await decline.getByRole('button', { name: EN.portal.decline.confirm }).click();
    await toast(page, EN.portal.decline.done);
  });

  test('采购主管提前截止（三家都已响应）并开标', async ({ browser }) => {
    const page = await login(browser, 'manager.zhang');
    await detail(page, 'responses');
    await page.getByRole('button', { name: L.inquiries.responses.closeEarly }).click();
    await confirmBox(page);
    await toast(page, L.inquiries.responses.closedEarly);
    await page.getByRole('button', { name: L.inquiries.detail.actions.open, exact: true }).click();
    await confirmBox(page);
    await toast(page, L.inquiries.detail.opened);
  });

  test('采购员比价、入围两家、给 A 发目标价', async ({ browser }) => {
    const page = await login(browser, 'buyer.zhang');
    await detail(page, 'evaluation');
    for (const code of [SUPPLIERS.a.code, SUPPLIERS.b.code]) {
      await page
        .locator('.el-table__row', { hasText: code })
        .locator('visible=true')
        .first()
        .locator('.el-checkbox')
        .click();
      await toast(page, L.inquiries.evaluation.shortlistSaved);
    }
    await detail(page, 'negotiation');
    // 第一个页签是 A（入围顺序）
    const form = page.locator('.offer').locator('visible=true').first();
    await form.getByPlaceholder(L.negotiation.form.pricePlaceholder).first().fill('0.10');
    await form.getByPlaceholder(L.negotiation.form.contentPlaceholder).fill('年用量较大，希望单价降到 0.10');
    await form.getByRole('button', { name: L.negotiation.form.submit }).click();
    await toast(page, L.inquiries.negotiation.offered);
  });

  test('供应商 A 接受目标价（成交，生成第 2 版）', async ({ browser }) => {
    const page = await login(browser, SUPPLIERS.a.user);
    await page.locator('[data-card="negotiations"] .wb-item', { hasText: TITLE }).locator('a').click();
    await page.waitForURL(/\/portal\/quotes\/\w+/);
    portalQuoteUrl = new URL(page.url()).pathname;
    await page.getByRole('button', { name: L.portal.negotiation.accept, exact: true }).click();
    await confirmBox(page);
    await toast(page, fmt(L.portal.negotiation.accepted, { no: 2 }));
  });

  test('采购主管定标 A，生成合同草稿', async ({ browser }) => {
    const page = await login(browser, 'manager.zhang');
    await detail(page, 'evaluation');
    await page.getByRole('button', { name: L.inquiries.award.button, exact: true }).click();
    const award = dialog(page, L.inquiries.award.title);
    await award.locator('.el-table__row', { hasText: '华信' }).locator('.el-radio').click();
    await award.getByPlaceholder(L.inquiries.award.commentPlaceholder).fill('议价后单价最低');
    await award.getByRole('button', { name: L.inquiries.award.confirm }).click();
    await confirmBox(page);
    await expect(page.locator('.completed-banner')).toBeVisible();
  });

  test('采购员补全合同并提交审核，主管审核通过，批准人批准', async ({ browser }) => {
    const buyer = await login(browser, 'buyer.zhang');
    await detail(buyer);
    await buyer
      .getByRole('link', { name: L.inquiries.detail.viewContract })
      .or(buyer.getByRole('button', { name: L.inquiries.detail.viewContract }))
      .click();
    await buyer.waitForURL(/\/contracts\/\w+$/);
    contractUrl = new URL(buyer.url()).pathname;
    await buyer.getByRole('button', { name: L.contracts.actions.edit, exact: true }).click();
    const edit = dialog(buyer, L.contracts.edit.title);
    const date = formItem(edit, L.contracts.fields.deliveryDate).locator('input');
    await date.fill('2027-01-15');
    await date.press('Enter');
    await formItem(edit, L.contracts.fields.deliveryPlace)
      .locator('input')
      .fill('深圳市宝安区示例工业园 3 栋');
    await formItem(edit, L.contracts.fields.paymentTerms).locator('input').fill('货到验收后 30 天付款');
    await edit.locator('.el-dialog__footer .el-button--primary').click();
    await toast(buyer, L.contracts.edit.saved);
    await buyer.getByRole('button', { name: L.contracts.actions.submit, exact: true }).click();
    await confirmBox(buyer);
    await toast(buyer, L.contracts.submitted);

    const manager = await login(browser, 'manager.zhang');
    await manager.goto(contractUrl);
    await manager.getByRole('button', { name: L.contracts.actions.reviewApprove, exact: true }).click();
    await confirmBox(manager);
    await toast(manager, L.contracts.reviewed);

    const approver = await login(browser, 'approver.zhao');
    await approver.goto(contractUrl);
    await approver.getByRole('button', { name: L.contracts.actions.approve, exact: true }).click();
    await confirmBox(approver);
    await toast(approver, L.contracts.approved);
  });

  test('关键页面中英文各截一次图', async ({ browser }) => {
    const pages: [string, string, string][] = [
      ['manager.zhang', '/workbench', 'workbench'],
      ['buyer.zhang', `/inquiries/${inquiryId}?tab=evaluation`, 'evaluation'],
      ['buyer.zhang', `/inquiries/${inquiryId}?tab=negotiation`, 'negotiation'],
      ['approver.zhao', contractUrl, 'contract'],
      [SUPPLIERS.a.user, '/portal', 'portal-home'],
      [SUPPLIERS.a.user, portalQuoteUrl, 'portal-quote'],
    ];
    for (const lang of ['zh-CN', 'en-US'] as const) {
      for (const [user, path, name] of pages) {
        const page = await login(browser, user);
        // 右上角语言切换（同时保存到账号）
        await page.locator('.el-radio-button', { hasText: lang === 'zh-CN' ? '中文' : 'English' }).click();
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('.el-loading-mask').locator('visible=true')).toHaveCount(0);
        await page.screenshot({ path: `e2e/.artifacts/screenshots/${lang}/${name}.png`, fullPage: true });
      }
    }
    expect(formalNo).toMatch(/^RFQ-/);
  });
});
