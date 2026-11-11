import { useEffect, useRef, useState } from 'react'
import type { BackupPart } from '../lib/imports'
import type { readOfferArchive } from '../lib/storage'

export function BackupDownload({ parts, includeEvidence, summary, onRecovery, onClose }: { parts: BackupPart[]; includeEvidence: boolean; summary: Awaited<ReturnType<typeof readOfferArchive>>; onRecovery: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [files, setFiles] = useState<(typeof parts[number] & { url: string })[]>([])
  useEffect(() => {
    const downloads = parts.map(part => ({ ...part, url: URL.createObjectURL(part.blob) }))
    setFiles(downloads)
    dialog.current?.showModal()
    return () => { downloads.forEach(file => URL.revokeObjectURL(file.url)) }
  }, [parts])
  return <dialog ref={dialog} className="backup-dialog" aria-labelledby="backup-heading" onClose={onClose}>
    <div className="dialog-heading"><h2 id="backup-heading">Download your backup</h2><button onClick={onClose}>Close</button></div>
    <p>Download every part. Each file can be imported separately. {includeEvidence ? 'Includes available local screenshots, original OCR and your corrections.' : 'Contains offer data only. Screenshots and OCR are not included.'}</p>
    {!!(summary.omittedOffers || summary.missingEvidence || summary.damagedEvidence) && <div className="backup-warning"><p role="status">{summary.omittedOffers} unreadable offer(s) excluded. {summary.missingEvidence} screenshot/OCR record(s) unavailable on this device. {summary.damagedEvidence} damaged evidence record(s) excluded. Readable offer data is included.</p>{!!(summary.omittedOffers || summary.damagedEvidence) && <button onClick={onRecovery}>Export recovery data</button>}</div>}
    <ul>{files.map(file => <li key={file.filename}><a href={file.url} download={file.filename}>{file.filename}</a> <span>({file.offers} offers)</span></li>)}</ul>
  </dialog>
}
