import { useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { queryKeys, useDeleteHearing, useFinishHearing, useHearing, useReplyHearing, useSendHearingTurn } from '../api/hooks';
import type { Hearing } from '../api/types';
import { Alert, Dialog, Spinner } from '../components/ui';
import { FeedbackView } from '../features/hearings/FeedbackView';
import { ROLE_LABELS, ROLE_SHORT_LABELS } from '../features/hearings/hearing-labels';
import { PendingTurn, TurnCard } from '../features/hearings/TurnCard';

const MAX_ANSWER_CHARS = 4_000;

export function HearingPage() {
  const { id = '' } = useParams();
  const { data: hearing, isPending, isError, error } = useHearing(id);

  return (
    <>
      <Link to="/audiencia" className="inline-flex min-h-10 items-center text-sm text-muted hover:text-ink">
        ← Volver a Audiencia
      </Link>
      {isPending && (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted">
          <Spinner /> Cargando…
        </p>
      )}
      {isError && (
        <div className="mt-6">
          <Alert tone="error">{error.message}</Alert>
        </div>
      )}
      {hearing && <Conversation hearing={hearing} />}
    </>
  );
}

function Conversation({ hearing }: { hearing: Hearing }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const send = useSendHearingTurn(hearing.id);
  const reply = useReplyHearing(hearing.id);
  const finish = useFinishHearing(hearing.id);
  const remove = useDeleteHearing();
  const [draft, setDraft] = useState('');
  // What the lawyer just sent, shown while the character answers.
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const seen = useRef(hearing.turns.length);

  const active = hearing.status === 'ACTIVE';
  const lastTurn = hearing.turns.at(-1);
  const answers = hearing.turns.filter((turn) => turn.speaker === 'USER').length;
  const waiting = send.isPending || reply.isPending;
  // Her last answer is saved but the character didn't reply (the model failed): she can ask again.
  const unanswered = active && !waiting && lastTurn?.speaker === 'USER';
  const closedByCharacter = active && lastTurn?.kind === 'CIERRE';
  const outOfAnswers = active && hearing.answersLeft === 0;
  const failure = send.error ?? reply.error ?? finish.error ?? null;
  const role = hearing.role;

  // The conversation scrolls to the newest turn as it grows (not when it opens).
  useEffect(() => {
    if (hearing.turns.length !== seen.current || pendingText !== null) {
      seen.current = hearing.turns.length;
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [hearing.turns.length, pendingText]);

  const submit = () => {
    const content = draft.trim();
    if (!content || waiting || !active || unanswered || outOfAnswers) return;
    reply.reset();
    finish.reset();
    setPendingText(content);
    setDraft('');
    send.mutate(content, {
      onSettled: () => setPendingText(null),
      onError: () => {
        // The answer is saved before the model is asked: if it isn't there, the text goes back to the box.
        const saved = queryClient.getQueryData<Hearing>(queryKeys.hearing(hearing.id))?.turns.at(-1);
        if (!(saved?.speaker === 'USER' && saved.content === content)) setDraft((current) => current || content);
      },
    });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  };

  const retry = () => {
    send.reset();
    finish.reset();
    reply.mutate();
  };

  const finishPractice = () => {
    send.reset();
    reply.reset();
    finish.mutate();
  };

  const deletePractice = () => remove.mutate(hearing.id, { onSuccess: () => navigate('/audiencia') });

  return (
    <div className="mt-4 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl break-words sm:text-2xl">{hearing.title}</h1>
          <p className="mt-1 text-xs break-words text-muted">
            La IA hace de {ROLE_LABELS[role].toLowerCase()}
            {hearing.case && (
              <>
                {' · '}
                <Link to={`/expedientes/${hearing.case.id}`} className="underline">
                  {hearing.case.title}
                </Link>
              </>
            )}
            {' · '}
            <span className={active ? 'text-amber-700' : 'text-emerald-700'}>{active ? 'En curso' : 'Terminada'}</span>
          </p>
        </div>
        <button type="button" className="btn-secondary min-h-11 sm:min-h-0" onClick={() => setConfirmingDelete(true)}>
          Eliminar
        </button>
      </header>

      {!active && hearing.feedback && <FeedbackView feedback={hearing.feedback} />}
      {!active && !hearing.feedback && <Alert tone="info">Esta práctica terminó sin devolución.</Alert>}

      <section aria-label="Conversación" className="space-y-3">
        {!active && <h2 className="text-lg">Conversación</h2>}
        <ol className="space-y-3">
          {hearing.turns.map((turn) => (
            <TurnCard key={turn.id} turn={turn} role={role} />
          ))}
          {pendingText !== null && <PendingTurn content={pendingText} />}
        </ol>
        {(waiting || finish.isPending) && (
          <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
            <Spinner />
            {finish.isPending ? 'Preparando la devolución…' : `${ROLE_SHORT_LABELS[role]} está respondiendo…`}
          </p>
        )}
        <div ref={endRef} />
      </section>

      {failure && <Alert tone="error">{failure.message}</Alert>}

      {unanswered && (
        <Alert tone="warning">
          <p>Tu última respuesta todavía no tiene contestación.</p>
          <button type="button" className="btn-secondary mt-3 min-h-11 sm:min-h-0" onClick={retry}>
            Reintentar
          </button>
        </Alert>
      )}

      {outOfAnswers && <Alert tone="info">Llegaste al máximo de respuestas de esta práctica. Terminala para ver la devolución.</Alert>}

      {active && (
        <form onSubmit={onSubmit} className="card space-y-3 p-3 sm:p-4">
          {!unanswered && !outOfAnswers && (
            <>
              <label htmlFor="hearing-answer" className="sr-only">
                Tu respuesta
              </label>
              <textarea
                id="hearing-answer"
                className="input min-h-28 resize-y leading-relaxed"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                maxLength={MAX_ANSWER_CHARS}
                disabled={waiting || finish.isPending}
                placeholder="Respondé como lo harías en la audiencia…"
              />
            </>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {!unanswered && !outOfAnswers && (
              <button type="submit" className="btn-primary min-h-11 sm:min-h-0" disabled={!draft.trim() || waiting || finish.isPending}>
                <Send className="size-4" aria-hidden />
                Enviar
              </button>
            )}
            <button
              type="button"
              className={`min-h-11 sm:min-h-0 ${closedByCharacter || outOfAnswers ? 'btn-primary' : 'btn-secondary'}`}
              onClick={finishPractice}
              disabled={answers === 0 || waiting || finish.isPending}
            >
              {finish.isPending && <Spinner />}
              Terminar y ver la devolución
            </button>
          </div>
        </form>
      )}

      <Dialog
        open={confirmingDelete}
        title="¿Eliminar esta práctica?"
        onClose={() => setConfirmingDelete(false)}
        actions={
          <>
            <button type="button" className="btn-secondary min-h-11 sm:min-h-0" data-autofocus onClick={() => setConfirmingDelete(false)}>
              Cancelar
            </button>
            <button type="button" className="btn-danger min-h-11 sm:min-h-0" onClick={deletePractice} disabled={remove.isPending}>
              {remove.isPending && <Spinner />}
              Eliminar
            </button>
          </>
        }
      >
        Se elimina la conversación y su devolución.
      </Dialog>
    </div>
  );
}
