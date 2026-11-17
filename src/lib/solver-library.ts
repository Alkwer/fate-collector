import { z } from '../../shared/validation'
import { newSolverSettings, parseSolverSettings, selectedRewardGoal, serializeSolverSettings, solverSettingsSchema, SOLVER_SETTINGS_KEY, type SolverSettings } from './solver-settings'
import type { AdvisorGoal } from '../../shared/advisor'

export const SOLVER_LIBRARY_KEY = 'fate-collector.solver-library.v1'
export const MAX_SAVED_PROFILES = 20
export const MAX_PROFILE_NAME = 60
export const MAX_LIBRARY_BYTES = 1_500_000
const nameKey = (name: string) => name.trim().normalize('NFKC').toLowerCase()
const profileName = z.string().trim().min(1).max(MAX_PROFILE_NAME)
export const solverLibrarySchema = z.object({
  kind: z.literal('fate-collector.solver-library'), schemaVersion: z.literal(1),
  activeProfileId: z.string().uuid(),
  profiles: z.array(z.object({ id: z.string().uuid(), name: profileName, settings: solverSettingsSchema }).strict()).min(1).max(MAX_SAVED_PROFILES),
}).strict().refine(library => library.profiles.some(row => row.id === library.activeProfileId)
  && new Set(library.profiles.map(row => row.id)).size === library.profiles.length
  && new Set(library.profiles.map(row => nameKey(row.name))).size === library.profiles.length,
'Profiles need distinct names and IDs, and an existing active profile.')
export type SolverLibrary = z.infer<typeof solverLibrarySchema>
export type ProfileAction = { type: 'select'; id: string } | { type: 'rename'; name: string } | { type: 'new' | 'duplicate' | 'delete' }

export function newSolverLibrary(settings = newSolverSettings(), legacyGoal: AdvisorGoal | null = null): SolverLibrary {
  const id = crypto.randomUUID()
  return { kind: 'fate-collector.solver-library', schemaVersion: 1, activeProfileId: id,
    profiles: [{ id, name: 'My build', settings: { ...settings, singleGoal: selectedRewardGoal(settings, legacyGoal) } }] }
}
export function activeProfile(library: SolverLibrary) {
  return library.profiles.find(row => row.id === library.activeProfileId)!
}
function validate(library: SolverLibrary) {
  const parsed = solverLibrarySchema.parse(library)
  for (const row of parsed.profiles) {
    row.settings.singleGoal ??= null
    serializeSolverSettings(row.settings)
  }
  return parsed
}
export function parseSolverLibrary(text: string): SolverLibrary {
  if (new TextEncoder().encode(text).byteLength > MAX_LIBRARY_BYTES) throw new Error('Profile library is too large (1.5 MB maximum).')
  try { return validate(JSON.parse(text)) }
  catch { throw new Error('Invalid profile library. Use 1–20 profiles with distinct names, valid settings and an active profile.') }
}
export function serializeSolverLibrary(library: SolverLibrary) {
  const text = JSON.stringify(validate(library), null, 2)
  if (new TextEncoder().encode(text).byteLength > MAX_LIBRARY_BYTES) throw new Error('Profile library is too large (1.5 MB maximum).')
  return text
}
export function changeActiveSettings(library: SolverLibrary, settings: SolverSettings): SolverLibrary {
  return { ...library, profiles: library.profiles.map(row => row.id === library.activeProfileId ? { ...row, settings: { ...settings, singleGoal: settings.singleGoal ?? null } } : row) }
}
export function updateSolverLibrary(library: SolverLibrary, action: ProfileAction): SolverLibrary {
  const active = activeProfile(library)
  if (action.type === 'select') {
    if (!library.profiles.some(row => row.id === action.id)) throw new Error('That profile is no longer available. Reload saved profiles.')
    return { ...library, activeProfileId: action.id }
  }
  if (action.type === 'rename') {
    const name = profileName.safeParse(action.name)
    if (!name.success) throw new Error('Enter a profile name with 1–60 characters.')
    if (library.profiles.some(row => row.id !== active.id && nameKey(row.name) === nameKey(name.data))) throw new Error('A profile with that name already exists. Choose another name.')
    return { ...library, profiles: library.profiles.map(row => row.id === active.id ? { ...row, name: name.data } : row) }
  }
  if (action.type === 'delete') {
    if (library.profiles.length === 1) throw new Error('Keep at least one profile. Create another before deleting this one.')
    const profiles = library.profiles.filter(row => row.id !== active.id)
    return { ...library, profiles, activeProfileId: profiles[0].id }
  }
  if (library.profiles.length === MAX_SAVED_PROFILES) throw new Error('Your library holds 20 profiles. Delete one before adding another.')
  const id = crypto.randomUUID()
  const base = action.type === 'new' ? 'New build' : `${active.name.slice(0, MAX_PROFILE_NAME - 8)} copy`
  let name = base, index = 2
  while (library.profiles.some(row => nameKey(row.name) === nameKey(name))) name = `${base} ${index++}`
  const settings = action.type === 'new' ? { ...newSolverSettings(), singleGoal: null } : parseSolverSettings(serializeSolverSettings(active.settings))
  return { ...library, activeProfileId: id, profiles: [...library.profiles, { id, name, settings }] }
}

interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface LibraryState {
  library: SolverLibrary
  raw: string | null
  legacyRaw: string | null
  unreadable: boolean
  recovery: string | null
  unsaved: boolean
  error: string | null
}
export function readSolverLibrary(storage: Storage, legacyGoal: AdvisorGoal | null = null): LibraryState {
  let raw: string | null = null, legacyRaw: string | null = null
  try {
    raw = storage.getItem(SOLVER_LIBRARY_KEY)
    if (raw === null) legacyRaw = storage.getItem(SOLVER_SETTINGS_KEY)
  } catch { return { library: newSolverLibrary(), raw, legacyRaw, unreadable: false, recovery: null, unsaved: false, error: 'Browser profile storage is unavailable. Export your profiles before leaving.' } }
  try {
    const library = raw === null ? newSolverLibrary(legacyRaw === null ? newSolverSettings() : parseSolverSettings(legacyRaw), legacyGoal) : parseSolverLibrary(raw)
    return { library, raw, legacyRaw, unreadable: false, recovery: null, unsaved: false, error: null }
  } catch {
    return { library: newSolverLibrary(), raw, legacyRaw, unreadable: true, recovery: raw ?? legacyRaw, unsaved: false,
      error: 'Your saved profiles could not be read. The stored copy is unchanged. Export the stored copy before restoring a library backup or resetting.' }
  }
}
export function writeSolverLibrary(storage: Storage, library: SolverLibrary, previous: Pick<LibraryState, 'raw' | 'legacyRaw'>) {
  try {
    const raw = serializeSolverLibrary(library)
    if (storage.getItem(SOLVER_LIBRARY_KEY) !== previous.raw
      || (previous.raw === null && storage.getItem(SOLVER_SETTINGS_KEY) !== previous.legacyRaw)) {
      return { raw: previous.raw, conflict: true, error: 'The profiles changed in another tab. Export your current library or reload saved profiles before editing.' }
    }
    // One atomic write includes the active selection and every profile. Keep the legacy backup intact.
    storage.setItem(SOLVER_LIBRARY_KEY, raw)
    return { raw, conflict: false, error: null }
  } catch {
    return { raw: previous.raw, conflict: false, error: 'The profiles could not be saved. Keep this tab open or export the library before leaving.' }
  }
}
