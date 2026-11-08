import { useEffect, useState } from 'react'
import { consentRecords, onConsentChange, retryWithdrawals, selectedConsent, sharingConsent, type LocalConsent } from './consent'

export function useSharingConsent() {
  const [state, setState] = useState<{ current: LocalConsent | null; active: LocalConsent | null; records: LocalConsent[]; error: string }>({ current: null, active: null, records: [], error: '' })
  useEffect(() => {
    function refresh() {
      try { setState({ current: selectedConsent(), active: sharingConsent(), records: consentRecords(), error: '' }) }
      catch { setState({ current: null, active: null, records: [], error: 'Consent history could not be read. Sharing is disabled.' }) }
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
