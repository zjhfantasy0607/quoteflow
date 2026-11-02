#!/usr/bin/env node
// 交付文档的 Word 版本（待确认事项 B-77）：把 docs/交付/*.md 连同 images/ 里的截图转换成 docs/交付/word/*.docx。
// Markdown 是唯一来源，改了 Markdown 以后重新执行，不要直接改 Word。
// 交付文档之间的链接写成《书名》，指向仓库里其他文档的链接写成仓库路径；有 5 列及以上表格的文档用横向 A4。
//
//   npm run docs:word
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Tab,
  TabStopType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import { Lexer } from 'marked';

const root = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(root, 'docs', '交付');
const outDir = join(srcDir, 'word');

const PRODUCT = 'QuoteFlow 询盘报价平台';
const FONT = 'Microsoft YaHei';
const MONO = { ascii: 'Consolas', hAnsi: 'Consolas', cs: 'Consolas', eastAsia: FONT };
const EMOJI_FONT = 'Segoe UI Emoji';
// 配色取自前端 apps/web/src/styles/main.css（--qf-navy、--el-color-primary）
const NAVY = '0B1F3A';
const TEAL = '0F766E';
const TEXT = '1F2933';
const MUTED = '667085';
const LINE = 'D0D7E1';
const HEAD_FILL = 'E8F2F1';
const CODE_FILL = 'F4F6F8';
const CODE_INLINE_FILL = 'F0F2F5';
const COMMENT = '6B7280';

// 长度单位是缇（1 cm ≈ 567 缇），字号单位是半磅
const A4 = { short: 11906, long: 16838 };
const MARGIN = { top: 1304, bottom: 1247, left: 1134, right: 1134, header: 680, footer: 624 };
const SIZE = { title: 52, body: 21, table: 18, code: 18, small: 17 };
const CELL_MARGIN = { top: 57, bottom: 57, left: 100, right: 100 };
const TWIPS_PER_PX = 15; // 图片尺寸按 96 px / 英寸
const LIST_INDENT = 420;
// 微软雅黑在 Word 里的单倍行距约为字号的 1.7 倍，偏松：正文、表格、代码用固定行距，图片和标题用单倍
const exact = (line) => ({ line, lineRule: LineRuleType.EXACT });
const LEADING = { body: exact(340), table: exact(280), code: exact(270) };
const SINGLE = { line: 240, lineRule: LineRuleType.AUTO };

const CJK = /[\u2e80-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;
const EMOJI = /(\p{Extended_Pictographic}\uFE0F?)/u;

/** 文字的大致宽度，单位是字号：中日韩与全角字符、emoji 算 1，其他算 0.55 */
function textWidth(text) {
  let width = 0;
  for (const ch of text) width += CJK.test(ch) || EMOJI.test(ch) ? 1 : ch === ' ' ? 0.3 : 0.55;
  return width;
}

/** 不能断行的最长片段（连续的西文、数字、代码）的宽度 */
function longestChunk(text) {
  return Math.max(
    0,
    ...text.split(/[\s\u2e80-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]+/).map(textWidth),
  );
}

function imageSize(data) {
  if (data.readUInt32BE(0) === 0x89504e47)
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  if (data.toString('ascii', 0, 3) === 'GIF')
    return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  for (let i = 2; i + 9 < data.length;) {
    const marker = data[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: data.readUInt16BE(i + 7), height: data.readUInt16BE(i + 5) };
    }
    i += 2 + data.readUInt16BE(i + 2);
  }
  throw new Error('Unsupported image format');
}

/** 链接目标：交付文档之间写成《书名》，仓库里的其他文件写成仓库路径，站外链接保留超链接 */
function linkTarget(href) {
  if (/^(https?|mailto):/.test(href)) return { url: href };
  const file = decodeURI(href.split('#')[0]);
  if (!file) return {};
  const abs = resolve(srcDir, file);
  if (dirname(abs) === srcDir && extname(abs) === '.md') return { sibling: true };
  return { path: relative(root, abs).split('\\').join('/') };
}

/** 行内内容的纯文本（算列宽、取标题用），链接按 linkTarget 的写法 */
function plain(tokens) {
  return tokens
    .map((t) => {
      if (t.type === 'link') {
        const target = linkTarget(t.href);
        if (target.sibling) return `《${plain(t.tokens)}》`;
        if (target.path) return target.path;
      }
      return t.tokens ? plain(t.tokens) : (t.text ?? '');
    })
    .join('');
}

