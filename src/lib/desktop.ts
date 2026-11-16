import type { CaptureDirectory } from './capture-sync'
import type { OverlayDirectory } from './overlay-channel'

interface WebView {
  postMessage(message: unknown): void
  addEventListener(name: 'message', listener: (event: MessageEvent) => void): void
}
type Reply = { protocol: number; id: string; ok: boolean; value?: unknown; error?: { code?: string; message?: string } }
function webview(): WebView | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as Window & { chrome?: { webview?: WebView } }).chrome?.webview
}
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && (window as Window & { __fateCollectorDesktop?: unknown }).__fateCollectorDesktop === 1
    && typeof webview()?.postMessage === 'function'
}
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: number; deadline: number }>()
let listening = false

export function desktopRequest<T>(operation: string, path?: string, content?: string): Promise<T> {
  const host = webview()
  if (!host) return Promise.reject(new Error('The local advisor is not running.'))
  if (!listening) {
    host.addEventListener('message', event => {
      const reply = event.data as Reply | null
      if (!reply || reply.protocol !== 1 || typeof reply.id !== 'string' || typeof reply.ok !== 'boolean') return
      const request = pending.get(reply.id)
      if (!request) return
      pending.delete(reply.id); window.clearTimeout(request.timer)
      if (reply.ok) request.resolve(reply.value)
      else request.reject(new DOMException(reply.error?.message || 'The local helper could not complete this operation.', reply.error?.code || 'OperationError'))
    })
    window.addEventListener('fate-desktop-tick', () => {
      for (const [id, request] of pending) if (Date.now() >= request.deadline) {
        pending.delete(id); window.clearTimeout(request.timer); request.reject(new Error('The local helper stopped responding. Restart it from the tray.'))
      }
    })
    listening = true
  }
  const id = crypto.randomUUID()
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => { pending.delete(id); reject(new Error('The local helper stopped responding. Restart it from the tray.')) }, 10_000)
    pending.set(id, { resolve: value => resolve(value as T), reject, timer, deadline: Date.now() + 10_000 })
    try { host.postMessage({ protocol: 1, id, operation, ...(path === undefined ? {} : { path }), ...(content === undefined ? {} : { content }) }) }
    catch (error) { pending.delete(id); window.clearTimeout(timer); reject(error) }
  })
}

// The host enforces this same allowlist independently. These handles deliberately
// implement only the folder operations used by capture review and overlay IPC.
const captureFile = /^(?:auto-)?fate-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.json$/i
function allowedFile(path: string, name: string) {
  return path === 'captures' ? captureFile.test(name) : path === 'captures/.overlay' && ['capture.json', 'command.json', 'state.json'].includes(name)
}
function denied(): never { throw new DOMException('This file is outside the local advisor connection.', 'NotAllowedError') }

function nativeFile(path: string, name: string): FileSystemFileHandle {
  return {
    kind: 'file', name,
    async getFile() {
      let result: { text: string; lastModified: number }
      try { result = await desktopRequest('read', `${path}/${name}`) }
      catch (error) {
        if (path === 'captures' && error instanceof DOMException && error.name === 'OperationError') {
          throw new DOMException('This capture is unreadable or exceeds the size limit. Other captures can still be imported.', 'NotReadableError')
        }
        throw error
      }
      if (typeof result?.text !== 'string' || !Number.isFinite(result.lastModified)) throw new Error('Invalid local capture response.')
      return new File([result.text], name, { type: 'application/json', lastModified: result.lastModified })
    },
    async createWritable() {
      if (path !== 'captures/.overlay' || name !== 'state.json') denied()
      let text = '', closed = false
      return {
        async write(value: unknown) {
          if (closed || typeof value !== 'string' || new TextEncoder().encode(value).length > 32768) throw new Error('Invalid overlay message.')
          text = value
        },
        async close() { if (closed) throw new Error('The overlay writer is closed.'); closed = true; await desktopRequest('write', `${path}/${name}`, text) },
        async abort() { closed = true; text = '' },
      }
    },
  } as FileSystemFileHandle
}

function nativeDirectory(path: 'captures' | 'captures/.overlay'): CaptureDirectory & OverlayDirectory {
  const directory = {
    kind: 'directory', name: path === 'captures' ? 'captures' : '.overlay',
    async queryPermission() { return 'granted' as const },
    async requestPermission() { return 'granted' as const },
    async getDirectoryHandle(name: string) {
      if (path !== 'captures' || name !== '.overlay') denied()
      await desktopRequest('list', 'captures/.overlay')
      return nativeDirectory('captures/.overlay')
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!allowedFile(path, name) || (options?.create && (path !== 'captures/.overlay' || name !== 'state.json'))) denied()
      return nativeFile(path, name)
    },
    async *values() {
      const entries = await desktopRequest<{ kind: string; name: string }[]>('list', path)
      if (!Array.isArray(entries)) throw new Error('Invalid local folder response.')
      for (const entry of entries) {
        if (entry.kind === 'file' && allowedFile(path, entry.name)) yield nativeFile(path, entry.name)
        else if (path === 'captures' && entry.kind === 'directory' && entry.name === '.overlay') yield nativeDirectory('captures/.overlay')
      }
    },
  }
  return directory as unknown as CaptureDirectory & OverlayDirectory
}
export function desktopDirectory(): CaptureDirectory & OverlayDirectory { return nativeDirectory('captures') }

export function onDesktopTick(callback: () => void, interval = 1000): () => void {
  if (!isDesktop()) return () => undefined
  let last = 0
  const tick = () => { const now = Date.now(); if (now - last >= interval) { last = now; callback() } }
  window.addEventListener('fate-desktop-tick', tick)
  return () => window.removeEventListener('fate-desktop-tick', tick)
}

export async function initializeDesktop() {
  if (!isDesktop()) return
  await desktopRequest('ready')
  if (!localStorage.getItem('fate-collector.desktop-introduced')) await desktopRequest('show')
}
export async function hideDesktop() {
  await desktopRequest('hide')
  localStorage.setItem('fate-collector.desktop-introduced', '1')
}
