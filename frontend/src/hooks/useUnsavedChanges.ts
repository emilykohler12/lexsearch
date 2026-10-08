import { useEffect, type RefObject } from 'react';
import { useBlocker } from 'react-router';

/**
 * Warns before leaving a form with unsaved changes. Going to another section is blocked
 * (the page shows an UnsavedChangesDialog); closing or reloading the tab gets the browser's
 * own warning, which a page can't customize.
 *
 * `leaving` is set by the page when it leaves on purpose (after deleting, or after creating).
 */
export function useUnsavedChanges({
  dirty,
  saving,
  save,
  leaving,
}: {
  dirty: boolean;
  saving: boolean;
  /** Saves the pending changes; false when it could not (the page shows why). */
  save: () => Promise<boolean>;
  leaving: RefObject<boolean>;
}) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!dirty && !saving) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saving]);

  /** "Guardar y salir": leaves only if the save worked. */
  const saveAndLeave = async () => {
    const saved = await save();
    if (blocker.state !== 'blocked') return;
    if (saved) blocker.proceed();
    else blocker.reset(); // stay: the page shows the error
  };

  return { blocker, saveAndLeave };
}
