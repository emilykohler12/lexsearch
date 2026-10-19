import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { SourceRateLimitedError, SourceUnavailableError } from '../../src/modules/normative/sources/normative-source.js';
import { BoletinOficialMisionesSource, parseEditionList, segmentEdition } from '../../src/modules/normative/sources/misiones.js';

const PORTADA = readFileSync(new URL('../fixtures/boletin-misiones/portada.html', import.meta.url), 'utf8');

const EDITION = { number: '16696', date: '2026-10-16', path: '/boletines/16696.pdf' } as const;

/**
 * The text of an edition as the PDF gives it, one string per page: page headers (even pages one way, odd pages
 * the other), the code at the end of each norm, a ministry on two lines, a mention that is not a norm, words
 * broken with a hyphen, the «sintetizados», the municipalities and the second section.
 */
const PAGES: string[] = [
  ['AUTORIDADES', 'DIRECCIÓN BOLETÍN OFICIAL', 'SUMARIO', 'Decretos N°s.: 1104 y 1105 ........................ Pág. 2', 'Resoluciones N°s.: 367 y 162 ........ Pág. 3'].join('\n'),
  [
    'Pág. 2 \tBOLETÍN OFICIAL Nº 16696 \tPosadas, Viernes 16 de Octubre de 2026',
    'PRIMERA SECCIÓN',
    'DECRETOS',
    'DECRETO N° 1104',
    'POSADAS, 14 de Octubre de 2026.-',
    'VISTO el Expediente N° 100 y CONSIDERANDO: Que corresponde modificar el régimen de licencias del personal.',
    'ARTÍCULO 1°.- MODIFÍCASE el artículo 5° del Decreto N° 777, que quedará redactado así: las licencias serán de treinta días.-',
    'ARTÍCULO 2°.- REGÍSTRESE, comuníquese, publíquese y archívese.-',
    'PASSALACQUA - Sartori \tPS137979 V16696',
    'DECRETO N° 1105',
    'POSADAS, 14 de Octubre de 2026.-',
    'VISTO la necesidad de actualizar la contrata-',
    'ción de servicios y CONSIDERANDO: Que corresponde dictar el acto.',
  ].join('\n'),
  [
    'Posadas, Viernes 16 de Octubre de 2026 \tBOLETÍN OFICIAL Nº 16696 \tPág. 3',
    'ARTÍCULO 1°.- APRUÉBASE el procedimiento de contratación de servicios de limpieza para los organismos de la Provincia.-',
    'DECRETO N° 55',
    'ANEXO I',
    'ARTÍCULO 2°.- REGÍSTRESE, comuníquese, publíquese y archívese.-',
    'PASSALACQUA - Sartori \tPS137980 V16696',
    'RESOLUCIONES',
    'MINISTERIO DE ECOLOGÍA Y RECURSOS',
    'NATURALES RENOVABLES',
    'RESOLUCIÓN N° 367',
    'POSADAS, 15 de Octubre de 2026.-',
    'VISTO la Ley XVI - N° 29 y CONSIDERANDO: Que corresponde reglamentar la presentación de los estudios ambientales.',
    'ARTÍCULO 1°.- ESTABLÉCESE que los estudios de impacto ambiental deberán presentarse con treinta días de antelación.-',
    'ARTÍCULO 2°.- REGÍSTRESE, comuníquese, publíquese y archívese.-',
    'ARAUJO',
    'PS137981 V16696',
  ].join('\n'),
  [
    'Pág. 4 \tBOLETÍN OFICIAL Nº 16696 \tPosadas, Viernes 16 de Octubre de 2026',
    'MINISTERIO DE TRABAJO Y EMPLEO',
    'RESOLUCIÓN N° 162',
    'POSADAS, 15 de Octubre de 2026.-',
    'VISTO el Expediente N° 200 y CONSIDERANDO: Que corresponde fijar el procedimiento de las audiencias laborales.',
    'ARTÍCULO 1°.- FÍJASE que las audiencias de conciliación laboral se celebrarán en la Delegación correspondiente.-',
    'ARTÍCULO 2°.- REGÍSTRESE, comuníquese, publíquese y archívese.-',
    'SCHUAP',
    'PS137982 V16696',
    'LEYES',
    'LEY XVI - N° 98',
    'LA CÁMARA DE REPRESENTANTES DE LA PROVINCIA DE MISIONES SANCIONA CON FUERZA DE L E Y:',
    'ARTÍCULO 1.- Créase el Registro Provincial de Entidades de ejemplo, que funcionará en el Ministerio de Gobierno.-',
    'ARTÍCULO 2.- Comuníquese al Poder Ejecutivo.-',
    'DECRETOS SINTETIZADOS',
    'DECRETO N° 1093',
    'POSADAS, 19 de Junio de 2026.-',
    'ARTÍCULO 1°.- RECONÓCESE de legítimo abono la suma de $ 2.900.000,00 a la firma EJEMPLO S.R.L., por la adquisición de insumos.-',
    'MUNICIPALIDADES',
    'MUNICIPALIDAD DE GARUPÁ',
    'DECRETO Nº 24',
    'Garupá, Misiones, 09 de Octubre de 2026.-',
    'VISTO: La nota presentada por un agente municipal mediante la cual presenta su renuncia al cargo; y',
    'ARTÍCULO 1º.- ACÉPTASE la renuncia presentada.-',
    'SEGUNDA SECCIÓN',
    'SOCIEDADES',
    'EJEMPLO SOCIEDAD DE RESPONSABILIDAD LIMITADA',
    'DECRETO N° 9',
    'POSADAS, 1 de Octubre de 2026.-',
    'Texto de un edicto que no es una norma del Estado.',
  ].join('\n'),
];