function textRuns(text, style, ctx) {
  // 源文件里的软换行：中文之间直接相连，其他情况换成空格
  const joined = text.replace(/[ \t]*\n[ \t]*/g, (m, offset, s) =>
    CJK.test(s[offset - 1] ?? '') && CJK.test(s[offset + m.length] ?? '') ? '' : ' ',
  );
  // 直双引号按段内出现的次序换成中文的“”（代码里的不换）
  const quoted = joined.replace(/"/g, () => {
    ctx.quoteOpen = !ctx.quoteOpen;
    return ctx.quoteOpen ? '“' : '”';
  });
  return quoted
    .split(EMOJI)
    .filter(Boolean)
    .map((part) => new TextRun({ ...style, text: part, ...(EMOJI.test(part) ? { font: EMOJI_FONT } : {}) }));
}

function codeRun(text, style) {
  return new TextRun({
    text,
    bold: style.bold,
    color: style.color,
    size: (style.size ?? SIZE.body) - 1,
    font: MONO,
    noProof: true,
    shading: { type: ShadingType.CLEAR, fill: CODE_INLINE_FILL, color: 'auto' },
  });
}

/** 一段（或一个单元格）的行内内容 */
function paragraphRuns(tokens, ctx, style = {}) {
  ctx.quoteOpen = false;
  return inlineRuns(tokens, ctx, style);
}

function inlineRuns(tokens, ctx, style) {
  return tokens.flatMap((t) => {
    switch (t.type) {
      case 'strong':
        return inlineRuns(t.tokens, ctx, { ...style, bold: true });
      case 'em':
        return inlineRuns(t.tokens, ctx, { ...style, italics: true });
      case 'del':
        return inlineRuns(t.tokens, ctx, { ...style, strike: true });
      case 'codespan':
        return [codeRun(t.text, style)];
      case 'br':
        return [new TextRun({ break: 1 })];
      case 'image':
        return [imageRun(t, ctx)];
      case 'link': {
        const target = linkTarget(t.href);
        if (target.url) {
          const children = inlineRuns(t.tokens, ctx, { ...style, color: TEAL, underline: {} });
          return [new ExternalHyperlink({ link: target.url, children })];
        }
        if (target.sibling) return textRuns(`《${plain(t.tokens)}》`, style, ctx);
        if (target.path) return [codeRun(target.path, style)];
        return inlineRuns(t.tokens, ctx, style);
      }
      default:
        return t.tokens ? inlineRuns(t.tokens, ctx, style) : textRuns(t.text ?? '', style, ctx);
    }
  });
}

function imageRun(t, ctx) {
  const file = resolve(srcDir, decodeURI(t.href));
  const data = readFileSync(file);
  const { width, height } = imageSize(data);
  // 截图最宽 14 cm（满版宽度时每页只放得下一张，页底空得多），且留出边框线的宽度；原图分辨率不变，放大仍清楚
  const maxWidth = Math.min(ctx.textWidth - 60, 7938) / TWIPS_PER_PX;
  const maxHeight = (ctx.textHeight * 0.7) / TWIPS_PER_PX;
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  const ext = extname(file).slice(1).toLowerCase();
  return new ImageRun({
    type: ext === 'jpeg' ? 'jpg' : ext,
    data,
    transformation: { width: Math.floor(width * scale), height: Math.floor(height * scale) },
    altText: { name: t.text, title: t.text, description: t.text },
    outline: { type: 'solidFill', solidFillType: 'rgb', value: LINE, width: 9525 },
  });
}

/** 单独成段的图片：居中，下面是"图 n 说明" */
function figure(t, ctx) {
  ctx.figures += 1;
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { ...SINGLE, before: 120, after: 80 },
      children: [imageRun(t, ctx)],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { ...LEADING.table, after: 240 },
      children: textRuns(`图 ${ctx.figures}  ${t.text}`, { size: SIZE.table, color: MUTED }, {}),
    }),
  ];
}

