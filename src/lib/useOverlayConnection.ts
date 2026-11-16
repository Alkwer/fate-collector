import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { OverlayCapture, OverlayView } from '../../shared/overlay'
import { OverlayChannel, overlayPicker } from './overlay-channel'
import type { CaptureDirectory } from './capture-sync'

interface Options {
  snapshot: (capture: OverlayCapture | null) => { view: OverlayView; context: string }
  dispatch: (action: string, capture: OverlayCapture | null) => void
  connectCaptures: (directory: CaptureDirectory) => Promise<void>
}
export function useOverlayConnection(options: Options) {
  const supported = typeof overlayPicker() === 'function' && window.isSecureContext
  const current = useRef(options)
  useLayoutEffect(() => { current.current = options })
  const [status, setStatus] = useState<'off' | 'connecting' | 'active' | 'error'>('off')
  const [problem, setProblem] = useState<string | null>(null)
  const [preview, setPreview] = useState<OverlayView | null>(null)
  const session = useRef<{ channel: OverlayChannel; timer?: number; release?: () => void } | null>(null)
  const generation = useRef(0)

  async function disconnect() {
    ++generation.current
    const old = session.current
    session.current = null
    if (old) { window.clearTimeout(old.timer); old.channel.stop(); old.release?.(); await old.channel.disconnect().catch(() => undefined) }
    setStatus('off'); setPreview(null); setProblem(null)
  }
  useEffect(() => () => {
    ++generation.current
    const old = session.current
    if (old) { window.clearTimeout(old.timer); old.channel.stop(); old.release?.() }
  }, [])

  async function connect() {
    const picker = overlayPicker()
    if (!picker || status === 'connecting' || status === 'active') return
    const version = ++generation.current
    setStatus('connecting'); setProblem(null)
    let release: (() => void) | undefined
    try {
      const directory = await picker.call(window, { id: 'fate-collector-overlay', mode: 'readwrite' })
      if (version !== generation.current) return
      if (directory.name !== 'captures') throw new Error('Select the captures folder beside the running FateCollector.ahk helper.')
      // The native helper creates this directory. Do not silently enable a bridge
      // in an unrelated folder selected by mistake.
      const bridge = await directory.getDirectoryHandle('.overlay')
      if (await directory.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Allow read and write access for the overlay connection.')
      if (!navigator.locks) throw new Error('This browser cannot coordinate overlay access. Use desktop Chrome or Edge.')
      await new Promise<void>((resolve, reject) => {
        void navigator.locks.request('fate-collector-overlay', { ifAvailable: true }, lock => {
          if (!lock) { reject(new Error('An overlay is already connected in another tab. Disconnect it first.')); return }
          return new Promise<void>(unlock => { release = unlock; resolve() })
        }).catch(reject)
      })
      if (version !== generation.current) { release?.(); return }
      const active = { channel: new OverlayChannel(bridge), release, timer: undefined as number | undefined }
      session.current = active
      // Check ownership before changing the existing capture connection.
      await active.channel.tick(capture => current.current.snapshot(capture), () => undefined)
      await current.current.connectCaptures(directory as unknown as CaptureDirectory)
      if (version !== generation.current) { active.channel.stop(); release?.(); return }
      setStatus('active')
      const poll = async () => {
        try {
          const state = await active.channel.tick(capture => current.current.snapshot(capture), (action, capture) => current.current.dispatch(action, capture))
          if (version !== generation.current) return
          if (state) setPreview(previous => JSON.stringify(previous) === JSON.stringify({ captureId: state.captureId, status: state.status, title: state.title, detail: state.detail, rows: state.rows, actions: state.actions }) ? previous : { captureId: state.captureId, status: state.status, title: state.title, detail: state.detail, rows: state.rows, actions: state.actions })
          active.timer = window.setTimeout(() => void poll(), 1000)
        } catch (error) {
          active.channel.stop(); release?.()
          if (version === generation.current) { session.current = null; setStatus('error'); setProblem(error instanceof Error ? error.message : 'Overlay connection failed. Reconnect the folder.'); setPreview(null) }
        }
      }
      void poll()
    } catch (error) {
      release?.()
      session.current?.channel.stop(); session.current = null
      if (version !== generation.current) return
      if (error instanceof DOMException && error.name === 'AbortError') { setStatus('off'); return }
      setStatus('error'); setProblem(error instanceof DOMException && error.name === 'NotFoundError' ? 'Start the updated Windows helper, then select its captures folder. The overlay folder is missing.' : error instanceof Error ? error.message : 'Could not connect the overlay.')
    }
  }
  return { supported, status, problem, preview, connect, disconnect }
}
