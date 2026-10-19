import type { HearingMaterialKind, HearingRole, HearingTurnKind } from '../../api/types';

/** Who the AI plays: the long name for choosing it, the short one for the conversation. */
export const ROLE_LABELS: Record<HearingRole, string> = {
  JUDGE: 'Juez',
  OPPONENT: 'Abogado de la contraparte',
};

export const ROLE_SHORT_LABELS: Record<HearingRole, string> = {
  JUDGE: 'Juez',
  OPPONENT: 'Contraparte',
};

export const TURN_KIND_LABELS: Record<HearingTurnKind, string> = {
  APERTURA: 'Apertura',
  PREGUNTA: 'Pregunta',
  REPREGUNTA: 'Repregunta',
  OBJECION: 'Objeción',
  CIERRE: 'Cierre',
};

export const MATERIAL_LABELS: Record<HearingMaterialKind, string> = {
  DRAFT: 'Borrador',
  DOCUMENT: 'Documento',
  TEXT: 'Texto pegado',
};
