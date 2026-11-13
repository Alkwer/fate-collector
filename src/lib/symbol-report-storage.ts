import { z } from '../../shared/validation'
import { offerSchema } from '../../shared/schema'
import { SYMBOL_REPORT_LIMIT, symbolId, symbolReceiptSchema, symbolReportSchema, symbolSubmissionSchema, symbolToken, type SymbolSubmission } from '../../shared/symbol-reports'

const origin = z.string().url()
const timestamp = z.string().datetime({ offset: true })
const reportMetadata = z.strictObject({
  kind: symbolReportSchema.shape.kind, schemaVersion: symbolReportSchema.shape.schemaVersion,
  id: symbolId, createdAt: timestamp, offer: symbolReportSchema.shape.offer, label: symbolReportSchema.shape.label,
  rewardKind: symbolReportSchema.shape.rewardKind, threshold: symbolReportSchema.shape.threshold, description: symbolReportSchema.shape.description,
}).refine(report => report.rewardKind === 'combo' || report.threshold === null)
const imagesSchema = z.strictObject({ icon: symbolReportSchema.shape.icon, tooltip: symbolReportSchema.shape.tooltip })
const summarySchema = z.strictObject({
  id: symbolId, origin, report: reportMetadata, token: symbolToken, consent: symbolSubmissionSchema.shape.consent,
  receipt: symbolReceiptSchema.nullable(), withdrawRequestedAt: timestamp.nullable(), withdrawnAt: timestamp.nullable(),
  expired: z.boolean(), hasImages: z.boolean(), createdMs: z.number().int(),
}).refine(row => row.id === row.report.id && row.createdMs === Date.parse(row.report.createdAt)
  && (!row.withdrawnAt || !!row.withdrawRequestedAt)
  && (!row.receipt || (row.receipt.id === row.id && row.receipt.consent.version === row.consent.version
    && row.receipt.consent.text === row.consent.text && row.receipt.consent.acceptedAt === row.consent.acceptedAt
    && row.receipt.consent.recordedAt === row.receipt.receivedAt)))
const legacySchema = z.strictObject({
  id: symbolId, origin, submission: symbolSubmissionSchema, receipt: symbolReceiptSchema.nullable(),
  withdrawRequestedAt: timestamp.nullable(), withdrawnAt: timestamp.nullable(), expired: z.boolean().optional(),
})
export type LocalSymbolReport = z.infer<typeof legacySchema>
type Summary = z.infer<typeof summarySchema>
export type SymbolHistoryRow = Pick<Summary, 'id' | 'receipt' | 'withdrawRequestedAt' | 'withdrawnAt' | 'expired' | 'hasImages'> & {
  createdAt: string
  label: string
}
export type SymbolHistoryCursor = [string, number, string]
export type DamagedSymbolRecord = { key: IDBValidKey; store: 'reports' | 'summaries' | 'images' }
export const SYMBOL_HISTORY_PAGE_SIZE = 20
const MAX_LOCAL_DRAFTS = 30
const draftSchema = z.strictObject({
  id: symbolId, origin, revision: symbolId, updatedAt: timestamp, context: offerSchema, cardId: symbolId, rewardId: z.union([symbolId, z.literal('')]),
  label: z.string().max(160), rewardKind: symbolReportSchema.shape.rewardKind, threshold: z.string().max(32),
  description: z.string().max(2000), gameVersion: z.string().max(64),
  icon: imagesSchema.shape.icon.nullable(), tooltip: imagesSchema.shape.tooltip.nullable(),
  fromHelper: z.boolean(), linkedOffer: z.boolean(),
}).refine(draft => draft.context.cards.some(card => card.id === draft.cardId
  && (!draft.rewardId || card.rewards.some(reward => reward.id === draft.rewardId))))
export type LocalSymbolDraft = z.infer<typeof draftSchema>