describe('parseEditionList', () => {
  it('lists the editions of the home page, with their day and the address of their PDF', () => {
    const editions = parseEditionList(PORTADA);

    expect(editions.map((edition) => [edition.number, edition.date, edition.supplement, edition.path])).toEqual([
      ['16696', '2026-10-16', false, '/boletines/16696.pdf'],
      ['16695', '2026-10-15', false, '/boletines/16695.pdf'],
      ['16694', '2026-10-14', false, '/boletines/16694.pdf'],
      ['16693', '2026-10-13', false, '/boletines/16693.pdf'],
      ['16693', '2026-10-13', true, '/boletines/16693%20sup.pdf'], // the supplement of the day: same number, a second file
    ]);
  });

  it('ignores a link to another site and a file that is not the one of its card', () => {
    const paths = parseEditionList(PORTADA).map((edition) => edition.path);
    expect(paths.some((path) => path.includes('otro-sitio') || path.includes('99999'))).toBe(false);
  });

  it('gives nothing for a page that is not the list', () => {
    expect(parseEditionList('<html><body><p>Mantenimiento</p></body></html>')).toEqual([]);
  });
});

describe('segmentEdition', () => {
  const norms = segmentEdition(PAGES, EDITION);
  const byId = (id: string) => norms.find((norm) => norm.externalId === id)!;

  it('cuts the first section into decrees, resolutions and laws, in the order they appear', () => {
    expect(norms.map((norm) => [norm.externalId, norm.kind, norm.number, norm.category, norm.page])).toEqual([
      ['16696-D-1104', 'Decreto', '1104/2026', 'DECRETOS', 2],
      ['16696-D-1105', 'Decreto', '1105/2026', 'DECRETOS', 2],
      ['16696-R-367', 'Resolución', '367/2026', 'RESOLUCIONES', 3],
      ['16696-R-162', 'Resolución', '162/2026', 'RESOLUCIONES', 4],
      ['16696-L-98', 'Ley', '98/2026', 'LEYES', 4],
      ['16696-D-1093', 'Decreto', '1093/2026', 'DECRETOS', 4], // among the «sintetizados»
    ]);
    expect(norms.every((norm) => norm.publishedOn === '2026-10-16' && norm.reference === '')).toBe(true);
  });

  it('names who issues each one: the ministry above a resolution (on one line or two), the Executive for decrees', () => {
    expect(byId('16696-R-367').organism).toBe('MINISTERIO DE ECOLOGÍA Y RECURSOS NATURALES RENOVABLES');
    expect(byId('16696-R-162').organism).toBe('MINISTERIO DE TRABAJO Y EMPLEO');
    expect(byId('16696-D-1104').organism).toBe('PODER EJECUTIVO DE LA PROVINCIA DE MISIONES');
    expect(byId('16696-L-98').organism).toBe('PROVINCIA DE MISIONES');
  });

  it('points to the page of the PDF where each norm starts', () => {
    expect(byId('16696-R-367').url).toBe('https://www.boletindigital.misiones.gov.ar/boletines/16696.pdf#page=3');
  });

  it('keeps only the text of each norm: no page headers, no print codes, no heading of the next one', () => {
    const decree = byId('16696-D-1105').text;
    expect(decree).toContain('POSADAS, 14 de Octubre de 2026.-');
    expect(decree).toContain('contratación de servicios'); // the word broken at the end of a line is mended
    expect(decree).toContain('APRUÉBASE el procedimiento'); // the norm goes on in the next page
    expect(decree).not.toMatch(/BOLET[ÍI]N OFICIAL|PS\d{6}|RESOLUCIONES/);

    expect(byId('16696-D-1104').text).not.toContain('PS137979');
    // The ministry that opens the next resolution is not the last line of the previous norm.
    expect(byId('16696-R-367').text).not.toContain('MINISTERIO DE TRABAJO');
    expect(byId('16696-R-367').text.trimEnd().endsWith('ARAUJO')).toBe(true);
  });

  it('puts each sentence of a norm on its own line', () => {
    expect(byId('16696-D-1104').text.split('\n')).toEqual([
      'POSADAS, 14 de Octubre de 2026.-',
      'VISTO el Expediente N° 100 y CONSIDERANDO: Que corresponde modificar el régimen de licencias del personal.',
      'ARTÍCULO 1°.- MODIFÍCASE el artículo 5° del Decreto N° 777, que quedará redactado así: las licencias serán de treinta días.-',
      'ARTÍCULO 2°.- REGÍSTRESE, comuníquese, publíquese y archívese.- PASSALACQUA - Sartori',
    ]);
  });

  it('does not take a mention of a decree, the summary on the cover, the municipalities or the second section for norms', () => {
    const text = norms.map((norm) => norm.text).join('\n');
    expect(norms.map((norm) => norm.externalId)).not.toContain('16696-D-55');
    expect(norms.map((norm) => norm.externalId)).not.toContain('16696-D-24');
    expect(norms.map((norm) => norm.externalId)).not.toContain('16696-D-9');
    expect(text).not.toContain('Garupá');
    expect(text).not.toContain('edicto');
    expect(byId('16696-D-1105').text).toContain('DECRETO N° 55'); // it stays as text of the decree it is in
  });

  it('gives nothing when there is no first section to read', () => {
    expect(segmentEdition(['Solo avisos y edictos.', 'SOCIEDADES\nDECRETO N° 9\nPOSADAS, 1 de Octubre de 2026.-'], EDITION)).toEqual([]);
    expect(segmentEdition([], EDITION)).toEqual([]);
  });

  it('keeps apart two norms with the same number', () => {
    const twice = segmentEdition(
      [
        [
          'DECRETOS',
          'DECRETO N° 5',
          'POSADAS, 1 de Octubre de 2026.-',
          'ARTÍCULO 1°.- APRUÉBASE el primer texto de ejemplo para esta prueba de numeración repetida.-',
          'DECRETO N° 5',
          'POSADAS, 1 de Octubre de 2026.-',
          'ARTÍCULO 1°.- APRUÉBASE el segundo texto de ejemplo para esta prueba de numeración repetida.-',
        ].join('\n'),
      ],
      EDITION,
    );
    expect(twice.map((norm) => norm.externalId)).toEqual(['16696-D-5', '16696-D-5-2']);
  });
});

