import { useRef, useState } from 'react'
import { bindOfferToMap, loadAdvisorWorkspace, newAdvisorWorkspace, saveAdvisorWorkspace, startMapWorkspace,
  type AdvisorWorkspace } from './advisor-workspace'

const unavailableStorage = 'Browser storage is unavailable. Planning notes will not survive a reload.'

export function useAdvisorWorkspace() {
  const [state, setState] = useState(() => {
    try {
      const { workspace, restored, error } = loadAdvisorWorkspace(window.sessionStorage)
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
    try { storageError = saveAdvisorWorkspace(window.sessionStorage, workspace) }
    catch { storageError = unavailableStorage }
    commit({ workspace, needsMapConfirmation, storageError })
  }

  function changeWorkspace(next: AdvisorWorkspace) {
    const { workspace, needsMapConfirmation } = current.current
    if (next.map?.id !== workspace.map?.id || (!workspace.map && next.collection.cards.length)) return
    if (JSON.stringify(next.collection.cards) !== JSON.stringify(workspace.collection.cards)) remember()
    save({ ...next, map: workspace.map, offerIds: workspace.offerIds }, needsMapConfirmation)
  }

  function confirmMap() {
    if (!current.current.needsMapConfirmation || state.workspace.map?.id !== current.current.workspace.map?.id) return
    commit({ ...current.current, needsMapConfirmation: false })
  }

  function startMap(offerId?: string) {
    const { workspace } = current.current
    if (state.workspace.map?.id !== workspace.map?.id) return
    remember()
    const next = startMapWorkspace(workspace)
    save(offerId === undefined ? next : bindOfferToMap(next, offerId), false)
  }

  function bindOffer(offerId: string) {
    const { workspace, needsMapConfirmation } = current.current
    if (needsMapConfirmation || state.workspace.map?.id !== workspace.map?.id) return
    const next = bindOfferToMap(workspace, offerId)
    if (next !== workspace) save(next, false)
  }

  function undo() {
    const previous = undoStates.at(-1)
    if (!previous) return
    setUndoStates(items => items.slice(0, -1))
    save(previous.workspace, previous.needsMapConfirmation || previous.workspace.map?.id !== current.current.workspace.map?.id)
  }
  return { ...state, changeWorkspace, confirmMap, startMap, bindOffer, undo, canUndo: undoStates.length > 0 }
}
