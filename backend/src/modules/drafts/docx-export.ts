import { AlignmentType, Document, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun } from 'docx';
import { parseMarkdownBlocks, type InlineRun, type MarkdownBlock } from './markdown-blocks.js';

const FONT = 'Times New Roman';

const toRuns = (runs: InlineRun[], breakBefore = false): TextRun[] =>
  runs.map(
    (run, i) =>
      new TextRun({
        text: run.text,
        bold: run.bold ?? false,
        italics: run.italic ?? false,
        ...(breakBefore && i === 0 && { break: 1 }),
      }),
  );

const HEADINGS = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 } as const;

function toParagraph(block: MarkdownBlock): Paragraph {
  switch (block.type) {
    case 'heading':
      return new Paragraph({ heading: HEADINGS[block.level], children: toRuns(block.runs) });
    case 'bullet':
      return new Paragraph({ numbering: { reference: 'bullets', level: 0 }, alignment: AlignmentType.JUSTIFIED, children: toRuns(block.runs) });
    case 'numbered':
      return new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        indent: { left: 567, hanging: 567 },
        children: [new TextRun({ text: `${block.marker}\t` }), ...toRuns(block.runs)],
      });
    case 'rule':
      return new Paragraph({ children: [] });
    case 'paragraph':
      return new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        // Each Markdown line becomes a line break inside the same paragraph.
        children: block.lines.flatMap((line, i) => toRuns(line, i > 0)),
      });
  }
}

const headingStyle = (id: string, name: string, size: number, centered: boolean) => ({
  id,
  name,
  basedOn: 'Normal',
  next: 'Normal',
  quickFormat: true,
  run: { font: FONT, size, bold: true, color: '000000' },
  paragraph: {
    spacing: { before: 240, after: 120 },
    ...(centered && { alignment: AlignmentType.CENTER }),
  },
});

/** A Word document with the usual format of a brief: Times New Roman 12, 1.5 spacing, justified. */
export async function draftToDocx(title: string, markdown: string): Promise<Buffer> {
  const document = new Document({
    title,
    creator: 'LexSearch',
    styles: {
      default: {
        document: { run: { font: FONT, size: 24 }, paragraph: { spacing: { line: 360, after: 120 } } },
      },
      paragraphStyles: [
        headingStyle('Heading1', 'Heading 1', 28, true),
        headingStyle('Heading2', 'Heading 2', 24, false),
        headingStyle('Heading3', 'Heading 3', 24, false),
      ],
    },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 567, hanging: 283 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        // A4 with 3 cm left and 2.5 cm top/right/bottom margins (in twentieths of a point).
        properties: { page: { margin: { top: 1418, right: 1418, bottom: 1418, left: 1701 } } },
        children: parseMarkdownBlocks(markdown).map(toParagraph),
      },
    ],
  });
  return Packer.toBuffer(document);
}
