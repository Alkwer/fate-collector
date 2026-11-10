import type { Capture } from '../../shared/schema'
import type { VisualAnalysis } from '../../shared/visual-recognition'

export function readVisualCapture(capture: Capture): Promise<VisualAnalysis> {
  const unavailable = (message: string): VisualAnalysis => ({ version: 'browser-v1', status: 'unavailable', cards: [], warnings: [message] })
  if (typeof Worker === 'undefined') return Promise.resolve(unavailable('Visual recognition is unavailable in this browser.'))
  return new Promise(resolve => {
    let worker: Worker | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (result: VisualAnalysis) => { clearTimeout(timer); worker?.terminate(); resolve(result) }
    try {
      worker = new Worker(new URL('./visual-worker.ts', import.meta.url), { type: 'module' })
      timer = setTimeout(() => finish(unavailable('Visual recognition timed out. The capture and OCR are preserved.')), 15000)
      worker.onmessage = (event: MessageEvent<VisualAnalysis>) => finish(event.data)
      worker.onerror = event => { event.preventDefault(); finish(unavailable('Visual recognition could not run. The capture and OCR are preserved.')) }
      worker.onmessageerror = () => finish(unavailable('Visual recognition returned unreadable data.'))
      worker.postMessage(capture)
    } catch { finish(unavailable('Visual recognition could not start. The capture and OCR are preserved.')) }
  })
}
