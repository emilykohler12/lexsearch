import { NavLink } from 'react-router';

export interface SectionTab {
  to: string;
  label: string;
  /** The tab is active only on exactly this address (the first tab of a section). */
  end?: boolean;
  /** How many there are (shown next to the name when there is at least one). */
  count?: number | undefined;
}

/**
 * The sections of a page (for example «Línea de tiempo», «Documentos» and «Contradicciones» of an expediente),
 * each one with its own address. On a phone they scroll sideways if they don't fit.
 */
export function SectionTabs({ label, tabs }: { label: string; tabs: SectionTab[] }) {
  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-4 shadow-[inset_0_-1px_0_0_var(--color-line)] sm:mx-0 sm:px-0">
      <ul className="flex sm:gap-1">
        {tabs.map(({ to, label: name, end, count }) => (
          <li key={to} className="shrink-0">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                `inline-flex min-h-11 items-center gap-1.5 border-b-2 px-2 text-sm whitespace-nowrap transition-colors sm:px-3 ${
                  isActive ? 'border-brass-500 font-medium text-ink' : 'border-transparent text-muted hover:text-ink'
                }`
              }
            >
              {name}
              {count !== undefined && count > 0 && <span className="text-xs text-muted">{count}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
