import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SourceRateLimitedError, SourceUnavailableError } from '../../src/modules/normative/sources/normative-source.js';
import { FakeLlmProvider } from '../helpers/fakes.js';
import { askedIn, CCT_QUOTE, CCT_TEXT, FRIDAY, laborAnswer, NOW, respondWith, THURSDAY } from '../helpers/normative-fixtures.js';
import { createTestApp } from '../helpers/test-app.js';

/** A resolution of the province of Misiones, with its own phrase the model can quote. */
const PROVINCIAL_TEXT = [
  'POSADAS, 14 de Octubre de 2026.-',
  'VISTO el Expediente N° 1000 y CONSIDERANDO: Que corresponde fijar el horario del comercio en la Provincia.',
  'ARTÍCULO 1°.- Fíjase el horario de atención al público del comercio en toda la Provincia de 8 a 20 horas.',
].join('\n');
const PROVINCIAL_QUOTE = 'Fíjase el horario de atención al público del comercio en toda la Provincia de 8 a 20 horas';

const llm = new FakeLlmProvider();
let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  ctx = await createTestApp({ llm, now: () => NOW, provincial: true });
});

afterEach(async () => {
  ctx.normativeWatcher.stop();
  await ctx.reset();
  llm.structuredCalls = [];
  llm.structuredResponder = null;
  llm.structuredError = null;
});

afterAll(async () => {
  await ctx.reset();
  await ctx.close();
});

const api = () => request(ctx.app);
const laboral = () => ctx.db.normativeTopic.create({ data: { name: 'Laboral', practiceArea: 'LABORAL' } });

/** Friday: a collective agreement in the national bulletin and a resolution in the provincial one. */
function bothBulletins() {
  ctx.normativeSource.add(
    FRIDAY,
    { externalId: '349071', category: 'CONVENCIONES COLECTIVAS DE TRABAJO', kind: 'Disposición', number: '683/2026', organism: 'MINISTERIO DE CAPITAL HUMANO' },
    CCT_TEXT,
  );
  ctx.provincialSource.add(
    FRIDAY,
    { externalId: '16696-R-162', category: 'RESOLUCIONES', kind: 'Resolución', number: '162/2026', organism: 'MINISTERIO DE TRABAJO Y EMPLEO' },
    PROVINCIAL_TEXT,
  );
}

/** The model finds both norms relevant to «Laboral». */
const bothRelevant = ({ norms, topics }: Parameters<typeof laborAnswer>[0]) => {
  const topic = topics.find((t) => t.name === 'Laboral')!;
  return {
    norms: norms.map((norm) => ({
      norm: norm.ref,
      summary: `Norma de ${norm.scope}.`,
      matches: [{ topic: topic.ref, relevance: 'ALTA', reason: 'Cambia las reglas del tema.', quote: norm.title.includes('683/2026') ? CCT_QUOTE : PROVINCIAL_QUOTE }],
    })),
  };
};

