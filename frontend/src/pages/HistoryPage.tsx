import { ChevronRight, History } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { useInteraction, useInteractions } from '../api/hooks';
import { Alert, PageHeader, Spinner } from '../components/ui';
import { AnswerView } from '../features/consult/AnswerView';
import { formatDate, formatSeconds } from '../lib/format';

export function HistoryPage() {
  const { id } = useParams();
  return id ? <InteractionDetailView id={id} /> : <InteractionList />;
}

function InteractionList() {
  const { data: interactions, isPending, isError, error } = useInteractions();

  return (
    <>
      <PageHeader title="Historial" description="Tus consultas anteriores con sus respuestas y fuentes, tal como se generaron." />
      {isPending && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Cargando…
        </p>
      )}
      {isError && <Alert tone="error">{error.message}</Alert>}
      {interactions?.length === 0 && (
        <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
          <History className="size-8 text-brass-500" aria-hidden />
          <p className="font-serif text-lg">Todavía no hiciste consultas</p>
          <Link to="/" className="text-sm font-medium text-brass-700 underline">
            Hacer la primera
          </Link>
        </div>
      )}
      {interactions && interactions.length > 0 && (
        <ul className="card divide-y divide-line">
          {interactions.map((interaction) => (
            <li key={interaction.id}>
              <Link to={`/historial/${interaction.id}`} className="flex items-center gap-4 px-4 py-4 hover:bg-paper/70 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 font-medium break-words sm:line-clamp-1">
                    {interaction.question ?? '(sin pregunta)'}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {formatDate(interaction.createdAt)}
                    {interaction.durationMs !== null && ` · ${formatSeconds(interaction.durationMs)}`}
                    {interaction.status === 'FAILED' && <span className="text-red-700"> · falló</span>}
                  </p>
                </div>
                <ChevronRight className="size-4 text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function InteractionDetailView({ id }: { id: string }) {
  const { data: interaction, isPending, isError, error } = useInteraction(id);

  return (
    <>
      <Link to="/historial" className="inline-flex min-h-10 items-center text-sm text-muted hover:text-ink">
        ← Volver al historial
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
      {interaction && (
        <div className="mt-4 space-y-6">
          <header>
            <p className="text-xs text-muted">{formatDate(interaction.createdAt)}</p>
            <h1 className="mt-1 text-xl break-words sm:text-2xl">{interaction.input.question}</h1>
          </header>
          {interaction.status === 'FAILED' && (
            <Alert tone="error">Esta consulta falló: {interaction.errorMessage}</Alert>
          )}
          {interaction.output && (
            <AnswerView
              blocks={interaction.output.blocks}
              sources={interaction.output.sources}
              footer={[
                interaction.model && `Modelo: ${interaction.model}`,
                interaction.promptVersion && `prompt ${interaction.promptVersion}`,
                interaction.durationMs !== null && formatSeconds(interaction.durationMs),
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          )}
        </div>
      )}
    </>
  );
}
