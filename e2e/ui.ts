import { expect, type Page } from '@playwright/test'

/** Follow the same disclosure path as a user without bypassing visibility checks. */
export async function openDisclosure(page: Page, selector: string) {
  const details = page.locator(selector)
  await details.waitFor({ state: 'visible' })
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click()
}

/** A new map clears its planning data and returns to the capture entry point. */
export async function expectEmptyMap(page: Page) {
  await expect(page.getByRole('heading', { name: 'Bring your next offer into focus.' })).toBeVisible()
  const workspace = await page.evaluate(() => JSON.parse(sessionStorage.getItem('fate-collector.advisor-area.v2')!))
  expect(workspace.collection.cards).toEqual([])
  expect(workspace.offerIds).toEqual([])
  expect(workspace.sources).toEqual({})
}
