import type { FateCard } from './schema'
import { assessFateRisk, type FateRiskSettings } from './fate-risk'

export type PlanningFilters = { risks?: FateRiskSettings; avoidModifiers?: string[]; excludedCardIds?: string[] }

export function assessPlanningCard(card: FateCard, filters: PlanningFilters) {
  const risk = assessFateRisk(card, filters.risks ?? {})
  const reasons = [...risk.reasons]
  if (filters.excludedCardIds?.includes(card.id)) reasons.push('Excluded from planning.')
  for (const phrase of filters.avoidModifiers ?? []) {
    if (card.modifiers.some(line => line.normalize().toLowerCase().includes(phrase.normalize().toLowerCase()))) reasons.push(`Modifier matches “${phrase}”.`)
  }
  const warnings = [...risk.warnings]
  if (filters.avoidModifiers?.length && !card.modifiers.some(line => line.trim())) warnings.push('A Fate has no recorded modifiers. Its modifier safety is unverified.')
  return { excluded: reasons.length > 0, reasons, warnings }
}

export function assessPlanningMerge(card: FateCard, filters: PlanningFilters) {
  return assessFateRisk(card, filters.risks ?? {}, 3)
}
