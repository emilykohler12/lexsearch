import { useEffect, useEffectEvent } from 'react';

/** Ctrl + S (⌘ + S on a Mac) saves instead of opening the browser's "Save page" dialog. */
export function useSaveShortcut(onSave: () => void) {
  const handle = useEffectEvent((event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      onSave();
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handle(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
}