describe('NormativeWatcher with two bulletins', () => {
  it('reads both in one check, keeps each norm with its bulletin and tells the model which one it comes from', async () => {
    bothBulletins();
    await laboral();
    respondWith(llm, bothRelevant);

    const summary = await ctx.normativeWatcher.refresh();

    const items = await ctx.db.normativeItem.findMany({ orderBy: { source: 'asc' } });
    expect(items.map((item) => [item.source, item.externalId, item.detailStatus])).toEqual([
      ['BO_MISIONES', '16696-R-162', 'DONE'],
      ['BO_NACIONAL', '349071', 'DONE'],
    ]);
    expect(summary.newAlerts).toBe(2);
    expect(summary.editions.filter((edition) => edition.date === FRIDAY).map((edition) => [edition.source, edition.status, edition.found, edition.alerts])).toEqual([
      ['BO_NACIONAL', 'OK', 1, 1],
      ['BO_MISIONES', 'OK', 1, 1],
    ]);

    // One request per bulletin, each one told where its norms come from.
    expect(llm.structuredCalls).toHaveLength(2);
    expect(askedIn(llm.structuredCalls[0]!).norms.map((norm) => norm.scope)).toEqual(['Nación']);
    expect(askedIn(llm.structuredCalls[1]!).norms.map((norm) => norm.scope)).toEqual(['Misiones']);

    const { body } = await api().get('/api/normativa/alerts').expect(200);
    expect(body.alerts.map((alert: { item: { source: string; sourceLabel: string; number: string } }) => [alert.item.source, alert.item.sourceLabel, alert.item.number]).sort()).toEqual([
      ['BO_MISIONES', 'Misiones', '162/2026'],
      ['BO_NACIONAL', 'Nación', '683/2026'],
    ]);
    expect(body.alerts.every((alert: { quoteVerified: boolean }) => alert.quoteVerified)).toBe(true);
  });

  it('does not repeat what each bulletin already gave', async () => {
    bothBulletins();
    await laboral();
    respondWith(llm, bothRelevant);
    await ctx.normativeWatcher.refresh();
    ctx.normativeSource.textCalls = [];
    ctx.provincialSource.textCalls = [];

    const again = await ctx.normativeWatcher.refresh();

    expect(again.newAlerts).toBe(0);
    expect(ctx.normativeSource.textCalls).toEqual([]);
    expect(ctx.provincialSource.textCalls).toEqual([]);
    expect(llm.structuredCalls).toHaveLength(2);
    expect(await ctx.db.normativeAlert.count()).toBe(2);
  });

  it('keeps reading the other bulletin when one fails, and records the failure on its own', async () => {
    bothBulletins();
    await laboral();
    respondWith(llm, laborAnswer);
    ctx.provincialSource.listError = new SourceUnavailableError('El Boletín Oficial de Misiones respondió con el error 503.');

    const summary = await ctx.normativeWatcher.refresh();

    expect(summary.newAlerts).toBe(1);
    expect(summary.editions.find((edition) => edition.source === 'BO_NACIONAL' && edition.date === FRIDAY)).toMatchObject({ status: 'OK', alerts: 1 });
    expect(summary.editions.find((edition) => edition.source === 'BO_MISIONES')).toEqual({
      source: 'BO_MISIONES',
      date: '2026-10-17',
      status: 'ERROR',
      found: 0,
      alerts: 0,
      error: 'El Boletín Oficial de Misiones respondió con el error 503.',
    });

    const { body } = await api().get('/api/normativa/status').expect(200);
    expect(body.sources.map((source: { shortLabel: string; lastError: string | null }) => [source.shortLabel, source.lastError])).toEqual([
      ['Nación', null],
      ['Misiones', 'El Boletín Oficial de Misiones respondió con el error 503.'],
    ]);
  });

  it('does not mix up the bulletins: an unexpected failure names the one that failed', async () => {
    ctx.normativeSource.add(FRIDAY, { externalId: '349071', kind: 'Disposición', number: '683/2026' }, CCT_TEXT);
    ctx.provincialSource.listError = new TypeError("Cannot read properties of undefined (reading 'secret')");

    const summary = await ctx.normativeWatcher.refresh();

    expect(summary.editions.find((edition) => edition.source === 'BO_MISIONES')).toMatchObject({
      status: 'ERROR',
      error: 'Ocurrió un error inesperado al revisar el Boletín Oficial (Misiones).',
    });
  });

  it('schedules the next check for the earliest wait that a bulletin asked for', async () => {
    ctx.normativeSource.listError = new SourceRateLimitedError('El Boletín Oficial pidió esperar unos minutos antes de seguir leyendo (recibió demasiados pedidos).', 600_000);
    ctx.provincialSource.listError = new SourceRateLimitedError('El Boletín Oficial de Misiones pidió esperar unos minutos antes de seguir leyendo (recibió demasiados pedidos).', 90_000);

    await ctx.normativeWatcher.refresh();

    expect(ctx.normativeWatcher.retryScheduledAt).toBe(NOW.getTime() + 90_000 + 5_000);
  });

  it('starts a check on its own when any of the bulletins was not checked lately', async () => {
    bothBulletins();
    await ctx.normativeWatcher.refresh();
    expect(await ctx.normativeWatcher.ensureFresh()).toBe(false);

    await ctx.db.normativeRun.deleteMany({ where: { source: 'BO_MISIONES' } });

    const status = (await api().get('/api/normativa/status').expect(200)).body;
    expect(status.stale).toBe(true);
    expect(status.sources.map((source: { stale: boolean }) => source.stale)).toEqual([false, true]);
    expect(await ctx.normativeWatcher.ensureFresh()).toBe(true);
    await ctx.normativeWatcher.refresh(); // joins it
    expect(ctx.provincialSource.listCalls.filter((call) => call === undefined)).toHaveLength(2);
  });
});

describe('GET /api/normativa/items with two bulletins', () => {
  it('lists each bulletin on its own, with the editions it has, and the national one by default', async () => {
    ctx.normativeSource.add(FRIDAY, { externalId: '349071', kind: 'Disposición', number: '683/2026', category: 'CONVENCIONES COLECTIVAS DE TRABAJO' }, CCT_TEXT);
    ctx.provincialSource.add(THURSDAY, { externalId: '16695-D-1103', kind: 'Decreto', number: '1103/2026', category: 'DECRETOS', organism: 'PODER EJECUTIVO DE LA PROVINCIA DE MISIONES' }, PROVINCIAL_TEXT);
    await ctx.normativeWatcher.refresh(); // no topics: the norms are listed, not read

    const national = (await api().get('/api/normativa/items').expect(200)).body;
    expect(national.source).toBe('BO_NACIONAL');
    expect(national.sources.map((source: { id: string; shortLabel: string }) => [source.id, source.shortLabel])).toEqual([
      ['BO_NACIONAL', 'Nación'],
      ['BO_MISIONES', 'Misiones'],
    ]);
    expect(national.dates).toEqual([FRIDAY]);
    expect(national.categories).toEqual(['CONVENCIONES COLECTIVAS DE TRABAJO']);
    expect(national.items.map((item: { number: string }) => item.number)).toEqual(['683/2026']);

    const provincial = (await api().get('/api/normativa/items').query({ source: 'BO_MISIONES' }).expect(200)).body;
    expect(provincial.source).toBe('BO_MISIONES');
    expect(provincial.date).toBe(THURSDAY);
    expect(provincial.dates).toEqual([THURSDAY]);
    expect(provincial.categories).toEqual(['DECRETOS']);
    expect(provincial.items).toHaveLength(1);
    expect(provincial.items[0]).toMatchObject({ source: 'BO_MISIONES', sourceLabel: 'Misiones', kind: 'Decreto', number: '1103/2026' });

    // The edition of one bulletin isn't looked for in the other.
    const other = (await api().get('/api/normativa/items').query({ source: 'BO_MISIONES', date: FRIDAY }).expect(200)).body;
    expect(other.items).toEqual([]);
  });
});
