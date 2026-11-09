import { useEffect, useState } from 'react'
import { consentHistory, onConsentChange, retryWithdrawals, selectedConsent, sharingConsent, type LocalConsent } from './consent'

export function useSharingConsent() {
  const [state, setState] = useState<{ current: LocalConsent | null; active: LocalConsent | null; records: LocalConsent[]; error: string; warning: string }>({ current: null, active: null, records: [], error: '', warning: '' })
  useEffect(() => {
    function refresh() {
      try {
        const history = consentHistory()
        setState({ current: selectedConsent(), active: sharingConsent(), records: history.records, error: '', warning: history.unreadableCount ? `${history.unreadableCount} consent record(s) could not be read and were preserved for recovery. Valid withdrawals continue. Do not clear site data.` : '' })
      } catch { setState({ current: null, active: null, records: [], warning: '', error: 'Consent history could not be read. Sharing is disabled.' }) }
    }
    refresh()
    const unsubscribe = onConsentChange(refresh)
    const retry = () => { void retryWithdrawals().catch(() => { /* Durable pending state remains visible; a later retry can confirm it. */ }) }
    retry()
    window.addEventListener('online', retry)
    const timer = window.setInterval(retry, 30000)
    return () => { unsubscribe(); window.removeEventListener('online', retry); clearInterval(timer) }
  }, [])
  return state
}
