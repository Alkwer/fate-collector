// Regenerate helpers/overlay-icons.json after changing the verified combo art.
// The Windows renderer reads these PNGs offline without a WebP decoder.
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, watch: null } })
try {
  const { REWARD_CATALOG } = await vite.ssrLoadModule('/shared/reward-catalog.ts')
  const { rewardArt } = await vite.ssrLoadModule('/src/lib/game-art.ts')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const icons = {}
    for (const reward of REWARD_CATALOG.filter(entry => entry.kind === 'combo')) {
      const path = rewardArt(reward.label)
      if (!path) continue
      const bytes = await readFile(new URL('../public' + path, import.meta.url))
      icons[reward.label] = await page.evaluate(async data => {
        const img = new Image()
        img.src = data
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 32
        const scale = Math.min(canvas.width / img.width, canvas.height / img.height)
        const w = img.width * scale, h = img.height * scale
        const context = canvas.getContext('2d')
        context.imageSmoothingQuality = 'high'
        context.drawImage(img, (32 - w) / 2, (32 - h) / 2, w, h)
        return canvas.toDataURL('image/png').split(',')[1]
      }, `data:image/${path.endsWith('.png') ? 'png' : 'webp'};base64,${bytes.toString('base64')}`)
    }
    await writeFile(new URL('../helpers/overlay-icons.json', import.meta.url), JSON.stringify(icons, null, 2) + '\n')
  } finally { await browser.close() }
} finally { await vite.close() }
