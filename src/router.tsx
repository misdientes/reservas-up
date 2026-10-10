import { createBrowserRouter, type RouteObject } from 'react-router'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { PropertyPage } from './pages/PropertyPage'
import { CheckoutPage } from './pages/CheckoutPage'
import { BookingStatusPage } from './pages/BookingStatusPage'
import { LegalPage } from './pages/LegalPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { t } from './lib/i18n'

// Pasarela de prueba: SOLO en el modo 'localdb' (Supabase local). La
// condición va escrita aquí para que el build de producción la evalúe como
// false y elimine el import() (se verifica con grep sobre dist/).
const localOnlyRoutes: RouteObject[] =
  import.meta.env.MODE === 'localdb'
    ? [
        {
          path: '/pasarela-prueba/:paymentId',
          lazy: async () => ({ Component: (await import('./pages/MockGatewayPage')).MockGatewayPage }),
        },
      ]
    : []

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/propiedades/:slug', element: <PropertyPage /> },
      { path: '/reservar/:slug', element: <CheckoutPage /> },
      { path: '/reserva/:code', element: <BookingStatusPage /> },
      { path: '/terminos', element: <LegalPage key="terminos" kind="terminos" title={t.legal.terms} /> },
      { path: '/privacidad', element: <LegalPage key="privacidad" kind="privacidad" title={t.legal.privacy} /> },
      { path: '/cancelaciones', element: <LegalPage key="cancelacion" kind="cancelacion" title={t.legal.cancellation} /> },
      // Panel: chunk aparte (el sitio público no lo descarga).
      { path: '/admin/*', lazy: async () => ({ Component: (await import('./admin/AdminApp')).AdminApp }) },
      ...localOnlyRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
