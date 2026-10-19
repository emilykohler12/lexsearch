import { parse } from 'node-html-parser';
import { PDFParse } from 'pdf-parse';
import type { IsoDate } from '../../calendar/dates.js';
import { SourceUnavailableError, type EditionListing, type ListedNorm, type NormativeSource } from './normative-source.js';
import { PoliteClient, type PoliteClientOptions } from './polite-client.js';

const BASE_URL = 'https://www.boletindigital.misiones.gov.ar';
/** Editions kept in memory: the texts of the norms are read from them when the check asks for them. */
const MAX_CACHED_EDITIONS = 6;
/** What a «norm» needs to have to be worth keeping (a stray heading with nothing under it isn't). */
const MIN_NORM_CHARS = 80;

/** One edition of the bulletin as the page lists it: a number, a day and a PDF. */
export interface MisionesEdition {
  number: string;
  date: IsoDate;
  /** The supplement of a day (annexes, like the tables of the budget: hundreds of pages) is a second file with the same number. */
  supplement: boolean;
  /** Address of the PDF, already encoded. */
  path: string;
}

/** A norm cut out of an edition, with its text. */
export interface MisionesNorm extends ListedNorm {
  text: string;
  /** Page of the PDF where it starts. */
  page: number;
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/** «16/10/2026» → «2026-10-16». */
function isoFromSlashes(value: string): IsoDate | null {
  const match = /(\d{2})\/(\d{2})\/(\d{4})/.exec(value);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

/** The newest editions of the month, as the home page of the digital bulletin lists them. */
export function parseEditionList(html: string): MisionesEdition[] {
  const editions: MisionesEdition[] = [];
  const seen = new Set<string>();

  for (const card of parse(html).querySelectorAll('.tarjetaBoletin')) {
    const text = squash(card.text);
    const number = /Bolet[ií]n Nro:\s*(\d{1,7})/i.exec(text)?.[1];
    const date = isoFromSlashes(text);
    const href = card.querySelector('a[href*="/boletines/"]')?.getAttribute('href') ?? '';
    // Only the files of the bulletin itself: the address of a PDF is never taken from anything else.
    const file = /^\/boletines\/(\d{1,7})( sup)?\.pdf$/i.exec(href.trim());
    if (!number || !date || !file || file[1] !== number || seen.has(href)) continue;
    seen.add(href);
    editions.push({ number, date, supplement: Boolean(file[2]), path: encodeURI(href.trim()) });
  }
  return editions;
}

// ── Cutting an edition into norms ─────────────────────────────────────────────

/** The top of every page: «Pág. 2 BOLETÍN OFICIAL Nº…» on the even ones, «Posadas, Viernes 16 de… BOLETÍN OFICIAL Nº… Pág. 21» on the odd ones. */
const PAGE_HEADER = /^(?:Pág\.\s*\d+\s+BOLET[ÍI]N OFICIAL\b|Posadas,\s+\p{L}+\s+\d{1,2}\s+de\s+\p{L}+\s+de\s+\d{4}\s+BOLET[ÍI]N OFICIAL\b)/iu;
/** A code printed at the end of each norm (the number of the publication order). */
const PRINT_CODE = /\s*\bPS\d{4,}\s+V\d{3,}\s*$/;

/** Titles that open a part of the first section («sintetizados» are decrees that the bulletin prints in short). */
const SECTION_START = /^(DECRETOS(?: COMPLETOS| SINTETIZADOS)?|LEYES|RESOLUCIONES|DISPOSICIONES)$/;
/** Titles after which comes what isn't a provincial norm: municipalities, court notices, companies, calls, tenders. */
const SECTION_END = /^(MUNICIPALIDADES|EXPEDIENTES A SENTENCIA|SOCIEDADES|EDICTOS|CONVOCATORIAS|LICITACIONES|CONCURSOS|SEGUNDA SECCI[ÓO]N|TERCERA SECCI[ÓO]N|AVISOS)\b/;

/** «DECRETO N° 1104», «RESOLUCIÓN N° 367», «LEY XVI - N° 98»: always alone on its line and in capitals. */
const NORM_HEADER = /^(DECRETO|RESOLUCI[ÓO]N|DISPOSICI[ÓO]N|LEY)\s+(?:[IVXLC]+\s*[-–]\s*)?N[°ºo.]*\s*(\d[\d.]*)\s*(?:\(.*\))?$/;
/** What follows the heading of a real norm (and not of a mention in a table or an annex). */
const AFTER_HEADER = /^(POSADAS,\s*\d{1,2}\s+de\b|SANCIONAD|PROMULGAD|VISTO|EL (?:GOBERNADOR|PODER|MINISTRO|SECRETARIO)|LA (?:MINISTRA|C[ÁA]MARA))/i;

/** Lines of the organism that issues a resolution (the ministry is named right above its number). */
const ORGANISM_LINE = /^(MINISTERIO|SECRETAR[ÍI]A|SUBSECRETAR[ÍI]A|CONSEJO|INSTITUTO|DIRECCI[ÓO]N|AGENCIA|ENTE|FISCAL[ÍI]A|TRIBUNAL|UNIVERSIDAD|POLIC[ÍI]A|CONTADUR[ÍI]A|TESORER[ÍI]A|ADMINISTRACI[ÓO]N|LOTER[ÍI]A|CAJA|COMISI[ÓO]N|INSTITUCI[ÓO]N|PROCURACI[ÓO]N|CONTADOR|SINDICATURA|PODER)\b/;

/** A paragraph starts where the text says it does (the PDF breaks lines wherever the page does). */
const PARAGRAPH_START = /^(VISTO\b|CONSIDERANDO\b|QUE[,\s]|POR ELLO\b|POR TODO\b|ART[ÍI]CULO\b|EL GOBERNADOR\b|EL MINISTRO\b|LA MINISTRA\b|EL SECRETARIO\b|DECRETA\b|RESUELVE\b|ANEXO\b|POSADAS,)/i;

const KINDS: Record<string, { code: string; kind: string; category: string }> = {
  DECRETO: { code: 'D', kind: 'Decreto', category: 'DECRETOS' },
  RESOLUCION: { code: 'R', kind: 'Resolución', category: 'RESOLUCIONES' },
  DISPOSICION: { code: 'X', kind: 'Disposición', category: 'DISPOSICIONES' },
  LEY: { code: 'L', kind: 'Ley', category: 'LEYES' },
};
const kindOf = (word: string) => KINDS[word.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()]!;

interface Line {
  text: string;
  page: number;
}

const isAllCaps = (text: string) => /\p{L}/u.test(text) && text === text.toUpperCase();

/**
 * The organism that issues a resolution is printed in capitals right above its number («MINISTERIO DE TRABAJO
 * Y EMPLEO»), on one line or on two. `used` is how many lines it takes: they are the heading of this norm, not
 * the end of the previous one.
 */
function organismAbove(lines: Line[], at: number): { organism: string; used: number } {
  const one = lines[at - 1]?.text;
  const two = lines[at - 2]?.text;
  if (!one || !isAllCaps(one) || SECTION_START.test(one)) return { organism: '', used: 0 };
  if (ORGANISM_LINE.test(one)) return { organism: one, used: 1 };
  if (two && isAllCaps(two) && !SECTION_START.test(two) && ORGANISM_LINE.test(two)) return { organism: `${two} ${one}`, used: 2 };
  return { organism: '', used: 0 };
}

/** Joins the lines of a norm into paragraphs, mending the words that the page broke with a hyphen. */
function toParagraphs(lines: string[]): string {
  const paragraphs: string[] = [];
  let current = '';
  for (const line of lines) {
    if (current && PARAGRAPH_START.test(line)) {
      paragraphs.push(current);
      current = '';
    }
    if (!current) current = line;
    else if (/\p{L}-$/u.test(current) && /^\p{Ll}/u.test(line)) current = current.slice(0, -1) + line;
    else current += ` ${line}`;
  }
  if (current) paragraphs.push(current);
  return paragraphs.join('\n');
}

/**
 * Cuts the text of an edition (one string per page) into its norms: decrees, resolutions, dispositions and
 * laws of the first section. What comes after (court notices, companies, calls, tenders) is not a norm.
 */
export function segmentEdition(pages: string[], edition: Pick<MisionesEdition, 'number' | 'date' | 'path'>): MisionesNorm[] {
  const lines: Line[] = [];
  pages.forEach((text, index) => {
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\s+/g, ' ').trim().replace(PRINT_CODE, '');
      if (line && !PAGE_HEADER.test(line) && line !== 'PRIMERA SECCIÓN') lines.push({ text: line, page: index + 1 });
    }
  });

