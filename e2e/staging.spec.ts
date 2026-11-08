import { expect, test } from '@playwright/test'

test('staging remains visibly separate while navigating the collector', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { ingestionEnabled: true, environment: 'staging' } }))
  await page.goto('/')
  await expect(page.getByText('Test collection. Uploads go to the test database.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Saved offers', exact: true }).click()
  await expect(page.getByText('STAGING', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No offers here yet.' })).toBeVisible()
})
