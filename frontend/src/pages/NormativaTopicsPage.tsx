import { Check, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useCreateNormativeTopic, useDeleteNormativeTopic, useNormativeTopics, useUpdateNormativeTopic } from '../api/hooks';
import type { NormativeTopic, PracticeArea } from '../api/types';
import { Alert, Dialog, Spinner } from '../components/ui';
import { PRACTICE_AREA_LABELS, PRACTICE_AREAS } from '../lib/format';

/** "Otro" has no profile of its own: it is followed with topics the lawyer writes. */
const FOLLOWABLE_AREAS = PRACTICE_AREAS.filter((area) => area !== 'OTRO');

const MAX_KEYWORDS = 12;

interface TopicDraft {
  /** Set when an existing topic is being edited. */
  id?: string;
  name: string;
  keywords: string;
  description: string;
}

const BLANK: TopicDraft = { name: '', keywords: '', description: '' };

/** What the lawyer follows: whole areas of practice, and topics of her own described with words. */
export function NormativaTopicsPage() {
  const { data: topics, isPending, isError, error } = useNormativeTopics();
  const create = useCreateNormativeTopic();
  const update = useUpdateNormativeTopic();
  const remove = useDeleteNormativeTopic();

  const [editing, setEditing] = useState<TopicDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<NormativeTopic | null>(null);

  const followedAreas = new Map((topics ?? []).filter((topic) => topic.practiceArea).map((topic) => [topic.practiceArea as PracticeArea, topic]));
  const ownTopics = (topics ?? []).filter((topic) => !topic.practiceArea);
  const saving = create.isPending || update.isPending;

  const closeForm = () => {
    setEditing(null);
    setFormError(null);
  };

  const toggleArea = (area: PracticeArea) => {
    const followed = followedAreas.get(area);
    if (followed) setRemoving(followed);
    else create.mutate({ practiceArea: area });
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const name = editing.name.trim();
    const keywords = [...new Set(editing.keywords.split(',').map((word) => word.trim()).filter(Boolean))];
    if (!name) return setFormError('Escribí un nombre para el tema.');
    if (keywords.length === 0) return setFormError('Agregá al menos una palabra clave.');
    if (keywords.length > MAX_KEYWORDS) return setFormError(`Podés usar hasta ${MAX_KEYWORDS} palabras clave.`);

    const description = editing.description.trim();
    const options = { onSuccess: closeForm, onError: (failure: Error) => setFormError(failure.message) };
    if (editing.id) update.mutate({ id: editing.id, name, keywords, description }, options);
    else create.mutate({ name, keywords, description }, options);
  };

  const confirmRemove = () => {
    if (removing) remove.mutate(removing.id, { onSuccess: () => setRemoving(null) });
  };

  if (isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Cargando…
      </p>
    );
  }
  if (isError) return <Alert tone="error">{error.message}</Alert>;

  const problem = !editing && (create.error ?? update.error ?? remove.error);

  return (
    <div className="space-y-8">
      {problem && <Alert tone="error">{problem.message}</Alert>}

      <section className="space-y-3" aria-labelledby="areas-title">
        <h2 id="areas-title" className="text-lg">
          Áreas de práctica
        </h2>
        <ul className="flex flex-wrap gap-2">
          {FOLLOWABLE_AREAS.map((area) => {
            const followed = followedAreas.has(area);
            const starting = create.isPending && create.variables?.practiceArea === area;
            return (
              <li key={area}>
                <button
                  type="button"
                  aria-pressed={followed}
                  disabled={starting}
                  onClick={() => toggleArea(area)}
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors sm:min-h-9 ${
                    followed ? 'border-brass-500 bg-brass-50 font-medium text-brass-700' : 'border-line bg-white text-muted hover:text-ink'
                  }`}
                >
                  {starting ? <Spinner className="size-3.5" /> : followed && <Check className="size-4" aria-hidden />}
                  {PRACTICE_AREA_LABELS[area]}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-3" aria-labelledby="own-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="own-title" className="text-lg">
            Temas propios
          </h2>
          <button type="button" className="btn-secondary min-h-11 sm:min-h-0" onClick={() => setEditing(BLANK)}>
            Agregar tema
          </button>
        </div>

        {ownTopics.length === 0 ? (
          <p className="text-sm text-muted">Todavía no agregaste temas propios.</p>
        ) : (
          <ul className="card divide-y divide-line overflow-hidden">
            {ownTopics.map((topic) => (
              <li key={topic.id} className="flex items-start gap-2 px-3 py-3 sm:px-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium break-words">{topic.name}</p>
                    {!topic.active && (
                      <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                        En pausa
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs break-words text-muted">{topic.keywords.join(', ')}</p>
                  {topic.description && <p className="mt-1 text-sm break-words text-muted">{topic.description}</p>}
                </div>
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    className="btn-icon"
                    title={topic.active ? 'Pausar' : 'Reanudar'}
                    disabled={update.isPending && update.variables?.id === topic.id}
                    onClick={() => update.mutate({ id: topic.id, active: !topic.active })}
                  >
                    {topic.active ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
                    <span className="sr-only">{topic.active ? `Pausar «${topic.name}»` : `Reanudar «${topic.name}»`}</span>
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    title="Editar"
                    onClick={() => setEditing({ id: topic.id, name: topic.name, keywords: topic.keywords.join(', '), description: topic.description })}
                  >
                    <Pencil className="size-4" aria-hidden />
                    <span className="sr-only">Editar «{topic.name}»</span>
                  </button>
                  <button type="button" className="btn-icon hover:text-red-700" title="Eliminar" onClick={() => setRemoving(topic)}>
                    <Trash2 className="size-4" aria-hidden />
                    <span className="sr-only">Eliminar «{topic.name}»</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog
        open={editing !== null}
        title={editing?.id ? 'Editar tema' : 'Agregar tema'}
        onClose={closeForm}
        actions={
          <>
            <button type="button" className="btn-secondary min-h-11 sm:min-h-0" onClick={closeForm}>
              Cancelar
            </button>
            <button type="submit" form="topic-form" className="btn-primary min-h-11 sm:min-h-0" disabled={saving}>
              {saving && <Spinner />}
              Guardar
            </button>
          </>
        }
      >
        {editing && (
          <form id="topic-form" onSubmit={save} className="space-y-3">
            {formError && <Alert tone="error">{formError}</Alert>}
            <div>
              <label htmlFor="topic-name" className="label">
                Nombre
              </label>
              <input
                id="topic-name"
                className="input"
                maxLength={80}
                placeholder="Por ejemplo: Alquileres"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                data-autofocus
              />
            </div>
            <div>
              <label htmlFor="topic-keywords" className="label">
                Palabras clave
              </label>
              <input
                id="topic-keywords"
                className="input"
                placeholder="locación, alquiler, locatario"
                value={editing.keywords}
                onChange={(e) => setEditing({ ...editing, keywords: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="topic-description" className="label">
                Qué incluye (opcional)
              </label>
              <textarea
                id="topic-description"
                className="input min-h-20 resize-y"
                maxLength={300}
                value={editing.description}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              />
            </div>
          </form>
        )}
      </Dialog>

      <Dialog
        open={removing !== null}
        title="¿Dejar de seguir este tema?"
        onClose={() => setRemoving(null)}
        actions={
          <>
            <button type="button" className="btn-secondary min-h-11 sm:min-h-0" data-autofocus onClick={() => setRemoving(null)}>
              Cancelar
            </button>
            <button type="button" className="btn-danger min-h-11 sm:min-h-0" onClick={confirmRemove} disabled={remove.isPending}>
              {remove.isPending && <Spinner />}
              Dejar de seguir
            </button>
          </>
        }
      >
        {removing && <>«{removing.name}» se quita de tus temas, con sus novedades.</>}
      </Dialog>
    </div>
  );
}