function split(submission: SymbolSubmission, state: Pick<Summary, 'origin' | 'receipt' | 'withdrawRequestedAt' | 'withdrawnAt' | 'expired'>) {
  const { icon, tooltip, ...report } = submission.report
  const summary: Summary = { ...state, id: report.id, report, token: submission.token, consent: submission.consent, hasImages: true, createdMs: Date.parse(report.createdAt) }
  return { summary, images: { icon, tooltip } }
}

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('fate-collector-symbol-reports', 2)
    request.onupgradeneeded = () => {
      const db = request.result
      const legacy = db.objectStoreNames.contains('reports') ? request.transaction!.objectStore('reports') : db.createObjectStore('reports', { keyPath: 'id' })
      const summaries = db.createObjectStore('summaries', { keyPath: 'id' })
      summaries.createIndex('history', ['origin', 'createdMs', 'id'])
      const images = db.createObjectStore('images')
      db.createObjectStore('drafts')
      const migration = legacy.openCursor()
      migration.onsuccess = () => {
        const cursor = migration.result
        if (!cursor) return
        const parsed = legacySchema.safeParse(cursor.value)
        if (parsed.success) {
          const { id, submission, expired, ...state } = parsed.data
          const row = split(submission, { ...state, expired: !!expired })
          if (id === row.summary.id && cursor.primaryKey === id && summarySchema.safeParse(row.summary).success) {
            summaries.add(row.summary)
            images.add(row.images, id)
            cursor.delete()
          }
        }
        cursor.continue()
      }
    }
    let blocked = false
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      if (blocked) db.close()
      else resolve(db)
    }
    request.onerror = () => reject(new Error('Symbol report storage is unavailable. Keep the images and retry.'))
    request.onblocked = () => { blocked = true; reject(new Error('Close other collector tabs and retry.')) }
  })
}

function read<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function transact<T>(stores: string[], mode: IDBTransactionMode, run: (transaction: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await database()
  const transaction = db.transaction(stores, mode)
  const complete = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(new Error('Could not save symbol report data. Keep the images and retry.'))
  })
  void complete.catch(() => {})
  try {
    const result = await run(transaction)
    await complete
    return result
  } catch (error) {
    try { transaction.abort() } catch { /* Transaction already finished. */ }
    await complete.catch(() => {})
    throw error
  } finally { db.close() }
}

const changeEvent = 'fate-collector-symbol-history-changed'
function changed() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(changeEvent))
  try {
    const channel = new BroadcastChannel(changeEvent)
    channel.postMessage('changed')
    channel.close()
  } catch { /* Focus refresh remains available. */ }
}
export function onSymbolHistoryChange(listener: () => void) {
  let channel: BroadcastChannel | undefined
  try {
    channel = new BroadcastChannel(changeEvent)
    channel.onmessage = listener
  } catch { /* Focus refresh remains available. */ }
  window.addEventListener(changeEvent, listener)
  window.addEventListener('focus', listener)
  return () => { channel?.close(); window.removeEventListener(changeEvent, listener); window.removeEventListener('focus', listener) }
}

