import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SourceConnectionError } from '../../src/modules/normative/sources/normative-source.js';
import { CCT_TEXT, FRIDAY, NOW, THURSDAY } from '../helpers/normative-fixtures.js';
import { createTestApp } from '../helpers/test-app.js';

// The clock the app sees: tests move it forward to tell a fresh check from an old one.
let clock = NOW.getTime();
const HOUR = 3_600_000;
const ctx = await createTestApp({ llm: null, now: () => new Date(clock) });

afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  clock = NOW.getTime();
  await ctx.reset();
});

const api = () => request(ctx.app);

const createTopic = (data: { name?: string; practiceArea?: string; keywords?: string[]; active?: boolean } = {}) =>
  ctx.db.normativeTopic.create({ data: { name: 'Laboral', practiceArea: 'LABORAL', ...data } });

let counter = 0;
const createItem = (data: Partial<{ externalId: string; publishedOn: string; category: string; organism: string; kind: string; number: string; summary: string; detailStatus: string; text: string; analyzedTopicIds: string[] }> = {}) => {
  counter++;
  const { publishedOn = FRIDAY, ...rest } = data;
  return ctx.db.normativeItem.create({
    data: {
      source: 'BO_NACIONAL',
      externalId: String(349000 + counter),
      category: 'RESOLUCIONES',
      organism: 'MINISTERIO DE EJEMPLO',
      kind: 'Resolución',
      number: `${counter}/2026`,
      url: `https://example.test/${counter}`,
      ...rest,
      publishedOn: new Date(publishedOn),
    },
  });
};

const createAlert = (itemId: string, topicId: string, data: { relevance?: string; status?: string; origin?: string; quote?: string } = {}) =>
  ctx.db.normativeAlert.create({ data: { itemId, topicId, relevance: 'ALTA', reason: 'Cambia las reglas del tema.', ...data } });

describe('GET /api/normativa/status', () => {
  it('says nothing was checked yet, and that a check is due', async () => {
    const { body } = await api().get('/api/normativa/status').expect(200);

    expect(body).toEqual({
      running: false,
      aiConfigured: false,
      topicCount: 0,
      lastCheckedAt: null,
      stale: true,
      sources: [
        {
          id: 'BO_NACIONAL',
          label: 'Boletín Oficial (de prueba)',
          shortLabel: 'Nación',
          lastCheckedAt: null,
          lastEditionDate: null,
          lastError: null,
          stale: true,
        },
      ],
    });
  });

  it('shows the last check, and calls it old after six hours', async () => {
    ctx.normativeSource.add(FRIDAY, { externalId: '349071', kind: 'Disposición', number: '683/2026' }, CCT_TEXT);
    await createTopic();
    await ctx.normativeWatcher.refresh();

    const fresh = (await api().get('/api/normativa/status').expect(200)).body;
    expect(fresh).toMatchObject({ lastCheckedAt: NOW.toISOString(), stale: false, topicCount: 1 });
    expect(fresh.sources[0]).toMatchObject({ id: 'BO_NACIONAL', lastCheckedAt: NOW.toISOString(), lastEditionDate: FRIDAY, lastError: null, stale: false });

    clock += 7 * HOUR;
    const old = (await api().get('/api/normativa/status').expect(200)).body;
    expect(old.stale).toBe(true);
    expect(old.sources[0].stale).toBe(true);
  });

  it('tells what went wrong in the last check, and clears it when the next one goes well', async () => {
    ctx.normativeSource.add(FRIDAY, { externalId: '349071', kind: 'Disposición', number: '683/2026' }, CCT_TEXT);
    await ctx.normativeWatcher.refresh();
    clock += HOUR;
    ctx.normativeSource.listError = new SourceConnectionError('No se pudo conectar con el Boletín Oficial.');
    await ctx.normativeWatcher.refresh();

    const failed = (await api().get('/api/normativa/status').expect(200)).body;
    expect(failed.sources[0]).toMatchObject({ lastError: 'No se pudo conectar con el Boletín Oficial.', lastEditionDate: FRIDAY });

    clock += HOUR;
    ctx.normativeSource.listError = null;
    await ctx.normativeWatcher.refresh();
    expect((await api().get('/api/normativa/status').expect(200)).body.sources[0].lastError).toBeNull();
  });
});

