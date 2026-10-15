import { X } from 'lucide-react';
import { useId } from 'react';
import type { ClientSummary } from '../../api/types';

/** The most clients an expediente can have (the server enforces it too). */
export const MAX_CLIENTS = 10;

/** Chooses the clients of an expediente: the chosen ones as removable chips, and a list to add more. */
export function ClientPicker({
  clients,
  selectedIds,
  onChange,
  className,
}: {
  clients: ClientSummary[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  className?: string;
}) {
  const id = useId();
  const byId = new Map(clients.map((client) => [client.id, client]));
  // A client that was deleted can't be chosen anymore.
  const selected = selectedIds.flatMap((clientId) => byId.get(clientId) ?? []);
  const available = clients.filter((client) => !selectedIds.includes(client.id));

  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        Clientes
      </label>
      {selected.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {selected.map((client) => (
            <li
              key={client.id}
              className="inline-flex min-h-9 items-center gap-1 rounded-full bg-navy-900/5 py-1 pr-1 pl-3 text-sm ring-1 ring-navy-900/10"
            >
              <span className="break-words">{client.fullName}</span>
              <button
                type="button"
                className="grid size-7 place-items-center rounded-full text-muted hover:bg-black/10 hover:text-ink"
                onClick={() => onChange(selectedIds.filter((clientId) => clientId !== client.id))}
                title={`Quitar a ${client.fullName}`}
              >
                <X className="size-3.5" aria-hidden />
                <span className="sr-only">Quitar a {client.fullName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <select
        id={id}
        className="input sm:max-w-md"
        value=""
        disabled={available.length === 0 || selectedIds.length >= MAX_CLIENTS}
        onChange={(event) => {
          if (event.target.value) onChange([...selectedIds, event.target.value]);
        }}
      >
        <option value="">{clients.length === 0 ? 'Todavía no hay clientes cargados' : 'Agregar un cliente…'}</option>
        {available.map((client) => (
          <option key={client.id} value={client.id}>
            {client.fullName}
          </option>
        ))}
      </select>
    </div>
  );
}
