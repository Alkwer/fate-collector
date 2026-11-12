import { z } from 'zod'

export const SYMBOL_REPORT_VERSION = 'symbol-reports-v1'
export const SYMBOL_REPORT_LIMIT = 640 * 1024
export const SYMBOL_RETENTION_MS = 30 * 86400000
export const symbolId = z.string().uuid().transform(value => value.toLowerCase())
export const symbolToken = z.string().regex(/^[a-f0-9]{64}$/)
export function symbolConsentText(origin: string) {
  return `I agree to send the two previewed images (symbol and tooltip), my reward description and the displayed offer references to ${origin} for reward-symbol research. This is separate from OCR and reviewed-offer sharing. Reports are unverified and do not automatically change recognition or reward values. Images and descriptions are deleted from the live collection after 30 days or when I withdraw this report. A minimal consent receipt remains; database recovery backups may retain deleted data temporarily. I can withdraw using this browser's report history. Only submit game images you intend to share.`
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
function crc(bytes: Uint8Array) {
  let value = 0xffffffff
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}
function pngMatches(image: { dataBase64: string; width: number; height: number }) {
  try {
    if (image.dataBase64.length > 524288) return false
    const binary = atob(image.dataBase64)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    const view = new DataView(bytes.buffer)
    if (bytes.length < 57 || [137, 80, 78, 71, 13, 10, 26, 10].some((v, i) => bytes[i] !== v)) return false
    if (view.getUint32(8) !== 13 || binary.slice(12, 16) !== 'IHDR' || view.getUint32(16) !== image.width || view.getUint32(20) !== image.height) return false
    if (bytes[24] !== 8 || ![0, 2, 4, 6].includes(bytes[25]) || bytes[26] || bytes[27] || bytes[28]) return false
    let offset = 8, data = false
    while (offset + 12 <= bytes.length) {
      const size = view.getUint32(offset), kind = binary.slice(offset + 4, offset + 8)
      if (offset + size + 12 > bytes.length) return false
      if (crc(bytes.subarray(offset + 4, offset + 8 + size)) !== view.getUint32(offset + 8 + size)) return false
      if (kind === 'IHDR' && offset !== 8) return false
      if (!['IHDR', 'IDAT', 'IEND', 'sRGB', 'pHYs'].includes(kind)) return false
      if (kind === 'sRGB' && (data || size !== 1 || bytes[offset + 8] > 3)) return false
      if (kind === 'pHYs' && (data || size !== 9 || bytes[offset + 16] > 1)) return false
      if (kind === 'IDAT') data ||= size > 0
      if (kind === 'IEND') return data && size === 0 && offset + 12 === bytes.length
      offset += size + 12
    }
  } catch { return false }
  return false
}
const png = (maxSide: number, maxBytes: number) => z.object({
  mimeType: z.literal('image/png'), width: z.number().int().min(8).max(maxSide), height: z.number().int().min(8).max(maxSide),
  dataBase64: z.string().min(1).max(Math.ceil(maxBytes / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).strict().refine(pngMatches, 'Use a valid PNG with matching dimensions.')

export const symbolReportSchema = z.object({
  kind: z.literal('fate-collector.symbol-report'), schemaVersion: z.literal(1), id: symbolId,
  createdAt: z.string().datetime({ offset: true }),
  offer: z.object({ id: symbolId, revision: z.number().int().min(1), captureId: symbolId.nullable(), cardId: symbolId,
    cardName: z.string().max(160), rewardId: symbolId.nullable(), gameVersion: z.string().trim().min(1).max(64),
    origin: z.enum(['live', 'test']), areaLevel: z.number().int().min(1).max(100).nullable(),
  }).strict(),
  label: z.string().trim().max(160), rewardKind: z.enum(['regular', 'combo', 'unknown']),
  threshold: z.number().int().min(1).max(100).nullable(), description: z.string().trim().max(2000),
  icon: png(256, 64 * 1024), tooltip: png(1600, 384 * 1024),
}).strict().refine(value => value.rewardKind === 'combo' || value.threshold === null, 'Only a combo can have a threshold.')
export const symbolSubmissionSchema = z.object({
  report: symbolReportSchema, token: symbolToken,
  consent: z.object({ version: z.literal(SYMBOL_REPORT_VERSION), text: z.string().max(4000), acceptedAt: z.string().datetime({ offset: true }) }).strict(),
}).strict()
export type SymbolReport = z.infer<typeof symbolReportSchema>
/** Decode the bounded zlib stream before accepting/exporting pixels. Native streaming
 * decompression enforces the checksum and stops as soon as dimensions are exceeded. */
export async function validateSymbolPixels(report: SymbolReport): Promise<boolean> {
  try {
    for (const image of [report.icon, report.tooltip]) {
      if (!pngMatches(image)) return false
      const bytes = Uint8Array.from(atob(image.dataBase64), char => char.charCodeAt(0)), view = new DataView(bytes.buffer)
      const chunks: Uint8Array<ArrayBuffer>[] = []
      for (let offset = 8; offset + 12 <= bytes.length;) {
        const size = view.getUint32(offset)
        if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'IDAT') chunks.push(bytes.slice(offset + 8, offset + 8 + size))
        offset += size + 12
      }
      const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[bytes[25]]
      const stride = image.width * channels + 1, expected = stride * image.height
      const reader = new Blob(chunks).stream().pipeThrough(new DecompressionStream('deflate')).getReader()
      let count = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (count + value.length > expected) return false
          for (let index = (stride - count % stride) % stride; index < value.length; index += stride) if (value[index] > 4) return false
          count += value.length
        }
      } finally { await reader.cancel().catch(() => {}) }
      if (count !== expected) return false
    }
    return true
  } catch { return false }
}
export type SymbolSubmission = z.infer<typeof symbolSubmissionSchema>
export const symbolReceiptSchema = z.object({ id: symbolId, status: z.literal('received'), receivedAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }),
  consent: symbolSubmissionSchema.shape.consent.extend({ recordedAt: z.string().datetime({ offset: true }) }),
}).strict()
export type SymbolReceipt = z.infer<typeof symbolReceiptSchema>
