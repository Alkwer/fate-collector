import type { Offer } from '../../shared/schema'
import { useRef, useState } from 'react'
import { isDesktop } from './desktop'
import { bindOfferToMap, loadAdvisorWorkspace, newAdvisorWorkspace, saveAdvisorWorkspace, startMapWorkspace,
  type AdvisorWorkspace } from './advisor-workspace'
import { invocationSnapshotSchema, type InvocationAction } from './fight-journal'
import { useFightJournal } from './useFightJournal'

const unavailableStorage = 'Browser storage is unavailable. Planning notes will not survive a reload.'

export function useAdvisorWorkspace() {
  const outcomes = useFightJournal()
  const [state, setState] = useState(() => {
    try {
      const { workspace, restored, error } = loadAdvisorWorkspace(isDesktop() ? window.localStorage : window.sessionStorage)
      return { workspace, needsMapConfirmation: restored, storageError: error }
    } catch {
      return { workspace: newAdvisorWorkspace(), needsMapConfirmation: false, storageError: unavailableStorage }
    }
  })
  const current = useRef(state)
  const [undoStates, setUndoStates] = useState<typeof state[]>([])
  function remember() {
    const snapshot = structuredClone(current.current)
    setUndoStates(items => [...items.slice(-9), snapshot])
  }

  function commit(next: typeof state) {
    current.current = next
    setState(next)
  }

  function save(workspace: AdvisorWorkspace, needsMapConfirmation: boolean) {
    let storageError: string | null
    try { storageError = saveAdvisorWorkspace(isDesktop() ? window.localStorage : window.sessionStorage, workspace) }
    catch { storageError = unavailableStorage }
    commit({ workspace, needsMapConfirmation, storageError })
  }

  function changeWorkspace(next: AdvisorWorkspace, invocation?: InvocationAction) {
    const { workspace, needsMapConfirmation } = current.current
    if (next.map?.id !== workspace.map?.id || (!workspace.map && next.collection.cards.length)) return
    let lastInvocation = workspace.lastInvocation
    if (invocation) {
      if (!workspace.map || needsMapConfirmation || new Set(invocation.cardIds).size !== invocation.cardIds.length) return
      const inputs = invocation.cardIds.map(id => workspace.collection.cards.find(card => card.id === id))
      if (inputs.some(card => !card) || next.collection.cards.some(card => invocation.cardIds.includes(card.id))) return
      const snapshot = invocationSnapshotSchema.safeParse({
        id: crypto.randomUUID(),
        areaId: workspace.map.id,
        invokedAt: new Date().toISOString(),
        mapName: invocation.mapName,
        gameVersion: invocation.gameVersion,
        modeledPreview: invocation.modeledPreview,
        inputs: inputs.map(card => ({ name: card?.name || '', tier: card?.visualReview && !card.visualReview.tierReviewed ? null : card?.tier ?? null })),
      })
      if (!snapshot.success) return
      lastInvocation = snapshot.data
    }
    if (JSON.stringify(next.collection.cards) !== JSON.stringify(workspace.collection.cards)) remember()
    save({ ...next, lastInvocation, map: workspace.map, offerIds: workspace.offerIds }, needsMapConfirmation)
  }

  function confirmMap() {
    if (!current.current.needsMapConfirmation || state.workspace.map?.id !== current.current.workspace.map?.id) return
    commit({ ...current.current, needsMapConfirmation: false })
  }

  function startMap(offer?: Offer) {
    const { workspace } = current.current
    if (state.workspace.map?.id !== workspace.map?.id) return
    remember()
    const next = startMapWorkspace(workspace)
    save(offer === undefined ? next : bindOfferToMap(next, offer.id, offer.areaCategory), false)
  }

  function bindOffer(offer: Offer, showOffer = false) {
    const { workspace, needsMapConfirmation } = current.current
    if (needsMapConfirmation || state.workspace.map?.id !== workspace.map?.id) return
    const next = bindOfferToMap(workspace, offer.id, offer.areaCategory)
    if (next !== workspace || (showOffer && next.mode !== 'offer')) save({ ...next, mode: showOffer ? 'offer' : next.mode }, false)
  }

  function undo() {
    const previous = undoStates.at(-1)
    if (!previous) return
    const invocation = current.current.workspace.lastInvocation
    if (invocation && invocation.id !== previous.workspace.lastInvocation?.id && !outcomes.undoInvocation(invocation.id)) return
    setUndoStates(items => items.slice(0, -1))
    save(previous.workspace, previous.needsMapConfirmation || previous.workspace.map?.id !== current.current.workspace.map?.id)
  }
  return { ...state, changeWorkspace, confirmMap, startMap, bindOffer, undo, canUndo: undoStates.length > 0, outcomes }
}
