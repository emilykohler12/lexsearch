import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { ChecklistItem } from '../../api/types';
import { newId } from './client-form';

/** The documents the client still has to bring: tick the ones already in hand. */
export function ChecklistEditor({
  items,
  suggestedIds,
  onChange,
}: {
  items: ChecklistItem[];
  /** Items the AI added: highlighted until edited. */
  suggestedIds: ReadonlySet<string>;
  onChange: (items: ChecklistItem[], editedId?: string) => void;
}) {
  const [draft, setDraft] = useState('');

  const update = (id: string, changes: Partial<ChecklistItem>) =>
    onChange(
      items.map((item) => (item.id === id ? { ...item, ...changes } : item)),
      id,
    );
  const remove = (id: string) =>
    onChange(
      items.filter((item) => item.id !== id),
      id,
    );
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onChange([...items, { id: newId(), text, done: false }]);
    setDraft('');
  };

  return (
    <div>
      {items.length > 0 && (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-1 py-1.5 sm:gap-2">
              <label className="grid size-11 shrink-0 cursor-pointer place-items-center sm:size-9">
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={(e) => update(item.id, { done: e.target.checked })}
                  className="size-5 cursor-pointer accent-navy-900"
                />
                <span className="sr-only">Ya tengo «{item.text}»</span>
              </label>
              {/* A box that grows with its text: a long document name is read in full, not cut off. */}
              <textarea
                aria-label="Documento"
                rows={1}
                value={item.text}
                maxLength={300}
                onChange={(e) => update(item.id, { text: e.target.value.replace(/\s*\n\s*/g, ' ') })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
                // A document emptied out is a document removed.
                onBlur={() => {
                  if (!item.text.trim()) remove(item.id);
                }}
                data-suggested={suggestedIds.has(item.id)}
                className={`input field-sizing-content min-h-0 min-w-0 flex-1 resize-none ${item.done ? 'text-muted line-through' : ''}`}
              />
              <button type="button" className="btn-icon shrink-0 hover:text-red-700" onClick={() => remove(item.id)} title="Quitar">
                <X className="size-4" aria-hidden />
                <span className="sr-only">Quitar «{item.text}»</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={`flex gap-2 ${items.length > 0 ? 'mt-3' : ''}`}>
        <input
          aria-label="Agregar un documento"
          value={draft}
          maxLength={300}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault(); // Enter adds the document, it doesn't save the form
              add();
            }
          }}
          placeholder="Agregar un documento…"
          className="input min-w-0 flex-1"
        />
        <button type="button" className="btn-secondary shrink-0" onClick={add} disabled={!draft.trim()}>
          <Plus className="size-4" aria-hidden />
          <span className="max-sm:sr-only">Agregar</span>
        </button>
      </div>
    </div>
  );
}
