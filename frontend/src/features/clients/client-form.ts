import type { ChecklistItem, Client, ClientFields, ClientProposal, PracticeArea } from '../../api/types';
import { normalizeText } from '../../lib/format';

/** The form works with "" for "no area yet"; the API uses null. */
export type ClientForm = Omit<ClientFields, 'practiceArea'> & { practiceArea: PracticeArea | '' };

/** Fields shown as a text box: the ones the AI can fill and the form can highlight. */
export const TEXT_FIELDS = [
  'fullName',
  'documentNumber',
  'email',
  'phone',
  'address',
  'counterpartyName',
  'counterpartyDocument',
  'counterpartyAddress',
  'conflictSummary',
  'claim',
] as const;

export type TextField = (typeof TEXT_FIELDS)[number];
export type FieldName = TextField | 'personType' | 'practiceArea';

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function emptyForm(): ClientForm {
  return {
    fullName: '',
    personType: 'FISICA',
    documentNumber: '',
    email: '',
    phone: '',
    address: '',
    counterpartyName: '',
    counterpartyDocument: '',
    counterpartyAddress: '',
    practiceArea: '',
    conflictSummary: '',
    claim: '',
    checklist: [],
    meetingNotes: '',
  };
}

export function formFromClient(client: Client): ClientForm {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, practiceArea, ...fields } = client;
  return { ...fields, practiceArea: practiceArea ?? '' };
}

/** What the server would store for this form: trimmed texts, no blank checklist items. */
export function toFields(form: ClientForm): ClientFields {
  return {
    ...form,
    fullName: form.fullName.trim(),
    documentNumber: form.documentNumber.trim(),
    email: form.email.trim(),
    phone: form.phone.trim(),
    address: form.address.trim(),
    counterpartyName: form.counterpartyName.trim(),
    counterpartyDocument: form.counterpartyDocument.trim(),
    counterpartyAddress: form.counterpartyAddress.trim(),
    conflictSummary: form.conflictSummary.trim(),
    claim: form.claim.trim(),
    meetingNotes: form.meetingNotes.trim(),
    practiceArea: form.practiceArea || null,
    checklist: form.checklist
      .map((item) => ({ ...item, text: item.text.trim() }))
      .filter((item) => item.text.length > 0),
  };
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What the lawyer has changed: for a saved client, only the fields that differ; for a new one,
 * everything, as soon as anything was typed. Null when there is nothing to save. Trailing spaces
 * don't count (the server trims them), so a saved form is never "dirty" because of them.
 */
export function changesFrom(client: Client | null, form: ClientForm): Partial<ClientFields> | null {
  const current = toFields(form);
  const saved = client ? toFields(formFromClient(client)) : toFields(emptyForm());
  const changed = (Object.keys(current) as Array<keyof ClientFields>).filter((key) => !sameValue(current[key], saved[key]));
  if (changed.length === 0) return null;
  return client ? Object.fromEntries(changed.map((key) => [key, current[key]])) : current;
}

const documentKey = (text: string) => normalizeText(text).replace(/[^\p{L}\d]+/gu, ' ').trim();

export interface AppliedProposal {
  form: ClientForm;
  /** Fields the AI filled, to highlight them until the lawyer edits them. */
  filled: FieldName[];
  /** Checklist items the AI added. */
  addedItemIds: string[];
}

/**
 * Fills what is still empty with the AI's proposal and adds the documents that aren't in the
 * checklist yet. Anything the lawyer already wrote is left alone.
 */
export function applyProposal(form: ClientForm, proposal: ClientProposal): AppliedProposal {
  const next: ClientForm = { ...form };
  const filled: FieldName[] = [];

  for (const key of TEXT_FIELDS) {
    if (form[key].trim() === '' && proposal[key].trim() !== '') {
      next[key] = proposal[key];
      filled.push(key);
    }
  }
  // The person type always has a value, so it only follows the proposal while the form is still blank.
  if (form.fullName.trim() === '' && proposal.fullName.trim() !== '') {
    next.personType = proposal.personType;
    filled.push('personType');
  }
  if (form.practiceArea === '' && proposal.practiceArea) {
    next.practiceArea = proposal.practiceArea;
    filled.push('practiceArea');
  }

  const known = new Set(form.checklist.map((item) => documentKey(item.text)));
  const added: ChecklistItem[] = [];
  for (const text of proposal.missingDocuments) {
    const key = documentKey(text);
    if (!key || known.has(key)) continue;
    known.add(key);
    added.push({ id: newId(), text, done: false });
  }
  next.checklist = [...form.checklist, ...added];

  return { form: next, filled, addedItemIds: added.map((item) => item.id) };
}
