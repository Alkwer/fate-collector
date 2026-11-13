import type { Capture, Offer } from './schema.ts'

export const AREA_CATEGORY_LABELS = { campaign: 'Campaign', map: 'Map', other: 'Other', unknown: 'Unknown' } as const

// Apply source context only when creating a draft; saved corrections take precedence.
export function capturedAreaFields(context: Capture['context']): Pick<Offer, 'area' | 'areaLevel' | 'areaCategory'> {
  const area = context?.captureMode === 'game' ? context.area : undefined
  return { area: area?.areaId ?? '', areaLevel: area?.areaLevel ?? null, areaCategory: area?.category ?? 'unknown' }
}
