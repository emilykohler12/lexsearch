import { ExternalLink } from 'lucide-react';
import type { NormativeAlert, NormativeAlertStatus, NormativeRelevance } from '../../api/types';
import { formatLongDay, plural } from '../../lib/format';
import { normTitle } from './norm-title';

const RELEVANCE_STYLES: Record<NormativeRelevance, string> = {
  ALTA: 'bg-red-50 text-red-800 ring-red-200',
  MEDIA: 'bg-amber-50 text-amber-800 ring-amber-200',
};

const RELEVANCE_LABELS: Record<NormativeRelevance, string> = {
  ALTA: 'Relevancia alta',
  MEDIA: 'Relevancia media',
};

/** Who the norm concerns, from the clients and expedientes the lawyer has in the topic's area. */
function affectedText(alert: NormativeAlert): string | null {
  const affected = alert.affected;
  if (!affected || (affected.clients === 0 && affected.cases === 0)) return null;
  const parts = [
    affected.clients > 0 ? plural(affected.clients, 'cliente', 'clientes') : null,
    affected.cases > 0 ? plural(affected.cases, 'expediente abierto', 'expedientes abiertos') : null,
  ].filter(Boolean);
  return `Alcanza a ${parts.join(' y ')} de ${alert.topic.name}.`;
}

/** A norm that touches a topic the lawyer follows, with why it matters and the phrase of the norm that says so. */
export function AlertCard({
  alert,
  busy,
  onStatus,
}: {
  alert: NormativeAlert;
  busy: boolean;
  onStatus: (status: NormativeAlertStatus) => void;
}) {
  const { item } = alert;
  const affected = affectedText(alert);
  const unseen = alert.status === 'NEW';

  return (
    <li className={`card p-3 sm:p-4 ${unseen ? 'border-l-4 border-l-brass-500' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ring-1 ${RELEVANCE_STYLES[alert.relevance]}`}>
          {RELEVANCE_LABELS[alert.relevance]}
        </span>
        <span className="inline-flex rounded-md bg-navy-900/5 px-2 py-0.5 text-xs font-medium text-navy-800 ring-1 ring-navy-900/10">
          {alert.topic.name}
        </span>
        <span className="inline-flex rounded-md bg-white px-2 py-0.5 text-xs font-medium text-muted ring-1 ring-line">{item.sourceLabel}</span>
        {alert.origin === 'KEYWORDS' && <span className="text-xs text-muted">Por palabra clave</span>}
        <span className="text-xs text-muted sm:ml-auto">{formatLongDay(item.publishedOn)}</span>
      </div>

      <h3 className="mt-2 font-sans text-base font-medium break-words">{normTitle(item) || item.kind}</h3>
      <p className="mt-0.5 text-xs break-words text-muted">{item.organism}</p>

      {item.summary && <p className="mt-2 text-sm break-words">{item.summary}</p>}
      {alert.reason && <p className="mt-1 text-sm break-words text-muted">{alert.reason}</p>}

      {alert.quote ? (
        <blockquote className="mt-3 border-l-2 border-brass-500 pl-3 text-sm break-words">“{alert.quote}”</blockquote>
      ) : (
        alert.origin === 'AI' &&
        !alert.quoteVerified && <p className="mt-2 text-xs text-amber-800">No se encontró la frase en la norma: leela en el Boletín Oficial.</p>
      )}

      {affected && <p className="mt-3 text-sm font-medium">{affected}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="btn-secondary min-h-11 sm:min-h-0"
          onClick={() => unseen && onStatus('SEEN')}
        >
          <ExternalLink className="size-4" aria-hidden />
          Ver en el Boletín Oficial
        </a>
        {unseen && (
          <button type="button" className="btn-secondary min-h-11 sm:min-h-0" disabled={busy} onClick={() => onStatus('SEEN')}>
            Marcar como vista
          </button>
        )}
        {alert.status === 'DISMISSED' ? (
          <button type="button" className="btn-secondary min-h-11 sm:min-h-0" disabled={busy} onClick={() => onStatus('SEEN')}>
            Restaurar
          </button>
        ) : (
          <button type="button" className="btn-secondary min-h-11 sm:min-h-0" disabled={busy} onClick={() => onStatus('DISMISSED')}>
            Descartar
          </button>
        )}
      </div>
    </li>
  );
}
