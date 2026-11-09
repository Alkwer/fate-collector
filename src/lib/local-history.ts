// Read failures still propagate. A malformed record is isolated without deleting
// its credentials or allowing it to authorize an operation.
export function readLocalHistory<T>(prefix: string, parse: (value: unknown) => T, excluded: string[] = []) {
  const records: T[] = []
  let unreadableCount = 0
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
  for (const key of keys) {
    if (!key?.startsWith(prefix) || excluded.includes(key)) continue
    const raw = localStorage.getItem(key)
    if (raw === null) continue
    try { records.push(parse(JSON.parse(raw))) }
    catch { unreadableCount++ }
  }
  return { records, unreadableCount }
}
