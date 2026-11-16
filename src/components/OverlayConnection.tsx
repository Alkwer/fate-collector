import type { useOverlayConnection } from '../lib/useOverlayConnection'
import '../overlay.css'

export function OverlayConnection({ overlay }: { overlay: ReturnType<typeof useOverlayConnection> }) {
  return <section className="overlay-settings" aria-label="In-game overlay settings">
    <p>See Fate advice beside the game while this website stays open. Use the updated Windows helper in windowed or borderless mode.</p>
    <ol>
      <li>Run <strong>FateCollector.ahk</strong>.</li>
      <li>Connect its <strong>captures</strong> folder below and allow read and write access. This also connects local review.</li>
      <li>Return to the game and press <kbd>F9</kbd>. Confirm the area, then record your in-game choice with the displayed shortcut.</li>
    </ol>
    <p className="hint">Only overlay messages are written to the helper folder. Original captures stay unchanged. No cloud connection is needed.</p>
    {!overlay.supported ? <p role="status">Overlay connection requires desktop Chrome or Edge on HTTPS or localhost.</p> : <div className="connection-actions">
      {overlay.status === 'active' ? <button onClick={() => void overlay.disconnect()}>Disconnect overlay</button> : <button disabled={overlay.status === 'connecting'} onClick={() => void overlay.connect()}>{overlay.status === 'connecting' ? 'Connecting overlay…' : 'Connect overlay folder'}</button>}
    </div>}
    {overlay.status === 'active' && <p role="status">Overlay connected. Keep this tab open. Closing or suspending it clears the advice after 12 seconds.</p>}
    {overlay.problem && <p className="field-error" role="alert">{overlay.problem}</p>}
    <h3>While playing</h3>
    <ul>
      <li><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>Enter</kbd>: confirm the displayed area action.</li>
      <li><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>1–9</kbd>: record that numbered Fate after choosing it in game.</li>
      <li><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>N</kbd>: start a new area; press again to confirm.</li>
      <li><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>Z</kbd>: undo a collection change.</li>
      <li><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>O</kbd>: show or hide the overlay.</li>
    </ul>
    <p>Numbers follow the recognized offer order. Check the Fate name before recording a choice. These controls update your local collection; they do not click cards in the game.</p>
    <p>Unknown rewards still need review on the website. Reward priorities, corrections and invocation planning remain available there.</p>
    {overlay.preview && <div className="overlay-preview" aria-label="Current overlay message"><strong>{overlay.preview.title}</strong><p>{overlay.preview.detail}</p></div>}
  </section>
}