describe('POST /api/normativa/refresh', () => {
  it('answers at once and checks the bulletin in the background, only one check at a time', async () => {
    ctx.normativeSource.add(FRIDAY, { externalId: '349071', kind: 'Disposición', number: '683/2026' }, CCT_TEXT);
    let release!: () => void;
    ctx.normativeSource.listGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    expect((await api().post('/api/normativa/refresh').expect(202)).body).toEqual({ running: true });
    expect((await api().post('/api/normativa/refresh').expect(202)).body).toEqual({ running: true }); // already running
    expect((await api().get('/api/normativa/status').expect(200)).body.running).toBe(true);

    release();
    await ctx.normativeWatcher.refresh(); // joins the running check: it is done when this returns

    const done = (await api().get('/api/normativa/status').expect(200)).body;
    expect(done.running).toBe(false);
    expect(done.sources[0].lastEditionDate).toBe(FRIDAY);
    expect(ctx.normativeSource.listCalls.filter((call) => call === undefined)).toHaveLength(1);
    expect(await ctx.db.normativeItem.count()).toBe(1);
  });
});

describe('/api/normativa/topics', () => {
  it('follows a whole area of practice, with its name', async () => {
    const { body } = await api().post('/api/normativa/topics').send({ practiceArea: 'LABORAL' }).expect(201);

    expect(body.topic).toMatchObject({ name: 'Laboral', practiceArea: 'LABORAL', keywords: [], description: '', active: true });
    expect((await api().post('/api/normativa/topics').send({ practiceArea: 'LABORAL' }).expect(409)).body.error.message).toBe('Ya seguís esa área de práctica.');
  });

  it('follows a topic of its own, described with words', async () => {
    const { body } = await api()
      .post('/api/normativa/topics')
      .send({ name: ' Alquileres ', keywords: ['locación', ' alquiler '], description: 'Contratos de vivienda' })
      .expect(201);

    expect(body.topic).toMatchObject({ name: 'Alquileres', practiceArea: null, keywords: ['locación', 'alquiler'], description: 'Contratos de vivienda' });
    expect((await api().get('/api/normativa/topics').expect(200)).body.topics).toHaveLength(1);
  });

  it.each([
    ['a topic with no name', { keywords: ['alquiler'] }],
    ['a topic with no words', { name: 'Alquileres' }],
    ['more than twelve words', { name: 'X', keywords: Array.from({ length: 13 }, (_, i) => `palabra${i}`) }],
    ['«Otro» as a whole area', { practiceArea: 'OTRO' }],
    ['an unknown area', { practiceArea: 'ASTROLOGIA' }],
  ])('refuses %s', async (_label, body) => {
    await api().post('/api/normativa/topics').send(body).expect(400);
    expect(await ctx.db.normativeTopic.count()).toBe(0);
  });

  it('lists the topics in the order they were added', async () => {
    await api().post('/api/normativa/topics').send({ practiceArea: 'CIVIL' }).expect(201);
    await api().post('/api/normativa/topics').send({ name: 'Alquileres', keywords: ['alquiler'] }).expect(201);

    const { body } = await api().get('/api/normativa/topics').expect(200);
    expect(body.topics.map((topic: { name: string }) => topic.name)).toEqual(['Civil', 'Alquileres']);
  });

  it('changes a topic; changing what it looks for makes the norms be checked against it again', async () => {
    const topic = await createTopic({ name: 'Alquileres', practiceArea: undefined, keywords: ['alquiler'] });
    const other = await createTopic({ name: 'Laboral' });
    const item = await createItem({ detailStatus: 'DONE', analyzedTopicIds: [topic.id, other.id] });

    const { body } = await api().patch(`/api/normativa/topics/${topic.id}`).send({ keywords: ['locación'] }).expect(200);

    expect(body.topic.keywords).toEqual(['locación']);
    expect((await ctx.db.normativeItem.findUniqueOrThrow({ where: { id: item.id } })).analyzedTopicIds).toEqual([other.id]);

    // Pausing it doesn't make anything be checked again.
    await api().patch(`/api/normativa/topics/${topic.id}`).send({ active: false }).expect(200);
    expect((await api().get('/api/normativa/status').expect(200)).body.topicCount).toBe(1);
  });

  it('refuses an empty change and a topic that does not exist', async () => {
    const topic = await createTopic();
    await api().patch(`/api/normativa/topics/${topic.id}`).send({}).expect(400);
    await api().patch('/api/normativa/topics/00000000-0000-4000-8000-000000000000').send({ active: false }).expect(404);
    await api().delete('/api/normativa/topics/00000000-0000-4000-8000-000000000000').expect(404);
    await api().patch('/api/normativa/topics/no-es-un-id').send({ active: false }).expect(400);
  });

  it('stops following a topic and its alerts go with it', async () => {
    const topic = await createTopic();
    const item = await createItem();
    await createAlert(item.id, topic.id);

    await api().delete(`/api/normativa/topics/${topic.id}`).expect(204);

    expect(await ctx.db.normativeAlert.count()).toBe(0);
    expect(await ctx.db.normativeItem.count()).toBe(1); // the norm stays in the bulletin
    await api().delete(`/api/normativa/topics/${topic.id}`).expect(404);
  });
});

