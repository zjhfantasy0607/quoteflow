import { contentDisposition, fixUploadName } from './file-types';

describe('contentDisposition（M17 安全复查：头部注入）', () => {
  it('中文文件名：filename 回退成下划线，filename* 按 UTF-8 编码', () => {
    expect(contentDisposition('attachment', '规格书.pdf')).toBe(
      `attachment; filename="___.pdf"; filename*=UTF-8''%E8%A7%84%E6%A0%BC%E4%B9%A6.pdf`,
    );
  });

  it('引号、反斜杠、分号、换行不会提前结束参数或拆出新的头部', () => {
    const header = contentDisposition('inline', 'a"b\\c;d\r\nSet-Cookie: x=1.pdf');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toBe(
      `inline; filename="a_b_c;d__Set-Cookie: x=1.pdf"; ` +
        `filename*=UTF-8''a%22b%5Cc%3Bd%0D%0ASet-Cookie%3A%20x%3D1.pdf`,
    );
    // 整个头部只有 filename="…" 的一对引号（分号在引号里是文件名的一部分）
    expect(header.match(/"/g)).toHaveLength(2);
  });

  it("filename* 里 ' ( ) * 也编码（不在 RFC 5987 的 attr-char 里）", () => {
    expect(contentDisposition('attachment', "it's (v2)*.xlsx")).toBe(
      `attachment; filename="it's (v2)*.xlsx"; filename*=UTF-8''it%27s%20%28v2%29%2A.xlsx`,
    );
  });

  it('fixUploadName：multer 按 latin1 解析的 UTF-8 名还原，本来就是 Unicode 的不动', () => {
    expect(fixUploadName(Buffer.from('报价.xlsx', 'utf8').toString('latin1'))).toBe('报价.xlsx');
    expect(fixUploadName('报价.xlsx')).toBe('报价.xlsx');
    expect(fixUploadName('plain.pdf')).toBe('plain.pdf');
  });
});
