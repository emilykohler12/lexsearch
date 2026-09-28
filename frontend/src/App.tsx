import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { ConsultPage } from './pages/ConsultPage';
import { HistoryPage } from './pages/HistoryPage';
import { LibraryPage } from './pages/LibraryPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<ConsultPage />} />
          <Route path="biblioteca" element={<LibraryPage />} />
          <Route path="historial" element={<HistoryPage />} />
          <Route path="historial/:id" element={<HistoryPage />} />
          <Route
            path="*"
            element={
              <p className="text-sm text-muted">
                Esta página no existe.{' '}
                <Link to="/" className="underline">
                  Ir a Consultar
                </Link>
              </p>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
