import { ExternalLink, Info } from 'lucide-react';
import { api } from '../../api/client';
import type { EstimateAntecedent, EstimateOrientation, EstimateResult } from '../../api/types';
import { Alert } from '../../components/ui';

const ORIENTATION_STYLES: Record<EstimateOrientation, string> = {
  FAVORABLE: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  DIVIDED: 'border-amber-200 bg-amber-50 text-amber-900',
  UNFAVORABLE: 'border-red-200 bg-red-50 text-red-900',
  INSUFFICIENT: 'border-line bg-paper text-ink',
};

const DIRECTION_LABELS = { FAVORABLE: 'A favor', DESFAVORABLE: 'En contra', NEUTRO: 'Neutro' } as const;
const LEVEL_LABELS = { CSJN: 'Corte Suprema', SUPERIOR: 'Tribunal superior', CAMARA: 'Cámara', PRIMERA: 'Primera instancia', DESCONOCIDO: 'Tribunal desconocido' } as const;
const COMPARABLE_LABELS ={ SI: 'Comparable', PARCIAL: 'Comparable en parte', NO: 'No comparable' } as const;

/** The result of an estimate, whether it is a proposal or one that was saved. The notice is always shown. */
export function EstimateView({ label, notice, result }: { label: string; notice: string; result: EstimateResult }) {
  const { counts } = result;
  const comparable = counts.favorable + counts.unfavorable + counts.neutral;

  return (
    <div className="space-y-4">
      <Alert tone="warning">{notice}</Alert>

      <div className={`rounded-lg border px-4 py-4 ${ORIENTATION_STYLES[result.orientation]}`}>
        <p className="text-lg font-semibold">{label}</p>
        <p className="mt-1 text-sm">
          {result.searched === 0
            ? 'No encontré jurisprudencia parecida en tu biblioteca.'
            : result.antecedents.length === 0
            ? `Solo encontré ${result.searched} fallo(s) parecido(s) en tu biblioteca: no alcanza para estimar.`
            : `Se leyeron ${result.searched} fallos de tu biblioteca; ${comparable} se pudieron comparar y verificar: ${counts.favorable} a favor, ${counts.unfavorable} en contra y ${counts.neutral} neutros.`}
        </p>
        {result.orientation === 'INSUFFICIENT' && result.searched > 0 && (
          <p className="mt-1 text-sm">Hacen falta al menos 3 antecedentes comparables y verificados, y que alguno incline hacia un lado.</p>
        )}
        {result.weighted.favorable + result.weighted.unfavorable > 0 && (
          <p className="mt-1 text-xs">Los fallos de tribunales superiores y los más recientes pesan más: a favor suman {result.weighted.favorable.toLocaleString('es-AR')} y en contra {result.weighted.unfavorable.toLocaleString('es-AR')}.</p>
        )}
        {(counts.notComparable > 0 || counts.unverified > 0) && (
          <p className="mt-1 text-xs">
            {counts.notComparable > 0 && `${counts.notComparable} no comparables. `}
            {counts.unverified > 0 && `${counts.unverified} sin contar porque la frase no se pudo verificar.`}
          </p>
        )}
      </div>

      {result.antecedents.length > 0 && (
        <ul className="space-y-3">
          {result.antecedents.map((antecedent) => (
            <AntecedentCard key={antecedent.documentId} antecedent={antecedent} />
          ))}
        </ul>
      )}

      {result.missingFacts.length > 0 && (
        <div className="card p-4">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Info className="size-4" aria-hidden /> Datos que cambiarían la comparación
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            {result.missingFacts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AntecedentCard({ antecedent }: { antecedent: EstimateAntecedent }) {
  return (
    <li className={`card space-y-2 p-4 ${antecedent.counted ? '' : 'opacity-80'}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <a
          href={api.documentFileUrl(antecedent.documentId, antecedent.pageStart)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-1 font-medium underline sm:min-h-0"
        >
          {antecedent.documentTitle}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
        <span className="text-xs text-muted">{COMPARABLE_LABELS[antecedent.comparable]}</span>
        {antecedent.comparable !== 'NO' && <span className="rounded-full bg-paper px-2 py-0.5 text-xs ring-1 ring-line">{DIRECTION_LABELS[antecedent.direction]}</span>}
      </div>
      <p className="text-xs text-muted">
        {antecedent.court || LEVEL_LABELS[antecedent.level]}
        {antecedent.court && antecedent.level !== 'DESCONOCIDO' && ` (${LEVEL_LABELS[antecedent.level]})`}
        {antecedent.year ? ` · ${antecedent.year}` : ' · sin fecha'}
        {antecedent.counted && antecedent.direction !== 'NEUTRO' && ` · pesa ${antecedent.weight.toLocaleString('es-AR')}`}
      </p>
      {antecedent.holding && (
        <p className="text-sm">
          {antecedent.comparable !== 'NO' && !antecedent.counted && <span className="text-amber-800">Lectura de la IA sin frase verificada: </span>}
          {antecedent.holding}
        </p>
      )}
      {antecedent.quote ? (
        <blockquote className="border-l-2 border-line pl-3 text-sm text-muted">«{antecedent.quote}»</blockquote>
      ) : (
        antecedent.comparable !== 'NO' && <p className="text-xs text-amber-800">No se pudo verificar la frase en el fallo: no se contó. Revisalo en el original.</p>
      )}
      {(antecedent.similarities.length > 0 || antecedent.differences.length > 0) && (
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          {antecedent.similarities.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted">En qué se parece</p>
              <ul className="list-disc pl-5">
                {antecedent.similarities.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {antecedent.differences.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted">En qué se diferencia</p>
              <ul className="list-disc pl-5">
                {antecedent.differences.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
