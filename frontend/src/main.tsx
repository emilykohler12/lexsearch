import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ApiError } from './api/client';
import './index.css';

// When a request can't reach the server, check the system state right away so the banner of the menu shows
// without waiting for the next poll (the health query itself is left alone: it would call itself).
const onNetworkError = (error: Error, isHealth: boolean) => {
  // The session closed (or the server restarted): the app goes back to the login.
  if (error instanceof ApiError && error.status === 401) queryClient.setQueryData(['auth'], (old: object | undefined) => ({ totpRequired: false, ...old, authRequired: true, authenticated: false, username: null, security: undefined }));
  if (!isHealth && error instanceof ApiError && error.code === 'NETWORK') void queryClient.invalidateQueries({ queryKey: ['health'] });
};

const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
  queryCache: new QueryCache({ onError: (error, query) => onNetworkError(error, query.queryKey[0] === 'health') }),
  mutationCache: new MutationCache({ onError: (error) => onNetworkError(error, false) }),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
