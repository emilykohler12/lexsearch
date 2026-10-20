import { LogIn, Scale } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { useAuth, useLogin } from '../api/hooks';
import { Spinner } from '../components/ui';

/** Shown instead of the app while the lawyer has no open session. */
export function LoginPage() {
  const ids = { username: useId(), password: useId(), code: useId() };
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const login = useLogin();
  const { data: auth } = useAuth();
  const totpRequired = auth?.totpRequired ?? false;
  const canSubmit = username.trim() !== '' && password !== '' && (!totpRequired || /^d{6}$/.test(code)) && !login.isPending;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (canSubmit) login.mutate({ username: username.trim(), password, ...(totpRequired && { code }) });
  };

  return (
    <main className="grid min-h-screen place-items-center bg-paper px-4 py-8">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4 p-5 sm:p-6" aria-labelledby="login-title">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-navy-900 text-brass-500">
            <Scale className="size-5" aria-hidden />
          </span>
          <div>
            <h1 id="login-title" className="font-serif text-xl leading-none">
              LexSearch
            </h1>
            <p className="mt-1 text-xs text-muted">Ingresá para continuar</p>
          </div>
        </div>

        <div>
          <label htmlFor={ids.username} className="label">
            Usuario
          </label>
          <input
            id={ids.username}
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            maxLength={100}
          />
        </div>
        <div>
          <label htmlFor={ids.password} className="label">
            Contraseña
          </label>
          <input
            id={ids.password}
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            maxLength={200}
          />
        </div>

        {totpRequired && (
          <div>
            <label htmlFor={ids.code} className="label">
              Código de la app de autenticación
            </label>
            <input
              id={ids.code}
              className="input tracking-widest"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6 dígitos"
              maxLength={6}
            />
          </div>
        )}

        {login.isError && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {login.error.message}
          </p>
        )}

        <button type="submit" className="btn-primary min-h-11 w-full justify-center sm:min-h-0" disabled={!canSubmit}>
          {login.isPending ? <Spinner /> : <LogIn className="size-4" aria-hidden />}
          Ingresar
        </button>
      </form>
    </main>
  );
}
