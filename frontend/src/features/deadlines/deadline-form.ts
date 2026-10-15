import type { DayType, Deadline, DeadlineInput, DeadlineProposal, DeadlineState } from '../../api/types';

/** One term (title + days + type) of the form: a document can grant several. */
export interface TermRow {
  /** Stable React key. */
  key: string;
  title: string;
  /** What is typed in the days box ("" = empty). */
  days: string;
  dayType: DayType;
  /** The sentence of the document that sets the term (from an analysis, or saved with the deadline). */
  quote: string;
  /** null: it doesn't come from a document. false: the AI's quote isn't in the document. */
  quoteVerified: boolean | null;
  /** The document doesn't say how many days: the lawyer fills them in. */
  daysMissing: boolean;
  /** The AI filled the title and days in: highlighted until the lawyer edits them. */
  suggested: boolean;
}

export interface DeadlineForm {
  notificationDate: string;
  caseReference: string;
  /** "" = no client. */
  clientId: string;
  /** "" = no expediente. */
  caseId: string;
  notes: string;
  terms: TermRow[];
}

/** Which of the shared fields the AI filled in. */
export type SharedField = 'notificationDate' | 'caseReference' | 'caseId';

let termCounter = 0;
const newKey = () => `term-${++termCounter}`;

export function emptyTerm(): TermRow {
  return { key: newKey(), title: '', days: '', dayType: 'BUSINESS', quote: '', quoteVerified: null, daysMissing: false, suggested: false };
}

export function emptyForm(clientId = '', caseId = ''): DeadlineForm {
  return { notificationDate: '', caseReference: '', clientId, caseId, notes: '', terms: [emptyTerm()] };
}

export function formFromDeadline(deadline: Deadline): DeadlineForm {
  return {
    notificationDate: deadline.notificationDate,
    caseReference: deadline.caseReference,
    clientId: deadline.client?.id ?? '',
    caseId: deadline.case?.id ?? '',
    notes: deadline.notes,
    terms: [
      {
        key: newKey(),
        title: deadline.title,
        days: String(deadline.days),
        dayType: deadline.dayType,
        quote: deadline.sourceQuote,
        quoteVerified: deadline.sourceQuote ? true : null,
        daysMissing: false,
        suggested: false,
      },
    ],
  };
}

export const MAX_TERM_DAYS = 365;

/** A whole number of days between 1 and 365, or null. */
export function parseDays(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const days = Number(text.trim());
  return days >= 1 && days <= MAX_TERM_DAYS ? days : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What the server needs to calculate a due date; null while the term is incomplete. */
export function termForCalculation(notificationDate: string, row: TermRow) {
  const days = parseDays(row.days);
  if (!ISO_DATE.test(notificationDate) || days === null) return null;
  return { notificationDate, days, dayType: row.dayType };
}

/** The deadlines to save, one per term. */
export function toInputs(form: DeadlineForm): DeadlineInput[] {
  return form.terms.map((row) => ({
    title: row.title.trim(),
    caseReference: form.caseReference.trim(),
    notes: form.notes.trim(),
    clientId: form.clientId || null,
    caseId: form.caseId || null,
    notificationDate: form.notificationDate,
    days: parseDays(row.days) ?? 0,
    dayType: row.dayType,
    sourceQuote: row.quote,
  }));
}

/** Only what differs from the saved deadline (null when nothing does). */
export function changesFrom(deadline: Deadline, form: DeadlineForm): Partial<DeadlineInput> | null {
  const [row] = form.terms;
  if (!row) return null;
  const changes: Partial<DeadlineInput> = {};
  const days = parseDays(row.days);

  if (row.title.trim() !== deadline.title) changes.title = row.title.trim();
  if (days !== null && days !== deadline.days) changes.days = days;
  if (row.dayType !== deadline.dayType) changes.dayType = row.dayType;
  if (form.notificationDate !== deadline.notificationDate && ISO_DATE.test(form.notificationDate)) {
    changes.notificationDate = form.notificationDate;
  }
  if (form.caseReference.trim() !== deadline.caseReference) changes.caseReference = form.caseReference.trim();
  if (form.notes.trim() !== deadline.notes) changes.notes = form.notes.trim();
  if (form.clientId !== (deadline.client?.id ?? '')) changes.clientId = form.clientId || null;
  if (form.caseId !== (deadline.case?.id ?? '')) changes.caseId = form.caseId || null;

  return Object.keys(changes).length > 0 ? changes : null;
}

/** For a new deadline: has the lawyer typed anything yet? */
export function hasEntries(form: DeadlineForm, initial: DeadlineForm): boolean {
  const plain = (f: DeadlineForm) =>
    JSON.stringify({ ...f, terms: f.terms.map(({ key: _key, suggested: _suggested, ...rest }) => rest) });
  return plain(form) !== plain(initial);
}

const isBlank = (row: TermRow) => row.title.trim() === '' && row.days.trim() === '' && row.quote === '';

export interface AppliedProposal {
  form: DeadlineForm;
  /** Shared fields the AI filled in. */
  filled: SharedField[];
}

/**
 * Adds the terms the document grants and fills the notification date and the case reference if
 * they are still empty: what the lawyer already wrote is left alone.
 */
export function applyProposal(form: DeadlineForm, proposal: DeadlineProposal): AppliedProposal {
  const filled: SharedField[] = [];
  const next: DeadlineForm = { ...form };

  if (form.notificationDate === '' && proposal.notificationDate !== '') {
    next.notificationDate = proposal.notificationDate;
    filled.push('notificationDate');
  }
  if (form.caseReference.trim() === '' && proposal.caseReference !== '') {
    next.caseReference = proposal.caseReference;
    filled.push('caseReference');
  }

  const proposed: TermRow[] = proposal.terms.map((term) => ({
    key: newKey(),
    title: term.title,
    days: term.days > 0 ? String(term.days) : '',
    dayType: term.dayType,
    quote: term.quote,
    quoteVerified: term.quoteVerified,
    daysMissing: term.days === 0,
    suggested: true,
  }));
  const kept = form.terms.filter((row) => !isBlank(row));
  const terms = [...kept, ...proposed];
  next.terms = terms.length > 0 ? terms : [emptyTerm()];

  return { form: next, filled };
}

/** Same classification the server uses for pending deadlines. */
export function stateForDaysLeft(daysLeft: number): DeadlineState {
  if (daysLeft < 0) return 'OVERDUE';
  if (daysLeft === 0) return 'TODAY';
  return daysLeft <= 3 ? 'SOON' : 'ONGOING';
}
