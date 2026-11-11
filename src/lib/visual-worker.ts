import { analyzeVisualCapture } from '../../shared/visual-recognition'
import type { Capture } from '../../shared/schema'

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<Capture>) => void) | null
  postMessage: (message: unknown) => void
}
worker.onmessage = event => {
  void (async () => {
    let bitmap: ImageBitmap | undefined
    try {
      const capture = event.data
      const bytes = Uint8Array.from(atob(capture.image.dataBase64), character => character.charCodeAt(0))
      bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      if (bitmap.width !== capture.image.width || bitmap.height !== capture.image.height) throw new Error('Image size mismatch')
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('Canvas is unavailable')
      context.drawImage(bitmap, 0, 0)
      worker.postMessage(analyzeVisualCapture({ width: bitmap.width, height: bitmap.height,
        data: context.getImageData(0, 0, bitmap.width, bitmap.height).data,
        ocr: capture.ocr, frameHeight: capture.image.frameHeight }))
    } catch {
      worker.postMessage({ version: 'browser-v1', status: 'unavailable', cards: [],
        warnings: ['Visual recognition could not read this image. The capture and OCR are preserved.'] })
    } finally { bitmap?.close() }
  })()
}
