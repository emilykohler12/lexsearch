import type { DayType, DocumentCategory, DocumentStatus, DraftType, PersonType, PracticeArea } from '../api/types';

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  LEGISLACION: 'Legislación',
  JURISPRUDENCIA: 'Jurisprudencia',
  DOCTRINA: 'Doctrina',
  MODELO: 'Modelo propio',
  ESCRITO: 'Escrito',
  OTRO: 'Otro',
};

export const CATEGORIES = Object.keys(CATEGORY_LABELS) as DocumentCategory[];

export const STATUS_LABELS: Record<DocumentStatus, string> = {
  PENDING: 'En cola',
  PROCESSING: 'Procesando',
  READY: 'Listo',
  FAILED: 'Error',
};

const dateFormatter = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
const numberFormatter = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${numberFormatter.format(bytes / 1024)} KB`;
  return `${numberFormatter.format(bytes / (1024 * 1024))} MB`;
}

/** plural(1, 'fragmento', 'fragmentos') -> "1 fragmento" */
export function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function formatSeconds(ms: number): string {
  return `${numberFormatter.format(ms / 1000)} s`;
}

export function formatPages(pageStart: number | null, pageEnd: number | null): string | null {
  if (pageStart === null) return null;
  if (pageEnd === null || pageEnd === pageStart) return `pág. ${pageStart}`;
  return `págs. ${pageStart}–${pageEnd}`;
}

export const DRAFT_TYPE_LABELS: Record<DraftType, string> = {
  CARTA_DOCUMENTO: 'Carta documento',
  CONTRATO: 'Contrato',
  DEMANDA: 'Demanda',
  CONTESTACION_DEMANDA: 'Contestación de demanda',
  ESCRITO_JUDICIAL: 'Otro escrito judicial',
  NOTA: 'Nota o intimación',
  OTRO: 'Otro documento',
};

export const DRAFT_TYPES = Object.keys(DRAFT_TYPE_LABELS) as DraftType[];

export const PRACTICE_AREA_LABELS: Record<PracticeArea, string> = {
  LABORAL: 'Laboral',
  CIVIL: 'Civil',
  COMERCIAL: 'Comercial',
  FAMILIA: 'Familia',
  SUCESIONES: 'Sucesiones',
  PENAL: 'Penal',
  ADMINISTRATIVO: 'Administrativo',
  PREVISIONAL: 'Previsional',
  CONSUMO: 'Consumidor',
  OTRO: 'Otro',
};

export const PRACTICE_AREAS = Object.keys(PRACTICE_AREA_LABELS) as PracticeArea[];

export const PERSON_TYPE_LABELS: Record<PersonType, string> = {
  FISICA: 'Persona humana',
  JURIDICA: 'Persona jurídica',
};

export const PERSON_TYPES = Object.keys(PERSON_TYPE_LABELS) as PersonType[];

/** Lowercase and without accents, to compare what the lawyer types with what is stored. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

export const DAY_TYPE_LABELS: Record<DayType, string> = {
  BUSINESS: 'Hábiles',
  CALENDAR: 'Corridos',
};

export const DAY_TYPES = Object.keys(DAY_TYPE_LABELS) as DayType[];

/** "1 día hábil", "15 días hábiles", "10 días corridos". */
export function termText(days: number, dayType: DayType): string {
  if (days === 1) return dayType === 'BUSINESS' ? '1 día hábil' : '1 día corrido';
  return `${days} días ${dayType === 'BUSINESS' ? 'hábiles' : 'corridos'}`;
}

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** "vie 23/10/2026" from AAAA-MM-DD, read as plain text: no time zone can move it a day. */
export function formatDay(iso: string): string {
  const [year = '', month = '', day = ''] = iso.split('-');
  const weekday = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay();
  return `${WEEKDAYS[weekday]} ${day}/${month}/${year}`;
}

/** Today's date in Argentina as AAAA-MM-DD, whatever the computer's own time zone is. */
export function todayInArgentina(): string {
  // The "en-CA" locale writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** "Vence en 5 días", "Vence hoy", "Venció ayer"… */
export function whenText(daysLeft: number): string {
  if (daysLeft < -1) return `Venció hace ${-daysLeft} días`;
  if (daysLeft === -1) return 'Venció ayer';
  if (daysLeft === 0) return 'Vence hoy';
  if (daysLeft === 1) return 'Vence mañana';
  return `Vence en ${daysLeft} días`;
}
