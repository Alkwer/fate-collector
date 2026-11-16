import { z } from './validation'

export const OVERLAY_LIFETIME_MS = 12_000
export const OVERLAY_MAX_BYTES = 32_768
const id = z.string().uuid()
const timestamp = z.number().int().nonnegative()
export const overlayCaptureSchema = z.object({
  protocol: z.literal(1), captureId: id.nullable(),
  phase: z.enum(['capturing', 'saved', 'error', 'cancelled']), updatedAt: timestamp,
}).strict()
export const overlayStateSchema = z.object({
  protocol: z.literal(1), clientId: id, revision: id, writtenAt: timestamp,
  captureId: id.nullable(),
  status: z.enum(['idle', 'busy', 'confirm-area', 'ready', 'provisional', 'check', 'collected', 'error']),
  title: z.string().max(240), detail: z.string().max(1200),
  rows: z.array(z.object({ label: z.string().max(240), detail: z.string().max(500), recommended: z.boolean() }).strict()).max(9),
  actions: z.array(z.object({ id: z.string().min(1).max(80), label: z.string().max(160), slot: z.number().int().min(1).max(12) }).strict()).max(12),
  acknowledgedCommandId: id.nullable(), notice: z.string().max(300).nullable(),
}).strict()
export const overlayCommandSchema = z.object({
  protocol: z.literal(1), id, clientId: id, revision: id, captureId: id.nullable(),
  action: z.string().min(1).max(80), createdAt: timestamp,
}).strict()
export type OverlayCapture = z.infer<typeof overlayCaptureSchema>
export type OverlayState = z.infer<typeof overlayStateSchema>
export type OverlayCommand = z.infer<typeof overlayCommandSchema>
export type OverlayView = Pick<OverlayState, 'captureId' | 'status' | 'title' | 'detail' | 'rows' | 'actions'>

export function overlayFresh(timestamp: number, now = Date.now()): boolean {
  return timestamp <= now + 5000 && now - timestamp <= OVERLAY_LIFETIME_MS
}

export function acceptsOverlayCommand(command: OverlayCommand, state: OverlayState, now = Date.now()): boolean {
  return overlayFresh(state.writtenAt, now) && overlayFresh(command.createdAt, now)
    && command.clientId === state.clientId && command.revision === state.revision
    && command.captureId === state.captureId && command.id !== state.acknowledgedCommandId
    && state.actions.some(action => action.id === command.action)
}
