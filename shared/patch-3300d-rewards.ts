export const PATCH_3300D_SOURCE = 'https://www.pathofexile.com/forum/view-thread/4017726'

export const singleOrbRewards = [
  { id: 'divine-orb', label: 'Divine Orb' },
  { id: 'orb-of-annulment', label: 'Orb of Annulment' },
].map(entry => ({
  ...entry, kind: 'combo' as const, threshold: 2,
  description: `Invoke two matching reward copies to guarantee one ${entry.label}.`,
  source: PATCH_3300D_SOURCE, sourceLabel: 'GGG 3.30.0d patch notes',
}))

// Apply the previous three-copy rule's replacement only when planning.
export function currentComboThreshold(normalizedLabel: string, recorded: number | null) {
  if (recorded !== 3) return recorded
  return singleOrbRewards.find(entry => entry.label.toLowerCase() === normalizedLabel)?.threshold ?? recorded
}
