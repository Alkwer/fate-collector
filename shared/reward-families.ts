// Display grouping only. Families never pool icons, thresholds or solver keys.
export function rewardFamily(label: string): string {
  const value = label.toLowerCase()
  if (value.includes('currency') || ['divine orb', 'orb of annulment', 'additional divine orbs', 'mirror shard', 'fracturing orb', "hinekora's lock"].includes(value)) return 'Currency'
  if (value.includes('rarity')) return 'Item rarity'
  if (value === 'amulets with a gem modifier') return 'Equipment'
  if (value.includes('gem')) return 'Gems'
  if (value.includes('viscera')) return 'Viscera'
  if (value.includes('thread')) return 'Threads'
  if (value.includes('stacked deck')) return 'Stacked decks'
  if (value.includes('gold')) return 'Gold'
  if (/\bmaps?\b/.test(value)) return 'Maps'
  if (/unique|sacrament|ordered fate|doedre|vendigo|corpse rose/.test(value)) return 'Unique items'
  if (/rare|armour|weapon|boot|shield|jewellery/.test(value)) return 'Equipment'
  return 'Other rewards'
}
