import { FileUp, Sparkles, X } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useAddProceedings, useAnalyzeProceedings, useHealth, useUpdateCase } from '../../api/hooks';
import type { Case, CaseInput, ProceedingKind, TimelineProposal } from '../../api/types';
import { SelectField, TextAreaField, TextField } from '../../components/fields';
import { Alert, Spinner } from '../../components/ui';
import { formatDay, plural, PROCEEDING_KIND_LABELS, PROCEEDING_KINDS } from '../../lib/format';

// Photos and scans are read with OCR.
const ACCEPT = '.pdf,.docx,.txt,.md,.jpg,.jpeg,.png,.webp,.tif,.tiff';

interface Row {
  key: number;
  include: boolean;
  date: string;
  kind: ProceedingKind;
  title: string;
  description: string;
  quote: string;
  quoteVerified: boolean;
  duplicate: boolean;
}

let rowCounter = 0;

/** The proposal as editable rows; the ones the expediente already has start unchecked. */
function rowsFrom(proposal: TimelineProposal): Row[] {
  return proposal.proceedings.map((item) => ({
    key: ++rowCounter,
    include: !item.duplicate,
    date: item.date,
    kind: item.kind,
    title: item.title,
    description: item.description,
    quote: item.quote,
    quoteVerified: item.quoteVerified,
    duplicate: item.duplicate,
  }));
}

/** Number and court the text gives for an expediente that doesn't have them yet. */
function missingData(found: Case, proposal: TimelineProposal): Partial<Pick<CaseInput, 'number' | 'court'>> {
  const data: Partial<Pick<CaseInput, 'number' | 'court'>> = {};
  if (found.number === '' && proposal.caseInfo.number) data.number = proposal.caseInfo.number;
  if (found.court === '' && proposal.caseInfo.court) data.court = proposal.caseInfo.court;
  return data;
}

/**
 * Reads a text with the movements of the expediente (pasted, or a file) and proposes its
 * actuaciones. Nothing is saved until the lawyer reviews them and confirms.
 */
