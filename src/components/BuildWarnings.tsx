import type { FateCard } from '../../shared/schema'
import { UNRESOLVED_TRIPLE_RISK } from '../../shared/advisor'
import { assessPlanningCard, assessPlanningMerge, type PlanningFilters } from '../../shared/planning-filters'

export function BuildWarnings({ cards, filters, merges = [], planWarnings = [] }: { cards: FateCard[]; filters: PlanningFilters; merges?: { firstId: string }[]; planWarnings?: string[] }) {
  const warnings = [...new Set([...planWarnings.filter(warning => warning === UNRESOLVED_TRIPLE_RISK), ...cards.flatMap(card => {
    const assessment = merges.some(merge => merge.firstId === card.id) ? assessPlanningMerge(card, filters) : assessPlanningCard(card, filters)
    return [...assessment.reasons, ...assessment.warnings].map(message => `${card.name || 'Unnamed Fate'}: ${message}`)
  })])]
  return warnings.length ? <div className="storage-warning" aria-label="Build warnings"><strong>Check your build</strong><ul>{warnings.map(message => <li key={message}>{message}</li>)}</ul></div> : null
}