describe('/api/normativa/alerts', () => {
  async function seed() {
    const area = await createTopic();
    const own = await createTopic({ name: 'Alquileres', practiceArea: undefined, keywords: ['alquiler'] });
    const cct = await createItem({ publishedOn: FRIDAY, category: 'CONVENCIONES COLECTIVAS DE TRABAJO', kind: 'Disposición', number: '683/2026', summary: 'Homologa un acuerdo salarial.' });
    const rent = await createItem({ publishedOn: THURSDAY, kind: 'Resolución', number: '12/2026' });
    const dismissed = await createItem({ publishedOn: THURSDAY, kind: 'Resolución', number: '13/2026' });
    const newer = await createAlert(cct.id, area.id, { relevance: 'ALTA', quote: 'Declárase homologado el acuerdo', status: 'NEW' });
    await createAlert(rent.id, own.id, { relevance: 'MEDIA', status: 'SEEN', origin: 'KEYWORDS' });
    await createAlert(dismissed.id, area.id, { status: 'DISMISSED' });
    return { area, own, cct, rent, newer };
  }

  it('lists what is new or seen, the most recent norms first, with what each one concerns', async () => {
    const { area, own, cct } = await seed();
    await ctx.db.client.createMany({ data: [{ fullName: 'Ana', practiceArea: 'LABORAL' }, { fullName: 'Beto', practiceArea: 'LABORAL' }, { fullName: 'Carla', practiceArea: 'CIVIL' }] });
    await ctx.db.case.createMany({
      data: [
        { title: 'Caso en trámite', practiceArea: 'LABORAL', status: 'ACTIVE' },
        { title: 'Caso pausado', practiceArea: 'LABORAL', status: 'PAUSED' },
        { title: 'Caso cerrado', practiceArea: 'LABORAL', status: 'CLOSED' },
        { title: 'Caso civil', practiceArea: 'CIVIL', status: 'ACTIVE' },
      ],
    });

    const { body } = await api().get('/api/normativa/alerts').expect(200);

    expect(body.alerts).toHaveLength(2);
    const [first, second] = body.alerts;
    expect(first).toMatchObject({
      status: 'NEW',
      relevance: 'ALTA',
      origin: 'AI',
      quote: 'Declárase homologado el acuerdo',
      topic: { id: area.id, name: 'Laboral', practiceArea: 'LABORAL' },
      item: { id: cct.id, source: 'BO_NACIONAL', sourceLabel: 'Nación', publishedOn: FRIDAY, category: 'CONVENCIONES COLECTIVAS DE TRABAJO', kind: 'Disposición', number: '683/2026', summary: 'Homologa un acuerdo salarial.' },
      affected: { clients: 2, cases: 2 }, // the closed expediente doesn't count
    });
    expect(second).toMatchObject({ status: 'SEEN', origin: 'KEYWORDS', topic: { id: own.id, practiceArea: null }, affected: null });
    expect(first.item).not.toHaveProperty('text');
  });

  it('lists the dismissed ones apart, and by state', async () => {
    await seed();

    expect((await api().get('/api/normativa/alerts?status=DISMISSED').expect(200)).body.alerts.map((a: { item: { number: string } }) => a.item.number)).toEqual(['13/2026']);
    expect((await api().get('/api/normativa/alerts?status=NEW').expect(200)).body.alerts).toHaveLength(1);
    expect((await api().get('/api/normativa/alerts?status=SEEN').expect(200)).body.alerts).toHaveLength(1);
    await api().get('/api/normativa/alerts?status=TODAS').expect(400);
  });

  it('puts the norms that regulate a topic directly before the ones that might affect it, within the same day', async () => {
    const topic = await createTopic();
    const a = await createItem({ publishedOn: FRIDAY, number: '1/2026' });
    const b = await createItem({ publishedOn: FRIDAY, number: '2/2026' });
    await createAlert(a.id, topic.id, { relevance: 'MEDIA' });
    await createAlert(b.id, topic.id, { relevance: 'ALTA' });

    const { body } = await api().get('/api/normativa/alerts').expect(200);
    expect(body.alerts.map((alert: { relevance: string }) => alert.relevance)).toEqual(['ALTA', 'MEDIA']);
  });

  it('counts the new ones and marks one as seen, dismissed or new again', async () => {
    const { newer } = await seed();
    expect((await api().get('/api/normativa/alerts/unread-count').expect(200)).body).toEqual({ count: 1 });

    const seen = await api().patch(`/api/normativa/alerts/${newer.id}`).send({ status: 'SEEN' }).expect(200);
    expect(seen.body.alert).toMatchObject({ id: newer.id, status: 'SEEN' });
    expect((await api().get('/api/normativa/alerts/unread-count').expect(200)).body.count).toBe(0);

    expect((await api().patch(`/api/normativa/alerts/${newer.id}`).send({ status: 'DISMISSED' }).expect(200)).body.alert.status).toBe('DISMISSED');
    expect((await api().get('/api/normativa/alerts').expect(200)).body.alerts).toHaveLength(1);
    expect((await api().patch(`/api/normativa/alerts/${newer.id}`).send({ status: 'NEW' }).expect(200)).body.alert.status).toBe('NEW');
  });

  it('refuses a state that does not exist and an alert that does not', async () => {
    const { newer } = await seed();
    await api().patch(`/api/normativa/alerts/${newer.id}`).send({ status: 'BORRADA' }).expect(400);
    await api().patch('/api/normativa/alerts/00000000-0000-4000-8000-000000000000').send({ status: 'SEEN' }).expect(404);
  });

  it('marks all the new ones as seen at once, leaving the dismissed ones as they are', async () => {
    const { area } = await seed();
    const extra = await createItem({ publishedOn: FRIDAY });
    await createAlert(extra.id, area.id, { status: 'NEW' });
    expect((await api().get('/api/normativa/alerts/unread-count').expect(200)).body.count).toBe(2);

    await api().post('/api/normativa/alerts/read-all').expect(204);

    expect((await api().get('/api/normativa/alerts/unread-count').expect(200)).body.count).toBe(0);
    expect((await api().get('/api/normativa/alerts?status=DISMISSED').expect(200)).body.alerts).toHaveLength(1);
    expect((await api().get('/api/normativa/alerts?status=SEEN').expect(200)).body.alerts).toHaveLength(3);
  });
});

