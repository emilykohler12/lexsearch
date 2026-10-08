import { ChevronRight, Plus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useClients } from '../api/hooks';
import { Alert, PageHeader, PracticeAreaBadge, Spinner } from '../components/ui';
import { normalizeText, plural } from '../lib/format';

const collator = new Intl.Collator('es');

export function ClientsPage() {
  const { data: clients, isPending, isError, error } = useClients();
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => {
    const needle = normalizeText(filter.trim());
    return (clients ?? [])
      .filter(
        (c) =>
          !needle || normalizeText(`${c.fullName} ${c.documentNumber} ${c.counterpartyName}`).includes(needle),
      )
      .sort((a, b) => collator.compare(a.fullName, b.fullName));
  }, [clients, filter]);

  return (
    <>
      <PageHeader
        title="Clientes"
        actions={
          <Link to="/clientes/nuevo" className="btn-primary min-h-11 sm:min-h-0">
            <Plus className="size-4" aria-hidden />
            Nuevo cliente
          </Link>
        }
      />

      {isPending && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Cargando…
        </p>
      )}
      {isError && <Alert tone="error">{error.message}</Alert>}

      {clients?.length === 0 && (
        <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
          <Users className="size-8 text-brass-500" aria-hidden />
          <p className="font-serif text-lg">Todavía no cargaste clientes</p>
          <Link to="/clientes/nuevo" className="text-sm font-medium text-brass-700 underline">
            Cargar el primero
          </Link>
        </div>
      )}

      {clients && clients.length > 0 && (
        <div className="space-y-4">
          <input
            type="search"
            className="input sm:max-w-md"
            placeholder="Buscar por nombre, documento o contraparte…"
            aria-label="Buscar clientes"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />

          {visible.length === 0 ? (
            <p className="text-sm text-muted">Ningún cliente coincide con la búsqueda.</p>
          ) : (
            <ul className="card divide-y divide-line">
              {visible.map((client) => {
                const details = [client.documentNumber, client.counterpartyName && `contra ${client.counterpartyName}`]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <li key={client.id}>
                    <Link to={`/clientes/${client.id}`} className="flex items-center gap-4 px-4 py-4 hover:bg-paper/70 sm:px-5">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium break-words sm:truncate">{client.fullName}</p>
                        {details && <p className="mt-0.5 text-xs break-words text-muted sm:truncate">{details}</p>}
                        {(client.practiceArea || client.pendingDocuments > 0) && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            {client.practiceArea && <PracticeAreaBadge area={client.practiceArea} />}
                            {client.pendingDocuments > 0 && (
                              <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800 ring-1 ring-amber-200">
                                {plural(client.pendingDocuments, 'documento pendiente', 'documentos pendientes')}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