export async function readSymbolHistoryPage(before?: SymbolHistoryCursor) {
  return transact(['reports', 'summaries'], 'readonly', async transaction => {
    const summaries = transaction.objectStore('summaries')
    const index = summaries.index('history')
    const [legacyKeys, summaryKeys, indexedKeys] = await Promise.all([
      read(transaction.objectStore('reports').getAllKeys()), read(summaries.getAllKeys()), read(index.getAllKeys()),
    ])
    // IndexedDB skips malformed compound keys. Check only primary keys here,
    // so damaged metadata remains recoverable without scanning image records.
    const indexed = new Set(indexedKeys.map(key => JSON.stringify(key)))
    const damaged: DamagedSymbolRecord[] = [
      ...legacyKeys.map(key => ({ store: 'reports' as const, key })),
      ...summaryKeys.filter(key => !indexed.has(JSON.stringify(key))).map(key => ({ store: 'summaries' as const, key })),
    ]
    const range = IDBKeyRange.bound([location.origin, -Infinity], before ?? [location.origin, Infinity], false, !!before)
    return new Promise<{ rows: SymbolHistoryRow[]; damaged: DamagedSymbolRecord[]; next: SymbolHistoryCursor | null }>((resolve, reject) => {
      const rows: SymbolHistoryRow[] = []
      let next: SymbolHistoryCursor | null = null
      const request = index.openCursor(range, 'prev')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) { resolve({ rows, damaged, next: null }); return }
        const parsed = summarySchema.safeParse(cursor.value)
        if (!parsed.success || cursor.primaryKey !== parsed.data.id) damaged.push({ store: 'summaries', key: cursor.primaryKey })
        else {
          if (rows.length === SYMBOL_HISTORY_PAGE_SIZE) { resolve({ rows, damaged, next }); return }
          const { id, report, receipt, withdrawRequestedAt, withdrawnAt, expired, hasImages } = parsed.data
          rows.push({ id, createdAt: report.createdAt, label: report.label, receipt, withdrawRequestedAt, withdrawnAt, expired, hasImages })
          next = cursor.key as SymbolHistoryCursor
        }
        cursor.continue()
      }
    })
  })
}

async function summaryById(transaction: IDBTransaction, id: string) {
  const summary = summarySchema.safeParse(await read(transaction.objectStore('summaries').get(id)))
  if (!summary.success || summary.data.id !== id || summary.data.origin !== location.origin) throw new Error('This saved symbol report is unavailable.')
  return summary.data
}
async function readImages(transaction: IDBTransaction, summary: Summary) {
  if (!summary.hasImages) return null
  return imagesSchema.safeParse(await read(transaction.objectStore('images').get(summary.id))).data ?? null
}
export async function readSymbolReportDetails(id: string) {
  return transact(['summaries', 'images'], 'readonly', async transaction => {
    const summary = await summaryById(transaction, id)
    const images = await readImages(transaction, summary)
    return { report: summary.report, consent: summary.consent, images, damagedImages: summary.hasImages && !images }
  })
}
export async function checkSymbolUpload(id: string) {
  return transact(['summaries'], 'readonly', async transaction => {
    const row = await summaryById(transaction, id)
    assertSymbolCanUpload(row)
  })
}
function assertSymbolCanUpload(row: Summary) {
  if (row.withdrawRequestedAt) throw new Error('This report has a withdrawal request; it will not be sent.')
  if (row.expired || (row.receipt && Date.parse(row.receipt.expiresAt) <= Date.now())) throw new Error('This report expired or was removed from the collection.')
  if (!row.hasImages) throw new Error('The saved images are unavailable.')
}
export async function readSymbolSubmission(id: string) {
  return transact(['summaries', 'images'], 'readonly', async transaction => {
    const row = await summaryById(transaction, id)
    assertSymbolCanUpload(row)
    const images = await readImages(transaction, row)
    if (!images) throw new Error('The saved images are unavailable.')
    return { report: { ...row.report, ...images }, token: row.token, consent: row.consent }
  })
}
export async function updateSymbolSummary(id: string, change: (row: Summary) => Summary) {
  const updated = await transact(['summaries'], 'readwrite', async transaction => {
    const row = change(await summaryById(transaction, id))
    await read(transaction.objectStore('summaries').put(row))
    return row
  })
  changed()
  return updated
}

