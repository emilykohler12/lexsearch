import type { IsoDate } from '../../calendar/dates.js';

/** A norm as the bulletin lists it, before its text is read. */
export interface ListedNorm {
  /** Identifier of the notice in the source (digits). */
  externalId: string;
  publishedOn: IsoDate;
  /** Heading of the bulletin it appears under: RESOLUCIONES, DISPOSICIONES... */
  category: string;
  organism: string;
  /** Resolución, Decreto, Disposición... (the number goes apart). */
  kind: string;
  number: string;
  /** Technical code (RESOL-2026-286-APN-BNMM#MCH); empty when the listing doesn't have one. */
  reference: string;
  url: string;
}

export interface EditionListing {
  /** Date of the edition the source gave back; null when there is none (a day without edition). */
  editionDate: IsoDate | null;
  items: ListedNorm[];
}

/** Where the norms come from: the national bulletin today; a provincial one would be another implementation. */
export interface NormativeSource {
  /** Stored with every norm (BO_NACIONAL, BO_MISIONES). */
  readonly id: string;
  /** Its full name: «Boletín Oficial de la República Argentina». */
  readonly label: string;
  /** The short name that tells the jurisdiction: «Nación», «Misiones». */
  readonly shortLabel: string;
  /** The listing of one edition; the newest one when no date is given. */
  listEdition(date?: IsoDate): Promise<EditionListing>;
  /** The whole text of a listed norm, as plain text. */
  fetchText(item: ListedNorm): Promise<string>;
}

/** The source can't be read right now: no connection, an error from the site, or pages that changed their format. */
export class SourceUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SourceUnavailableError';
  }
}

/** The site couldn't be reached at all (no internet, timeout): nothing is wrong with any particular norm. */
export class SourceConnectionError extends SourceUnavailableError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SourceConnectionError';
  }
}

/** The site asked to slow down (HTTP 429): nothing is wrong with any norm; the next try has to wait. */
export class SourceRateLimitedError extends SourceUnavailableError {
  constructor(
    message: string,
    /** How long the site asked to wait. */
    readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = 'SourceRateLimitedError';
  }
}
