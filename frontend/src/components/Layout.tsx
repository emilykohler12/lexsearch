import {
  BookOpen,
  CalendarClock,
  Compass,
  FilePenLine,
  FolderKanban,
  Gavel,
  History,
  LogOut,
  MessageSquareText,
  Newspaper,
  Scale,
  TriangleAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { NETWORK_ERROR_MESSAGE } from '../api/client';
import { useAuth, useHealth, useLogout, useNormativeUnread, useNotifications } from '../api/hooks';

type Badge = 'deadlines' | 'normative';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Which unread count is shown next to the name as a red badge. */
  badge?: Badge;
  /** On phones these go in the top bar as icons, to leave room for the names of the others. */
  secondary?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Consultar', icon: MessageSquareText, end: true },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/expedientes', label: 'Expedientes', icon: FolderKanban },
  { to: '/plazos', label: 'Plazos', icon: CalendarClock, badge: 'deadlines' },
  { to: '/normativa', label: 'Normativa', icon: Newspaper, badge: 'normative', secondary: true },
  { to: '/borradores', label: 'Borradores', icon: FilePenLine },
  { to: '/audiencia', label: 'Audiencia', icon: Gavel, secondary: true },
  { to: '/estimador', label: 'Estimador', icon: Compass, secondary: true },
  { to: '/biblioteca', label: 'Biblioteca', icon: BookOpen, secondary: true },
  { to: '/historial', label: 'Historial', icon: History, secondary: true },
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

/** Closes the session; only where there is a login. */
function LogoutButton({ variant }: { variant: 'sidebar' | 'icon' }) {
  const { data: auth } = useAuth();
  const logout = useLogout();
  if (!auth?.authRequired) return null;
  return variant === 'icon' ? (
    <button type="button" title="Cerrar sesión" aria-label="Cerrar sesión" onClick={() => logout.mutate()} className="grid size-11 place-items-center rounded-lg text-white/60 transition-colors hover:bg-white/5 hover:text-white">
      <LogOut className="size-5" aria-hidden />
    </button>
  ) : (
    <button type="button" onClick={() => logout.mutate()} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white">
      <LogOut className="size-4" aria-hidden />
      Cerrar sesión
    </button>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-9 place-items-center rounded-lg bg-brass-500/15 text-brass-500">
        <Scale className="size-5" aria-hidden />
      </span>
      {/* On a phone the icons of the menu need the room: only the mark is shown. */}
      <div className="hidden min-[480px]:block md:block">
        <p className="font-serif text-lg leading-none text-white">LexSearch</p>
        <p className="mt-1 text-xs text-white/50">Tu estudio, asistido</p>
      </div>
    </div>
  );
}

/** What the lawyer hasn't read yet: deadlines about to expire (or expired) and new norms that touch her topics. */
function useUnreadCounts(): Record<Badge, number> {
  return { deadlines: useNotifications().data?.length ?? 0, normative: useNormativeUnread().data ?? 0 };
}

function WarningsBadge({ count, className = '' }: { count: number; className?: string }) {
  if (count === 0) return null;
  return (
    <span
      className={`grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] leading-none font-semibold text-white ${className}`}
    >
      <span aria-hidden>{count > 9 ? '9+' : count}</span>
      <span className="sr-only">{count === 1 ? '1 aviso sin leer' : `${count} avisos sin leer`}</span>
    </span>
  );
}

function DesktopSidebar() {
  const unread = useUnreadCounts();
  return (
    <aside className="hidden shrink-0 flex-col bg-navy-900 text-white/85 md:sticky md:top-0 md:flex md:h-screen md:w-64">
      <div className="px-5 py-5">
        <Brand />
      </div>

      <nav aria-label="Principal" className="flex flex-col gap-1 px-3 pb-3">
        {NAV.map(({ to, label, icon: Icon, end, badge }) => (
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
            {badge && <WarningsBadge count={unread[badge]} className="ml-auto" />}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto space-y-2 px-3 pb-4">
        <LogoutButton variant="sidebar" />
        <SystemProblems className="rounded-lg px-3 py-2.5" />
      </div>
    </aside>
  );
}

function MobileHeader() {
  const unread = useUnreadCounts();
  return (
    <header className="sticky top-0 z-20 bg-navy-900 text-white/85 shadow-sm md:hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <Brand />
        <nav aria-label="Secundario" className="flex items-center">
          {NAV.filter((item) => item.secondary).map(({ to, label, icon: Icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              title={label}
              aria-label={label}
              className={({ isActive }) =>
                `grid size-11 place-items-center rounded-lg transition-colors ${
                  isActive ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              <span className="relative">
                <Icon className="size-5" aria-hidden />
                {badge && <WarningsBadge count={unread[badge]} className="absolute -top-2 left-3" />}
              </span>
            </NavLink>
          ))}
          <LogoutButton variant="icon" />
        </nav>
      </div>

      <nav aria-label="Principal" className="grid grid-cols-5 border-t border-white/10">
        {NAV.filter((item) => !item.secondary).map(({ to, label, icon: Icon, end, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 border-b-2 px-0.5 text-[11px] transition-colors ${
                isActive ? 'border-brass-500 font-medium text-white' : 'border-transparent text-white/60'
              }`
            }
          >
            <span className="relative">
              <Icon className="size-4" aria-hidden />
              {badge && <WarningsBadge count={unread[badge]} className="absolute -top-2 left-2.5" />}
            </span>
            <span className="max-w-full truncate">{label}</span>
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
  if (isError) return [NETWORK_ERROR_MESSAGE];
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
