// Converts the report's Markdown into a formatted Word document:
// A4, Arial 11pt, 1.5 line spacing, header, "Page X of Y" footer, automatic contents,
// headings, tables, bullet/numbered lists, images with captions, code listings, references.
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, Footer, Header, PageNumber, TableOfContents, LevelFormat, ImageRun, LineRuleType,
  Tab, TabStopType, LeaderType,
} = require('docx');

const [, , input, output] = process.argv;
const baseDir = path.dirname(input);
const lines = fs.readFileSync(input, 'utf8').split('\n');

const FONT = 'Arial';
const CODE_FONT = 'Consolas';
const TABLE_WIDTH = 9026; // A4 width minus 1" margins, in DXA
const ACCENT = '1F3864';

// inline markdown: **bold**, _italic_ / *italic*, `code`
function inline(text, base = {}) {
  const runs = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|(?<![A-Za-z0-9])_(?:[^_`]|`[^`]*`)+_(?![A-Za-z0-9])|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const tok = m[0];
    if (tok.startsWith('**')) runs.push(...inline(tok.slice(2, -2), { ...base, bold: true }));
    else if (tok.startsWith('`')) runs.push(new TextRun({ text: tok.slice(1, -1), ...base, font: CODE_FONT, size: base.size ? base.size - 1 : 20 }));
    else runs.push(...inline(tok.slice(1, -1), { ...base, italics: true }));
    last = m.index + tok.length;
  }
  if (last < text.length) runs.push(new TextRun({ text: text.slice(last), ...base }));
  return runs;
}

const para = (text, opts = {}, runBase = {}) => new Paragraph({ children: inline(text, runBase), ...opts });

function caption(label, text) {
  return new Paragraph({
    keepNext: true, alignment: AlignmentType.LEFT, spacing: { before: 200, after: 80 },
    children: [new TextRun({ text: `${label} `, bold: true, size: 20 }), ...inline(text, { size: 20, italics: true })],
  });
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function buildTable(rows) {
  const header = rows[0];
  const body = rows.slice(2);
  const n = header.length;
  const cols = header.map((h, i) => [h, ...body.map((r) => r[i] || '')]);
  const len = cols.map((c) => Math.max(6, ...c.map((x) => x.length)));
  const floor = cols.map((c) => Math.max(...c.flatMap((x) => x.replace(/[`*_]/g, '').split(/\s+/)).map((w) => w.length)) * 110 + 240);
  const total = len.reduce((a, b) => a + b, 0);
  let widths = len.map((l, k) => Math.max(floor[k], Math.round((l / total) * TABLE_WIDTH)));
  const sum = widths.reduce((a, b) => a + b, 0);
  if (sum > TABLE_WIDTH) {
    const excess = sum - TABLE_WIDTH;
    const slack = widths.map((w, k) => Math.max(0, w - floor[k]));
    const slackSum = slack.reduce((a, b) => a + b, 0) || 1;
    widths = widths.map((w, k) => Math.round(w - (excess * slack[k]) / slackSum));
  }
  widths[widths.length - 1] += TABLE_WIDTH - widths.reduce((a, b) => a + b, 0);

  const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (text, i, isHeader) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA },
    borders,
    shading: isHeader ? { type: ShadingType.CLEAR, fill: ACCENT, color: 'auto' } : undefined,
    margins: { top: 50, bottom: 50, left: 90, right: 90 },
    children: [new Paragraph({
      keepNext: true, spacing: { line: 240, before: 0, after: 0 },
      children: text ? inline(text, { size: 18, ...(isHeader ? { bold: true, color: 'FFFFFF' } : {}) }) : [new TextRun({ text: '', size: 18 })],
    })],
  });
  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: header.map((h, i) => cell(h, i, true)) }),
      ...body.map((r) => new TableRow({ cantSplit: true, children: Array.from({ length: n }, (_, i) => cell(r[i] || '', i, false)) })),
    ],
  });
}

const children = [];
let i = 0;

// Cover page: everything before the first '---'
const cover = [];
while (i < lines.length && lines[i].trim() !== '---') cover.push(lines[i++]);
i++;
children.push(new Paragraph({ spacing: { before: 2000 } }));
for (const l of cover) {
  if (l.startsWith('# ')) {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 },
      children: [new TextRun({ text: l.slice(2), bold: true, size: 44, color: ACCENT })] }));
  } else if (l.startsWith('### ')) {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 900 },
      children: [new TextRun({ text: l.slice(4), size: 28, color: '2E5597' })] }));
  } else if (l.trim()) {
    children.push(para(l, { alignment: AlignmentType.CENTER, spacing: { after: 160 } }, { size: 24 }));
  }
}

let inReferences = false;
let listInstance = 0;
while (i < lines.length) {
  const line = lines[i];
  const t = line.trim();

  if (t === '---') { i++; continue; }

  if (line.startsWith('## ')) {
    const text = line.slice(3);
    inReferences = /^References/i.test(text);
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun(text)] }));
    if (/^Contents$/i.test(text)) {
      // TOC_JSON (heading -> page) gives a fixed list for PDF export; otherwise Word builds it from a field.
      if (process.env.TOC_JSON) {
        const pages = JSON.parse(fs.readFileSync(process.env.TOC_JSON, 'utf8'));
        for (const l of lines.slice(lines.findIndex((x) => x.trim() === '---') + 1)) { // skip the cover
          const h = l.match(/^(##|###) (.*)$/);
          if (!h || /^Contents$/i.test(h[2])) continue;
          const sub = h[1] === '###';
          children.push(new Paragraph({
            indent: { left: sub ? 480 : 0 }, spacing: { before: sub ? 0 : 100, after: 30, line: 276 },
            tabStops: [{ type: TabStopType.RIGHT, position: TABLE_WIDTH, leader: LeaderType.DOT }],
            children: [
              new TextRun({ text: h[2], bold: !sub, size: sub ? 20 : 22 }),
              new TextRun({ children: [new Tab()], size: sub ? 20 : 22 }),
              new TextRun({ text: String(pages[h[2]] ?? ''), bold: !sub, size: sub ? 20 : 22 }),
            ],
          }));
        }
      } else {
        children.push(new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }));
      }
      i++;
      while (i < lines.length && !lines[i].startsWith('## ')) i++;
      continue;
    }
    i++; continue;
  }
  if (line.startsWith('### ')) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, children: [new TextRun(line.slice(4))] }));
    i++; continue;
  }
  if (line.startsWith('#### ')) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, keepNext: true, children: [new TextRun(line.slice(5))] }));
    i++; continue;
  }

  if (t.startsWith('|')) {
    const rows = [];
    while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(splitRow(lines[i++]));
    children.push(buildTable(rows));
    children.push(new Paragraph({ spacing: { after: 100 } }));
    continue;
  }

  const img = t.match(/^!\[(Figure \d+:)\s*([^\]]*)\]\(([^)]+)\)$/);
  if (img) {
    const buf = fs.readFileSync(path.join(baseDir, img[3]));
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20); // PNG header
    const width = 600;
    const height = Math.min(Math.round((h / w) * width), 820);
    const scaledWidth = Math.round(width * (height / Math.round((h / w) * width)));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 160, after: 60, line: 240, lineRule: LineRuleType.AUTO },
      children: [new ImageRun({ type: 'png', data: buf, transformation: { width: scaledWidth, height } })] }));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
      children: [new TextRun({ text: `${img[1]} `, bold: true, size: 20 }), ...inline(img[2], { size: 20, italics: true })] }));
    i++; continue;
  }

  if (t.startsWith('```')) {
    i++;
    const code = [];
    while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++]);
    i++;
    code.forEach((c, k) => children.push(new Paragraph({
      keepNext: k < code.length - 1, keepLines: true,
      shading: { type: ShadingType.CLEAR, fill: 'F3F4F1', color: 'auto' },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: '8EAADB', space: 6 } },
      spacing: { before: k === 0 ? 100 : 0, after: k === code.length - 1 ? 160 : 0, line: 240 },
      children: [new TextRun({ text: c || ' ', font: CODE_FONT, size: 16 })],
    })));
    continue;
  }

  const cap = t.match(/^\*\*((?:Table|Listing) [A-Z]?\d+:)\*\*\s*(.*)$/);
  if (cap) { children.push(caption(cap[1], cap[2])); i++; continue; }

  const bullet = line.match(/^- (.*)$/);
  if (bullet) { children.push(para(bullet[1], { numbering: { reference: 'bullet', level: 0 }, spacing: { after: 60 } })); i++; continue; }
  const num = line.match(/^\d+\. (.*)$/);
  if (num) {
    if (!/^\d+\. /.test(lines[i - 1] || '')) listInstance++; // a new list restarts at 1
    children.push(para(num[1], { numbering: { reference: 'numbers', level: 0, instance: listInstance }, spacing: { after: 60 } }));
    i++; continue;
  }

  if (inReferences && t) { children.push(para(t, { indent: { left: 567, hanging: 567 }, spacing: { after: 120, line: 276 } })); i++; continue; }

  if (t) children.push(para(t, { alignment: AlignmentType.JUSTIFIED }));
  i++;
}

const doc = new Document({
  creator: 'IoThings report',
  title: 'IoThings Sensors Database: Design and Implementation Report',
  styles: {
    default: { document: { run: { font: FONT, size: 22 }, paragraph: { spacing: { line: 360, after: 120 } } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, color: ACCENT, font: FONT },
        paragraph: { spacing: { before: 240, after: 200 }, outlineLevel: 0,
          border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 4 } } } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, color: '2E5597', font: FONT },
        paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 23, bold: true, color: '2E5597', font: FONT },
        paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullet', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: 'numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },
  features: { updateFields: true },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } }, titlePage: true },
    headers: {
      default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: 'IoThings Sensors Database', size: 16, color: '808080' })] })] }),
      first: new Header({ children: [new Paragraph({})] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: 'Page ', size: 18 }), new TextRun({ children: [PageNumber.CURRENT], size: 18 }),
          new TextRun({ text: ' of ', size: 18 }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18 })] })] }),
      first: new Footer({ children: [new Paragraph({})] }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(output, buf); console.log('written', output); });