export function ProceedingImporter({
  found,
  onClose,
  onDone,
}: {
  found: Case;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [text, setText] = useState('');
  const [proposal, setProposal] = useState<TimelineProposal | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [completeCase, setCompleteCase] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const analyze = useAnalyzeProceedings();
  const add = useAddProceedings();
  const updateCase = useUpdateCase();
  const { data: health } = useHealth();
  const llmConfigured = health?.llm.configured ?? true;

  const reading = analyze.isPending;
  const saving = add.isPending || updateCase.isPending;
  const extra = proposal ? missingData(found, proposal) : {};
  const chosen = rows.filter((row) => row.include);

  const read = (source: { text: string } | { file: File }) => {
    setProblem(null);
    setProposal(null);
    analyze.mutate(
      { caseId: found.id, source },
      {
        onSuccess: (result) => {
          setProposal(result);
          setRows(rowsFrom(result));
          setCompleteCase(true);
        },
      },
    );
  };

  const chooseFile = (files: FileList | null) => {
    const file = files?.[0];
    if (file) read({ file });
    if (fileInput.current) fileInput.current.value = '';
  };

  const setRow = (key: number, changes: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...changes } : row)));

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || chosen.length === 0) return;
    if (chosen.some((row) => row.title.trim() === '')) {
      setProblem('A alguna actuación le falta el título.');
      return;
    }
    setProblem(null);
    try {
      await add.mutateAsync({
        caseId: found.id,
        items: chosen.map((row) => ({
          date: row.date,
          kind: row.kind,
          title: row.title.trim(),
          description: row.description.trim(),
          documentId: null,
          sourceQuote: row.quote,
          source: 'AI' as const,
        })),
      });
    } catch {
      return; // the reason shows below
    }
    // The actuaciones are already saved: not being able to fill in the number or the court must not undo them.
    if (completeCase && Object.keys(extra).length > 0) {
      await updateCase.mutateAsync({ id: found.id, ...extra }).catch(() => undefined);
    }
    onDone(`Se ${chosen.length === 1 ? 'agregó' : 'agregaron'} ${plural(chosen.length, 'actuación', 'actuaciones')} a la línea de tiempo.`);
  };

  return (
    <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="importer-title">
      <div className="flex items-start justify-between gap-3">
        <h2 id="importer-title" className="text-lg">
          Importar actuaciones con IA
        </h2>
        <button type="button" className="btn-icon -mt-1 -mr-1" onClick={onClose} disabled={saving} title="Cerrar">
          <X className="size-4" aria-hidden />
          <span className="sr-only">Cerrar</span>
        </button>
      </div>

      {!llmConfigured && (
        <Alert tone="warning">
          Para leer actuaciones con IA hace falta configurar la API key de Gemini (ver el README, sección «Configurar Gemini»). Mientras tanto
          podés cargarlas a mano.
        </Alert>
      )}

      <div className="space-y-3">
        <textarea
          aria-labelledby="importer-title"
          className="input field-sizing-content max-h-96 min-h-32 resize-y leading-relaxed"
          placeholder="Pegá acá el listado de movimientos del expediente…"
          value={text}
          maxLength={400_000}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-primary min-h-11 sm:min-h-0"
            onClick={() => read({ text: text.trim() })}
            disabled={text.trim().length < 20 || reading || !llmConfigured}
          >
            {reading ? <Spinner /> : <Sparkles className="size-4" aria-hidden />}
            Leer con IA
          </button>
          <button
            type="button"
            className="btn-secondary min-h-11 sm:min-h-0"
            onClick={() => fileInput.current?.click()}
            disabled={reading || !llmConfigured}
          >
            <FileUp className="size-4" aria-hidden />
            Subir un archivo
          </button>
          <input ref={fileInput} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} onChange={(e) => chooseFile(e.target.files)} />
          {reading && (
            <span className="text-sm text-muted" aria-live="polite">
              Leyendo…
            </span>
          )}
        </div>
        {analyze.isError && <Alert tone="error">{analyze.error.message}</Alert>}
      </div>

      {proposal && (
        <form onSubmit={(event) => void confirm(event)} className="space-y-4 border-t border-line pt-4">
          <Summary proposal={proposal} rows={rows} />

          {Object.keys(extra).length > 0 && (
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-5 shrink-0 accent-navy-900"
                checked={completeCase}
                onChange={(e) => setCompleteCase(e.target.checked)}
              />
              <span>
                Completar el expediente con{' '}
                <strong className="font-medium">{[extra.number && `el número ${extra.number}`, extra.court && extra.court].filter(Boolean).join(' y ')}</strong>
              </span>
            </label>
          )}

          {rows.length > 0 && (
            <ul className="space-y-3">
              {rows.map((row) => (
                <ProposalRow key={row.key} row={row} onChange={(changes) => setRow(row.key, changes)} />
              ))}
            </ul>
          )}

          {problem && <Alert tone="error">{problem}</Alert>}
          {add.isError && <Alert tone="error">No se pudieron agregar las actuaciones: {add.error.message}</Alert>}

          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn-primary min-h-11 sm:min-h-0" disabled={saving || chosen.length === 0}>
              {saving && <Spinner />}
              {saving ? 'Agregando…' : chosen.length === 0 ? 'Agregar' : `Agregar ${plural(chosen.length, 'actuación', 'actuaciones')}`}
            </button>
            <button
              type="button"
              className="btn-secondary min-h-11 sm:min-h-0"
              onClick={() => {
                setProposal(null);
                setRows([]);
              }}
              disabled={saving}
            >
              Descartar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function Summary({ proposal, rows }: { proposal: TimelineProposal; rows: Row[] }) {
  const found = proposal.proceedings.length;
  const repeated = rows.filter((row) => row.duplicate).length;
  const notes: string[] = [];
  if (repeated > 0) notes.push(`${plural(repeated, 'ya está', 'ya están')} en el expediente (sin tildar).`);
  if (proposal.withoutDate > 0) notes.push(`${plural(proposal.withoutDate, 'movimiento figura', 'movimientos figuran')} sin fecha y no se incluyó.`);
  if (proposal.textTruncated) notes.push('El texto era muy largo: se leyó el principio y el final.');

  return (
    <Alert tone={found > 0 ? 'info' : 'warning'}>
      <p className="font-medium">
        {found > 0
          ? `Se ${found === 1 ? 'encontró' : 'encontraron'} ${plural(found, 'actuación', 'actuaciones')}. Revisalas antes de agregarlas.`
          : 'No se encontraron actuaciones con fecha en el texto.'}
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

function ProposalRow({ row, onChange }: { row: Row; onChange: (changes: Partial<Row>) => void }) {
  return (
    <li className={`rounded-lg border p-3 sm:p-4 ${row.include ? 'border-line bg-white' : 'border-line/70 bg-paper/60'}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-8 size-5 shrink-0 accent-navy-900"
          checked={row.include}
          onChange={(e) => onChange({ include: e.target.checked })}
          aria-label={`Agregar «${row.title}»`}
        />
        <div className={`grid min-w-0 flex-1 gap-3 sm:grid-cols-[10.5rem_11rem_minmax(0,1fr)] ${row.include ? '' : 'opacity-60'}`}>
          <TextField label="Fecha" type="date" required={row.include} value={row.date} onChange={(e) => onChange({ date: e.target.value })} />
          <SelectField label="Tipo" value={row.kind} onChange={(e) => onChange({ kind: e.target.value as ProceedingKind })}>
            {PROCEEDING_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {PROCEEDING_KIND_LABELS[kind]}
              </option>
            ))}
          </SelectField>
          <TextField label="Título" required={row.include} maxLength={200} value={row.title} onChange={(e) => onChange({ title: e.target.value })} />
          <TextAreaField
            label="Descripción"
            className="sm:col-span-3"
            rows={2}
            maxLength={600}
            value={row.description}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-8 text-xs sm:pl-8">
        <span className="text-muted">{formatDay(row.date)}</span>
        {row.duplicate && (
          <span className="inline-flex rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-800 ring-1 ring-sky-200">Ya está en el expediente</span>
        )}
        {!row.quoteVerified && (
          <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800 ring-1 ring-amber-200">
            No se pudo verificar en el texto: revisala
          </span>
        )}
        {row.quote && (
          <details className="w-full">
            <summary className="cursor-pointer text-muted hover:text-ink">Frase del texto</summary>
            <blockquote className="mt-1 border-l-2 border-brass-500 pl-2 break-words text-muted">{row.quote}</blockquote>
          </details>
        )}
      </div>
    </li>
  );
}
