import { useEffect, useRef, useState } from 'react'
import type { archiveParts } from '../lib/imports'

export function BackupDownload({ parts, onClose }: { parts: ReturnType<typeof archiveParts>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [files, setFiles] = useState<(typeof parts[number] & { url: string })[]>([])
  useEffect(() => {
    const downloads = parts.map(part => ({ ...part, url: URL.createObjectURL(new Blob([part.json], { type: 'application/json' })) }))
    setFiles(downloads)
    dialog.current?.showModal()
    return () => { downloads.forEach(file => URL.revokeObjectURL(file.url)) }
  }, [parts])
  return <dialog ref={dialog} className="backup-dialog" aria-labelledby="backup-heading" onClose={onClose}>
    <div className="dialog-heading"><h2 id="backup-heading">Download your backup</h2><button onClick={onClose}>Close</button></div>
    <p>Download every part. Each file can be imported separately. These files contain offer data; screenshots and OCR stay in your capture folder.</p>
    <ul>{files.map(file => <li key={file.filename}><a href={file.url} download={file.filename}>{file.filename}</a> <span>({file.offers} offers)</span></li>)}</ul>
  </dialog>
}
