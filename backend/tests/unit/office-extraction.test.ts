import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { decodeXmlText, extractDoc, extractPptx, extractSvg } from '../../src/modules/documents/ingestion/office-extraction.js';
import { ExtractionError } from '../../src/modules/documents/ingestion/text-extraction.js';

const slide = (...paragraphs: string[]) =>
  `<p:sld><p:cSld><p:spTree>${paragraphs.map((p) => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`).join('')}</p:spTree></p:cSld></p:sld>`;

async function pptx(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('decodeXmlText', () => {
  it('decodes the basic entities and numeric references, and nothing else', () => {
    expect(decodeXmlText('A &amp; B &lt;c&gt; &quot;d&quot; &#233; &#x41;')).toBe('A & B <c> "d" é A');
    expect(decodeXmlText('&secreto;')).toBe('&secreto;');
  });
});

describe('extractPptx', () => {
  it('reads each slide as a page, in numeric order, one paragraph per line', async () => {
    const data = await pptx({
      'ppt/slides/slide10.xml': slide('Cierre'),
      'ppt/slides/slide2.xml': slide('Hechos', 'El actor fue despedido &amp; no cobró'),
      'ppt/slides/slide1.xml': slide('Demanda por despido'),
      'ppt/slideMasters/slideMaster1.xml': slide('No es una diapositiva'),
    });
    const pages = await extractPptx(data);
    expect(pages.map((page) => page.page)).toEqual([1, 2, 10]);
    expect(pages[1]!.text).toBe('Hechos\n\nEl actor fue despedido & no cobró');
  });

  it('says so when the file is not a presentation', async () => {
    await expect(extractPptx(Buffer.from('no soy un zip'))).rejects.toThrow(ExtractionError);
    await expect(extractPptx(await pptx({ 'otro.xml': '<x/>' }))).rejects.toThrow(/no tiene diapositivas/);
  });
});

describe('extractSvg', () => {
  it('reads the text of the drawing, not its code or its scripts', () => {
    const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><title>Croquis del accidente</title>
      <script>alert('x')</script><text x="1" y="2">Calle <tspan>San Martín</tspan></text><rect width="5"/></svg>`;
    const [page] = extractSvg(Buffer.from(svg));
    expect(page!.text).toContain('Croquis del accidente');
    expect(page!.text).toContain('Calle San Martín');
    expect(page!.text).not.toContain('alert');
    expect(page!.text).not.toContain('rect');
  });

  it('does not expand the entities of a doctype', () => {
    const svg = '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg><text>Hola &x;</text></svg>';
    expect(extractSvg(Buffer.from(svg))[0]!.text).toBe('Hola &x;');
  });

  it('explains that a drawing without text can not be read', () => {
    expect(() => extractSvg(Buffer.from('<svg><rect width="5"/></svg>'))).toThrow(/solo un dibujo/);
  });
});

describe('extractDoc', () => {
  it('reports a damaged Word 97-2003 file instead of failing with a stack trace', async () => {
    const damaged = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    await expect(extractDoc(damaged)).rejects.toThrow(ExtractionError);
  });
});
