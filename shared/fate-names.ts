export function normalizeFateName(name: string): string {
  const key = name.normalize().trim().toLowerCase().replace(/[\u2018\u2019\u201B\u02BC\uFF07]/g, "'").replace(/\s+/g, ' ')
  return key === 'rot' ? 'rotted' : key
}