function heading(t, ctx) {
  if (t.depth === 1) {
    ctx.title = plain(t.tokens);
    return [
      new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: PRODUCT, size: 24, bold: true, color: TEAL })],
      }),
      new Paragraph({ heading: HeadingLevel.TITLE, children: paragraphRuns(t.tokens, ctx) }),
    ];
  }
  const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][t.depth - 2];
  return [
    new Paragraph({ heading: level ?? HeadingLevel.HEADING_4, children: paragraphRuns(t.tokens, ctx) }),
  ];
}

function orderedListReference(ctx, start) {
  const reference = `ordered-${ctx.lists.length + 1}`;
  ctx.lists.push({
    reference,
    levels: ['%1.', '%2)', '%3.'].map((text, level) => ({
      level,
      text,
      start: level === 0 ? start : 1,
      format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level],
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: LIST_INDENT * (level + 1), hanging: 300 } } },
    })),
  });
  return reference;
}

function list(t, ctx, level = 0) {
  const reference = t.ordered ? orderedListReference(ctx, Number(t.start) || 1) : 'bullet';
  const blocks = [];
  for (const item of t.items) {
    let numbered = false;
    for (const b of item.tokens) {
      if (b.type === 'list') blocks.push(...list(b, ctx, level + 1));
      else if (b.type === 'text' || b.type === 'paragraph') {
        // 同一项里第二段起不再编号，与编号后的文字对齐
        const position = numbered
          ? { indent: { left: LIST_INDENT * (level + 1) } }
          : { numbering: { reference, level } };
        numbered = true;
        blocks.push({ position, tokens: b.tokens ?? [b] });
      } else if (b.type !== 'space') blocks.push(...block(b, ctx));
    }
  }
  const lastText = blocks.findLastIndex((b) => !(b instanceof Paragraph || b instanceof Table));
  return blocks.map((b, i) =>
    b instanceof Paragraph || b instanceof Table
      ? b
      : new Paragraph({
          ...b.position,
          spacing: { after: i === lastText && level === 0 ? 160 : t.loose ? 120 : 60 },
          children: paragraphRuns(b.tokens, ctx),
        }),
  );
}

/** 列宽：短列（全部内容放得下一行）按内容给足，其余按内容长度分剩下的宽度，且不小于最长的不可断片段 */
function columnWidths(texts, total) {
  const em = SIZE.table * 10;
  const pad = CELL_MARGIN.left + CELL_MARGIN.right + 40;
  const columns = texts[0].map((_, j) => {
    const cells = texts.map((row) => row[j] ?? '');
    const widths = cells.map(textWidth);
    const max = Math.max(...widths);
    const avg = widths.reduce((a, b) => a + b, 0) / widths.length;
    const min = Math.max(widths[0], ...cells.map(longestChunk));
    return { max: max * em + pad, min: min * em + pad, want: ((max + avg) / 2) * em + pad };
  });
  const result = new Array(columns.length);
  let rest = total;
  let open = columns.map((c, j) => j);
  if (columns.reduce((sum, c) => sum + c.max, 0) <= total) {
    const sum = columns.reduce((s, c) => s + c.max, 0);
    columns.forEach((c, j) => (result[j] = (c.max * total) / sum));
  } else {
    for (;;) {
      const fair = rest / open.length;
      const fits = open.filter((j) => columns[j].max <= fair);
      if (fits.length === 0) break;
      for (const j of fits) {
        result[j] = columns[j].max;
        rest -= columns[j].max;
      }
      open = open.filter((j) => !fits.includes(j));
    }
    // 剩下的列按 want 分配，低于 min 的先给足 min 再分其他列
    for (;;) {
      const sum = open.reduce((s, j) => s + columns[j].want, 0);
      const short = open.filter((j) => (rest * columns[j].want) / sum < columns[j].min);
      if (short.length === 0 || short.length === open.length) {
        for (const j of open) result[j] = (rest * columns[j].want) / sum;
        break;
      }
      for (const j of short) {
        result[j] = columns[j].min;
        rest -= columns[j].min;
      }
      open = open.filter((j) => !short.includes(j));
    }
  }
  const rounded = result.map(Math.floor);
  rounded[rounded.length - 1] += total - rounded.reduce((a, b) => a + b, 0);
  return rounded;
}

