import type { Archive } from './schema'

export function duplicateBackupOffer(id: string, firstRevision: number, secondRevision: number): Error {
  return new Error(`Duplicate offer ID ${id} (revisions ${firstRevision} and ${secondRevision}). Keep the original backup files and select one version of this offer before importing. Nothing was imported.`)
}

export function assertUniqueBackupOffers(offers: Archive['offers']): void {
  const revisions = new Map<string, number>()
  for (const { offer } of offers) {
    const id = offer.id.toLowerCase()
    const revision = revisions.get(id)
    if (revision !== undefined) throw duplicateBackupOffer(id, revision, offer.revision)
    revisions.set(id, offer.revision)
  }
}

export function combineBackupParts(inputs: Archive[]): Archive {
  if (!inputs.length || inputs.length > 250) throw new Error('Choose between 1 and 250 backup files.')
  const archives = [...inputs]
  const metadata = archives.flatMap(archive => archive.backup ? [archive.backup] : [])
  if (metadata.length) {
    if (metadata.length !== archives.length) throw new Error('Select parts of one backup set, without unrelated exports.')
    const first = metadata[0]
    if (metadata.some(part => part.setId !== first.setId || part.total !== first.total)) throw new Error('These files belong to different backup sets.')
    const numbers = new Set(metadata.map(part => part.part))
    if (numbers.size !== metadata.length) throw new Error('The same backup part was selected more than once.')
    if (numbers.size !== first.total) throw new Error(`Incomplete backup: selected ${numbers.size} of ${first.total} parts. Select every part of this set.`)
    archives.sort((a, b) => a.backup!.part - b.backup!.part)
  }
  const offers = archives.flatMap(archive => archive.offers)
  assertUniqueBackupOffers(offers)
  if (offers.length > 250) throw new Error('A combined backup may contain at most 250 offers.')
  return { kind: 'fate-collector.export', schemaVersion: 1, offers }
}
