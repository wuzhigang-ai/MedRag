import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import { TRPCProvider } from '@/providers/trpc'
import { ThemeProvider } from '@/hooks/useTheme'
import { ToastProvider } from '@/providers/toast'
import ErrorBoundary from '@/components/ErrorBoundary'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <TRPCProvider>
          <ThemeProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </ThemeProvider>
        </TRPCProvider>
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
)
