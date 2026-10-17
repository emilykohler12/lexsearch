import { GitCompareArrows } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAnalyzeContradictions, useHealth, useSaveContradictions } from '../../api/hooks';
import type { Case, ContradictionProposal, FindingProposal, LibraryDocument } from '../../api/types';
import { Alert, CategoryBadge, Spinner, StatusBadge } from '../../components/ui';
import { plural } from '../../lib/format';
import { ConfidenceBadge, KindBadge, NoteBadge, StatementList } from './finding-parts';

/** The most documents the model can compare at once (the server enforces it too). */
const MAX_DOCUMENTS = 8;

/**
 * Compares documents of the expediente and shows the contradictions the AI found. Nothing is
 * saved until the lawyer has checked them against the originals and confirmed the ones to keep.
 */
export function Comparer({
  found,
  documents,
  onSaved,
}: {
  found: Case;
  documents: LibraryDocument[];
  onSaved: (message: string) => void;
}) {
  const ready = documents.filter((document) => document.status === 'READY');
  // Until the lawyer chooses, all the ready documents are chosen, unless there are more than can be compared at once:
  // any subset would be arbitrary, so then she picks.
  const [picked, setPicked] = useState<string[] | null>(null);
  const [focus, setFocus] = useState('');
  const [proposal, setProposal] = useState<ContradictionProposal | null>(null);
  const [checked, setChecked] = useState<boolean[]>([]);

  const analyze = useAnalyzeContradictions();
  const save = useSaveContradictions();
  const { data: health } = useHealth();
  const llmConfigured = health?.llm.configured ?? true;

  // A document that was deleted or taken out of the expediente since must not be sent.
  const chosen = (picked ?? (ready.length <= MAX_DOCUMENTS ? ready.map((document) => document.id) : [])).filter((id) =>
    ready.some((document) => document.id === id),
  );
  const canCompare = chosen.length >= 2 && !analyze.isPending && llmConfigured;
  const processing = documents.length - ready.length;

  const toggle = (id: string) => setPicked(chosen.includes(id) ? chosen.filter((other) => other !== id) : [...chosen, id]);

  const compare = () => {
    setProposal(null);
    analyze.mutate(
      { caseId: found.id, documentIds: chosen, focus: focus.trim() },
      {
        onSuccess: (result) => {
          setProposal(result);
          // The ones the lawyer already has, and the ones that could not be checked, start unchecked.
          setChecked(result.findings.map((finding) => finding.verified && !finding.duplicate));
        },
      },
    );
  };

  const confirm = async () => {
    if (!proposal) return;
    const items = proposal.findings
      .filter((_, index) => checked[index])
      .map((finding) => ({
        kind: finding.kind,
        confidence: finding.confidence,
        title: finding.title,
        explanation: finding.explanation,
        statements: finding.statements,
        note: '',
      }));
    if (items.length === 0) return;
    try {
      await save.mutateAsync({ caseId: found.id, items });
    } catch {
      return; // the reason shows below
    }
    setProposal(null);
    onSaved(`Se ${items.length === 1 ? 'guardó' : 'guardaron'} ${plural(items.length, 'contradicción', 'contradicciones')}.`);
  };

  const selectedCount = checked.filter(Boolean).length;

  return (
    <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="compare-title">
      <h2 id="compare-title" className="text-lg">
        Comparar documentos
      </h2>

      {!llmConfigured && (
        <Alert tone="warning">
          Para buscar contradicciones con IA hace falta configurar la API key de Gemini (ver el README, sección «Configurar Gemini»).
        </Alert>
      )}

      {ready.length < 2 ? (
        <p className="text-sm text-muted">
          Hacen falta al menos dos documentos del expediente para compararlos.{' '}
          <Link to={`/expedientes/${found.id}/documentos`} className="font-medium text-brass-700 underline">
            Ir a Documentos
          </Link>
          {processing > 0 && ` (${plural(processing, 'se está procesando', 'se están procesando')})`}
        </p>
      ) : (
        <>
          <fieldset className="space-y-2">
            <legend className="label">Documentos a comparar</legend>
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">
              {documents.map((document) => {
                const isReady = document.status === 'READY';
                const isChosen = chosen.includes(document.id);
                const full = !isChosen && chosen.length >= MAX_DOCUMENTS;
                return (
                  <li key={document.id}>
                    <label
                      className={`flex min-h-12 items-start gap-3 px-3 py-2.5 ${isReady && !full ? 'cursor-pointer hover:bg-paper/60' : 'opacity-60'}`}
                      title={full ? `Se pueden comparar hasta ${MAX_DOCUMENTS} documentos a la vez` : undefined}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 size-5 shrink-0 accent-navy-900"
                        checked={isChosen}
                        disabled={!isReady || full}
                        onChange={() => toggle(document.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium break-words">{document.title}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-2">
                          <CategoryBadge category={document.category} />
                          {!isReady && <StatusBadge status={document.status} />}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>

          <div>
            <label htmlFor="compare-focus" className="label">
              Qué revisar primero (opcional)
            </label>
            <input
              id="compare-focus"
              className="input"
              maxLength={500}
              placeholder="Por ejemplo: las fechas de la relación laboral"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary min-h-11 sm:min-h-0" onClick={compare} disabled={!canCompare}>
              {analyze.isPending ? <Spinner /> : <GitCompareArrows className="size-4" aria-hidden />}
              Buscar contradicciones
            </button>
            {analyze.isPending && (
              <span className="text-sm text-muted" aria-live="polite">
                Comparando {plural(chosen.length, 'documento', 'documentos')}… puede tardar hasta un minuto.
              </span>
            )}
          </div>
          {analyze.isError && <Alert tone="error">{analyze.error.message}</Alert>}
        </>
      )}

      {proposal && (
        <div className="space-y-4 border-t border-line pt-4">
          <Summary proposal={proposal} />

          {proposal.findings.length > 0 && (
            <ul className="space-y-3">
              {proposal.findings.map((finding, index) => (
                <ProposalCard
                  key={`${finding.title}-${index}`}
                  finding={finding}
                  checked={checked[index] ?? false}
                  onToggle={(value) => setChecked((current) => current.map((was, i) => (i === index ? value : was)))}
                />
              ))}
            </ul>
          )}

          {save.isError && <Alert tone="error">No se pudieron guardar las contradicciones: {save.error.message}</Alert>}

          <div className="flex flex-wrap items-center gap-2">
            {proposal.findings.length > 0 && (
              <button type="button" className="btn-primary min-h-11 sm:min-h-0" onClick={() => void confirm()} disabled={save.isPending || selectedCount === 0}>
                {save.isPending && <Spinner />}
                {save.isPending ? 'Guardando…' : selectedCount === 0 ? 'Guardar' : `Guardar ${plural(selectedCount, 'contradicción', 'contradicciones')}`}
              </button>
            )}
            <button type="button" className="btn-secondary min-h-11 sm:min-h-0" onClick={() => setProposal(null)} disabled={save.isPending}>
              {proposal.findings.length > 0 ? 'Descartar' : 'Cerrar'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Summary({ proposal }: { proposal: ContradictionProposal }) {
  const total = proposal.findings.length;
  const repeated = proposal.findings.filter((finding) => finding.duplicate).length;
  const unverified = proposal.findings.filter((finding) => !finding.verified).length;
  const cut = proposal.documents.filter((document) => document.truncated);

  const notes: string[] = [];
  if (repeated > 0) notes.push(`${plural(repeated, 'ya está guardada', 'ya están guardadas')} (sin tildar).`);
  if (unverified > 0) notes.push(`${plural(unverified, 'no se pudo verificar', 'no se pudieron verificar')} en los documentos (sin tildar): revisalas a mano.`);
  if (cut.length > 0) {
    notes.push(`Eran muy largos y se leyó solo el principio y el final de: ${cut.map((document) => `«${document.title}»`).join(', ')}.`);
  }

  return (
    <Alert tone={total > 0 ? 'info' : 'success'}>
      <p className="font-medium">
        {total > 0
          ? `Se ${total === 1 ? 'encontró' : 'encontraron'} ${plural(total, 'posible contradicción', 'posibles contradicciones')}. Verificalas contra los originales antes de guardarlas.`
          : 'No se encontraron contradicciones entre los documentos elegidos.'}
      </p>
      {notes.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

function ProposalCard({ finding, checked, onToggle }: { finding: FindingProposal; checked: boolean; onToggle: (value: boolean) => void }) {
  return (
    <li className={`rounded-xl border p-3 sm:p-4 ${checked ? 'border-brass-500/60 bg-white' : 'border-line bg-white'}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-5 shrink-0 accent-navy-900"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={`Guardar «${finding.title}»`}
        />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <KindBadge kind={finding.kind} />
              <ConfidenceBadge confidence={finding.confidence} />
              {finding.duplicate && <NoteBadge tone="info">Ya está guardada</NoteBadge>}
              {!finding.verified && <NoteBadge tone="warning">No se pudo verificar</NoteBadge>}
            </div>
            <p className="mt-2 font-medium break-words">{finding.title}</p>
            {finding.explanation && <p className="mt-1 text-sm break-words text-muted">{finding.explanation}</p>}
          </div>
          <StatementList statements={finding.statements} />
        </div>
      </div>
    </li>
  );
}
