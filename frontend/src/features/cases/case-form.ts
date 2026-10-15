import type { Case, CaseInput, CaseStatus, PracticeArea } from '../../api/types';

/** The expediente as the form holds it: texts as typed, clients as ids. */
export interface CaseForm {
  title: string;
  number: string;
  court: string;
  /** "" = not defined yet. */
  practiceArea: PracticeArea | '';
  status: CaseStatus;
  notes: string;
  clientIds: string[];
}

/** "Nuevo expediente" in a client's file arrives here with the client already chosen. */
export function emptyForm(clientId = ''): CaseForm {
  return {
    title: '',
    number: '',
    court: '',
    practiceArea: '',
    status: 'ACTIVE',
    notes: '',
    clientIds: clientId ? [clientId] : [],
  };
}

export function formFromCase(found: Case): CaseForm {
  return {
    title: found.title,
    number: found.number,
    court: found.court,
    practiceArea: found.practiceArea ?? '',
    status: found.status,
    notes: found.notes,
    clientIds: found.clients.map((client) => client.id),
  };
}

export function toInput(form: CaseForm): CaseInput {
  return {
    title: form.title.trim(),
    number: form.number.trim(),
    court: form.court.trim(),
    practiceArea: form.practiceArea || null,
    status: form.status,
    notes: form.notes.trim(),
    clientIds: form.clientIds,
  };
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Only what differs from the saved expediente (null when nothing does). */
export function changesFrom(found: Case, form: CaseForm): Partial<CaseInput> | null {
  const input = toInput(form);
  const changes: Partial<CaseInput> = {};

  if (input.title !== found.title) changes.title = input.title;
  if (input.number !== found.number) changes.number = input.number;
  if (input.court !== found.court) changes.court = input.court;
  if (input.practiceArea !== found.practiceArea) changes.practiceArea = input.practiceArea;
  if (input.status !== found.status) changes.status = input.status;
  if (input.notes !== found.notes) changes.notes = input.notes;
  if (!sameIds(input.clientIds, found.clients.map((client) => client.id))) changes.clientIds = input.clientIds;

  return Object.keys(changes).length > 0 ? changes : null;
}

/** For a new expediente: has the lawyer typed anything yet? */
export function hasEntries(form: CaseForm, initial: CaseForm): boolean {
  return JSON.stringify(form) !== JSON.stringify(initial);
}
