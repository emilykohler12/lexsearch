import {
  BookOpen,
  CalendarClock,
  FilePenLine,
  FolderKanban,
  History,
  MessageSquareText,
  Scale,
  TriangleAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { useHealth } from '../api/hooks';

const NAV: Array<{ to: string; label: string; icon: LucideIcon; end?: boolean }> = [
  { to: '/', label: 'Consultar', icon: MessageSquareText, end: true },
  { to: '/borradores', label: 'Borradores', icon: FilePenLine },
  { to: '/biblioteca', label: 'Biblioteca', icon: BookOpen },
  { to: '/historial', label: 'Historial', icon: History },
];

// Roadmap modules, shown so the lawyer knows what's coming.
const UPCOMING: Array<{ label: string; icon: LucideIcon; phase: number }> = [
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

      <div className="mt-auto px-3 pb-4">
        <SystemProblems className="rounded-lg px-3 py-2.5" />
      </div>
    </aside>
  );
}

function MobileHeader() {
  return (
    <header className="sticky top-0 z-20 bg-navy-900 text-white/85 shadow-sm md:hidden">
      <div className="px-4 py-3">
        <Brand />
      </div>

      <nav aria-label="Principal" className="grid grid-cols-4 border-t border-white/10">
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

      <SystemProblems className="border-t border-red-400/30 px-4 py-2" />
    </header>
  );
}

/** Problems that stop LexSearch from working; empty while everything is fine. */
function useSystemProblems(): string[] {
  const { data: health, isError } = useHealth();
  if (isError) return ['Sin conexión con el servidor de LexSearch.'];
  if (!health) return [];

  const problems: string[] = [];
  if (health.database !== 'ok') problems.push('Sin conexión con la base de datos. ¿Está abierto Docker Desktop?');
  if (health.embeddings.status === 'error') problems.push('No se pudo cargar el motor de búsqueda.');
  return problems;
}

/** Shown only when something is broken: nothing is displayed while the system works. */
function SystemProblems({ className }: { className: string }) {
  const problems = useSystemProblems();
  if (problems.length === 0) return null;
  return (
    <div role="alert" className={`flex gap-2 bg-red-500/15 text-xs text-red-100 ${className}`}>
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-red-300" aria-hidden />
      <div className="space-y-1">
        {problems.map((problem) => (
          <p key={problem}>{problem}</p>
        ))}
      </div>
    </div>
  );
}
