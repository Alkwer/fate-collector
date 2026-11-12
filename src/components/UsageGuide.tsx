import { useEffect, useRef, useState } from 'react'
import { AppIcon } from './AppIcon'
import '../usage-guide.css'

const chapters = [
  ['install', '1. Install the helper'],
  ['frame', '2. Frame the panel'],
  ['capture', '3. Capture an offer'],
  ['play', '4. Choose & invoke'],
  ['data', 'Backups & sharing'],
  ['problems', 'Troubleshooting'],
] as const

function CalibrationDiagram() {
  const [step, setStep] = useState(0)
  const instructions = [
    'Move the pointer to the upper-left corner of the whole Fate panel, then press F6.',
    'Move the pointer to the lower-right corner, then press F7. Keep the heading, every offered card and Confirm inside.',
    'Press F8 to preview the saved frame in game. If anything is outside it, repeat F6 and F7.',
  ]
  return <figure className="guide-calibration">
    <div className="guide-demo-controls" role="group" aria-label="Calibration diagram steps">
      {['F6 · First corner', 'F7 · Second corner', 'F8 · Preview'].map((label, index) => <button key={label} type="button" aria-pressed={step === index} onClick={() => setStep(index)}>{label}</button>)}
    </div>
    <div className="guide-frame-diagram" data-step={step} aria-hidden="true">
      <span className="guide-corner guide-corner-start">F6</span>
      <div className="guide-panel-outline">
        <span>Fate panel heading</span>
        <div className="guide-diagram-cards"><span>Card<br />+ text</span><span>Card<br />+ text</span><span>Card<br />+ text</span></div>
        <span>Confirm</span>
      </div>
      <span className="guide-corner guide-corner-end">F7</span>
    </div>
    <p className="guide-demo-instruction" aria-live="polite">{instructions[step]}</p>
    <figcaption>Click the steps to explore this diagram. It does not control the helper or the game.</figcaption>
  </figure>
}

