import { parse } from 'node-html-parser';
import type { IsoDate } from '../../calendar/dates.js';
import { SourceUnavailableError, type EditionListing, type ListedNorm, type NormativeSource } from './normative-source.js';
import { PoliteClient, type PoliteClientOptions } from './polite-client.js';

const BASE_URL = 'https://www.boletinoficial.gob.ar';

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/** 2026-10-16 → 16-10-2026 (how the site asks for an edition). */
export function toSiteDate(date: IsoDate): string {
  const [year, month, day] = date.split('-');
  return `${day}-${month}-${year}`;
}

/** 2026-10-16 → 20261016 (how the site names an edition in the address of a notice). */
export function toCompactDate(date: IsoDate): string {
  return date.replaceAll('-', '');
}

function fromCompactDate(value: string): IsoDate | null {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** «Resolución Conjunta 61/2026» → kind and number; «Aviso Oficial» has no number. */
export function parseNormTitle(title: string): { kind: string; number: string } {
  const clean = squash(title);
  const match = /^(.*?)\s+(\d[\d.]*(?:\/\d{1,4})?)$/.exec(clean);
  return match ? { kind: match[1]!, number: match[2]! } : { kind: clean, number: '' };
}

function noticeUrl(externalId: string, publishedOn: IsoDate): string {
  return `${BASE_URL}/detalleAviso/primera/${externalId}/${toCompactDate(publishedOn)}`;
}

/**
 * Reads the listing of the first section (laws, decrees, resolutions, dispositions...).
 * The page doesn't list what each norm is about: only who issued it, what kind it is and its number.
 */
export function parseListing(html: string): EditionListing {
  const editionDate = fromCompactDate(/fechaSeleccionadaYMD\s*=\s*'(\d{8})'/.exec(html)?.[1] ?? '');
  const container = parse(html).querySelector('#avisosSeccionDiv');
  if (!container) return { editionDate, items: [] };

  const items: ListedNorm[] = [];
  const seen = new Set<string>();
  let category = '';

  // Headings and links come in the order they appear: each notice belongs to the last heading before it.
  for (const node of container.querySelectorAll('h5.seccion-rubro, a')) {
    if (node.tagName === 'H5') {
      category = squash(node.text);
      continue;
    }

    const href = node.getAttribute('href') ?? '';
    const match = /\/detalleAviso\/primera\/(\d+)\/(\d{8})(?:\?(.*))?$/.exec(href);
    // The paperclip next to each notice (?anexos=1) points to the same notice: only the titled link counts.
    if (!match || match[3]?.includes('anexos') || !node.querySelector('.linea-aviso')) continue;

    const externalId = match[1]!;
    const publishedOn = fromCompactDate(match[2]!);
    if (!publishedOn || seen.has(externalId)) continue;
    seen.add(externalId);

    const details = node.querySelectorAll('.item-detalle small').map((small) => squash(small.text));
    const { kind, number } = parseNormTitle(details[0] ?? '');

    items.push({
      externalId,
      publishedOn,
      category,
      organism: squash(node.querySelector('p.item')?.text ?? ''),
      kind,
      number,
      reference: details[1] ?? '',
      url: noticeUrl(externalId, publishedOn),
    });
  }

  return { editionDate, items };
}

/** The text of one notice as plain text, paragraph by paragraph. */
export function parseNoticeText(html: string): string {
  const root = parse(html);
  const body = root.querySelector('#cuerpoDetalleAviso');
  if (!body) throw new SourceUnavailableError('El Boletín Oficial cambió el formato de la página de una norma.');

  // Some notices carry a stylesheet inside the text (for their tables).
  for (const node of body.querySelectorAll('style, script')) node.remove();

  return body.structuredText
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export type BoletinOficialOptions = Partial<Omit<PoliteClientOptions, 'siteName' | 'baseUrl'>> & { baseUrl?: string };

/**
 * The national Boletín Oficial (first section). It reads only what the site's robots.txt allows
 * (the second section, with company notices, is off limits) and one page at a time.
 */
export class BoletinOficialSource implements NormativeSource {
  readonly id = 'BO_NACIONAL';
  readonly label = 'Boletín Oficial de la República Argentina';
  readonly shortLabel = 'Nación';

  private readonly client: PoliteClient;

  constructor(options: BoletinOficialOptions = {}) {
    this.client = new PoliteClient({ ...options, baseUrl: options.baseUrl ?? BASE_URL, siteName: 'Boletín Oficial' });
  }

  async listEdition(date?: IsoDate): Promise<EditionListing> {
    // The site keeps the edition being read in the session: choose it first, then read the section.
    const cookies = new Map<string, string>();
    if (date) await this.client.text(`/edicion/actualizar/${toSiteDate(date)}`, cookies);
    return parseListing(await this.client.text('/seccion/primera', cookies));
  }

  async fetchText(item: ListedNorm): Promise<string> {
    // Built from digits only: the address of a notice is never taken from what a page says.
    if (!/^\d{1,12}$/.test(item.externalId)) throw new SourceUnavailableError('Identificador de norma inválido.');
    return parseNoticeText(await this.client.text(`/detalleAviso/primera/${item.externalId}/${toCompactDate(item.publishedOn)}`));
  }
}
