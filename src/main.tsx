import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import './styles.css'
import './review-workspace.css'
import './decision-visuals.css'
import { initializeTheme } from './lib/theme'
import { initializeDesktop } from './lib/desktop'

initializeTheme()
void initializeDesktop().then(() => {
  createRoot(document.getElementById('root')!).render(<StrictMode><AppErrorBoundary><App /></AppErrorBoundary></StrictMode>)
}).catch(error => {
  const root = document.getElementById('root')!
  const message = document.createElement('p')
  message.role = 'alert'; message.textContent = `The local advisor could not start. ${error instanceof Error ? error.message : 'Restart the helper.'}`
  const retry = document.createElement('button')
  retry.textContent = 'Retry'; retry.onclick = () => location.reload()
  root.replaceChildren(message, retry)
})
