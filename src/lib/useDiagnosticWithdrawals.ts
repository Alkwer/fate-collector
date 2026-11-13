import { useEffect } from 'react'

// Deletion retries run independently of the selected view.

export function useDiagnosticWithdrawals() {
  useEffect(() => {
    const retry = () => { void import('./diagnostics').then(module => module.retryDiagnosticWithdrawals()).catch(() => { /* The durable pending receipt stays visible. */ }) }
    retry(); window.addEventListener('online', retry)
    const timer = setInterval(retry, 30000)
    return () => { window.removeEventListener('online', retry); clearInterval(timer) }
  }, [])
}
