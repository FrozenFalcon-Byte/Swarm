import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { IslandProvider } from './components/Island'
import { AuthProvider } from './lib/auth'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <IslandProvider>
          <App />
        </IslandProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
