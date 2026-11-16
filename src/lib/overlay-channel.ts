import { acceptsOverlayCommand, overlayCaptureSchema, overlayCommandSchema, overlayFresh, overlayStateSchema, OVERLAY_MAX_BYTES, type OverlayCapture, type OverlayState, type OverlayView } from '../../shared/overlay'
import { desktopDirectory, isDesktop } from './desktop'

export type OverlayDirectory = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
}
export function overlayPicker() {
  if (isDesktop()) return async () => desktopDirectory()
  return (window as Window & { showDirectoryPicker?: (options: { id: string; mode: 'readwrite' }) => Promise<OverlayDirectory> }).showDirectoryPicker
}
export async function readOverlayFile(directory: FileSystemDirectoryHandle, name: string): Promise<unknown | null> {
  try {
    const file = await (await directory.getFileHandle(name)).getFile()
    if (file.size > OVERLAY_MAX_BYTES) throw new Error('An overlay message exceeds the size limit.')
    return JSON.parse(await file.text())
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }
}
async function writeState(directory: FileSystemDirectoryHandle, state: OverlayState) {
  const text = JSON.stringify(overlayStateSchema.parse(state))
  if (new TextEncoder().encode(text).length > OVERLAY_MAX_BYTES) throw new Error('The overlay message is too large.')
  const file = await directory.getFileHandle('state.json', { create: true })
  const writer = await file.createWritable()
  try { await writer.write(text); await writer.close() }
  catch (error) { await writer.abort().catch(() => undefined); throw error }
}

// Each connection has a new identity. Commands from previous visits cannot replay.
// The browser is the only state writer; the helper owns capture and command files.
export class OverlayChannel {
  readonly clientId = crypto.randomUUID()
  private fingerprint = ''
  private revision = crypto.randomUUID()
  private acknowledgedCommandId: string | null = null
  private active = true
  private lastState: OverlayState | null = null
  private writing: Promise<void> = Promise.resolve()
  private notice: string | null = null
  private noticeUntil = 0
  constructor(private directory: FileSystemDirectoryHandle) {}

  async tick(snapshot: (capture: OverlayCapture | null) => { view: OverlayView; context: string }, dispatch: (action: string, capture: OverlayCapture | null) => void, now = Date.now()): Promise<OverlayState | null> {
    if (!this.active) return null
    const previous = overlayStateSchema.safeParse(await readOverlayFile(this.directory, 'state.json'))
    if (previous.success && previous.data.clientId !== this.clientId && overlayFresh(previous.data.writtenAt, now)) throw new Error('Another advisor is using this overlay folder. Disconnect it or wait 12 seconds after closing it.')
    const rawCapture = await readOverlayFile(this.directory, 'capture.json')
    const capture = rawCapture === null ? null : overlayCaptureSchema.parse(rawCapture)
    const { view, context } = snapshot(capture)
    const fingerprint = JSON.stringify([view, context])
    if (fingerprint !== this.fingerprint) { this.fingerprint = fingerprint; this.revision = crypto.randomUUID() }
    const state: OverlayState = { ...view, protocol: 1, clientId: this.clientId, revision: this.revision, writtenAt: now, acknowledgedCommandId: this.acknowledgedCommandId, notice: now < this.noticeUntil ? this.notice : null }
    const command = overlayCommandSchema.safeParse(await readOverlayFile(this.directory, 'command.json'))
    if (!this.active) return null
    // Recheck the capture immediately before applying an input. A new F9 must
    // invalidate a command even when it arrived during the asynchronous reads.
    if (command.success && command.data.id !== this.acknowledgedCommandId && command.data.clientId === this.clientId) {
      this.acknowledgedCommandId = command.data.id
      const latestCapture = await readOverlayFile(this.directory, 'capture.json')
      if (!this.active) return null
      const latest = snapshot(capture)
      if (acceptsOverlayCommand(command.data, state, now) && JSON.stringify(latestCapture) === JSON.stringify(rawCapture)
        && JSON.stringify([latest.view, latest.context]) === fingerprint) {
        dispatch(command.data.action, capture)
        this.notice = null; this.noticeUntil = 0; state.notice = null
        // React commits the action before the next tick. Never publish the old
        // collect action again with its acknowledgement.
        state.status = 'busy'; state.title = 'Updating your collection…'; state.detail = 'Waiting for the advisor.'; state.rows = []; state.actions = []
        state.revision = crypto.randomUUID()
      } else {
        this.notice = 'That action expired. Use the current overlay controls.'
        this.noticeUntil = now + 5000
        state.notice = this.notice
      }
      state.acknowledgedCommandId = this.acknowledgedCommandId
    }
    if (!this.active) return null
    this.writing = writeState(this.directory, state)
    await this.writing
    this.lastState = state
    return state
  }

  stop() { this.active = false }
  async disconnect() {
    this.active = false
    await this.writing.catch(() => undefined)
    if (!this.lastState) return
    const previous = overlayStateSchema.safeParse(await readOverlayFile(this.directory, 'state.json'))
    if (previous.success && previous.data.clientId === this.clientId) await writeState(this.directory, { ...this.lastState, writtenAt: 0, actions: [], rows: [], status: 'idle', title: 'Overlay disconnected', detail: 'Reconnect the local advisor or website to resume.' })
  }
}
