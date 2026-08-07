import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import '@/styles/base.css'
import '@/styles/buttons.css'
import App from '@/App.tsx'

// One QueryClient for the whole app — it owns the single cache that every
// useQuery / useMutation call reads from and writes to. Created once, OUTSIDE
// render, so it isn't recreated on every re-render.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // data is "fresh" for 30s; after that it refetches in the background
      retry: 1,          // one silent retry on failure before surfacing the error
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)

/* --- OLD (pre-TanStack Query): no provider, just the router ---
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>

  </StrictMode>,
)
*/
