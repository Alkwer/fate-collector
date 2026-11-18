import { normalizeRewardLabel } from '../../shared/advisor'
import { z } from '../../shared/validation'

export const PROMISED_PROFITS_SOURCE = 'https://poedb.tw/us/Promised_Profits'
export const OVERPOWERING_OMENS_SOURCE = 'https://poedb.tw/us/Overpowering_Omens'

// Covens of Umbra (3.30) challenge objectives. Reward labels here refer to
// tooltip-backed catalog entries and are independent of the visual motifs.
export const profitObjectives = [
  { id: 'unique', label: 'Unique Item', target: 30, rewards: ['Unique Armour', 'Unique Flask', 'Unique Jewellery Item', 'Unique Weapon', 'Unique Jewel', 'Valuable Unique Jewellery Item', "Dreadmaidens' Sacrament", 'Hide of the Vendigo', 'Corpse Rose', 'Ordered Fate'] },
  { id: 'gem', label: 'Gem', target: 30, rewards: ['Exceptional Gem', 'Gem with Quality', 'Additional Gems with Quality', 'Additional Gems, Some with Maximum Quality'] },
  { id: 'rarity', label: 'Increased Item Rarity', target: 30, rewards: ['Item Rarity', 'Increased Item Rarity', 'Highly Increased Item Rarity', 'Greatly Increased Item Rarity', 'Massively Increased Item Rarity'] },
  { id: 'currency', label: 'Currency Items', target: 30, rewards: ['Additional Currency Items', 'Additional Valuable Currency Items'] },
  { id: 'viscera', label: 'Viscera Item', target: 30, rewards: ['Viscera Item'] },
  { id: 'threads', label: 'Threads', target: 30, rewards: ['Additional Threads', 'Many Additional Threads'] },
  { id: 'decks', label: 'Stacked Decks', target: 30, rewards: ['Additional Stacked Decks', 'Many Additional Stacked Decks'] },
  { id: 'gold', label: 'Gold', target: 30, rewards: ['Gold', 'Hoards of Gold'] },
  { id: 'maps', label: 'Maps', target: 30, rewards: ['Rare Map'] },
  { id: 'equipment', label: 'Fated Equipment', target: 60, rewards: ['Rare Body Armours without Life Modifiers', 'Rare Body Armours with a Life Modifier', 'Rare Boots with a Resistance Modifier', 'Rare Boots with a Speed Modifier', 'Rare Gloves with a Defence Modifier', 'Rare Gloves with an Attack Modifier', 'Rare Helmets with a Defence Modifier', 'Rare Helmets with a Drop Modifier', 'Rare Shields with a Life Modifier', 'Rare Shields with a Resistance Modifier', 'Rare Shields without Life Modifiers'] },
  { id: 'dreadmaidens', label: "Dreadmaidens' Sacrament", target: 1, rewards: ["Dreadmaidens' Sacrament"] },
  { id: 'vendigo', label: 'Hide of the Vendigo', target: 1, rewards: ['Hide of the Vendigo'] },
  { id: 'corpse-rose', label: 'Corpse Rose', target: 1, rewards: ['Corpse Rose'] },
  { id: 'ordered-fate', label: 'Ordered Fate', target: 1, rewards: ['Ordered Fate'] },
  { id: 'doedres', label: "Doedre's Tongue", target: 1, rewards: ["Doedre's Tongue"] },
] as const

export const omenMaps = [
  'Maze of the Minotaur', 'Lair of the Hydra', 'Pit of the Chimera', 'Forge of the Phoenix',
  'Map occupied by the Constrictor', 'Map occupied by the Purifier',
  'Map occupied by the Enslaver', 'Map occupied by the Eradicator',
  "Map contains Baran's Citadel", "Map contains Veritania's Citadel",
  "Map contains Drox's Citadel", "Map contains Al-Hezmin's Citadel",
  'Abomination', 'Citadel', 'Fortress', 'Sanctuary', 'Ziggurat',
] as const

export const leagueGoalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('profit'), objective: z.enum(profitObjectives.map(row => row.id)) }).strict(),
  z.object({ kind: z.literal('omen'), map: z.enum(omenMaps) }).strict(),
]).nullable()
export type LeagueGoal = z.infer<typeof leagueGoalSchema>

export function profitRewardLabels(id: string) {
  return new Set(profitObjectives.find(row => row.id === id)?.rewards.map(normalizeRewardLabel))
}