  const norms: MisionesNorm[] = [];
  const usedIds = new Set<string>();
  let open = false;
  let current: { header: Line; word: string; number: string; organism: string; body: string[] } | null = null;

  const close = () => {
    if (!current) return;
    const text = toParagraphs(current.body);
    const spec = kindOf(current.word);
    const year = /\b(20\d{2})\b/.exec(current.body[0] ?? '')?.[1] ?? edition.date.slice(0, 4);
    const number = current.number.replaceAll('.', '');
    if (text.length >= MIN_NORM_CHARS) {
      let externalId = `${edition.number}-${spec.code}-${number}`;
      for (let n = 2; usedIds.has(externalId); n++) externalId = `${edition.number}-${spec.code}-${number}-${n}`;
      usedIds.add(externalId);
      norms.push({
        externalId,
        publishedOn: edition.date,
        category: spec.category,
        organism: current.organism,
        kind: spec.kind,
        number: `${number}/${year}`,
        reference: '',
        url: `${BASE_URL}${edition.path}#page=${current.header.page}`,
        text,
        page: current.header.page,
      });
    }
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const { text } = lines[i]!;

    if (SECTION_END.test(text)) {
      close();
      open = false;
      continue;
    }
    if (SECTION_START.test(text)) {
      close();
      open = true;
      continue;
    }
    if (!open) continue;

    const header = NORM_HEADER.exec(text);
    const followedByNorm = header && lines.slice(i + 1, i + 4).some((next) => AFTER_HEADER.test(next.text));
    if (header && followedByNorm) {
      const { organism, used } = organismAbove(lines, i);
      // Those lines are the heading of this norm: they were read as the last lines of the previous one.
      if (current && used > 0) current.body.splice(Math.max(current.body.length - used, 0), used);
      close();
      const isDecree = /^DECRETO/.test(header[1]!);
      current = {
        header: lines[i]!,
        word: header[1]!,
        number: header[2]!,
        organism: organism || (isDecree ? 'PODER EJECUTIVO DE LA PROVINCIA DE MISIONES' : 'PROVINCIA DE MISIONES'),
        body: [],
      };
      continue;
    }
    if (current) current.body.push(text);
  }
  close();
  return norms;
}