// ── The source ──────────────────────────────────────────────────────────────

const noPause = async () => {};
const bytesOf = (text: string) => new TextEncoder().encode(text);

/** The pages that each fake PDF «contains»: the fake reader looks them up by what the PDF holds. */
const PAGES_BY_PDF: Record<string, string[]> = {
  '16696': PAGES,
  '16695': ['DECRETOS\nDECRETO N° 1103\nPOSADAS, 13 de Octubre de 2026.-\nARTÍCULO 1°.- APRUÉBASE el texto de ejemplo del decreto de la edición del día anterior.-'],
  '16694': ['Solo avisos y edictos.'],
  '16693': ['DECRETOS\nDECRETO N° 1090\nPOSADAS, 12 de Octubre de 2026.-\nARTÍCULO 1°.- APRUÉBASE el texto de ejemplo del decreto de la edición que tuvo suplemento.-'],
};

function fakeSite(handler: (path: string) => Response) {
  const requests: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    requests.push(path);
    return handler(path);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const goodSite = () =>
  fakeSite((path) => {
    if (path === '/') return new Response(PORTADA, { status: 200, headers: { 'content-type': 'text/html' } });
    const number = /^\/boletines\/(\d+)\.pdf$/.exec(path)?.[1];
    return number ? new Response(bytesOf(number), { status: 200 }) : new Response('no', { status: 404 });
  });

const newSource = (site: ReturnType<typeof fakeSite>) =>
  new BoletinOficialMisionesSource({
    fetchImpl: site.fetchImpl,
    sleep: noPause,
    extractPages: async (data) => PAGES_BY_PDF[new TextDecoder().decode(data)] ?? [],
  });

describe('BoletinOficialMisionesSource', () => {
  it('knows how it is shown to the lawyer', () => {
    const source = newSource(goodSite());
    expect([source.id, source.shortLabel, source.label]).toEqual(['BO_MISIONES', 'Misiones', 'Boletín Oficial de la Provincia de Misiones']);
  });

  it('reads the newest edition: the home page, then its PDF', async () => {
    const site = goodSite();

    const listing = await newSource(site).listEdition();

    expect(listing.editionDate).toBe('2026-10-16');
    expect(listing.items).toHaveLength(6);
    expect(listing.items[0]).toMatchObject({ externalId: '16696-D-1104', publishedOn: '2026-10-16', kind: 'Decreto', number: '1104/2026' });
    expect(listing.items[0]).not.toHaveProperty('text'); // the texts are asked for one by one
    expect(site.requests).toEqual(['/', '/boletines/16696.pdf']);
  });

  it('reads the edition of an earlier day, and never opens the supplement', async () => {
    const site = goodSite();

    const listing = await newSource(site).listEdition('2026-10-15');

    expect(listing).toMatchObject({ editionDate: '2026-10-15', items: [{ externalId: '16695-D-1103' }] });
    expect(site.requests).toEqual(['/', '/boletines/16695.pdf']);

    const supplementDay = goodSite();
    await newSource(supplementDay).listEdition('2026-10-13');
    expect(supplementDay.requests).toEqual(['/', '/boletines/16693.pdf']); // not «16693 sup.pdf»
  });

  it('says there is no edition for a day the page does not list', async () => {
    const site = goodSite();

    expect(await newSource(site).listEdition('2026-10-12')).toEqual({ editionDate: null, items: [] });
    expect(site.requests).toEqual(['/']); // no PDF was downloaded
  });

  it('gives the text of a norm without downloading the PDF again', async () => {
    const site = goodSite();
    const source = newSource(site);
    const { items } = await source.listEdition();

    const text = await source.fetchText(items.find((item) => item.externalId === '16696-R-162')!);

    expect(text).toContain('FÍJASE que las audiencias de conciliación laboral');
    expect(site.requests).toEqual(['/', '/boletines/16696.pdf']);
  });

  it('downloads the edition again when the text of a norm is asked after a restart', async () => {
    const first = newSource(goodSite());
    const { items } = await first.listEdition();

    const site = goodSite(); // a new process: nothing is in memory
    const text = await newSource(site).fetchText(items.find((item) => item.externalId === '16696-R-367')!);

    expect(text).toContain('ESTABLÉCESE que los estudios de impacto ambiental');
    expect(site.requests).toEqual(['/boletines/16696.pdf']);
  });

  it('refuses an identifier that is not one of its own, without going to the network', async () => {
    const site = goodSite();
    const source = newSource(site);
    const { items } = await source.listEdition();
    site.requests.length = 0;

    for (const externalId of ['../../etc/passwd', '16696', '16696-X-1-1-1', '16696-Z-5', 'abc-D-1']) {
      await expect(source.fetchText({ ...items[0]!, externalId })).rejects.toThrow(SourceUnavailableError);
    }
    expect(site.requests).toEqual([]);
  });

  it('says so when the norm is not in the edition anymore', async () => {
    const source = newSource(goodSite());
    const { items } = await source.listEdition();

    await expect(source.fetchText({ ...items[0]!, externalId: '16696-D-9999' })).rejects.toThrow('No se encontró la norma');
  });

  it('takes an edition that gives no norm as a change in the PDF, not as a day without bulletin', async () => {
    const source = newSource(goodSite());

    await expect(source.listEdition('2026-10-14')).rejects.toThrow(SourceUnavailableError);
    await expect(source.listEdition('2026-10-14')).rejects.toThrow('No se pudo leer ninguna norma');
  });

  it('takes a home page without editions as a change in the site', async () => {
    const site = fakeSite(() => new Response('<html><body>Mantenimiento</body></html>', { status: 200 }));

    await expect(newSource(site).listEdition()).rejects.toThrow('No se pudo interpretar la página del Boletín Oficial de Misiones');
  });

  it('tells how long to wait when the site asks to slow down', async () => {
    const site = fakeSite(() => new Response('Too Many Requests', { status: 429, headers: { 'retry-after': '120' } }));

    const error = await newSource(site).listEdition().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SourceRateLimitedError);
    expect((error as SourceRateLimitedError).retryAfterMs).toBe(120_000);
    expect((error as Error).message).toContain('Boletín Oficial de Misiones pidió esperar');
  });

  it('passes on the error of a PDF that can not be read', async () => {
    const source = new BoletinOficialMisionesSource({
      fetchImpl: goodSite().fetchImpl,
      sleep: noPause,
      extractPages: async () => {
        throw new SourceUnavailableError('No se pudo leer el PDF del Boletín Oficial de Misiones.');
      },
    });

    await expect(source.listEdition()).rejects.toThrow('No se pudo leer el PDF');
  });

  it('reads a real PDF, with its text layer, into norms', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const pages = [
      ['SUMARIO', 'Decretos N°s.: 7 ........ Pág. 2'],
      [
        'Pág. 2 BOLETÍN OFICIAL Nº 16696 Posadas, Viernes 16 de Octubre de 2026',
        'PRIMERA SECCIÓN',
        'DECRETOS',
        'DECRETO N° 7',
        'POSADAS, 14 de Octubre de 2026.-',
        'VISTO el Expediente N° 100 y CONSIDERANDO: Que corresponde dictar el acto.',
        'ARTÍCULO 1°.- DISPÓNESE el pago de la suma indicada en el expediente.-',
        'ARTÍCULO 2°.- REGÍSTRESE, comuníquese, publíquese y archívese.-',
        'PS000001 V16696',
      ],
    ];
    for (const lines of pages) {
      const page = pdf.addPage([595, 842]);
      lines.forEach((line, index) => page.drawText(line, { x: 40, y: 800 - index * 16, size: 10, font }));
    }
    const bytes = await pdf.save();
    const site = fakeSite((path) =>
      path === '/' ? new Response(PORTADA, { status: 200 }) : new Response(bytes.slice(), { status: 200, headers: { 'content-type': 'application/pdf' } }),
    );
    const source = new BoletinOficialMisionesSource({ fetchImpl: site.fetchImpl, sleep: noPause });

    const { items } = await source.listEdition();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ externalId: '16696-D-7', kind: 'Decreto', number: '7/2026', category: 'DECRETOS' });
    expect(await source.fetchText(items[0]!)).toContain('DISPÓNESE el pago de la suma indicada en el expediente');
  });
});
