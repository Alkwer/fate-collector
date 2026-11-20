import { expect, test } from 'vitest'
import { extractCards } from '../shared/recognition'

const line = (text: string, x: number, y: number, width: number, height = 33) => ({ text, x, y, width, height })
const read = (lines: ReturnType<typeof line>[]) => extractCards({
  image: { width: 3840, height: 2160 },
  ocr: { status: 'ok', language: 'en-US', text: '', lines },
}).cards.map(c => [c.name, ...c.modifiers])

const controllerFooter = [line('Confirm', 1646, 2037, 148), line('Close', 1916, 2037, 94)]
const cards = [
  line('Torchbearer', 1288, 309, 227), line('Sadist', 1866, 309, 106), line('Tempest', 2356, 313, 158),
  line('Creates dangerous', 1274, 729, 263), line('bonfires of corpses', 1270, 766, 270),
  line('Spawns an additional', 1770, 729, 304), line('Boss from Campaign', 1776, 766, 292),
  line('Areas without an Atlas', 1759, 803, 326), line('equivalent', 1848, 840, 149),
  line('Creates volatile orbs of', 2274, 726, 332), line('lightning', 2376, 766, 128),
]
const coveredButton = [
  line('Fates', 1853, 102, 135, 43), ...cards,
  line('Empowered Monster fires a mortar', 634, 984, 855),
  line('Ice spikes proceed to where the mortar landed', 631, 1018, 1573),
  line('Black Frost', 1304, 1200, 200), ...controllerFooter,
]
test('disambiguates a world prompt just above Confirm and keeps it out of the middle caption', () => {
  const result = read([
    line('Fates', 1243, 71, 75, 24), line('Select a Fate', 1211, 639, 139, 20),
    line('CONFIRM', 1218, 692, 124, 17), line('2/4', 1076, 682, 36, 29),
    line('Conjurer.', 892, 209, 95, 22), line('Creates portals, which', 835, 485, 204, 21),
    line('release violent energies', 830, 509, 214, 22), line('Murderous', 1227, 209, 108, 18),
    line('Summons malignant', 1186, 486, 192, 22), line('crows', 1254, 515, 54, 12),
    line('Doomsayer', 1571, 210, 111, 22), line('Creates massive', 1553, 487, 147, 16),
    line('explosive blasts of', 1542, 510, 171, 21), line('blackfire', 1587, 534, 79, 18),
    line('Wildfire', 1000, 829, 95), line('Doomsayer', 1390, 829, 111),
  ])
  expect(result).toEqual([['Conjurer', 'Creates portals, which release violent energies'],
    ['Murderous', 'Summons malignant crows'], ['Doomsayer', 'Creates massive explosive blasts of blackfire']])
})

test('reads only the upper row when tooltip text covers the controller button', () => {
  expect(read(coveredButton).map(c => c[0])).toEqual(['Torchbearer', 'Sadist', 'Tempest'])
  for (const marker of ['Close', 'Black Frost', 'Creates dangerous', 'Ice spikes proceed to where the mortar landed']) {
    expect(read(coveredButton.filter(l => l.text !== marker))).toEqual([])
  }
  expect(read([...coveredButton, line('Invoke Fates', 1780, 85, 280)])).toEqual([])
})

const sadistCaption = 'Spawns an additional Boss from Campaign Areas without an Atlas equivalent'
const coveredNames = [
  line('CONFIRM', 1829, 1037, 181), line('1/4', 1615, 1021, 51, 45),
  line('Houndmaster', 1019, 262, 254), line('Creates spectral wolves', 980, 682, 335),
  line('which explode into ice', 984, 719, 326), line('Fires rapid icy darts', 1525, 729, 279),
  line('Spawns an additional', 2029, 729, 304), line('Boss from Campaign', 2035, 767, 293),
  line('Areas without an Atlas', 2018, 803, 326), line('equivalent', 2107, 840, 149),
  line('Creates leylines of', 2568, 729, 262), line('lightning', 2634, 766, 129),
  line('Empowered Monster summons Spectral Wolves', 1417, 224, 2024, 43),
  line('Black Frost', 1820, 1239, 200),
]
test('preserves the slot and caption when two covered names share the same short description', () => {
  expect(read(coveredNames)).toEqual([
    ['Houndmaster', 'Creates spectral wolves which explode into ice'], ['Avalanche', 'Fires rapid icy darts'],
    ['', sadistCaption], ['Stormcaller', 'Creates leylines of lightning'],
  ])
  for (const marker of ['Black Frost', 'Fires rapid icy darts', 'Empowered Monster summons Spectral Wolves']) {
    expect(read(coveredNames.filter(l => l.text !== marker))).toEqual([])
  }
  expect(read([...coveredNames, line('Tempest', 2060, 309, 200)])).toEqual([])
})

test('uses the hovered tooltip name only for the uniquely raised matching column', () => {
  const lines = coveredNames.map(l => ['Spawns an additional','Boss from Campaign','Areas without an Atlas','equivalent'].includes(l.text)
    ? { ...l, y: l.y - 60 } : { ...l, y: ['Creates spectral wolves','which explode into ice'].includes(l.text) ? l.y + 47 : l.y })
  const tooltip = line('Sadist', 1417, 121, 123, 38)
  expect(read([...lines, tooltip])[2]).toEqual(['Sadist', sadistCaption])
  expect(read([...coveredNames, tooltip])[2]).toEqual(['', sadistCaption])
})

test.each(['Sadist', 'Pestilent'])('accepts a recovered %s nameplate in the shared-caption column', name => {
  const printed = line(name, 2124, 308, 106)
  expect(read([...coveredNames, printed])[2]).toEqual([name, sadistCaption])
})