// ── The source ────────────────────────────────────────────────────────────────

async function extractPdfPages(data: Uint8Array): Promise<string[]> {
  // pdf.js may detach the buffer it receives, so hand it a copy.
  const parser = new PDFParse({ data: new Uint8Array(data), verbosity: 0 });
  try {
    return (await parser.getText()).pages.map((page) => page.text);
  } catch (error) {
    throw new SourceUnavailableError('No se pudo leer el PDF del Boletín Oficial de Misiones.', { cause: error });
  } finally {
    await parser.destroy();
  }
}

export interface MisionesOptions extends Partial<Omit<PoliteClientOptions, 'siteName' | 'baseUrl'>> {
  baseUrl?: string;
  /** Turns a PDF into one text per page (the real reader by default; tests pass their own). */
  extractPages?: (data: Uint8Array) => Promise<string[]>;
}

/**
 * The Boletín Oficial de la Provincia de Misiones. The site publishes one PDF per business day: the home
 * page lists the newest, the PDF has a text layer, and its first section holds the decrees, resolutions and
 * laws, followed by notices that aren't norms. The supplements (a second, much bigger file with annexes) are
 * not read: they are tables, not text to classify.
 */
export class BoletinOficialMisionesSource implements NormativeSource {
  readonly id = 'BO_MISIONES';
  readonly label = 'Boletín Oficial de la Provincia de Misiones';
  readonly shortLabel = 'Misiones';

  private readonly client: PoliteClient;
  private readonly extractPages: (data: Uint8Array) => Promise<string[]>;
  private readonly editions = new Map<string, MisionesNorm[]>();

  constructor(options: MisionesOptions = {}) {
    const { extractPages, ...client } = options;
    this.client = new PoliteClient({ ...client, baseUrl: client.baseUrl ?? BASE_URL, siteName: 'Boletín Oficial de Misiones' });
    this.extractPages = extractPages ?? extractPdfPages;
  }

  async listEdition(date?: IsoDate): Promise<EditionListing> {
    const available = parseEditionList(await this.client.text('/')).filter((edition) => !edition.supplement);
    if (available.length === 0) {
      throw new SourceUnavailableError('No se pudo interpretar la página del Boletín Oficial de Misiones: puede que haya cambiado su formato.');
    }

    // Without a date: the newest day listed. A day that isn't listed has no edition (or is too old for the list).
    const wanted = date ?? available.map((edition) => edition.date).sort().at(-1)!;
    const ofTheDay = available.filter((edition) => edition.date === wanted);
    if (ofTheDay.length === 0) return { editionDate: null, items: [] };

    const items: ListedNorm[] = [];
    for (const edition of ofTheDay) {
      for (const norm of await this.load(edition)) {
        const { text: _text, page: _page, ...listed } = norm;
        items.push(listed);
      }
    }
    // An edition that exists but gives no norms is not a day without bulletin: the PDF changed or couldn't be read.
    if (items.length === 0) {
      throw new SourceUnavailableError('No se pudo leer ninguna norma del PDF del Boletín Oficial de Misiones: puede que haya cambiado su formato.');
    }
    return { editionDate: wanted, items };
  }

  async fetchText(item: ListedNorm): Promise<string> {
    // «16696-R-367»: the edition and the norm in it. Nothing else is ever asked for.
    const id = /^(\d{1,7})-[DRLX]-\d+(?:-\d+)?$/.exec(item.externalId);
    if (!id) throw new SourceUnavailableError('Identificador de norma inválido.');

    // Not in memory (the server restarted since it was listed): the edition is read again.
    const norms = this.editions.get(id[1]!) ?? (await this.load({ number: id[1]!, date: item.publishedOn, supplement: false, path: `/boletines/${id[1]}.pdf` }));
    const norm = norms.find((candidate) => candidate.externalId === item.externalId);
    if (!norm) throw new SourceUnavailableError('No se encontró la norma en la edición del Boletín Oficial de Misiones.');
    return norm.text;
  }

  /** Downloads an edition and cuts it into norms (kept in memory for a while). */
  private async load(edition: MisionesEdition): Promise<MisionesNorm[]> {
    const cached = this.editions.get(edition.number);
    if (cached) return cached;

    const pages = await this.extractPages(await this.client.bytes(edition.path));
    const norms = segmentEdition(pages, edition);

    this.editions.set(edition.number, norms);
    if (this.editions.size > MAX_CACHED_EDITIONS) this.editions.delete(this.editions.keys().next().value!);
    return norms;
  }
}
