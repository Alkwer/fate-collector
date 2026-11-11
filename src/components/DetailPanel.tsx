import { useEffect, useId, useImperativeHandle, useRef, type ReactNode, type Ref } from 'react'

export interface DetailPanelHandle {
  show: () => void
  close: () => void
  isOpen: () => boolean
  element: HTMLDialogElement | null
}

/** Secondary tasks get a focused workspace, without expanding the map underneath. */
export function DetailPanel({ title, children, className = '', autoOpen = false, trigger = true, ref, footer, onOpenChange }: {
  title: ReactNode; children: ReactNode; className?: string; autoOpen?: boolean
  trigger?: boolean; ref?: Ref<DetailPanelHandle>; footer?: ReactNode; onOpenChange?: (open: boolean) => void
}) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  function show() {
    if (!dialog.current || dialog.current.open) return
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current.showModal()
    onOpenChange?.(true)
    heading.current?.focus()
  }
  function close() { dialog.current?.close() }
  useImperativeHandle(ref, () => ({ show, close, isOpen: () => !!dialog.current?.open, element: dialog.current }))
  useEffect(() => { if (autoOpen) show() }, [autoOpen])
  return <div className={`detail-panel ${className}`}>
    {trigger && <button type="button" className="panel-trigger" aria-haspopup="dialog" aria-controls={id} onClick={show}>{title}</button>}
    <dialog id={id} ref={dialog} className="detail-dialog" aria-labelledby={`${id}-title`} onClose={event => {
      // React bubbles close events from nested panels; only this panel changed state.
      if (event.target !== event.currentTarget) return
      onOpenChange?.(false)
      // Native close normally restores focus. Preserve an explicit destination
      // selected by the caller (for example Back to advice or another panel).
      const active = document.activeElement
      if ((!active || active === document.body || event.currentTarget.contains(active)) && returnFocus.current?.isConnected) returnFocus.current.focus()
    }}>
      <div className="detail-heading"><h2 id={`${id}-title`} ref={heading} tabIndex={-1}>{title}</h2><button type="button" onClick={close} aria-label="Close panel">Close</button></div>
      <div className="detail-body">{children}</div>
      <div className="detail-footer">{footer || <button type="button" className="outline-button" onClick={close}>Done</button>}</div>
    </dialog>
  </div>
}
