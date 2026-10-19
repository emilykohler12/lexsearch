import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BoletinOficialSource,
  parseListing,
  parseNormTitle,
  parseNoticeText,
  toCompactDate,
  toSiteDate,
} from '../../src/modules/normative/sources/boletin-oficial.js';
import {
  SourceConnectionError,
  SourceRateLimitedError,
  SourceUnavailableError,
} from '../../src/modules/normative/sources/normative-source.js';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/boletin-oficial/${name}`, import.meta.url), 'utf8');
const LISTING = fixture('seccion-primera.html');
const DETAIL = fixture('detalle-aviso.html');

describe('parseListing', () => {
  const listing = parseListing(LISTING);

  it('reads the date of the edition the page shows', () => {
    expect(listing.editionDate).toBe('2026-10-16');
  });

  it('lists each titled notice once, with the heading it appears under', () => {
    expect(listing.items.map((item) => [item.externalId, item.category])).toEqual([
      ['349027', 'RESOLUCIONES'],
      ['349028', 'RESOLUCIONES'],
      ['349041', 'RESOLUCIONES CONJUNTAS'],
      ['349057', 'AVISOS OFICIALES'],
      ['349071', 'CONVENCIONES COLECTIVAS DE TRABAJO'],
    ]);
  });

  it('keeps who issued each norm, what kind it is, its number and its technical code', () => {
    expect(listing.items[0]).toEqual({
      externalId: '349027',
      publishedOn: '2026-10-16',
      category: 'RESOLUCIONES',
      organism: 'BIBLIOTECA NACIONAL DOCTOR MARIANO MORENO',
      kind: 'Resolución',
      number: '286/2026',
      reference: 'RESOL-2026-286-APN-BNMM#MCH',
      url: 'https://www.boletinoficial.gob.ar/detalleAviso/primera/349027/20261016',
    });
    expect(listing.items[2]).toMatchObject({ kind: 'Resolución Conjunta', number: '61/2026', organism: 'MINISTERIO DE ECONOMÍA - SECRETARÍA DE FINANZAS Y SECRETARÍA DE HACIENDA' });
  });

  it('lists notices that have no number (a bank notice) with an empty one', () => {
    expect(listing.items[3]).toMatchObject({ kind: 'Aviso Oficial', number: '', reference: '' });
  });

  it('ignores the attachment links (?anexos=1) and the images of the front page', () => {
    expect(listing.items.some((item) => item.externalId === '339128')).toBe(false);
    expect(listing.items.filter((item) => item.externalId === '349027')).toHaveLength(1);
  });

  it('does not list a notice twice when the page links it twice', () => {
    expect(listing.items.filter((item) => item.externalId === '349071')).toHaveLength(1);
  });

  it('gives back no items (and no date) for a page that is not a listing', () => {
    expect(parseListing('<html><body><h1>Mantenimiento</h1></body></html>')).toEqual({ editionDate: null, items: [] });
  });

  it('knows the edition date even when the page lists nothing', () => {
    expect(parseListing("<script>var fechaSeleccionadaYMD = '20261012';</script>")).toEqual({ editionDate: '2026-10-12', items: [] });
  });
});

describe('parseNormTitle', () => {
  it.each([
    ['Resolución 286/2026', 'Resolución', '286/2026'],
    ['Resolución Conjunta 61/2026', 'Resolución Conjunta', '61/2026'],
    ['Decreto 123/2026', 'Decreto', '123/2026'],
    ['Ley 27.798', 'Ley', '27.798'],
    ['Decisión Administrativa 12/2026', 'Decisión Administrativa', '12/2026'],
    ['Aviso Oficial', 'Aviso Oficial', ''],
    ['  Remate   Oficial ', 'Remate Oficial', ''],
    ['', '', ''],
  ])('%j → kind %j, number %j', (title, kind, number) => {
    expect(parseNormTitle(title)).toEqual({ kind, number });
  });
});

describe('parseNoticeText', () => {
  const text = parseNoticeText(DETAIL);

  it('returns the text paragraph by paragraph', () => {
    const lines = text.split('\n');
    expect(lines[0]).toBe('Ciudad de Buenos Aires, 14/10/2026');
    expect(lines[1]).toMatch(/^VISTO el Expediente N° EX-2026-10000001-APN-DGD#MCH, la Ley de Convenciones Colectivas de Trabajo Nº 14\.250, y$/);
    expect(lines).toContain('CONSIDERANDO:');
  });

  it('decodes the accents and the non-breaking spaces', () => {
    expect(text).toContain('Que se acompañó la nómina de las escalas salariales.');
    expect(text).toContain('ARTÍCULO 1°.- Declárase homologado el acuerdo celebrado entre la FEDERACIÓN EJEMPLO y la CÁMARA DE EJEMPLO');
  });

  it('leaves out the stylesheet and the scripts that sit inside the text', () => {
    expect(text).not.toContain('border');
    expect(text).not.toContain('alert');
  });

  it('fails clearly when the page has no body (the site changed or an error page came)', () => {
    expect(() => parseNoticeText('<html><body>Servicio no disponible</body></html>')).toThrow(SourceUnavailableError);
  });
});

describe('dates', () => {
  it('writes them the way the site asks for them', () => {
    expect(toSiteDate('2026-10-15')).toBe('15-10-2026');
    expect(toCompactDate('2026-10-15')).toBe('20261015');
  });
});

/** A fake of the site: answers by address and remembers what it was asked. */
function fakeSite(handler: (path: string, headers: Headers) => Response) {
  const requests: Array<{ path: string; headers: Headers }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    requests.push({ path: url.pathname, headers });
    return handler(url.pathname, headers);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const html = (body: string, headers: Array<[string, string]> = []) => {
  const response = new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  for (const [name, value] of headers) response.headers.append(name, value);
  return response;
};

const noPause = async () => {};

describe('BoletinOficialSource', () => {
  it('reads the newest edition with a single request that says who is asking', async () => {
    const site = fakeSite(() => html(LISTING));
    const source = new BoletinOficialSource({ fetchImpl: site.fetchImpl, sleep: noPause });

    const listing = await source.listEdition();

    expect(listing.editionDate).toBe('2026-10-16');
    expect(site.requests.map((request) => request.path)).toEqual(['/seccion/primera']);
    expect(site.requests[0]!.headers.get('user-agent')).toMatch(/^LexSearch\/.* uso personal\)$/);
  });

  it('asks for an earlier edition by choosing it first and then reading the section with the same session', async () => {
    const site = fakeSite((path) =>
      path.startsWith('/edicion/actualizar/') ? html('{}', [['set-cookie', 'BoletinWebSession=abc123; path=/; HttpOnly'], ['set-cookie', 'BORA=xyz; Secure']]) : html(LISTING),
    );
    const source = new BoletinOficialSource({ fetchImpl: site.fetchImpl, sleep: noPause });

    await source.listEdition('2026-10-15');

    expect(site.requests.map((request) => request.path)).toEqual(['/edicion/actualizar/15-10-2026', '/seccion/primera']);
    expect(site.requests[1]!.headers.get('cookie')).toBe('BoletinWebSession=abc123; BORA=xyz');
  });

  it('reads the text of a norm from its own address, built from digits only', async () => {
    const site = fakeSite(() => html(DETAIL));
    const source = new BoletinOficialSource({ fetchImpl: site.fetchImpl, sleep: noPause });
    const [item] = parseListing(LISTING).items;

    const text = await source.fetchText(item!);

    expect(site.requests[0]!.path).toBe('/detalleAviso/primera/349027/20261016');
    expect(text).toContain('CONSIDERANDO:');
  });

  it('refuses an identifier that is not made of digits', async () => {
    const site = fakeSite(() => html(DETAIL));
    const source = new BoletinOficialSource({ fetchImpl: site.fetchImpl, sleep: noPause });
    const [item] = parseListing(LISTING).items;

    await expect(source.fetchText({ ...item!, externalId: '../../segunda/1' })).rejects.toThrow(SourceUnavailableError);
    expect(site.requests).toHaveLength(0);
  });

  it('waits between requests so the site is read slowly', async () => {
    const pauses: number[] = [];
    let clock = 1_000;
    const realNow = Date.now;
    Date.now = () => clock;
    try {
      const site = fakeSite(() => {
        clock += 50; // the request itself takes 50 ms
        return html(LISTING);
      });
      const source = new BoletinOficialSource({
        fetchImpl: site.fetchImpl,
        delayMs: 700,
        sleep: async (ms) => {
          pauses.push(ms);
          clock += ms;
        },
      });

      await source.listEdition('2026-10-15'); // two requests
      expect(pauses).toHaveLength(1);
      expect(pauses[0]).toBe(650);
    } finally {
      Date.now = realNow;
    }
  });

  it('tells a connection problem from an error of the site', async () => {
    const down = new BoletinOficialSource({
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
      sleep: noPause,
    });
    await expect(down.listEdition()).rejects.toBeInstanceOf(SourceConnectionError);

    const broken = new BoletinOficialSource({ fetchImpl: (async () => new Response('x', { status: 503 })) as typeof fetch, sleep: noPause });
    const error = await broken.listEdition().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceUnavailableError);
    expect(error).not.toBeInstanceOf(SourceConnectionError);
    expect((error as Error).message).toContain('503');
  });

  describe('when the site says «too many requests»', () => {
    const tooMany = (retryAfter?: string) =>
      new Response('Too Many Requests', { status: 429, headers: retryAfter ? { 'retry-after': retryAfter } : {} });

    /** A clock the test moves by hand: the source reads it to know when the wait is over. */
    function withClock<T>(run: (advance: (ms: number) => void) => Promise<T>): Promise<T> {
      let clock = 1_000_000;
      const realNow = Date.now;
      Date.now = () => clock;
      return run((ms) => (clock += ms)).finally(() => {
        Date.now = realNow;
      });
    }

    it('stops, tells how long the site asked to wait, and sends no more requests meanwhile', async () => {
      await withClock(async (advance) => {
        const site = fakeSite(() => tooMany('600'));
        const source = new BoletinOficialSource({ fetchImpl: site.fetchImpl, sleep: noPause });

        const first = await source.listEdition().catch((e: unknown) => e);
        expect(first).toBeInstanceOf(SourceRateLimitedError);
        expect((first as SourceRateLimitedError).retryAfterMs).toBe(600_000);
        expect((first as Error).message).toContain('pidió esperar');

        advance(60_000);
        const second = await source.fetchText({ ...parseListing(LISTING).items[0]! }).catch((e: unknown) => e);
        expect(second).toBeInstanceOf(SourceRateLimitedError);
        expect((second as SourceRateLimitedError).retryAfterMs).toBe(540_000); // what is left of the wait
        expect(site.requests).toHaveLength(1); // the second one never went out
      });
    });

    it('waits ten minutes when the site does not say for how long', async () => {
      await withClock(async () => {
        const source = new BoletinOficialSource({ fetchImpl: fakeSite(() => tooMany()).fetchImpl, sleep: noPause });
        const error = await source.listEdition().catch((e: unknown) => e);
        expect((error as SourceRateLimitedError).retryAfterMs).toBe(600_000);
      });
    });

    it('goes back to reading once the wait is over', async () => {
      await withClock(async (advance) => {
        let limited = true;
        const site = fakeSite(() => (limited ? tooMany('60') : html(LISTING)));
        const source = new BoletinOficialSource({ fetchImpl: site.fetchImpl, sleep: noPause });

        await expect(source.listEdition()).rejects.toBeInstanceOf(SourceRateLimitedError);
        limited = false;
        advance(61_000);

        expect((await source.listEdition()).editionDate).toBe('2026-10-16');
        expect(site.requests).toHaveLength(2);
      });
    });
  });
});
