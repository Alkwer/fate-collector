import { afterEach, expect, test, vi } from 'vitest'
import { forceCloseDatabase, IDBFactory } from 'fake-indexeddb'
import { newOffer } from '../shared/offers'
import { listOffers, saveOffer } from '../src/lib/storage'

const name = 'fate-collector'
function browser() {
  const factory = new IDBFactory()
  vi.stubGlobal('indexedDB', factory)
  return factory
}
function opened(request: IDBOpenDBRequest) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

test('unexpected closure reopens the offer archive and retains existing records', async () => {
  const factory = browser(), nativeOpen = factory.open.bind(factory)
  let database: IDBDatabase | undefined
  const open = vi.spyOn(factory, 'open').mockImplementation((...args) => {
    const request = nativeOpen(...args)
    request.addEventListener('success', () => { database = request.result })
    return request
  })
  const saved = await saveOffer(newOffer(), null)
  expect(await listOffers()).toEqual([saved])
  expect(open).toHaveBeenCalledTimes(1)
  const closed = new Promise(resolve => database!.addEventListener('close', resolve, { once: true }))
  // fake-indexeddb currently declares the constructor instead of the instance.
  const forceClose = forceCloseDatabase as unknown as (database: IDBDatabase) => void
  forceClose(database!)
  await closed
  expect(await listOffers()).toEqual([saved])
  expect(open).toHaveBeenCalledTimes(2)
})

test('a blocked upgrade closes its late connection and a retry is usable', async () => {
  const factory = browser()
  const request = factory.open(name, 1)
  request.onupgradeneeded = () => request.result.createObjectStore('offers', { keyPath: 'offer.id' })
  const old = await opened(request)
  await expect(listOffers()).rejects.toThrow('Close other Fate Collector tabs')
  old.close()
  expect(await listOffers()).toEqual([])
  await opened(factory.deleteDatabase(name))
  expect(await listOffers()).toEqual([])
})

test('a synchronous open failure is retryable', async () => {
  const factory = browser()
  vi.spyOn(factory, 'open').mockImplementationOnce(() => { throw new DOMException('Storage unavailable', 'SecurityError') })
  await expect(listOffers()).rejects.toThrow('Storage unavailable')
  expect(await listOffers()).toEqual([])
})
