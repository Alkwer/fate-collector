import release from '../../shared/helper-release.json' with { type: 'json' }

export const HELPER_VERSION = release.version

export function hasNewerHelper(capturedVersion: string | null | undefined): boolean {
  if (!capturedVersion || !/^\d+\.\d+\.\d+$/.test(capturedVersion)) return false
  const current = HELPER_VERSION.split('.').map(Number)
  const captured = capturedVersion.split('.').map(Number)
  if (!captured.every(Number.isSafeInteger)) return false
  for (let index = 0; index < current.length; index++) {
    if (captured[index] !== current[index]) return captured[index] < current[index]
  }
  return false
}
