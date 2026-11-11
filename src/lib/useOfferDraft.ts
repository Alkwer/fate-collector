import { useCallback, useEffect, useRef, useState } from 'react'
import { formatValidationError, offerSchema, type Evidence, type Offer } from '../../shared/schema'
import { newOffer } from '../../shared/offers'
import { logDiagnostic } from './diagnostic-log'
import type { CapturedEntry } from './capture-sync'
import * as storage from './storage'

export const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Your draft is still open.'
interface Options {
  records: storage.SavedOffer[]
  connected: boolean
  refresh: () => Promise<void>
  announce: (text: string, error?: boolean) => void
}

// Own the editor session and save acknowledgements together. An async write can
// update its own revision, but cannot replace a different draft or newer typing.
export function useOfferDraft({ records, connected, refresh, announce }: Options) {
  const [draft, setDraft] = useState<Offer>(() => newOffer())
  const [evidence, setEvidence] = useState<Evidence | null>(null)
  const [dirty, setDirtyState] = useState(false)
  const [busy, setBusyState] = useState(false)
  const [autoSaving, setAutoSaving] = useState(false)
  const [failedAutoSave, setFailedAutoSave] = useState<{ session: number; version: number; conflict: boolean } | null>(null)
  const dirtyRef = useRef(false), busyRef = useRef(false)
  const draftSession = useRef(0), editVersion = useRef(0)
  const recoveryId = useRef<string>(crypto.randomUUID()), recoveryWrites = useRef(Promise.resolve())
  const recoveredFrom = useRef<string | null>(null)
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const setDirty = useCallback((value: boolean) => { dirtyRef.current = value; setDirtyState(value) }, [])
  const setBusy = useCallback((value: boolean) => { busyRef.current = value; setBusyState(value) }, [])
  const savedLocally = records.some(record => record.offer.id === draft.id)
  const previouslySaved = useRef({ id: draft.id, saved: savedLocally })
  if (previouslySaved.current.id !== draft.id) previouslySaved.current = { id: draft.id, saved: savedLocally }
  else if (savedLocally) previouslySaved.current.saved = true
  // A cross-tab deletion must still try the guarded save and surface its tombstone.
  const automatic = connected && previouslySaved.current.saved
  const canConfirm = !!evidence && draft.cards.length > 0 && draft.cards.every(card => card.name.trim())
  const needsConfirmation = canConfirm && !draft.reviewed
  const canSave = !busy && !autoSaving && (!!evidence || draft.cards.length > 0 || dirty) && (!savedLocally || dirty || needsConfirmation)
  const autoSaveFailure = dirty && failedAutoSave?.session === draftSession.current && failedAutoSave.version === editVersion.current ? failedAutoSave : null

  function loadDraft(offer: Offer, source: Evidence | null, changed = false) {
    draftSession.current++; setFailedAutoSave(null)
    setDraft(offer); setEvidence(source); setDirty(changed)
  }
  function change(patch: Partial<Offer>) {
    editVersion.current++
    setDraft(current => ({ ...current, ...patch, reviewed: patch.reviewed ?? false,
      completeness: patch.completeness ?? (patch.reviewed !== true && current.completeness === 'complete' ? 'unverified' : current.completeness) }))
    setDirty(true)
  }
  function receive(entry: CapturedEntry, inspecting: boolean) {
    if (entry.restored && draft.id === entry.offer.id) {
      // Missing evidence can arrive while corrections are still being typed.
      setEvidence(current => current ?? entry.evidence)
    } else if (!dirtyRef.current && !busyRef.current && !inspecting) loadDraft(entry.offer, entry.evidence)
  }
  function canReplace() { return !dirtyRef.current || window.confirm('Replace the unsaved draft? Save or export it first if you want to keep it.') }
  function recover(record: storage.RecoveryDraft) {
    if (!canReplace()) return false
    recoveredFrom.current = record.id
    recoveryId.current = crypto.randomUUID()
    loadDraft(record.offer, record.evidence, true)
    return true
  }
  useEffect(() => {
    const id = recoveryId.current
    const sourceId = recoveredFrom.current
    // Serialize recovery writes, including the removal after a successful save.
    recoveryWrites.current = recoveryWrites.current.then(async () => {
      if (dirty) {
        if (!offerSchema.safeParse(draft).success) { setRecoveryError('The current invalid fields cannot be recovered after a crash. Correct them or export your draft before leaving.'); return }
        await storage.writeDraftRecovery(id, draft, evidence)
        if (sourceId) { await storage.removeDraftRecovery(sourceId); if (recoveredFrom.current === sourceId) recoveredFrom.current = null }
      } else await storage.removeDraftRecovery(id)
      setRecoveryError(null)
    }).catch(() => setRecoveryError('The draft is still open, but its recovery copy could not be saved. Export it before closing the page.'))
  }, [draft, evidence, dirty])
  useEffect(() => {
    // Map/archive editors can hold the same saved offer. Refresh a clean copy
    // after another editor saves it, without rebasing pending or in-flight edits.
    if (dirtyRef.current || busyRef.current || autoSaving) return
    const saved = records.find(record => record.offer.id === draft.id)
    if (!saved || saved.offer.revision <= draft.revision) return
    setDraft(current => !dirtyRef.current && !busyRef.current && current.id === saved.offer.id
      && current.revision < saved.offer.revision ? saved.offer : current)
  }, [records, draft.id, draft.revision, dirty, busy, autoSaving])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  useEffect(() => {
    if (!automatic || !dirty || busy || autoSaving) return
    const session = draftSession.current, version = editVersion.current
    if (failedAutoSave?.session === session && failedAutoSave.version === version) return
    const timer = window.setTimeout(() => {
      const parsed = offerSchema.safeParse(draft)
      if (!parsed.success) { announce(`Changes are not saved yet. ${formatValidationError(parsed.error)}`, true); return }
      setAutoSaving(true)
      void storage.saveOffer(parsed.data, evidence).then(async saved => {
        if (session === draftSession.current) {
          setFailedAutoSave(null)
          if (version === editVersion.current) { setDraft(saved.offer); setDirty(false) }
          else setDraft(current => ({ ...current, revision: saved.offer.revision, updatedAt: saved.offer.updatedAt }))
        }
        await refresh()
      }).catch(error => {
        if (session === draftSession.current) {
          setFailedAutoSave({ session, version, conflict: error instanceof storage.OfferRevisionConflictError })
          announce(errorText(error), true)
        }
      }).finally(() => setAutoSaving(false))
    }, 700)
    return () => window.clearTimeout(timer)
  }, [automatic, dirty, busy, autoSaving, failedAutoSave, draft, evidence, refresh, announce, setDirty])

  async function save(mode: 'current' | 'confirm' | 'later' = 'current') {
    const candidate = mode === 'confirm' && canConfirm
      ? { ...draft, reviewed: true, completeness: draft.completeness === 'partial' ? 'partial' : 'complete' }
      : mode === 'later' ? { ...draft, reviewed: false, completeness: 'unverified' } : draft
    const parsed = offerSchema.safeParse(candidate)
    if (!parsed.success) { announce(formatValidationError(parsed.error), true); return }
    setBusy(true)
    const session = draftSession.current
    try {
      const saved = await storage.saveOffer(parsed.data, evidence)
      if (session === draftSession.current) { setDraft(saved.offer); setDirty(false) }
      await refresh(); logDiagnostic('local-save', 'ok')
      announce('Offer saved on this device. This save did not upload any changes.')
    } catch (error) { logDiagnostic('local-save', 'error'); announce(errorText(error), true) }
    finally { setBusy(false) }
  }
  return { draft, evidence, dirty, busy, autoSaving, dirtyRef, setBusy, loadDraft, change, receive, canReplace, save,
    savedLocally, automatic, canConfirm, needsConfirmation, canSave, autoSaveFailure, recoveryError, recover, retryAutoSave: () => setFailedAutoSave(null) }
}
