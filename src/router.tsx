import { createBrowserRouter } from 'react-router'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { PropertyPage } from './pages/PropertyPage'
import { LegalPage } from './pages/LegalPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { AdminPage } from './admin/AdminPage'
import { t } from './lib/i18n'

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/propiedades/:slug', element: <PropertyPage /> },
      { path: '/terminos', element: <LegalPage title={t.legal.terms} /> },
      { path: '/privacidad', element: <LegalPage title={t.legal.privacy} /> },
      { path: '/cancelaciones', element: <LegalPage title={t.legal.cancellation} /> },
      { path: '/admin', element: <AdminPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