export function UsageGuide({ onConnect, onMap, onSaved, onDiagnostics }: {
  onConnect: () => void; onMap: () => void; onSaved: () => void; onDiagnostics: () => void
}) {
  const contents = useRef<HTMLElement>(null)
  useEffect(() => {
    document.querySelector<HTMLElement>('.page-heading h1')?.focus()
    window.scrollTo(0, 0)
  }, [])
  function jump(id: string) {
    const heading = document.getElementById(`guide-${id}`)
    heading?.focus({ preventScroll: true })
    heading?.scrollIntoView({ block: 'start' })
  }
  return <div className="usage-guide">
    <nav className="guide-contents" ref={contents} aria-label="Guide sections">
      <strong>In this guide</strong>
      {chapters.map(([id, label]) => <button key={id} type="button" aria-controls={`guide-${id}`} onClick={() => jump(id)}>{label}</button>)}
      <p>Set up once. Then capture each new offer with <kbd>F9</kbd>.</p>
    </nav>
    <div className="guide-article">
      <section className="guide-section" aria-labelledby="guide-install">
        <h2 id="guide-install" tabIndex={-1}>1. Install the helper</h2>
        <p>You need Windows 10/11. Use desktop Chrome or Edge for automatic folder import; other browsers can import files manually.</p>
        <ol>
          <li>Install <a href="https://www.autohotkey.com/" target="_blank" rel="noreferrer">AutoHotkey v2</a>.</li>
          <li>Click <strong>Download Windows helper</strong> at the top of this page. Right-click the ZIP, choose <strong>Extract All</strong> and keep all the extracted files together in a writable folder.</li>
          <li>Double-click <code>FateCollector.ahk</code> in that folder. Leave it running. Its tray icon is near the Windows clock, sometimes under <strong>Show hidden icons</strong>.</li>
        </ol>
        <p className="guide-check"><AppIcon name="check" /><span>Right-click the helper’s tray icon and choose <strong>Open capture folder</strong>. This is the <code>captures</code> folder you will connect to the website.</span></p>
        <p className="hint">The helper uses built-in Windows PowerShell 5.1 and an installed Windows OCR language to read text. No cloud key is needed for local use.</p>
      </section>

      <section className="guide-section" aria-labelledby="guide-frame">
        <h2 id="guide-frame" tabIndex={-1}>2. Frame the Fate panel</h2>
        <p>Open a Fate offer in Path of Exile in <strong>windowed or borderless windowed</strong> mode. Keep the game in front and the whole panel visible on one monitor.</p>
        <CalibrationDiagram />
        <p>The helper remembers the frame between sessions. After a resolution change, check it with <kbd>F8</kbd>. Repeat <kbd>F6</kbd>/<kbd>F7</kbd> after changing the aspect ratio, UI scale or panel position. <kbd>F10</kbd> clears the frame and cancels an active capture.</p>
      </section>

      <section className="guide-section" aria-labelledby="guide-capture">
        <h2 id="guide-capture" tabIndex={-1}>3. Connect the folder and capture</h2>
        <ol>
          <li>Open <strong>Local review</strong> below, click <strong>Connect folder</strong> and select the helper’s <code>captures</code> folder. Allow read access. Existing captures in that folder will also be imported.</li>
          <li>Return to the game. Move the pointer away from cards so tooltips do not cover their text, then press <kbd>F9</kbd> once for the new offer.</li>
          <li>Wait for the helper’s <strong>Capture saved</strong> message, then open <strong>Current map</strong> on the website to inspect it.</li>
        </ol>
        <div className="guide-actions"><button className="primary-button" onClick={onConnect}>Open local review</button><button onClick={onMap}>Open current map</button></div>
        <figure className="guide-flow">
          <ol><li><AppIcon name="capture" /><strong>F9 in game</strong><span>Screenshot + OCR</span></li><li><AppIcon name="archive" /><strong>captures folder</strong><span>Original files on disk</span></li><li><AppIcon name="map" /><strong>Website</strong><span>Local review & advice</span></li></ol>
          <figcaption>Keep the helper and website open for automatic local import. A second F9 press creates another capture.</figcaption>
        </figure>
        <p>Connected captures and corrections save automatically. <strong>Saved locally</strong> confirms storage on this device; the capture still needs checking. After reopening the website, you may need <strong>Resume local review</strong> and renewed folder access.</p>
        <h3>Without a folder connection</h3>
        <p>After F9, switch to <strong>Current map</strong> and paste with <kbd>Ctrl</kbd>+<kbd>V</kbd>, or use <strong>Import capture</strong> to open a helper JSON file. Choose <strong>Save offer</strong> or <strong>Confirm and save</strong> when shown. A plain screenshot is kept as evidence but does not run text recognition in the browser.</p>
      </section>

      <section className="guide-section" aria-labelledby="guide-play">
        <h2 id="guide-play" tabIndex={-1}>4. Review, choose and invoke</h2>
        <ol>
          <li><strong>Check the capture.</strong> Compare the names, tiers and rewards with the source image. Open <strong>Edit details</strong> for corrections and review status. Leave unidentified rewards unknown.</li>
          <li><strong>Assign the offer to your map.</strong> Click <strong>Start map with this offer</strong>, or <strong>Use this offer in current map</strong> for an existing map. Do this only for the instance you are playing now.</li>
          <li><strong>Choose a Fate.</strong> Set <strong>Reward priorities</strong> and check the advice and modifiers. Make your choice in game, then click <strong>Collect Fate</strong> on that same card here.</li>
          <li><strong>Plan invocation.</strong> Open <strong>Plan invocation</strong>. Follow the pictured order and confirm in game. Only then click <strong>Done in game</strong> to update the local collection. <strong>Undo</strong> can restore the last collection change.</li>
        </ol>
        <p className="guide-note">The helper does not play for you. Advice marked <strong>provisional</strong> depends on incomplete or unverified information; review the highlighted cards before relying on it.</p>
        <p>For the next map, use <strong>More actions → New map</strong>. This clears map planning; your saved offers stay in the journal. After reopening a map session, use <strong>Continue this map</strong> only if it is still the same instance.</p>
        <button onClick={onMap}>Go to current map</button>
      </section>

      <section className="guide-section" aria-labelledby="guide-data">
        <h2 id="guide-data" tabIndex={-1}>Keep a backup. Share only if you want to.</h2>
        <h3>Back up your local journal</h3>
        <p>In <strong>Saved offers → Import, export & recovery</strong>, select <strong>Data, screenshots & OCR</strong>, then <strong>Export all data</strong>. Download every part. Browser storage can be cleared; a full backup keeps the available evidence and corrections.</p>
        <button onClick={onSaved}>Open saved offers</button>
        <h3>Optional: upload new captures from the helper</h3>
        <ol>
          <li>Right-click the helper’s tray icon and open <strong>Cloud upload settings</strong>.</li>
          <li>Enter the collection owner’s HTTPS site URL and <strong>capture upload key</strong>. Read the destination and consent text, tick the agreement and click <strong>Enable upload</strong>.</li>
          <li>Keep the helper running. <strong>Uploaded</strong> means the server acknowledged the capture; <strong>Queued</strong> means it is waiting for a connection or retry. The website can be closed.</li>
        </ol>
        <p>Only new captures after consent are sent. Upload includes OCR text and capture metadata; screenshots stay local. Automatic uploads remain unverified and do not appear in the browser’s journal unless you import the local files.</p>
        <p>To contribute visual evidence for a new reward, open its offer and choose <strong>More actions → Report symbol</strong>. Preview a symbol crop and a tooltip image, then accept the separate image-sharing consent. <strong>Symbol report history</strong> lets you retry or withdraw a report. Reports need verification before the catalog changes.</p>
        <p>Website corrections are shared separately under <strong>Saved offers → Shared research collection</strong>, with its own consent and reviewed-offer key. To stop helper sharing, use <strong>Cloud upload settings → Consent history → Withdraw consent</strong>; disconnecting the website folder does not stop uploads.</p>
      </section>

      <section className="guide-section" aria-labelledby="guide-problems">
        <h2 id="guide-problems" tabIndex={-1}>If something does not work</h2>
        <dl className="guide-troubleshooting">
          <div><dt>F9 does nothing or the frame is wrong</dt><dd>Check that the helper is running and PoE is in front. Preview with F8 or select the panel again with F6/F7. Keep it on one monitor. If HDR capture fails, try with Windows HDR off.</dd></div>
          <div><dt>The capture does not appear on the website</dt><dd>Check the helper’s capture folder for a saved file. Use desktop Chrome/Edge on HTTPS or localhost. Keep the page open; resume local review if permission is needed. If the folder moved, disconnect and select it again. Manual JSON import is also available.</dd></div>
          <div><dt>Names or rewards are missing or incorrect</dt><dd>Keep the complete panel in the frame and move tooltips out of the way. Check the image and correct the result in Edit details. If text recognition is unavailable, install the relevant Windows OCR language feature. A saved image can still be reviewed manually.</dd></div>
          <div><dt>Local auto-save is paused at 250 offers</dt><dd>Export a backup, remove older offers, then click Resume local review. New helper files remain on disk.</dd></div>
        </dl>
        <p className="hint">Recognition across live Fate scenes, HDR displays and UI scales is still being validated. Check your first capture against the game.</p>
        <div className="guide-actions"><button onClick={onDiagnostics}>Open diagnostics</button><button className="text-button" onClick={() => { contents.current?.querySelector<HTMLButtonElement>('button')?.focus(); window.scrollTo(0, 0) }}>Back to guide contents</button></div>
      </section>
    </div>
  </div>
}
