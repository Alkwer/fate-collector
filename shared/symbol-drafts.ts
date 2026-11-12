import { z } from 'zod'
import { SYMBOL_REPORT_LIMIT, symbolId, symbolReportSchema, validateSymbolPixels } from './symbol-reports'

/** Local helper handoff only. It carries no upload consent, credentials or destination. */
export const symbolDraftSchema = z.object({
  kind: z.literal('fate-collector.symbol-draft'), schemaVersion: z.literal(1), id: symbolId,
  createdAt: z.string().datetime({ offset: true }), helperVersion: z.string().min(1).max(40),
  origin: z.enum(['live', 'test']), captureId: symbolId.nullable(),
  icon: symbolReportSchema.shape.icon, tooltip: symbolReportSchema.shape.tooltip,
}).strict()
export type SymbolDraft = z.infer<typeof symbolDraftSchema>

export async function parseSymbolDraft(text: string): Promise<SymbolDraft> {
  if (text.length > SYMBOL_REPORT_LIMIT || new TextEncoder().encode(text).byteLength > SYMBOL_REPORT_LIMIT) {
    throw new Error('This helper draft is too large. Capture tighter symbol and tooltip crops.')
  }
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('Copy a symbol draft from the helper, then paste it here.') }
  const parsed = symbolDraftSchema.safeParse(value)
  if (!parsed.success || !await validateSymbolPixels(parsed.data)) {
    throw new Error('This helper draft is damaged or unsupported. Capture the symbol and tooltip again with the latest helper.')
  }
  return parsed.data
}
