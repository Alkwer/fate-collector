import { useEffect, useState } from 'react'
declare const __APP_REVISION__: string

export function useReleaseUpdate() {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    let stopped = false, pending = false
    async function check() {
      if (pending || document.hidden) return
      pending = true
      try {
        const response = await fetch('/api/status', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
        if (!response.ok) return
        const status = await response.json() as { revision?: unknown }
        if (!stopped && typeof status.revision === 'string' && /^[a-f0-9]{40}$/.test(status.revision)) setAvailable(status.revision !== __APP_REVISION__)
      } catch { /* Offline use remains available; a future focus or timer retries. */ }
      finally { pending = false }
    }
    void check()
    const wake = () => { void check() }
    window.addEventListener('focus', wake); window.addEventListener('online', wake)
    const timer = setInterval(wake, 60_000)
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('focus', wake); window.removeEventListener('online', wake) }
  }, [])
  return available
}
