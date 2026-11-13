import { useRef, useState } from 'react'
import { createBackupParts, type BackupPart } from './imports'
import * as storage from './storage'
import { errorText } from './useOfferDraft'

export function useArchiveBackup({ busy, setBusy, setDamagedEvidenceCount, announce }: { busy: boolean; setBusy: (busy: boolean) => void; setDamagedEvidenceCount: (count: number) => void; announce: (text: string, error?: boolean) => void }) {
  const [backup, setBackup] = useState<{ parts: BackupPart[]; includeEvidence: boolean; summary: Awaited<ReturnType<typeof storage.readOfferArchive>> } | null>(null)
  const backupReturnFocus = useRef<HTMLElement | null>(null)
  async function exportAll(includeEvidence: boolean, offerIds?: string[]) {
    if (busy) return
    backupReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setBusy(true)
    try {
      const builder = createBackupParts(includeEvidence)
      const summary = await storage.readOfferArchive(includeEvidence, entry => builder.add(entry), offerIds)
      if (includeEvidence) setDamagedEvidenceCount(summary.damagedEvidence)
      if (!summary.offers) throw new Error('No readable offers to export. Use Export recovery data for unreadable records.')
      setBackup({ parts: builder.finish(), includeEvidence, summary })
    } catch (error) { announce(errorText(error), true) } finally { setBusy(false) }
  }
  async function exportRecovery() {
    if (busy) return
    setBusy(true)
    try {
      const recovery = await storage.readOfferRecovery()
      const url = URL.createObjectURL(new Blob([JSON.stringify(recovery)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url; link.download = 'fate-collector-recovery.json'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      announce('Recovery data exported. The original records are unchanged. This file needs repair before it can be imported.')
    } catch (error) { announce(errorText(error), true) } finally { setBusy(false) }
  }
  function closeBackup() { setBackup(null); requestAnimationFrame(() => backupReturnFocus.current?.focus()) }
  return { backup, exportAll, exportRecovery, closeBackup }
}