describe('GET /api/normativa/items', () => {
  async function seed() {
    const topic = await createTopic();
    const cct = await createItem({ publishedOn: FRIDAY, externalId: '349071', category: 'CONVENCIONES COLECTIVAS DE TRABAJO', kind: 'Disposición', number: '683/2026', organism: 'MINISTERIO DE CAPITAL HUMANO', detailStatus: 'DONE', text: 'Se homologa un acuerdo salarial gastronómico.', summary: 'Homologa un acuerdo.' });
    await createItem({ publishedOn: FRIDAY, externalId: '349027', kind: 'Resolución', number: '286/2026', organism: 'BIBLIOTECA NACIONAL', detailStatus: 'PENDING' });
    await createItem({ publishedOn: FRIDAY, externalId: '349057', category: 'AVISOS OFICIALES', kind: 'Aviso Oficial', number: '', organism: 'BANCO DE LA NACIÓN', detailStatus: 'SKIPPED' });
    await createItem({ publishedOn: THURSDAY, externalId: '348900', kind: 'Resolución', number: '12/2026', organism: 'AGENCIA DE EJEMPLO' });
    await createAlert(cct.id, topic.id);
    return { cct };
  }

  it('gives back the newest edition, the dates there are norms for, and the headings of the edition', async () => {
    await seed();

    const { body } = await api().get('/api/normativa/items').expect(200);

    expect(body.date).toBe(FRIDAY);
    expect(body.dates).toEqual([FRIDAY, THURSDAY]);
    expect(body.categories).toEqual(['AVISOS OFICIALES', 'CONVENCIONES COLECTIVAS DE TRABAJO', 'RESOLUCIONES']);
    expect(body.items.map((item: { number: string }) => item.number)).toEqual(['286/2026', '', '683/2026']); // the order of the bulletin
    expect(body.items[2]).toMatchObject({ kind: 'Disposición', organism: 'MINISTERIO DE CAPITAL HUMANO', summary: 'Homologa un acuerdo.', read: true, alertCount: 1 });
    expect(body.items[0]).toMatchObject({ read: false, alertCount: 0 });
    expect(body.items[0]).not.toHaveProperty('text');
  });

  it('gives back the norms of another edition', async () => {
    await seed();
    const { body } = await api().get(`/api/normativa/items?date=${THURSDAY}`).expect(200);
    expect(body.date).toBe(THURSDAY);
    expect(body.items.map((item: { number: string }) => item.number)).toEqual(['12/2026']);
  });

  it('filters by heading and by what the lawyer types, without caring for case', async () => {
    await seed();

    const byCategory = await api().get('/api/normativa/items').query({ category: 'AVISOS OFICIALES' }).expect(200);
    expect(byCategory.body.items.map((item: { kind: string }) => item.kind)).toEqual(['Aviso Oficial']);

    const byOrganism = await api().get('/api/normativa/items').query({ q: 'biblioteca' }).expect(200);
    expect(byOrganism.body.items.map((item: { number: string }) => item.number)).toEqual(['286/2026']);

    const byText = await api().get('/api/normativa/items').query({ q: 'GASTRONÓMICO' }).expect(200);
    expect(byText.body.items.map((item: { number: string }) => item.number)).toEqual(['683/2026']);

    const bySummary = await api().get('/api/normativa/items').query({ q: 'homologa' }).expect(200);
    expect(bySummary.body.items).toHaveLength(1);

    expect((await api().get('/api/normativa/items').query({ q: 'nada que ver' }).expect(200)).body.items).toEqual([]);
  });

  it('says there is nothing yet when no edition was read', async () => {
    expect((await api().get('/api/normativa/items').expect(200)).body).toEqual({
      source: 'BO_NACIONAL',
      sources: [{ id: 'BO_NACIONAL', label: 'Boletín Oficial (de prueba)', shortLabel: 'Nación' }],
      date: null,
      dates: [],
      categories: [],
      items: [],
    });
  });

  it('tells which bulletin each norm came from, and refuses a bulletin that is not read', async () => {
    await seed();

    const { body } = await api().get('/api/normativa/items').expect(200);
    expect(body.source).toBe('BO_NACIONAL');
    expect(body.items[0]).toMatchObject({ source: 'BO_NACIONAL', sourceLabel: 'Nación' });
    expect((await api().get('/api/normativa/items').query({ source: 'BO_NACIONAL' }).expect(200)).body.items).toHaveLength(3);

    const unknown = await api().get('/api/normativa/items').query({ source: 'BO_OTRO' }).expect(400);
    expect(unknown.body.error.message).toBe('El boletín no existe');
  });

  it.each(['hoy', '2026-13-45', '16/10/2026'])('refuses the date %j', async (date) => {
    await api().get('/api/normativa/items').query({ date }).expect(400);
  });
});
