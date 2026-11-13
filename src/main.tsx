import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import './styles.css'
import './review-workspace.css'
import './decision-visuals.css'
import { initializeTheme } from './lib/theme'

initializeTheme()
createRoot(document.getElementById('root')!).render(<StrictMode><AppErrorBoundary><App /></AppErrorBoundary></StrictMode>)
