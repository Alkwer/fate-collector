import { expect, test } from 'vitest'
import { hasNewerHelper, HELPER_VERSION } from '../src/lib/helper-version'

test('update hint compares numeric versions without guessing for unknown or future helpers', () => {
  expect(hasNewerHelper('0.2.0')).toBe(true)
  expect(hasNewerHelper(HELPER_VERSION)).toBe(false)
  expect(hasNewerHelper('0.10.0')).toBe(false)
  expect(hasNewerHelper('1.0.0')).toBe(false)
  for (const version of [null, undefined, '', 'old', '0.3.0-preview', '9007199254740992.0.0']) expect(hasNewerHelper(version)).toBe(false)
})
