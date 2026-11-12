import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import type { SymbolVerification } from '../lib/symbol-reports'
import { DetailPanel, type DetailPanelHandle } from './DetailPanel'

type Action = Parameters<SymbolVerification>[0]
interface VerificationRequest {
  action: Action
  id: string
  resolve: (token: string) => void
  reject: (error: Error) => void
}

interface Turnstile {
  ready: (callback: () => void) => void
  render: (element: HTMLElement, options: {
    sitekey: string
    action: Action
    cData: string
    theme: 'light' | 'dark'
    size: 'normal' | 'compact'
    retry: 'never'
    'response-field': false
    'refresh-expired': 'never'
    'refresh-timeout': 'never'
    callback: (token: string) => void
    'error-callback': () => boolean
    'expired-callback': () => void
    'timeout-callback': () => void
    'unsupported-callback': () => void
  }) => string
  remove: (widget: string) => void
}

let scriptLoad: Promise<Turnstile> | undefined
function loadTurnstile() {
  if (scriptLoad) return scriptLoad
  scriptLoad = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    const timer = window.setTimeout(fail, 15000)
    function fail() {
      window.clearTimeout(timer)
      script.remove()
      reject(new Error('Verification could not load. Allow Cloudflare Turnstile in this browser and try again.'))
    }
    script.onerror = fail
    script.onload = () => {
      const turnstile = (window as Window & { turnstile?: Turnstile }).turnstile
      if (!turnstile || typeof turnstile.ready !== 'function') { fail(); return }
      turnstile.ready(() => {
        window.clearTimeout(timer)
        resolve(turnstile)
      })
    }
    document.head.appendChild(script)
  }).catch(error => {
    scriptLoad = undefined
    throw error
  })
  return scriptLoad
}

async function loadSitekey(signal: AbortSignal) {
  const config = await fetch('/api/symbol-reports/config', {
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  }).then(response => response.ok ? response.json<{ enabled?: unknown; sitekey?: unknown }>() : null).catch(() => null)
  if (!config) throw new Error('Could not reach symbol report verification. Check your connection and try again.')
  if (config.enabled !== true || typeof config.sitekey !== 'string' || !config.sitekey.trim()) {
    throw new Error('Symbol report verification is unavailable. Try again later.')
  }
  return config.sitekey
}

function VerificationWidget({ request, onToken, onError }: {
  request: VerificationRequest
  onToken: (token: string) => void
  onError: (error: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const element = container.current
    if (!element) return
    const controller = new AbortController()
    const { signal } = controller
    let turnstile: Turnstile | undefined
    let widget: string | undefined
    let timer: number | undefined
    const fail = (message: string) => { if (!signal.aborted) onError(message) }
    const timeout = () => fail('Verification timed out. Try again.')
    async function render() {
      const sitekey = await loadSitekey(signal)
      if (signal.aborted) return
      turnstile = await loadTurnstile()
      if (signal.aborted || !element) return
      widget = turnstile.render(element, {
        sitekey,
        action: request.action,
        cData: request.id,
        theme: document.documentElement.dataset.theme === 'trail' ? 'light' : 'dark',
        size: element.clientWidth >= 300 ? 'normal' : 'compact',
        retry: 'never',
        'response-field': false,
        'refresh-expired': 'never',
        'refresh-timeout': 'never',
        callback: token => { if (!signal.aborted) onToken(token) },
        'error-callback': () => { fail('Verification failed. Try again.'); return true },
        'expired-callback': () => fail('Verification expired. Try again.'),
        'timeout-callback': timeout,
        'unsupported-callback': () => fail('This browser could not complete verification. Try again or use another browser.'),
      })
      setLoading(false)
      timer = window.setTimeout(timeout, 120000)
    }
    void render().catch(error => fail(error instanceof Error ? error.message : 'Verification failed. Try again.'))
    return () => {
      controller.abort()
      window.clearTimeout(timer)
      if (widget) turnstile?.remove(widget)
    }
  }, [request, onToken, onError])

  return <>
    {loading && <p role="status">Loading verification…</p>}
    <div ref={container} className="symbol-verification-widget" />
  </>
}

export interface SymbolReportVerificationHandle {
  verify: SymbolVerification
  cancel: () => void
}

export function SymbolReportVerification({ ref }: { ref: Ref<SymbolReportVerificationHandle> }) {
  const panel = useRef<DetailPanelHandle>(null)
  const pending = useRef<VerificationRequest | null>(null)
  const [request, setRequest] = useState<VerificationRequest | null>(null)
  const [error, setError] = useState('')

  const finish = useCallback((token?: string) => {
    const current = pending.current
    if (!current) return
    pending.current = null
    if (token && panel.current?.isOpen()) current.resolve(token)
    else current.reject(new Error('Verification cancelled. Your report is saved on this device.'))
    setRequest(null)
    panel.current?.close()
  }, [])

  useImperativeHandle(ref, () => ({
    verify(action, id) {
      return new Promise((resolve, reject) => {
        if (pending.current) { reject(new Error('Verification is already in progress.')); return }
        const next = { action, id, resolve, reject }
        pending.current = next
        setError('')
        setRequest(next)
        panel.current?.show()
      })
    },
    cancel() { finish() },
  }))

  useEffect(() => () => {
    const current = pending.current
    pending.current = null
    current?.reject(new Error('Verification cancelled. Your report is saved on this device.'))
  }, [])

  return <DetailPanel ref={panel} trigger={false} title="Verify your request" className="symbol-report-verification"
    onOpenChange={open => { if (!open && !panel.current?.isOpen()) finish() }}
    footer={<>
      {error && <button type="button" onClick={() => setError('')}>Try again</button>}
      <button type="button" className="outline-button" onClick={() => finish()}>Cancel verification</button>
    </>}>
    <p>Complete the security check to {request?.action === 'symbol-withdraw' ? 'confirm withdrawal' : 'send your symbol report'}.</p>
    {error ? <p role="alert">{error}</p> : request && <VerificationWidget request={request} onToken={finish} onError={setError} />}
  </DetailPanel>
}
