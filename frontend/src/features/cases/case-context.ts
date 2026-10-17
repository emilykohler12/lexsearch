import { useOutletContext } from 'react-router';
import type { Case } from '../../api/types';

/** What the page of an expediente hands to its sections (timeline, documents, contradictions). */
export interface CaseContext {
  found: Case;
}

export const useCaseContext = () => useOutletContext<CaseContext>();
