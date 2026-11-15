import { afterEach, expect, test, vi } from 'vitest'
import { forceCloseDatabase, IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { readSymbolDrafts, readSymbolHistoryPage } from '../src/lib/symbol-report-storage'

const name = 'fate-collector-symbol-reports'
function browser() {
  const factory = new IDBFactory()
  vi.stubGlobal('indexedDB', factory)
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  vi.stubGlobal('location', { origin: 'https://collector.test' })
  return factory
}
function opened(request: IDBOpenDBRequest) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

test('concurrent history and draft reads share one open, including subsequent refreshes', async () => {
  const factory = browser(), open = vi.spyOn(factory, 'open')
  const [history, drafts] = await Promise.all([readSymbolHistoryPage(), readSymbolDrafts()])
  expect(history.rows).toEqual([])
  expect(drafts).toEqual([])
  await readSymbolHistoryPage()
  expect(open).toHaveBeenCalledTimes(1)
})

test('an external deletion closes the cached connection and the next read opens the new database', async () => {
  const factory = browser()
  await readSymbolHistoryPage()
  await opened(factory.deleteDatabase(name))
  expect((await readSymbolHistoryPage()).rows).toEqual([])
})

test('unexpected browser connection closure is recovered without reloading the page', async () => {
  const factory = browser(), nativeOpen = factory.open.bind(factory)
  let connection: IDBDatabase | undefined
  vi.spyOn(factory, 'open').mockImplementation((...args) => {
    const request = nativeOpen(...args)
    request.addEventListener('success', () => { connection = request.result })
    return request
  })
  await readSymbolHistoryPage()
  const closed = new Promise(resolve => connection!.addEventListener('close', resolve, { once: true }))
  // fake-indexeddb 6.2.7 incorrectly types this instance argument as a constructor.
  const forceClose = forceCloseDatabase as unknown as (database: IDBDatabase) => void
  forceClose(connection!)
  await closed
  expect(await readSymbolDrafts()).toEqual([])
})

test('a blocked upgrade discards its late connection and allows a fresh retry', async () => {
  const factory = browser(), request = factory.open(name, 1)
  request.onupgradeneeded = () => request.result.createObjectStore('reports', { keyPath: 'id' })
  const old = await opened(request)
  await expect(readSymbolHistoryPage()).rejects.toThrow('Close other collector tabs')
  old.close()
  expect((await readSymbolHistoryPage()).rows).toEqual([])
  // A leaked late connection would block deletion here.
  await opened(factory.deleteDatabase(name))
})

test('a synchronous open failure does not poison later attempts', async () => {
  const factory = browser()
  vi.spyOn(factory, 'open').mockImplementationOnce(() => { throw new DOMException('Storage unavailable', 'SecurityError') })
  await expect(readSymbolHistoryPage()).rejects.toThrow('Storage unavailable')
  expect(await readSymbolDrafts()).toEqual([])
})
