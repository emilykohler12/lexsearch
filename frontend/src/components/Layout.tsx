import {
  BookOpen,
  CalendarClock,
  FilePenLine,
  FolderKanban,
  History,
  MessageSquareText,
  Scale,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useHealth } from '../api/hooks';

const NAV: Array<{ to: string; label: string; icon: LucideIcon; end?: boolean }> = [
  { to: '/', label: 'Consultar', icon: MessageSquareText, end: true },
  { to: '/biblioteca', label: 'Biblioteca', icon: BookOpen },
  { to: '/historial', label: 'Historial', icon: History },
];

// Roadmap modules, shown so the lawyer knows what's coming.
const UPCOMING: Array<{ label: string; icon: LucideIcon; phase: number }> = [
  { label: 'Borradores de escritos', icon: FilePenLine, phase: 2 },
  { label: 'Clientes', icon: Users, phase: 3 },
  { label: 'Plazos', icon: CalendarClock, phase: 4 },
  { label: 'Expedientes', icon: FolderKanban, phase: 5 },
];

export function Layout() {
  return (
    <div className="min-h-screen md:flex">
      <DesktopSidebar />
      <MobileHeader />
      <main className="min-w-0 flex-1">
        <div className="w-full px-4 py-6 sm:px-6 md:py-8 lg:px-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-9 place-items-center rounded-lg bg-brass-500/15 text-brass-500">
        <Scale className="size-5" aria-hidden />
      </span>
      <div>
        <p className="font-serif text-lg leading-none text-white">LexSearch</p>
        <p className="mt-1 text-xs text-white/50">Tu estudio, asistido</p>
      </div>
    </div>
  );
}

function DesktopSidebar() {
  return (
    <aside className="hidden shrink-0 flex-col bg-navy-900 text-white/85 md:sticky md:top-0 md:flex md:h-screen md:w-64">
      <div className="px-5 py-5">
        <Brand />
      </div>

      <nav aria-label="Principal" className="flex flex-col gap-1 px-3 pb-3">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive ? 'bg-white/10 font-medium text-white' : 'hover:bg-white/5 hover:text-white'
              }`
            }
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-3">
        <p className="px-3 pt-4 pb-2 text-[11px] font-semibold tracking-wider text-white/40 uppercase">Próximamente</p>
        {UPCOMING.map(({ label, icon: Icon, phase }) => (
          <div key={label} className="flex items-center gap-3 px-3 py-1.5 text-sm text-white/35" aria-disabled>
            <Icon className="size-4" aria-hidden />
            <span className="flex-1">{label}</span>
            <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px]">Fase {phase}</span>
          </div>
        ))}
      </div>

      <div className="mt-auto border-t border-white/10 px-5 py-4 text-xs">
        <SystemStatusList />
      </div>
    </aside>
  );
}

function MobileHeader() {
  const [statusOpen, setStatusOpen] = useState(false);
  const { overall } = useSystemStatus();

  return (
    <header className="sticky top-0 z-20 bg-navy-900 text-white/85 shadow-sm md:hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <Brand />
        <button
          type="button"
          onClick={() => setStatusOpen((open) => !open)}
          aria-expanded={statusOpen}
          aria-controls="mobile-status"
          className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs text-white/70 hover:bg-white/5"
        >
          <span className={`size-2.5 rounded-full ${DOT[overall]}`} aria-hidden />
          Estado
        </button>
      </div>

      {statusOpen && (
        <div id="mobile-status" className="border-t border-white/10 px-4 py-3 text-xs">
          <SystemStatusList />
        </div>
      )}

      <nav aria-label="Principal" className="grid grid-cols-3 border-t border-white/10">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex min-h-12 flex-col items-center justify-center gap-0.5 border-b-2 text-xs transition-colors ${
                isActive ? 'border-brass-500 font-medium text-white' : 'border-transparent text-white/60'
              }`
            }
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}

type StatusState = 'ok' | 'warn' | 'error';
const DOT: Record<StatusState, string> = { ok: 'bg-emerald-400', warn: 'bg-amber-400', error: 'bg-red-400' };

function useSystemStatus() {
  const { data: health, isError } = useHealth();

  const items: Array<{ label: string; state: StatusState; detail: string }> =
    isError || !health
      ? [{ label: 'Servidor', state: 'error', detail: 'sin conexión' }]
      : [
          {
            label: 'Base de datos',
            state: health.database === 'ok' ? 'ok' : 'error',
            detail: health.database === 'ok' ? 'conectada' : 'sin conexión',
          },
          {
            label: 'Motor de búsqueda',
            state: health.embeddings.status === 'ready' ? 'ok' : health.embeddings.status === 'error' ? 'error' : 'warn',
            detail:
              health.embeddings.status === 'ready'
                ? 'listo'
                : health.embeddings.status === 'error'
                  ? 'error al cargar'
                  : 'cargando…',
          },
          {
            label: 'IA (Gemini)',
            state: health.llm.configured ? 'ok' : 'warn',
            detail: health.llm.configured ? health.llm.model : 'falta API key',
          },
        ];

  const overall: StatusState = items.some((i) => i.state === 'error')
    ? 'error'
    : items.some((i) => i.state === 'warn')
      ? 'warn'
      : 'ok';
  return { items, overall };
}

function SystemStatusList() {
  const { items } = useSystemStatus();
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${DOT[item.state]}`} aria-hidden />
          <span className="text-white/70">{item.label}</span>
          <span className="ml-auto truncate text-white/40">{item.detail}</span>
        </li>
      ))}
    </ul>
  );
}
