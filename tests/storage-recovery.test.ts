import 'fake-indexeddb/auto'
import { expect, test } from 'vitest'
import { exampleOffer } from '../shared/offers'
import type { Evidence } from '../shared/schema'
import { listOffers, saveOffer, readOfferHistory, readOfferRecovery, readOfferArchive, getOffer } from '../src/lib/storage'

test('a malformed offer is isolated, exported verbatim and never removed by listing or backup', async () => {
  const good = await saveOffer(exampleOffer(), null)
  const badId = crypto.randomUUID()
  const malformed = { offer: { id: badId, captureId: badId, revision: 'damaged' }, uploadedRevision: null, uploadedAt: null }
  const evidence: Evidence = { id: badId, imageDataUrl: 'data:image/png;base64,AAAA', ocrText: 'Original evidence', ocrLines: [], ocrStatus: 'ok', helperVersion: '0.3.3' }
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('fate-collector', 3)
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
  })
  const transaction = database.transaction(['offers', 'evidence'], 'readwrite')
  transaction.objectStore('offers').put(malformed)
  transaction.objectStore('evidence').put(evidence)
  await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error) })
  expect(await listOffers()).toEqual([good])
  expect((await readOfferHistory()).unreadable).toMatchObject([{ key: badId }])
  const backup: unknown[] = []
  expect(await readOfferArchive(true, entry => backup.push(entry))).toEqual({ offers: 1, omittedOffers: 1, missingEvidence: 0, damagedEvidence: 0 })
  expect(backup).toEqual([{ offer: good.offer, evidence: null }])
  expect(await readOfferRecovery()).toMatchObject({ kind: 'fate-collector.recovery', records: [{ key: badId, value: malformed }], evidence: [{ key: badId, value: evidence }] })
  expect(await getOffer(good.offer.id)).toEqual(good)
  const preserved = await new Promise(resolve => {
    const request = database.transaction('offers').objectStore('offers').get(badId)
    request.onsuccess = () => resolve(request.result)
  })
  expect(preserved).toEqual(malformed)
  database.close()
})
