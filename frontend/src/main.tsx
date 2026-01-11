import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'

import { localStorageColorSchemeManager, MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const queryClient = new QueryClient()
const colorSchemeManager = localStorageColorSchemeManager({ key: 'venue-seating-color-scheme' })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider defaultColorScheme="dark" colorSchemeManager={colorSchemeManager}>
        <Notifications />
        <App />
      </MantineProvider>
    </QueryClientProvider>
  </StrictMode>,
)
