export type RewardSegments = 0 | 2 | 3

interface Pixels { width: number; data: Uint8ClampedArray }

// The matched motif is a 24 × 24 crop at 1080p. Its silver rim extends
// beyond that crop. Callers check the entire sampling area for clipping and masks.
export function readRewardSegments(image: Pixels, x: number, y: number, scale: number): RewardSegments | undefined {
  // At smaller scales a slit can be narrower than one source pixel.
  if (scale < 1) return
  function silverAt(px: number, py: number) {
    const i = (py * image.width + px) * 4
    const low = Math.min(image.data[i], image.data[i + 1], image.data[i + 2])
    const high = Math.max(image.data[i], image.data[i + 1], image.data[i + 2])
    return Math.max(0, low - 0.8 * (high - low))
  }
  function sample(px: number, py: number) {
    const left = Math.floor(px), top = Math.floor(py)
    const dx = px - left, dy = py - top
    const upper = silverAt(left, top) * (1 - dx) + silverAt(left + 1, top) * dx
    const lower = silverAt(left, top + 1) * (1 - dx) + silverAt(left + 1, top + 1) * dx
    return upper * (1 - dy) + lower * dy
  }

  // The RGB matcher locates the motif. Artwork and raster rounding can move
  // its centre slightly relative to the frame. Require multiple agreeing fits.
  let two = 0, three = 0
  for (const dx of [-1.5, -0.75, 0, 0.75, 1.5]) {
    for (const dy of [-1, -0.5, 0, 0.5, 1]) {
      const profile = rimRays.map(({ sx, sy }) => {
        const ray = (radius: number) => sample(x + (dx + sx * radius) * scale, y + (dy + sy * radius) * scale)
        return (ray(15.3) + ray(16) + ray(16.7)) / 3 - ray(19.8)
      })
      const segments = countSegments(profile)
      if (segments === 2) two++
      if (segments === 3) three++
    }
  }
  if (two >= 2 && three === 0) return 2
  if (three >= 2 && two === 0) return 3
  if (!two && !three && plainBronzeRim(image, x, y, scale)) return 0
}

// A regular reward has a continuous bronze edge in place of the silver arc.
// Absence of a readable silver pattern alone is insufficient (cursor, clipping, glare).
function plainBronzeRim(image: Pixels, x: number, y: number, scale: number) {
  for (const { sx, sy } of bronzeRays) {
    const pixel = (r: number) => {
      const px = Math.round(x + sx * r * scale), py = Math.round(y + sy * r * scale)
      return 4 * (py * image.width + px)
    }
    const { data } = image
    let copper = false
    const inner = pixel(11.5)
    const innerChroma = data[inner] - data[inner + 2]
    for (let r = 13; r <= 18; r += 0.5) {
      const i = pixel(r)
      const red = data[i], green = data[i + 1], blue = data[i + 2]
      if (Math.min(red, green, blue) > 48) return false
      if (red >= 25 && red - green >= 8 && red - blue >= 14 && red - blue >= innerChroma + 6) copper = true
    }
    if (!copper) return false
  }
  return true
}

// Follow the rim from left to right. Compare each ray to the background
// immediately outside it so a bright flat patch cannot stand in for an arc.
const first = -42, step = 2
const rimRays = Array.from({ length: 43 }, (_, i) => {
  const angle = (first + i * step) * Math.PI / 180
  return { sx: Math.sin(angle), sy: Math.cos(angle) }
})
const bronzeRays = rimRays.filter((_, i) => i % 3 === 0)

function countSegments(strength: number[]): 2 | 3 | undefined {
  const median = [...strength].sort((a, b) => a - b)[Math.floor(strength.length / 2)]
  if (median < 45) return
  const gaps: number[] = []
  for (let i = 0; i < strength.length; i++) {
    if (strength[i] >= median * 0.60) continue
    const start = i
    while (i + 1 < strength.length && strength[i + 1] < median * 0.60) i++
    // Require a narrow, deep notch bounded by visible silver on both sides.
    if (start === 0 || i === strength.length - 1 || i === start || i - start > 7
      || Math.min(...strength.slice(start, i + 1)) > median * 0.48) return
    gaps.push(first + (start + i) / 2 * step)
  }
  if (gaps.length === 1 && Math.abs(gaps[0]) <= 7) return 2
  if (gaps.length === 2 && Math.abs(gaps[0] + 23) <= 8 && Math.abs(gaps[1] - 23) <= 8) return 3
}
