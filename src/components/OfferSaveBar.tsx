import type { useOfferDraft } from '../lib/useOfferDraft'

export function OfferSaveBar({ editor, clearNotice }: { editor: ReturnType<typeof useOfferDraft>; clearNotice: () => void }) {
  const { draft, evidence, dirty, busy, autoSaving, savedLocally, automatic, canConfirm, needsConfirmation, canSave, autoSaveFailure, retryAutoSave, save } = editor
  const savedCurrent = savedLocally && !dirty
  const reviewMessage = draft.reviewed
    ? draft.completeness === 'partial' ? 'Reviewed · some cards are missing.' : 'Reviewed · all offered cards are included.'
    : 'Not reviewed yet.'
  const saveMessage = automatic && (autoSaving || dirty)
    ? autoSaving ? 'Saving your corrections…' : 'Your corrections have not been saved yet.'
    : savedCurrent && draft.reviewed ? 'Review saved. You can still correct a misread in Edit details.'
    : automatic ? 'Capture saved. Open Edit details only if something needs correcting.'
    : canConfirm ? draft.completeness === 'partial'
      ? 'Confirm the listed cards. This offer will stay marked as incomplete.'
      : 'Confirm all offered cards are listed correctly. Unknown rewards are OK.'
    : savedCurrent ? 'Capture saved. You can check the details later.'
    : evidence || draft.cards.length ? 'Save on this device. You can check the details later.'
    : 'Capture an offer to start reviewing.'
  return (evidence || draft.cards.length > 0 || dirty || savedLocally) && <div className="action-band" data-sticky={!automatic && canSave || undefined}><p>{saveMessage}<span className="save-state">{automatic ? `${reviewMessage} Corrections save on this device.` : savedCurrent ? `${reviewMessage} Saved on this device.` : 'Saving here does not upload changes.'}{draft.origin === 'test' ? ' Test capture.' : ''}</span></p>{automatic ? <div className="auto-save-actions">
          <span className="auto-save-state" role="status">{autoSaving ? 'Saving changes…' : autoSaveFailure ? autoSaveFailure.conflict ? 'Save conflict' : 'Save failed' : dirty ? 'Changes pending…' : 'Saved locally'}</span>
          {autoSaveFailure && !autoSaveFailure.conflict && <button className="outline-button" disabled={busy || autoSaving} onClick={() => { clearNotice(); retryAutoSave() }}>Retry save</button>}
        </div> : <div className="primary-actions"><button className="primary-button" onClick={() => void save(canConfirm ? 'confirm' : 'current')} disabled={!canSave}>{busy ? 'Working…' : savedCurrent && !needsConfirmation ? 'Saved' : canConfirm ? 'Confirm and save' : 'Save offer'}</button></div>}</div>
}
