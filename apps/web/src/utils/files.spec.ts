import { describe, expect, it } from 'vitest';
import { acceptAttr, checkUpload, columnLetter, fileExtension, formatFileSize, previewMode } from './files';

const limits = { specDocMaxMB: 50, imageMaxMB: 10, attachmentMaxMB: 50, imagesPerLine: 10 };
const MB = 1024 * 1024;

describe('上传预检（R02-4，与后端同一份规则）', () => {
  it('R02-4 按类别限制扩展名，不区分大小写', () => {
    expect(checkUpload('SPEC_DOC', { name: '规格书.PDF', size: 1 }, limits)).toBeNull();
    expect(checkUpload('SPEC_DOC', { name: 'spec.xls', size: 1 }, limits)).toBeNull();
    expect(checkUpload('PRODUCT_IMAGE', { name: 'a.pdf', size: 1 }, limits)).toBe('type');
    expect(checkUpload('ATTACHMENT', { name: 'setup.exe', size: 1 }, limits)).toBe('type');
    expect(checkUpload('IMPORT', { name: 'materials.xls', size: 1 }, limits)).toBe('type');
    expect(checkUpload('ATTACHMENT', { name: 'noext', size: 1 }, limits)).toBe('type');
  });

  it('R02-4 大小上限取系统参数；还没取到参数时只查类型，大小交给后端', () => {
    expect(checkUpload('PRODUCT_IMAGE', { name: 'a.png', size: 10 * MB }, limits)).toBeNull();
    expect(checkUpload('PRODUCT_IMAGE', { name: 'a.png', size: 10 * MB + 1 }, limits)).toBe('size');
    expect(checkUpload('SPEC_DOC', { name: 'a.pdf', size: 51 * MB }, limits)).toBe('size');
    expect(checkUpload('SPEC_DOC', { name: 'a.pdf', size: 999 * MB }, null)).toBeNull();
  });

  it('accept 属性与允许的扩展名一致', () => {
    expect(acceptAttr('PRODUCT_IMAGE')).toBe('.png,.jpg,.jpeg,.webp');
    expect(acceptAttr('IMPORT')).toBe('.xlsx');
  });
});

describe('预览方式（A-17）', () => {
  it('PDF、图片内嵌预览，xlsx 表格预览，其他只能下载', () => {
    expect(previewMode('a.pdf')).toBe('pdf');
    expect(previewMode('photo.JPG')).toBe('image');
    expect(previewMode('data.xlsx')).toBe('sheet');
    expect(previewMode('old.xls')).toBe('none');
    expect(previewMode('spec.docx')).toBe('none');
  });
});

describe('格式化', () => {
  it('扩展名、文件大小、Excel 列名', () => {
    expect(fileExtension('a.b.PDF')).toBe('pdf');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(5 * MB)).toBe('5.0 MB');
    expect([0, 25, 26, 51, 701, 702].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AZ', 'ZZ', 'AAA']);
  });
});
