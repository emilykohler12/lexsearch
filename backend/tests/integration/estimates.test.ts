import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlmProvider } from '../helpers/fakes.js';
import { createTestApp, makePdf } from '../helpers/test-app.js';

const llm = new FakeLlmProvider();
const ctx = await createTestApp({ llm });
const noLlm = await createTestApp({ llm: null });
afterAll(async () => {
  await ctx.close();
  await noLlm.close();
});
beforeEach(async () => {
  llm.structuredCalls = [];
  llm.structuredError = null;
  llm.structuredResponder = null;
  await ctx.reset();
});

const FACTS = 'Un trabajador fue despedido sin causa después de cinco años y reclama la indemnización por antigüedad.';

async function seedRulings() {
  for (const n of [1, 2, 3]) {
    await request(ctx.app)
      .post('/api/documents')
      .field('category', 'JURISPRUDENCIA')
      .attach(
        'files',
        await makePdf([`Fallo ${n}. Despido sin causa del trabajador. El empleador no acreditó la causa del despido y se condena a pagar la indemnización por antigüedad.`]),
        `Fallo_${n}.pdf`,
      );
  }
  // A law about the same subject must not be read as a ruling.
  await request(ctx.app)
    .post('/api/documents')
    .field('category', 'LEGISLACION')
    .attach('files', Buffer.from('Despido sin causa del trabajador: indemnización por antigüedad.'), 'Ley.txt');
  await ctx.queue.idle();
}

const allFavorable = (input: { userMessage: string }) => {
  const count = (input.userMessage.match(/<antecedente-/g) ?? []).length;
  return {
    antecedents: Array.from({ length: count }, (_, i) => ({
      number: i + 1,
      comparable: 'SI',
      direction: 'FAVORABLE',
      holding: 'Condenó al empleador.',
      quote: 'El empleador no acreditó la causa del despido',
      court: '',
      courtLevel: 'DESCONOCIDO',
      year: 0,
      similarities: ['Despido sin causa'],
      differences: [],
    })),
    missingFacts: ['Si hubo intimación previa'],
  };
};

describe('POST /api/estimates/analyze', () => {
  it('reads only jurisprudence, verifies the phrases and counts the orientation itself', async () => {
    await seedRulings();
    llm.structuredResponder = (input) => allFavorable(input as { userMessage: string });

    const res = await request(ctx.app).post('/api/estimates/analyze').send({ facts: FACTS, claim: 'Indemnización por despido' });

    expect(res.status).toBe(200);
    const { proposal } = res.body;
    expect(proposal.orientation).toBe('FAVORABLE');
    expect(proposal.notice).toMatch(/no una predicción/);
    expect(proposal.result.searched).toBe(3);
    expect(proposal.result.counts.favorable).toBe(3);
    expect(proposal.result.antecedents[0]).toMatchObject({ quoteVerified: true, counted: true });
    expect(llm.structuredCalls[0]!.userMessage).not.toContain('Ley.txt');
    // The analysis proposes: nothing is saved.
    expect((await request(ctx.app).get('/api/estimates')).body.estimates).toEqual([]);
  });

  it('says «insufficient» without calling the model when the library has no jurisprudence like the case', async () => {
    const res = await request(ctx.app).post('/api/estimates/analyze').send({ facts: FACTS });
    expect(res.status).toBe(200);
    expect(res.body.proposal.orientation).toBe('INSUFFICIENT');
    expect(llm.structuredCalls).toHaveLength(0);
  });

  it('does not count a reading whose phrase is not in the ruling', async () => {
    await seedRulings();
    llm.structuredResponder = (input) => {
      const data = allFavorable(input as { userMessage: string });
      data.antecedents[0]!.quote = 'una frase inventada por el modelo';
      return data;
    };
    const res = await request(ctx.app).post('/api/estimates/analyze').send({ facts: FACTS });
    expect(res.body.proposal.result.counts).toMatchObject({ favorable: 2, unverified: 1 });
    expect(res.body.proposal.orientation).toBe('INSUFFICIENT');
  });

  it('validates the input and reports a missing key or a failing model without leaking content', async () => {
    expect((await request(ctx.app).post('/api/estimates/analyze').send({ facts: 'corto' })).status).toBe(400);
    expect((await request(noLlm.app).post('/api/estimates/analyze').send({ facts: FACTS })).status).toBe(503);

    await seedRulings();
    llm.structuredError = new Error('boom con datos del caso');
    const failed = await request(ctx.app).post('/api/estimates/analyze').send({ facts: FACTS });
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(failed.body)).not.toContain(FACTS);
    const stored = await request(ctx.app).get('/api/interactions');
    expect(JSON.stringify(stored.body)).not.toContain('boom');
  });

  it('rejects an expediente that does not exist', async () => {
    const res = await request(ctx.app).post('/api/estimates/analyze').send({ facts: FACTS, caseId: '00000000-0000-4000-8000-000000000000' });
    expect(res.status).toBe(400);
  });
});

describe('saved estimates', () => {
  it('saves a reviewed estimate, lists it, edits the note and deletes it', async () => {
    await seedRulings();
    llm.structuredResponder = (input) => allFavorable(input as { userMessage: string });
    const { proposal } = (await request(ctx.app).post('/api/estimates/analyze').send({ facts: FACTS, claim: 'Indemnización' })).body;

    const saved = await request(ctx.app).post('/api/estimates').send({ facts: FACTS, claim: 'Indemnización', result: proposal.result, model: proposal.model });
    expect(saved.status).toBe(201);
    const id = saved.body.estimate.id;
    expect(saved.body.estimate).toMatchObject({ title: 'Indemnización', orientation: 'FAVORABLE' });

    const list = await request(ctx.app).get('/api/estimates');
    expect(list.body.estimates).toHaveLength(1);
    expect(list.body.estimates[0]).not.toHaveProperty('facts');

    const edited = await request(ctx.app).patch(`/api/estimates/${id}`).send({ note: 'Revisar el fallo 2' });
    expect(edited.body.estimate.note).toBe('Revisar el fallo 2');
    expect((await request(ctx.app).get(`/api/estimates/${id}`)).body.estimate.result.antecedents).toHaveLength(3);

    expect((await request(ctx.app).delete(`/api/estimates/${id}`)).status).toBe(204);
    expect((await request(ctx.app).get(`/api/estimates/${id}`)).status).toBe(404);
  });

  it('recounts on save: a forged orientation is not stored', async () => {
    await seedRulings();
    llm.structuredResponder = (input) => allFavorable(input as { userMessage: string });
    const { proposal } = (await request(ctx.app).post('/api/estimates/analyze').send({ facts: FACTS })).body;
    const forged = { ...proposal.result, orientation: 'UNFAVORABLE', counts: { ...proposal.result.counts, favorable: 0, unfavorable: 3 } };

    const saved = await request(ctx.app).post('/api/estimates').send({ facts: FACTS, result: forged });
    expect(saved.body.estimate).toMatchObject({ orientation: 'FAVORABLE' });
    expect(saved.body.estimate.result.counts.favorable).toBe(3);
  });

  it('rejects a result that is not valid and an unknown id', async () => {
    expect((await request(ctx.app).post('/api/estimates').send({ facts: FACTS, result: { orientation: 'GANA' } })).status).toBe(400);
    expect((await request(ctx.app).get('/api/estimates/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });
});
