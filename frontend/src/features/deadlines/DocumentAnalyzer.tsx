import { CloudUpload } from 'lucide-react';
import { useId, useRef, useState, type DragEvent } from 'react';
import { useAnalyzeDeadlineDocument, useHealth } from '../../api/hooks';
import type { DeadlineProposal } from '../../api/types';
import { Alert, Spinner } from '../../components/ui';
import { formatDay, plural } from '../../lib/format';

// Photos and scans are read with OCR.
const ACCEPT = '.pdf,.docx,.doc,.pptx,.svg,.txt,.jpg,.jpeg,.png,.webp,.tif,.tiff';

/**
 * Reads a cédula or resolution and proposes the terms it grants. The file is read and thrown
 * away: nothing is saved until the lawyer confirms the terms in the form.
 */
export function DocumentAnalyzer({ onAnalyzed }: { onAnalyzed: (proposal: DeadlineProposal) => void }) {
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<{ fileName: string; proposal: DeadlineProposal } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const analyze = useAnalyzeDeadlineDocument();
  const { data: health } = useHealth();
  const llmConfigured = health?.llm.configured ?? true;

  const send = (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    setResult(null);
    analyze.mutate(file, {
      onSuccess: (proposal) => {
        setResult({ fileName: file.name, proposal });
        onAnalyzed(proposal);
      },
    });
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (llmConfigured && !analyze.isPending) send(event.dataTransfer.files);
  };

  const disabled = analyze.isPending || !llmConfigured;

  return (
    <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="analyze-title">
      <h2 id="analyze-title" className="text-lg">
        Leer una cédula o resolución
      </h2>

      {!llmConfigured && (
        <Alert tone="warning">
          Para leer documentos con IA hace falta configurar la API key de Gemini (ver el README, sección «Configurar Gemini»). Mientras
          tanto podés cargar el plazo a mano.
        </Alert>
      )}

      {/* The whole zone is the file picker's label: a tap (phone) or click opens it, and it also accepts drops. */}
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors focus-within:border-brass-500 ${
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-brass-500'
        } ${dragging ? 'border-brass-500 bg-brass-50' : 'border-line bg-paper/60'}`}
      >
        {analyze.isPending ? (
          <>
            <Spinner className="size-6 text-brass-600" />
            <span className="text-sm text-muted" aria-live="polite">
              Leyendo el documento…
            </span>
          </>
        ) : (
          <>
            <CloudUpload className="size-7 text-brass-600" aria-hidden />
            <span className="text-sm">
              <span className="hidden sm:inline">Arrastrá el documento acá o </span>
              <span className="font-medium text-brass-700 underline">
                <span className="sm:hidden">Tocá para elegir el documento</span>
                <span className="hidden sm:inline">elegilo desde tu computadora</span>
              </span>
            </span>
            <span className="text-xs text-muted">PDF, foto o escaneo, Word o texto</span>
          </>
        )}
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={disabled}
          onChange={(e) => send(e.target.files)}
        />
      </label>

      {analyze.isError && (
        <Alert tone="error" onClose={() => analyze.reset()}>
          {analyze.error.message}
        </Alert>
      )}

      {result && <AnalysisSummary fileName={result.fileName} proposal={result.proposal} onClose={() => setResult(null)} />}
    </section>
  );
}

function AnalysisSummary({
  fileName,
  proposal,
  onClose,
}: {
  fileName: string;
  proposal: DeadlineProposal;
  onClose: () => void;
}) {
  const found = proposal.terms.length;
  return (
    <Alert tone={found > 0 ? 'info' : 'warning'} onClose={onClose}>
      <p className="font-medium break-words">
        {found > 0
          ? `Se ${found === 1 ? 'encontró' : 'encontraron'} ${plural(found, 'plazo', 'plazos')} en «${fileName}». Revisalos antes de guardar.`
          : `«${fileName}» no otorga ningún plazo.`}
      </p>
      {proposal.summary && <p className="mt-1 break-words">{proposal.summary}</p>}
      <ul className="mt-1 space-y-0.5 text-xs">
        {proposal.documentDate && <li>Fecha del documento: {formatDay(proposal.documentDate)}</li>}
        {found > 0 && !proposal.notificationDate && (
          <li>El documento no indica la fecha de notificación: cargala vos para calcular el vencimiento.</li>
        )}
      </ul>
    </Alert>
  );
}
