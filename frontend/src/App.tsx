import { createBrowserRouter, Link } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { Layout } from './components/Layout';
import { CaseContradictionsPage } from './pages/CaseContradictionsPage';
import { CaseDocumentsPage } from './pages/CaseDocumentsPage';
import { CaseEditorPage } from './pages/CaseEditorPage';
import { CaseLayoutPage } from './pages/CaseLayoutPage';
import { CasesPage } from './pages/CasesPage';
import { CaseTimelinePage } from './pages/CaseTimelinePage';
import { ClientDetailPage } from './pages/ClientDetailPage';
import { ClientsPage } from './pages/ClientsPage';
import { ConsultPage } from './pages/ConsultPage';
import { DeadlineEditorPage } from './pages/DeadlineEditorPage';
import { DraftDetailPage } from './pages/DraftDetailPage';
import { DraftsPage } from './pages/DraftsPage';
import { HearingPage } from './pages/HearingPage';
import { HearingsPage } from './pages/HearingsPage';
import { HistoryPage } from './pages/HistoryPage';
import { LibraryPage } from './pages/LibraryPage';
import { NonWorkingDaysPage } from './pages/NonWorkingDaysPage';
import { NormativaAlertsPage } from './pages/NormativaAlertsPage';
import { NormativaBulletinPage } from './pages/NormativaBulletinPage';
import { NormativaLayoutPage } from './pages/NormativaLayoutPage';
import { NormativaTopicsPage } from './pages/NormativaTopicsPage';
import { PlazosPage } from './pages/PlazosPage';

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
      { path: 'expedientes', element: <CasesPage /> },
      { path: 'expedientes/nuevo', element: <CaseEditorPage /> },
      {
        path: 'expedientes/:id',
        element: <CaseLayoutPage />,
        children: [
          { index: true, element: <CaseTimelinePage /> },
          { path: 'documentos', element: <CaseDocumentsPage /> },
          { path: 'contradicciones', element: <CaseContradictionsPage /> },
        ],
      },
      { path: 'expedientes/:id/editar', element: <CaseEditorPage /> },
      { path: 'plazos', element: <PlazosPage /> },
      { path: 'plazos/nuevo', element: <DeadlineEditorPage /> },
      { path: 'plazos/inhabiles', element: <NonWorkingDaysPage /> },
      { path: 'plazos/:id', element: <DeadlineEditorPage /> },
      {
        path: 'normativa',
        element: <NormativaLayoutPage />,
        children: [
          { index: true, element: <NormativaAlertsPage /> },
          { path: 'boletin', element: <NormativaBulletinPage /> },
          { path: 'temas', element: <NormativaTopicsPage /> },
        ],
      },
      { path: 'borradores', element: <DraftsPage /> },
      { path: 'borradores/:id', element: <DraftDetailPage /> },
      { path: 'audiencia', element: <HearingsPage /> },
      { path: 'audiencia/:id', element: <HearingPage /> },
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
