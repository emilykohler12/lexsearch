import { TriangleAlert } from 'lucide-react';
import type { HearingRole, HearingTurn, HearingTurnKind } from '../../api/types';
import { ROLE_SHORT_LABELS, TURN_KIND_LABELS } from './hearing-labels';

const KIND_STYLES: Record<HearingTurnKind, string> = {
  APERTURA: 'bg-navy-900/5 text-navy-800 ring-navy-900/10',
  PREGUNTA: 'bg-navy-900/5 text-navy-800 ring-navy-900/10',
  REPREGUNTA: 'bg-amber-50 text-amber-800 ring-amber-200',
  OBJECION: 'bg-red-50 text-red-800 ring-red-200',
  CIERRE: 'bg-navy-900/5 text-navy-800 ring-navy-900/10',
};

/** One intervention of the conversation: the character's (with what kind it is) or the lawyer's. */
export function TurnCard({ turn, role }: { turn: HearingTurn; role: HearingRole }) {
  const mine = turn.speaker === 'USER';

  return (
    <li className={`card border-l-4 p-3 sm:p-4 ${mine ? 'border-l-brass-500 bg-brass-50/40' : 'border-l-navy-800'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{mine ? 'Vos' : ROLE_SHORT_LABELS[role]}</span>
        {turn.kind && turn.kind !== 'APERTURA' && (
          <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ring-1 ${KIND_STYLES[turn.kind]}`}>
            {TURN_KIND_LABELS[turn.kind]}
          </span>
        )}
        {turn.topic && !mine && <span className="text-xs text-muted">{turn.topic}</span>}
      </div>
      <p className="mt-2 text-sm leading-relaxed break-words whitespace-pre-line sm:text-base">{turn.content}</p>
      {turn.unverifiedCitations.length > 0 && (
        <p className="mt-3 flex items-start gap-2 text-xs text-amber-800">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>No figura en tu material: {turn.unverifiedCitations.join(', ')}. Verificalo antes de citarlo.</span>
        </p>
      )}
    </li>
  );
}

/** What the lawyer just sent, shown while the character answers. */
export function PendingTurn({ content }: { content: string }) {
  return (
    <li className="card border-l-4 border-l-brass-500 bg-brass-50/40 p-3 opacity-80 sm:p-4">
      <span className="text-sm font-medium">Vos</span>
      <p className="mt-2 text-sm leading-relaxed break-words whitespace-pre-line sm:text-base">{content}</p>
    </li>
  );
}
