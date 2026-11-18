// Published outcomes. The patch does not give chase reward kinds, set sizes or icon mappings.
export const PATCH_3300C_SOURCE = 'https://www.pathofexile.com/forum/view-thread/4017172'
export const chaseRewards = [
  { id: 'additional-divine-orbs', label: 'Additional Divine Orbs', description: 'The empowered monster drops additional Divine Orbs.' },
  { id: 'mirror-shard', label: 'Mirror Shard', description: 'The empowered monster drops a Mirror Shard.' },
  { id: 'fracturing-orb', label: 'Fracturing Orb', description: 'The empowered monster drops a Fracturing Orb.' },
  { id: 'hinekoras-lock', label: "Hinekora's Lock", description: "The empowered monster drops a Hinekora's Lock." },
  { id: 'amulets-with-a-gem-modifier', label: 'Amulets with a Gem Modifier', description: 'Amulets dropped by the empowered monster have a Gem modifier.' },
].map(entry => ({ ...entry, description: `${entry.description} Found in high-tier maps.` }))

// The regular additional-rare variants for shields and body armours were recorded
// before the modifier replacement. The other two had only PoEDB effect references.
const equipmentReplacements = [
  { slot: 'Body Armours', previous: 'Life', current: 'Defence', kind: 'regular' },
  { slot: 'Shields', previous: 'Life', current: 'Defence', kind: 'regular' },
  { slot: 'Helmets', previous: 'Defence', current: 'Life', kind: 'unknown' },
  { slot: 'Gloves', previous: 'Defence', current: 'Life', kind: 'unknown' },
] as const

export const replacedEquipmentLabels = new Set(equipmentReplacements.map(row =>
  `Rare ${row.slot} without ${row.previous} Modifiers`))

export const patchEquipmentRewards = equipmentReplacements.map(row => ({
  id: `rare-${row.slot.toLowerCase().replaceAll(' ', '-')}-with-a-${row.current.toLowerCase()}-modifier`,
  label: `Rare ${row.slot} with a ${row.current} Modifier`,
  description: `Empowered Monster will drop additional Rare ${row.slot}. ${row.slot} dropped by Empowered Monster will have a ${row.current} modifier.`,
  kind: row.kind, threshold: null,
}))

export function equipmentCorrection(description: string) {
  for (const row of equipmentReplacements) {
    const previous = `${row.slot} dropped by Empowered Monster will have no ${row.previous} modifiers`
    if (description.includes(previous)) return {
      label: `${description.includes('will drop additional Rare ') ? 'Rare ' : ''}${row.slot} with a ${row.current} Modifier`,
      description: description.replace(previous, `${row.slot} dropped by Empowered Monster will have a ${row.current} modifier`),
    }
  }
}
