import 'fake-indexeddb/auto'
import { expect, test } from 'vitest'
import { newOffer } from '../shared/offers'
import { getOffer, hasCaptureReceipt } from '../src/lib/storage'

test('upgrading the existing version-1 journal preserves saved offers', async () => {
  const offer = newOffer()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('fate-collector', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('offers', { keyPath: 'offer.id' })
      request.result.createObjectStore('evidence', { keyPath: 'id' })
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const transaction = request.result.transaction('offers', 'readwrite')
      transaction.objectStore('offers').put({ offer, uploadedRevision: null, uploadedAt: null })
      transaction.oncomplete = () => { request.result.close(); resolve() }
      transaction.onerror = () => reject(transaction.error)
    }
  })
  expect((await getOffer(offer.id))?.offer).toEqual(offer)
  expect(await hasCaptureReceipt(offer.id)).toBe(false)
})