export async function saveSymbolSubmission(submission: SymbolSubmission, expectedDraftRevision?: string | null): Promise<LocalSymbolReport> {
  submission = symbolSubmissionSchema.parse(submission)
  if (new TextEncoder().encode(JSON.stringify(submission)).length > SYMBOL_REPORT_LIMIT) throw new Error('Images are too large. Crop them more tightly and retry.')
  const state = { origin: location.origin, receipt: null, withdrawRequestedAt: null, withdrawnAt: null }
  const { summary, images } = split(submission, { ...state, expired: false })
  await transact(['reports', 'summaries', 'images', 'drafts'], 'readwrite', async transaction => {
    if (await read(transaction.objectStore('reports').getKey(summary.id)) !== undefined) throw new Error('A damaged report already uses this ID.')
    const drafts = transaction.objectStore('drafts')
    const draft = await read(drafts.get(summary.id)) as LocalSymbolDraft | undefined
    if (expectedDraftRevision !== undefined && (draft?.revision ?? null) !== expectedDraftRevision) {
      throw new Error('This draft changed in another tab. Reopen the saved draft before sending.')
    }
    await read(transaction.objectStore('summaries').add(summary))
    await read(transaction.objectStore('images').add(images, summary.id))
    await read(drafts.delete(summary.id))
  })
  changed()
  return { id: summary.id, submission, ...state }
}

// Retain the complete-row API for callers that explicitly need the original upload payload.
export async function symbolReportHistory(): Promise<LocalSymbolReport[]> {
  return transact(['summaries', 'images'], 'readonly', async transaction => {
    const rows = await read(transaction.objectStore('summaries').getAll())
    const result: LocalSymbolReport[] = []
    for (const raw of rows) {
      const parsed = summarySchema.safeParse(raw)
      if (!parsed.success || parsed.data.origin !== location.origin) continue
      const { id, origin, report, token, consent, receipt, withdrawRequestedAt, withdrawnAt, expired } = parsed.data
      const images = await readImages(transaction, parsed.data)
      if (images) result.push({ id, origin, submission: { report: { ...report, ...images }, token, consent }, receipt, withdrawRequestedAt, withdrawnAt, expired })
    }
    return result.sort((a, b) => Date.parse(b.submission.report.createdAt) - Date.parse(a.submission.report.createdAt))
  })
}

export function canCleanSymbolImages(row: SymbolHistoryRow | Summary) {
  return row.hasImages && (!!row.withdrawnAt || row.expired || (!!row.receipt && Date.parse(row.receipt.expiresAt) <= Date.now()))
}
export async function readSymbolReviewCredential(id: string) {
  return transact(['summaries'], 'readonly', async transaction => {
    const row = await summaryById(transaction, id)
    if (!row.receipt || row.withdrawRequestedAt || row.expired || Date.parse(row.receipt.expiresAt) <= Date.now()) {
      throw new Error('Review status is available for active received reports.')
    }
    return row.token
  })
}
export async function cleanSymbolImages(id: string) {
  await transact(['summaries', 'images'], 'readwrite', async transaction => {
    const row = await summaryById(transaction, id)
    if (!canCleanSymbolImages(row)) throw new Error('Only withdrawn or expired reports can have their local images removed.')
    await read(transaction.objectStore('summaries').put({ ...row, hasImages: false }))
    await read(transaction.objectStore('images').delete(id))
  })
  changed()
}

export async function exportDamagedSymbol({ store, key }: DamagedSymbolRecord) {
  return transact(store === 'summaries' ? [store, 'images'] : [store], 'readonly', async transaction => {
    const raw = await read(transaction.objectStore(store).get(key))
    if (raw === undefined) throw new Error('This unreadable entry is no longer saved.')
    return { kind: 'fate-collector.damaged-symbol-record', schemaVersion: 1, origin: location.origin, store, key, raw,
      ...(store === 'summaries' && { images: await read(transaction.objectStore('images').get(key)) }) }
  })
}
export async function removeDamagedSymbol({ store, key }: DamagedSymbolRecord) {
  await transact(store === 'reports' ? [store] : ['summaries', 'images'], 'readwrite', async transaction => {
    const source = transaction.objectStore(store), raw = await read(source.get(key))
    if (store === 'images') {
      if (typeof key !== 'string' || imagesSchema.safeParse(raw).success) throw new Error('The saved images are readable.')
      const summary = await summaryById(transaction, key)
      await read(transaction.objectStore('summaries').put({ ...summary, hasImages: false }))
      await read(source.delete(key))
      return
    }
    const parsed = summarySchema.safeParse(raw)
    if (store === 'summaries' && parsed.success && parsed.data.id === key) throw new Error('This report is readable. Open it in history instead.')
    await read(source.delete(key))
    if (store === 'summaries') await read(transaction.objectStore('images').delete(key))
  })
  changed()
}

