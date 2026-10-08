import type { Blocker } from 'react-router';
import { Dialog, Spinner } from './ui';

/** The question shown when the lawyer tries to leave a form with unsaved changes. */
export function UnsavedChangesDialog({
  blocker,
  saving,
  onSaveAndLeave,
}: {
  blocker: Blocker;
  saving: boolean;
  onSaveAndLeave: () => void;
}) {
  return (
    <Dialog
      open={blocker.state === 'blocked'}
      title="Tenés cambios sin guardar"
      onClose={() => blocker.reset?.()}
      actions={
        <>
          <button type="button" className="btn-secondary min-h-11 sm:min-h-0" data-autofocus onClick={() => blocker.reset?.()}>
            Seguir editando
          </button>
          <button type="button" className="btn-secondary min-h-11 sm:min-h-0" onClick={() => blocker.proceed?.()}>
            Salir sin guardar
          </button>
          <button type="button" className="btn-primary min-h-11 sm:min-h-0" onClick={onSaveAndLeave} disabled={saving}>
            {saving && <Spinner />}
            Guardar y salir
          </button>
        </>
      }
    />
  );
}
