import { getPoedbFate } from './poedb-catalog.ts'
import type { FateCard } from './schema.ts'
import { z } from './validation.ts'

const riskAction = z.enum(['allow', 'warn', 'exclude']).optional()

export const riskSettingsSchema = z.strictObject({
  physicalDot: riskAction,
  fireDot: riskAction,
  brittleCrit: riskAction,
  chaos: riskAction,
  bleeding: riskAction,
  curses: riskAction,
  bossRecovery: riskAction,
  extraBoss: riskAction,
})

export type FateRiskSettings = z.infer<typeof riskSettingsSchema>

export const RISK_CATEGORIES = [
  { id: 'physicalDot', label: 'Physical damage over time', description: 'Effects that explicitly deal physical damage over time.' },
  { id: 'fireDot', label: 'Fire damage over time', description: 'Ground and wall effects that deal fire damage over time.' },
  { id: 'brittleCrit', label: 'Brittle and critical strikes', description: 'Bosses that inflict Brittle or gain critical strike chance or multiplier.' },
  { id: 'chaos', label: 'Chaos damage and poison', description: 'Chaos damage, poison and Withered effects.' },
  { id: 'bleeding', label: 'Bleeding', description: 'Effects that inflict or amplify bleeding.' },
  { id: 'curses', label: 'Curses', description: 'Curses that the encounter applies to players.' },
  { id: 'bossRecovery', label: 'Boss life recovery', description: 'Life regeneration, leech or recovery for the empowered monster.' },
  { id: 'extraBoss', label: 'Additional boss', description: 'Effects that spawn a companion boss.' },
] as const satisfies ReadonlyArray<{ id: keyof FateRiskSettings; label: string; description: string }>

const modifierPatterns: Record<keyof FateRiskSettings, RegExp> = {
  physicalDot: /\bphysical damage over time\b/i,
  fireDot: /\b(?:deals?|dealing) (?:heavy )?fire damage over time\b/i,
  brittleCrit: /(?:\b(?:inflicts?|inflicting|applies) brittle|\b\d+% increased (?:global )?critical strike chance|\+\d+% to (?:global )?critical strike multiplier)\b/i,
  chaos: /\b(?:chaos damage(?! (?:taken|resistance)\b)|poisons? on hit|(?:inflicts?|inflicting|can) poison|inflicts? withered)\b/i,
  bleeding: /\b(?:(?:inflicts?|inflicting|causes?) bleed(?:ing)?|bleed(?:ing)? on hit|increased bleeding (?:damage|duration))\b/i,
  curses: /\b(?:(?:curses?|cursing) (?:enemies|players)|(?:enemies|players|you) (?:are|is) cursed with|(?:inflicts?|applies) (?:flammability|conductivity|frostbite|vulnerability|despair|elemental weakness|temporal chains|enfeeble|punishment))\b/i,
  bossRecovery: /\b(?:(?:regenerates?|recovers?) (?:\d+(?:[.,]\d+)?% of (?:maximum )?)?life|(?:leech|leeches) (?:a percentage of )?damage dealt as life|damage leeched as life|life regeneration)\b/i,
  extraBoss: /\b(?:additional|companion|extra|second) boss\b/i,
}

export function assessFateRisk(card: FateCard, settings: FateRiskSettings, effectiveTier = card.tier) {
  const reasons: string[] = []
  const warnings: string[] = []
  const active = RISK_CATEGORIES.filter(({ id }) => settings[id] === 'warn' || settings[id] === 'exclude')
  if (active.length === 0) return { excluded: false, reasons, warnings }

  const modifiers = card.modifiers.map(line => line.normalize().trim().replace(/\s+/g, ' ')).filter(Boolean)
  const reference = card.tier !== null && card.visualReview?.tierReviewed !== false
    ? getPoedbFate(card.name, effectiveTier)
    : undefined
  const referenceText = reference ? [...reference.description.split('\n'), ...reference.effects] : []

  if (effectiveTier !== card.tier && !reference) {
    warnings.push('Merged Fate risk is unverified. Its Tier 3 effects have no matching source reference; recorded input modifiers do not establish the upgraded effects.')
  } else if (modifiers.length === 0 && !reference) {
    warnings.push('Build risk is unverified. This Fate has no recorded modifiers or matching Tier 3 source reference.')
  }

  for (const { id, label } of active) {
    const pattern = modifierPatterns[id]
    const recorded = modifiers.some(modifier => pattern.test(modifier))
    const fromReference = !recorded && referenceText.some(line => pattern.test(line))
    if (!recorded && !fromReference) continue

    const message = recorded ? `${label} (recorded modifier).` : `${label} (Tier 3 source reference, PoEDB).`
    const messages = settings[id] === 'exclude' ? reasons : warnings
    messages.push(message)
  }

  return { excluded: reasons.length > 0, reasons, warnings }
}