export async function readSymbolDrafts() {
  const rows = await transact(['drafts'], 'readonly', transaction => read(transaction.objectStore('drafts').getAll()))
  return rows.flatMap(raw => {
    const parsed = draftSchema.safeParse(raw)
    return parsed.success && parsed.data.origin === location.origin ? [parsed.data] : []
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
export async function writeSymbolDraft(draft: LocalSymbolDraft, expectedRevision: string | null) {
  const parsed = draftSchema.safeParse(draft)
  if (!parsed.success) throw new Error('The symbol draft has invalid details. Check the fields before closing.')
  draft = parsed.data
  if (draft.origin !== location.origin) return false
  return transact(['drafts', 'summaries'], 'readwrite', async transaction => {
    const drafts = transaction.objectStore('drafts')
    const saved = await read(drafts.get(draft.id)) as LocalSymbolDraft | undefined
    if (saved && (saved.origin !== draft.origin || saved.revision !== expectedRevision)) return false
    if (await read(transaction.objectStore('summaries').getKey(draft.id)) !== undefined || (!saved && expectedRevision !== null)) return false
    if (!saved && await read(drafts.count()) >= MAX_LOCAL_DRAFTS) throw new Error('Discard an unused symbol draft to free a local draft slot.')
    await read(drafts.put(draft, draft.id))
    return true
  })
}
export async function discardSymbolDraft(draft: LocalSymbolDraft) {
  return transact(['drafts'], 'readwrite', async transaction => {
    const drafts = transaction.objectStore('drafts')
    const saved = await read(drafts.get(draft.id)) as LocalSymbolDraft | undefined
    if (saved?.id !== draft.id || saved.origin !== location.origin || saved.revision !== draft.revision) return false
    await read(drafts.delete(draft.id))
    return true
  })
}

export const SYMBOL_RECOVERY_LIMIT_BYTES = 64 * 1024 * 1024
const MAX_RECOVERY_REPORTS = 10000
const recoveryRowSchema = z.strictObject({ summary: summarySchema, images: imagesSchema.nullable() })
  .refine(row => row.summary.hasImages === !!row.images)
const recoverySchema = z.strictObject({
  kind: z.literal('fate-collector.private-symbol-backup'), schemaVersion: z.literal(1), origin,
  reports: z.array(recoveryRowSchema).max(MAX_RECOVERY_REPORTS), drafts: z.array(draftSchema).max(MAX_LOCAL_DRAFTS),
})
export type SymbolRecovery = z.infer<typeof recoverySchema>
function byteLength(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)).length }
export function parseSymbolRecovery(value: unknown): SymbolRecovery {
  if (byteLength(value) > SYMBOL_RECOVERY_LIMIT_BYTES) throw new Error('This private symbol backup is too large.')
  const parsed = recoverySchema.safeParse(value)
  if (!parsed.success) throw new Error('This file is not a readable private symbol backup.')
  const backup = parsed.data
  if (backup.origin !== location.origin || backup.reports.some(row => row.summary.origin !== backup.origin) || backup.drafts.some(draft => draft.origin !== backup.origin)) {
    throw new Error('This private backup belongs to a different collector address.')
  }
  const ids = [...backup.reports.map(row => row.summary.id), ...backup.drafts.map(draft => draft.id)]
  if (new Set(ids).size !== ids.length) throw new Error('This private backup contains duplicate report IDs.')
  return backup
}

export async function exportSymbolRecovery(): Promise<SymbolRecovery> {
  return transact(['summaries', 'images', 'drafts'], 'readonly', async transaction => {
    const store = transaction.objectStore('summaries')
    const drafts = (await read(transaction.objectStore('drafts').getAll())).flatMap(raw => {
      const parsed = draftSchema.safeParse(raw)
      return parsed.success && parsed.data.origin === location.origin ? [parsed.data] : []
    })
    const backup: SymbolRecovery = { kind: 'fate-collector.private-symbol-backup', schemaVersion: 1, origin: location.origin, reports: [], drafts }
    let bytes = byteLength(backup)
    if (bytes > SYMBOL_RECOVERY_LIMIT_BYTES) throw new Error('This private symbol backup is too large.')
    for (const raw of await read(store.getAll())) {
      const parsed = summarySchema.safeParse(raw)
      if (!parsed.success || parsed.data.origin !== location.origin) continue
      const summary = parsed.data
      // A damaged image must not prevent backing up an otherwise usable withdrawal credential.
      const images = await readImages(transaction, summary)
      const row = { summary: { ...summary, hasImages: !!images }, images }
      bytes += byteLength(row) + 1
      if (bytes > SYMBOL_RECOVERY_LIMIT_BYTES || backup.reports.length === MAX_RECOVERY_REPORTS) throw new Error('This private symbol backup is too large. Remove local images from ended reports and try again.')
      backup.reports.push(row)
    }
    return backup
  })
}

export async function importSymbolRecovery(value: unknown): Promise<{ restored: number; conflicts: number }> {
  const backup = parseSymbolRecovery(value)
  const result = await transact(['reports', 'summaries', 'images', 'drafts'], 'readwrite', async transaction => {
    const summaries = transaction.objectStore('summaries'), images = transaction.objectStore('images'), damaged = transaction.objectStore('reports'), drafts = transaction.objectStore('drafts')
    let restored = 0, conflicts = 0
    for (const incoming of backup.reports) {
      const { id } = incoming.summary
      const [raw, damagedKey] = await Promise.all([read(summaries.get(id)), read(damaged.getKey(id))])
      if (damagedKey !== undefined || await read(drafts.getKey(id)) !== undefined) { conflicts++; continue }
      if (raw === undefined) {
        await read(summaries.add(incoming.summary))
        if (incoming.images) await read(images.add(incoming.images, id))
        restored++
        continue
      }
      const parsed = summarySchema.safeParse(raw)
      if (!parsed.success) { conflicts++; continue }
      const current = parsed.data, next = incoming.summary
      const same = current.origin === next.origin && current.token === next.token && JSON.stringify(current.report) === JSON.stringify(next.report)
        && JSON.stringify(current.consent) === JSON.stringify(next.consent)
      if (!same) { conflicts++; continue }
      if (current.hasImages && incoming.images) {
        const localImages = await readImages(transaction, current)
        if (JSON.stringify(localImages) !== JSON.stringify(incoming.images)) { conflicts++; continue }
      }
      await read(summaries.put({
        ...current, receipt: current.receipt || next.receipt,
        withdrawRequestedAt: current.withdrawRequestedAt || next.withdrawRequestedAt,
        withdrawnAt: current.withdrawnAt || next.withdrawnAt, expired: current.expired || next.expired,
      }))
      restored++
    }
    for (const draft of backup.drafts) {
      if (await read(drafts.getKey(draft.id)) === undefined && await read(summaries.getKey(draft.id)) === undefined && await read(drafts.count()) < MAX_LOCAL_DRAFTS) {
        await read(drafts.add({ ...draft, revision: crypto.randomUUID() }, draft.id))
        restored++
      } else conflicts++
    }
    return { restored, conflicts }
  })
  changed()
  return result
}
