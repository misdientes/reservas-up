import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { router } from './router'
import { SiteDataProvider } from './lib/site-data'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SiteDataProvider>
      <RouterProvider router={router} />
    </SiteDataProvider>
  </StrictMode>,
)
