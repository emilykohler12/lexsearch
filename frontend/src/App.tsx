import { createBrowserRouter, Link } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { Layout } from './components/Layout';
import { ClientDetailPage } from './pages/ClientDetailPage';
import { ClientsPage } from './pages/ClientsPage';
import { ConsultPage } from './pages/ConsultPage';
import { DraftDetailPage } from './pages/DraftDetailPage';
import { DraftsPage } from './pages/DraftsPage';
import { HistoryPage } from './pages/HistoryPage';
import { LibraryPage } from './pages/LibraryPage';

function NotFound() {
  return (
    <p className="text-sm text-muted">
      Esta página no existe.{' '}
      <Link to="/" className="underline">
        Ir a Consultar
      </Link>
    </p>
  );
}

// A data router: needed to warn before leaving a draft with unsaved changes (useBlocker).
const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <ConsultPage /> },
      { path: 'clientes', element: <ClientsPage /> },
      { path: 'clientes/nuevo', element: <ClientDetailPage /> },
      { path: 'clientes/:id', element: <ClientDetailPage /> },
      { path: 'borradores', element: <DraftsPage /> },
      { path: 'borradores/:id', element: <DraftDetailPage /> },
      { path: 'biblioteca', element: <LibraryPage /> },
      { path: 'historial', element: <HistoryPage /> },
      { path: 'historial/:id', element: <HistoryPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