function table(t, ctx) {
  const rows = [t.header, ...t.rows].map((row) => row.map((cell) => cell.tokens));
  const texts = rows.map((row) => row.map(plain));
  const widths = columnWidths(texts, ctx.textWidth);
  // 只有很短内容（如"是 / 否"、序号）的列居中
  const align = t.align.map((a, j) =>
    a === 'center' || (!a && texts.slice(1).every((row) => textWidth(row[j] ?? '') <= 4))
      ? AlignmentType.CENTER
      : a === 'right'
        ? AlignmentType.RIGHT
        : AlignmentType.LEFT,
  );
  const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
  const cell = (tokens, j, head) =>
    new TableCell({
      width: { size: widths[j], type: WidthType.DXA },
      margins: CELL_MARGIN,
      verticalAlign: head ? VerticalAlign.CENTER : VerticalAlign.TOP,
      ...(head ? { shading: { type: ShadingType.CLEAR, fill: HEAD_FILL, color: 'auto' } } : {}),
      children: [
        new Paragraph({
          alignment: align[j],
          spacing: { ...LEADING.table, before: 0, after: 0 },
          children: paragraphRuns(tokens, ctx, {
            size: SIZE.table,
            ...(head ? { bold: true, color: NAVY } : {}),
          }),
        }),
      ],
    });
  return [
    new Table({
      width: { size: ctx.textWidth, type: WidthType.DXA },
      columnWidths: widths,
      layout: TableLayoutType.FIXED,
      borders: Object.fromEntries(
        ['top', 'bottom', 'left', 'right', 'insideHorizontal', 'insideVertical'].map((k) => [k, border]),
      ),
      rows: rows.map(
        (row, i) =>
          new TableRow({
            tableHeader: i === 0,
            cantSplit: true,
            children: row.map((tokens, j) => cell(tokens, j, i === 0)),
          }),
      ),
    }),
    new Paragraph({ spacing: { ...exact(160), before: 0, after: 0 }, children: [] }),
  ];
}

/** 代码块：等宽字体、浅灰底，# 后面的注释用灰色 */
function codeBlock(t) {
  const lines = t.text.split('\n');
  const border = { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 5 };
  return lines.map((line, i) => {
    const comment = t.lang === 'bash' || t.lang === 'sh' ? /(^|\s)(#.*)$/.exec(line) : null;
    const parts = comment
      ? [
          [line.slice(0, comment.index + comment[1].length), TEXT],
          [comment[2], COMMENT],
        ]
      : [[line, TEXT]];
    return new Paragraph({
      shading: { type: ShadingType.CLEAR, fill: CODE_FILL, color: 'auto' },
      border: { top: border, bottom: border, left: border, right: border },
      indent: { left: 130, right: 130 },
      keepNext: i < lines.length - 1,
      keepLines: true,
      spacing: { ...LEADING.code, before: i === 0 ? 80 : 0, after: i === lines.length - 1 ? 200 : 0 },
      children: parts
        .filter(([text]) => text)
        .map(([text, color]) => new TextRun({ text, color, font: MONO, size: SIZE.code, noProof: true })),
    });
  });
}

function block(t, ctx) {
  switch (t.type) {
    case 'heading':
      return heading(t, ctx);
    case 'paragraph': {
      const content = t.tokens.filter((x) => !(x.type === 'text' && !x.text.trim()));
      if (content.length === 1 && content[0].type === 'image') return figure(content[0], ctx);
      return [new Paragraph({ children: paragraphRuns(t.tokens, ctx) })];
    }
    case 'list':
      return list(t, ctx);
    case 'table':
      return table(t, ctx);
    case 'code':
      return codeBlock(t);
    case 'blockquote':
      return t.tokens.flatMap((b) =>
        b.type === 'paragraph'
          ? [
              new Paragraph({
                indent: { left: 240 },
                border: { left: { style: BorderStyle.SINGLE, size: 18, color: TEAL, space: 8 } },
                children: paragraphRuns(b.tokens, ctx, { color: MUTED }),
              }),
            ]
          : block(b, ctx),
      );
    case 'hr':
      return [
        new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 1 } } }),
      ];
    case 'space':
      return [];
    default:
      return t.text ? [new Paragraph({ children: textRuns(t.text, {}, {}) })] : [];
  }
}

