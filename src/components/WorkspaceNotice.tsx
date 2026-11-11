import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/** Keep save/import feedback in the active workspace, including a focused panel. */
export function WorkspaceNotice({ notice, onDismiss }: { notice: { text: string; error: boolean }; onDismiss: () => void }) {
  const [host, setHost] = useState<Element | null>(null)
  useEffect(() => {
    const sync = () => setHost([...document.querySelectorAll('.detail-dialog[open]')].at(-1)?.querySelector('.detail-body') ?? null)
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'], childList: true })
    return () => observer.disconnect()
  }, [])
  const message = <div className={`notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.text}</span><button aria-label="Dismiss message" onClick={onDismiss}>×</button></div>
  return host ? createPortal(message, host) : message
}
