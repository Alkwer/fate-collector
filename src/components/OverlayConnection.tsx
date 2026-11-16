import type { useOverlayConnection } from '../lib/useOverlayConnection'
import '../overlay.css'
import { isDesktop } from '../lib/desktop'

export function OverlayConnection({ overlay }: { overlay: ReturnType<typeof useOverlayConnection> }) {
  const desktop = isDesktop()
  return <section className="overlay-settings" aria-label="In-game overlay settings">
    <p>{desktop ? 'The helper runs the advisor locally. No browser tab or internet connection is needed for advice.' : 'Helper 0.7.0 includes a local advisor that works with your browser closed. Run the updated helper and open its local advisor from the tray. You can also use this website as the advisor.'} Use PoE in windowed or borderless mode.</p>
    <ol>
      <li>Run <strong>FateCollector.ahk</strong>.</li>
      <li>{desktop ? 'The local capture folder and overlay connect automatically. Keep the helper running.' : <>For website mode, select <strong>Use website advisor</strong> in the helper tray, then connect its <strong>captures</strong> folder below and allow read and write access.</>}</li>
      <li>Calibrate the Fate panel with <kbd>F6</kbd>/<kbd>F7</kbd> once. Keep it visible: the helper detects stable offers automatically. Confirm the area when prompted.</li>
    </ol>
    <p className="hint">Only overlay messages are written to the helper folder. Original captures stay unchanged. No cloud connection is needed.</p>
    <p>The helper scans while PoE is in front and the advisor is connected. Automatic captures stay local and are not added to cloud uploads. Unreadable or unknown names need a manual <kbd>F9</kbd> capture.</p>
    {!overlay.supported ? <p role="status">Overlay connection requires desktop Chrome or Edge on HTTPS or localhost.</p> : <div className="connection-actions">
      {overlay.status === 'active' ? <button onClick={() => void overlay.disconnect()}>Disconnect overlay</button> : <button disabled={overlay.status === 'connecting'} onClick={() => void overlay.connect()}>{overlay.status === 'connecting' ? 'Connecting overlay…' : desktop ? 'Reconnect local advisor' : 'Connect overlay folder'}</button>}
    </div>}
    {overlay.status === 'active' && <p role="status">{desktop ? 'Overlay connected. Closing this window keeps the advisor running. Exiting the helper stops it.' : 'Overlay connected. In website mode, keep this tab open. Closing or suspending it clears the advice after 12 seconds.'}</p>}
    {overlay.problem && <p className="field-error" role="alert">{overlay.problem}</p>}
    <h3>While playing</h3>
    <ul>
      <li><kbd>F9</kbd>: capture manually or refresh an offer.</li>
      <li><kbd>F10</kbd>: clear calibration and pause detection. Calibrate again with <kbd>F6</kbd>/<kbd>F7</kbd> to resume.</li>
      <li><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>Enter</kbd>: confirm the displayed area action.</li>
      <li><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>1–9</kbd>: record that numbered Fate while the offer is visible.</li>
      <li><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>N</kbd>: start a new area; press again to confirm.</li>
      <li><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>Z</kbd>: undo a collection change.</li>
      <li><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>O</kbd>: show or hide the overlay.</li>
    </ul>
    <p>Numbers follow the recognized offer order. Record the Fate you intend to choose while the panel is visible, then select it in game. These controls update your local collection; they do not click cards in the game. If you change your mind, undo the record.</p>
    <p>Disable or retry automatic detection with <strong>Auto-detect Fate cards</strong> in the helper tray. Closing the Fate panel clears automatic advice.</p>
    <p>Unknown rewards still need review in Fate Collector. Reward priorities, corrections and invocation planning are available in {desktop ? 'this local window' : 'the local advisor and website'}.</p>
    {overlay.preview && <div className="overlay-preview" aria-label="Current overlay message"><strong>{overlay.preview.title}</strong><p>{overlay.preview.detail}</p></div>}
  </section>
}
