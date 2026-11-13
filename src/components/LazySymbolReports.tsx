import { lazy, Suspense, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import type { Evidence, Offer } from '../../shared/schema'
import type { SymbolReportsHandle } from './SymbolReports'

const Reports = lazy(() => import('./SymbolReports').then(module => ({ default: module.SymbolReports })))
export function LazySymbolReports({ ref, offer, evidence }: { ref: Ref<SymbolReportsHandle>; offer: Offer; evidence: Evidence | null }) {
  const [enabled, setEnabled] = useState(false)
  const inner = useRef<SymbolReportsHandle | null>(null), pending = useRef<'showNew' | 'showHistory' | null>(null)
  useImperativeHandle(ref, () => ({ showNew: () => show('showNew'), showHistory: () => show('showHistory') }))
  function show(action: 'showNew' | 'showHistory') {
    if (inner.current) inner.current[action]()
    else { pending.current = action; setEnabled(true) }
  }
  useEffect(() => {
    const check = () => { if (location.hash === '#report-symbol') setEnabled(true) }
    check(); window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [])
  return enabled && <Suspense fallback={<p role="status">Loading symbol reports…</p>}><Reports offer={offer} evidence={evidence} ref={handle => {
    inner.current = handle
    if (handle && pending.current) { const action = pending.current; pending.current = null; handle[action]() }
  }} /></Suspense>
}
