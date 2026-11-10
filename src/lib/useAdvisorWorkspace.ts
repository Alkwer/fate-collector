import { useState } from 'react'
import { loadAdvisorWorkspace, newAdvisorWorkspace, saveAdvisorWorkspace, type AdvisorWorkspace } from './advisor-workspace'

export function useAdvisorWorkspace() {
  const [initial] = useState(() => {
    try { return loadAdvisorWorkspace(window.sessionStorage) }
    catch { return { workspace: newAdvisorWorkspace(), restored: false, error: 'Browser storage is unavailable. Planning notes will not survive a reload.' } }
  })
  const [workspace, setWorkspace] = useState(initial.workspace)
  const [needsAreaConfirmation, setNeedsAreaConfirmation] = useState(initial.restored)
  const [storageError, setStorageError] = useState(initial.error)
  function changeWorkspace(next: AdvisorWorkspace) {
    setWorkspace(next)
    try { setStorageError(saveAdvisorWorkspace(window.sessionStorage, next)) }
    catch { setStorageError('Browser storage is unavailable. Planning notes will not survive a reload.') }
    if (!next.collection.cards.length) setNeedsAreaConfirmation(false)
  }
  return { workspace, changeWorkspace, needsAreaConfirmation, confirmArea: () => setNeedsAreaConfirmation(false), storageError }
}
