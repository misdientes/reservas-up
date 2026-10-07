import { createBrowserRouter } from 'react-router'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { PropertyPage } from './pages/PropertyPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { AdminPage } from './admin/AdminPage'

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/propiedades/:slug', element: <PropertyPage /> },
      { path: '/admin', element: <AdminPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
