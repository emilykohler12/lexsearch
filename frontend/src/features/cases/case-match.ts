import type { CaseSummary } from '../../api/types';

/** "45.678/2026" and "45678/2026" are the same number: dots and spaces between digits don't count. */
const squash = (text: string) => text.replace(/(?<=\d)[.\s]+(?=\d)/g, '');

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The expediente a cédula points to ("Juzgado… Expte. 45.678/2026 «Pérez c/ Gómez»"), found by its
 * number. Null unless exactly one of the expedientes has a number that appears in the reference.
 */
export function findCaseByReference<T extends Pick<CaseSummary, 'number'>>(cases: T[], reference: string): T | null {
  const text = squash(reference);
  const matches = cases.filter((found) => {
    const number = squash(found.number.trim());
    return number !== '' && new RegExp(`(?<!\\d)${escapeRegExp(number)}(?!\\d)`).test(text);
  });
  return matches.length === 1 ? matches[0]! : null;
}