function headerFooter(ctx) {
  const small = { size: SIZE.small, color: MUTED };
  return {
    headers: {
      first: new Header({ children: [] }),
      default: new Header({
        children: [
          new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: ctx.textWidth }],
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 4 } },
            children: [
              new TextRun({ ...small, text: PRODUCT }),
              new TextRun({ ...small, children: [new Tab(), ctx.title] }),
            ],
          }),
        ],
      }),
    },
    footers: Object.fromEntries(
      ['first', 'default'].map((k) => [
        k,
        new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  ...small,
                  children: ['第 ', PageNumber.CURRENT, ' 页 / 共 ', PageNumber.TOTAL_PAGES, ' 页'],
                }),
              ],
            }),
          ],
        }),
      ]),
    ),
  };
}

const styles = {
  default: {
    document: {
      run: { font: FONT, size: SIZE.body, color: TEXT, language: { value: 'en-US', eastAsia: 'zh-CN' } },
      paragraph: { spacing: { ...LEADING.body, after: 120 } },
    },
    title: {
      run: { font: FONT, size: SIZE.title, bold: true, color: NAVY },
      paragraph: {
        spacing: { ...SINGLE, before: 0, after: 360 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: TEAL, space: 10 } },
      },
    },
    heading1: {
      run: { font: FONT, size: 30, bold: true, color: NAVY },
      paragraph: { spacing: { ...SINGLE, before: 400, after: 160 }, keepNext: true, keepLines: true },
    },
    heading2: {
      run: { font: FONT, size: 26, bold: true, color: NAVY },
      paragraph: { spacing: { ...SINGLE, before: 280, after: 120 }, keepNext: true, keepLines: true },
    },
    heading3: {
      run: { font: FONT, size: 23, bold: true, color: NAVY },
      paragraph: { spacing: { ...SINGLE, before: 200, after: 100 }, keepNext: true, keepLines: true },
    },
  },
};

const bullet = {
  reference: 'bullet',
  levels: ['•', '◦', '▪'].map((text, level) => ({
    level,
    text,
    format: LevelFormat.BULLET,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: LIST_INDENT * (level + 1), hanging: 280 } } },
  })),
};

function convert(file) {
  const tokens = Lexer.lex(readFileSync(join(srcDir, file), 'utf8'));
  const landscape = tokens.some((t) => t.type === 'table' && t.header.length >= 5);
  const [pageWidth, pageHeight] = landscape ? [A4.long, A4.short] : [A4.short, A4.long];
  const ctx = {
    title: file.replace(/\.md$/, ''),
    textWidth: pageWidth - MARGIN.left - MARGIN.right,
    textHeight: pageHeight - MARGIN.top - MARGIN.bottom,
    figures: 0,
    lists: [bullet],
  };
  const children = tokens.flatMap((t) => block(t, ctx));
  const doc = new Document({
    creator: 'QuoteFlow',
    lastModifiedBy: 'QuoteFlow',
    title: `${PRODUCT} ${ctx.title}`,
    subject: PRODUCT,
    description: `由 docs/交付/${file} 生成（npm run docs:word）`,
    styles,
    numbering: { config: ctx.lists },
    sections: [
      {
        properties: {
          titlePage: true,
          page: {
            // docx 按纵向尺寸传入、由 orientation 交换宽高
            size: {
              width: A4.short,
              height: A4.long,
              orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: MARGIN,
          },
        },
        ...headerFooter(ctx),
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

mkdirSync(outDir, { recursive: true });
const sources = readdirSync(srcDir).filter((f) => f.endsWith('.md'));
const outputs = new Set(sources.map((f) => f.replace(/\.md$/, '.docx')));
// 没有对应 Markdown 的 Word（改名、删掉的文档，或别人放进来的文件）只提示，不自动删除
for (const stale of readdirSync(outDir).filter((f) => f.endsWith('.docx') && !outputs.has(f))) {
  console.warn(`${relative(root, join(outDir, stale))} 没有对应的 Markdown，确认不需要后手动删除。`);
}
for (const file of sources) {
  const out = join(outDir, file.replace(/\.md$/, '.docx'));
  try {
    writeFileSync(out, await convert(file));
  } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') {
      console.error(`${relative(root, out)} 被占用，先在 Word 里关闭它再执行。`);
      process.exit(1);
    }
    throw err;
  }
  console.log(relative(root, out));
}
