import { expect, type Page } from '@playwright/test'

export async function closePanels(page: Page) {
  while (await page.locator('.detail-dialog[open]').count()) await page.keyboard.press('Escape')
}

/** Open secondary work through its visible action and leave the map undisturbed. */
export async function openPanel(page: Page, selector: string) {
  const panel = page.locator(selector)
  if (await panel.locator(':scope > .detail-dialog[open]').count()) return
  const actions: Record<string, string | RegExp> = {
    '.advanced-panel': 'Edit details',
    '.map-capture-connection': /^(Connect captures folder|Local review connected|Folder access needed|Local review needs attention)$/,
  }
  if (actions[selector]) {
    await openPanel(page, '.more-actions')
    await page.locator('.more-actions > .detail-dialog').getByRole('button', { name: actions[selector], exact: true }).click()
  } else {
    await closePanels(page)
    await panel.locator(':scope > .panel-trigger').click()
  }
  await expect(panel.locator(':scope > .detail-dialog')).toBeVisible()
}

export async function toggleEditor(page: Page) {
  if (await page.locator('.advanced-panel > .detail-dialog[open]').count()) await closePanels(page)
  else await openPanel(page, '.advanced-panel')
}

export async function selectRewardGoal(page: Page, goal: string) {
  await openPanel(page, '.reward-settings')
  await page.getByLabel('Compare multiple rewards', { exact: true }).uncheck()
  await page.getByRole('combobox', { name: 'Reward goal', exact: true }).selectOption(goal)
}

/** A new map clears its planning data and returns to the capture entry point. */
export async function expectEmptyMap(page: Page) {
  await expect(page.getByRole('heading', { name: 'Bring your next offer into focus.' })).toBeVisible()
  const workspace = await page.evaluate(() => JSON.parse(sessionStorage.getItem('fate-collector.advisor-area.v2')!))
  expect(workspace.collection.cards).toEqual([])
  expect(workspace.offerIds).toEqual([])
  expect(workspace.sources).toEqual({})
}
