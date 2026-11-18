# In-game Fate advice

The Windows helper automatically detects offers and runs the Fate advisor
locally, without an open browser or internet connection. It bundles the same
interface and recommendation engine as the website. Use PoE in windowed or
borderless mode; exclusive fullscreen is not supported by this version.

## Setup

1. Exit the old helper. Extract the entire helper package, including `desktop`
   and `webview2`, preserving captures, symbol reports and calibration. Run
   `FateCollector.ahk`. Microsoft Edge WebView2 Runtime must be installed.
2. Set reward priorities in the local Fate Collector window. Capture review
   and the overlay connect automatically; no folder picker is needed.
3. Choose **Run in background** or close the window. The advisor keeps running.
   **Open local advisor** in the helper tray opens settings, corrections and
   invocation planning again. Exiting the helper stops the advisor.
4. In the game, calibrate with F6/F7 if needed. Include the Fates heading, English
   card names and Confirm button. Keep the offer visible for two matching reads.
5. Confirm the current area with Ctrl+Alt+Enter when prompted. Check the displayed
   names and missing data. Record the Fate you intend to choose with the displayed
   Ctrl+Alt+number while the panel is visible, then select it in game. Undo the
   record if you change your mind. F9 remains available for a manual capture.

The local collection, journal and reward priorities are saved in the Windows
profile under `%LOCALAPPDATA%\FateCollector\desktop`. Restarting the helper
restores them and asks you to confirm the current area. Website data is separate;
use offer backup export/import to move observations. Cloud sharing and symbol
submission remain website flows, with their existing explicit consent.

To use the website instead, select **Use website advisor** in the helper tray.
Open **More actions → In-game overlay** in desktop Chrome or Edge on HTTPS,
select the helper's `captures` folder and allow read/write access. Keep that tab
open in website mode. To return to local mode, disconnect the website overlay
and select **Open local advisor**. Only one advisor owns the overlay at a time;
a closed advisor's connection expires after 12 seconds.

## Reading the choice

At the final cauldron, use **Mark as last offer** (Ctrl+Alt+Enter) after
confirming the area. The same shortcut restores the usual comparison while
**Allow later offers** is visible. The setting also appears in the advisor
window and applies only to the current offer.

When a tooltip could change the choice or reveal a reward for an active
Promised Profits goal, the overlay tells you which card and icon to hover.
Check the wording and combo requirement in game. The hint leaves the original
reward and its score untouched.

With weighted rewards, **Now** shows the highest current plan score. Choices
with equal current points tie even when one is closer to a combo. **Known
pts** means unchecked rewards or mechanics could change the comparison.
When later offers are possible, the forecast shows which Fate could take the lead, its current and potential
points, and the matching icon needed on a future Fate. If two icons are
needed, they come from separate new Fates. The overlay favors the fewest
missing icons, then the highest resulting score. In compact mode, a suggested
tooltip takes priority over the forecast.

## Automatic detection

**Auto-detect Fate cards** is enabled in the helper tray by default, but scans run
only with a fresh advisor connection, valid calibration and verified PoE
in the foreground. F8 previews, symbol reporting, manual captures, loss of focus
and disconnecting the advisor stop scanning. In standalone mode closing the local
window keeps the connection active; in website mode closing the tab stops it.
The tray toggle is saved;
F10 clears calibration and pauses scanning until F6/F7 calibration is restored.
After repeated capture errors, retry from the tray or use F9.

A persistent local worker samples the calibrated panel, waiting 1.5 seconds after
each completed OCR read. Two matching recognized rows are required before saving.
Only known, readable English names inside an unambiguous Fates/Confirm panel are
accepted; invocation screens and incomplete OCR abstain. Unknown or missed cards
still need F9 and review in Fate Collector. This has been tested with archived OCR and
generated fixtures, not established as a live-game accuracy guarantee.

Probe images remain in memory. Accepted offers are saved as
`captures/auto-fate-<id>.json` through a private `captures/.auto` staging folder.
They never overwrite the clipboard or enter the helper's cloud upload queue:
existing capture consent covers F9 only. Reviewed offers may still be shared
explicitly on the website under that separate consent.

An unchanged visible row is saved once. Loss of detection clears automatic advice;
two consecutive clear non-offer reads allow an identical future row to be saved.
OCR failures do not reset duplicate protection. Names and order identify a row;
use F9 to refresh changed rewards or text when names stay the same. F9 also keeps
manual advice usable when automatic recognition abstains. An explicit confirmed
new-area action rearms detection, without guessing which area an offer belongs to.

| Shortcut | Effect in Fate Collector |
| --- | --- |
| F9 | Manually capture or refresh an offer; immediately clear prior advice |
| F10 | Clear calibration and pause automatic detection; F6/F7 resumes |
| Ctrl+Alt+Enter | Confirm the displayed area action, cancel a new-area reset, or mark or clear the current offer as the last in this area |
| Ctrl+Alt+1–9 | Record the intended Fate while its offer is visible; choose it in game |
| Ctrl+Alt+N | Request a new area, then confirm with a second press |
| Ctrl+Alt+Z | Undo the latest collection/area change |
| Ctrl+Alt+O | Show or hide the overlay |

Only currently displayed actions are accepted. Keys are handled while the
verified game is active and never click cards or automate game actions. Numbers
follow the recognized offer order; check the name, especially after corrections.
More than nine recognized cards requires website review. Excluded cards cannot
be recorded through the overlay. A new area discards the current offer binding
and requires a fresh automatic or F9 capture.
When the full comparison cannot fit at a readable size, the overlay retains the
recommended position, reason and uncertainty, asks you to compare in Fate Collector,
and pauses its action shortcuts. It never hides missing-data details to fit more
choice buttons.

## Missing data and connection state

The overlay calls the existing single-goal or portfolio recommendation engine.
It preserves equal matches, unknown rewards and provisional advice. It does not
infer reward meanings from portraits or improve OCR. Inspect and correct unknown
data in Fate Collector. Invocation planning is available in the local window and website.
An open editor, pending changes or unavailable capture connection blocks overlay
actions so background commands cannot overwrite a correction.

In website mode the page must remain open. A background tab can be throttled or suspended;
after 12 seconds without a valid heartbeat the helper removes the advice and
actions. Return to the website to resume updates. A new F9, failed/cancelled
capture or mismatched capture ID also prevents an old recommendation from showing.
Reconnect the website overlay explicitly after reloading the page. The standalone
advisor reconnects automatically and is driven by a Windows timer while hidden.
Only one tab per
browser origin can own the overlay. A recently active writer from another origin
also blocks connection until it disconnects or expires.

**Disconnect overlay** leaves normal local review connected. It does not change
cloud upload settings. Overlay messages never enter the upload queue or offer
backups. Closing the helper closes its overlay sidecar.

## Local protocol and validation

The browser's ordinary capture connection stays read-only. The separate overlay
connection explicitly requests read/write permission, writing only
`captures/.overlay/state.json`. The helper owns `capture.json` and `command.json`.
Original capture files are not changed. No HTTP listener, remote service,
credentials are needed for advice. Standalone mode uses the installed WebView2
Runtime; its SDK libraries and complete local application ship in the helper ZIP.

`Start-FateDesktop.ps1` loads the WinForms WebView2 host with a persistent local
profile and parent-process lifetime. HTTPS virtual-host mapping serves bundled
assets without a server. Remote navigation and network resources are blocked.
The origin-bound message bridge lists/reads only capture files and three overlay
files, and writes only bounded `state.json` messages atomically. A profile mutex
prevents two local instances from sharing storage. Native 500 ms ticks wake capture
and overlay polling with single-flight guards, independently of browser tab timers.
Closing the window hides it; exiting the helper disposes the host.

Protocol 1 is defined by `shared/overlay.ts`. Messages are bounded to 32 KiB.
Browser state contains a connection ID, stable snapshot revision, capture ID,
heartbeat, display rows, advertised actions and last acknowledged command.
Commands echo those IDs and expire after 12 seconds. Each action is checked
against the current snapshot and capture marker immediately before dispatch.
The helper allows only one pending action; reconnecting gives the browser a new
identity, preventing replay from a previous visit. Native writes are atomic and
browser writes use `createWritable`/close.

Run `npm run test:auto-capture` for offer detection, request and evidence checks;
`npm run test:desktop` checks the packaged host's file and origin boundaries.
`npm run prepare:helper` builds and prepares a runnable helper in this checkout.
`npx playwright test e2e/desktop.spec.ts` covers automatic connection, local
collection persistence and native-message adapter behavior without API requests.
`npm run test:calibration` also tests automatic stability and manual fallback.
Run `npm run test:overlay` for native protocol/render checks and
`npx vitest run tests/overlay.test.ts` for recommendation/bridge checks.
`npx playwright test e2e/overlay.spec.ts` exercises import, area confirmation,
choice, undo, reset, stale commands, multiple tabs and responsive setup UI.
Browser tests use real Chromium OPFS instead of the OS folder picker. Native
fixture/render checks do not establish live PoE, HDR, exclusive-fullscreen or
every DPI/resolution combination; these require an in-game smoke test.

`npm run test:overlay:background` is a separate native-desktop browser check.
It launches an isolated, minimized Chromium profile under `.qa/overlay-browser`,
attaches with Playwright `noDefaults`, verifies that the application document is
actually hidden, and checks heartbeat and capture intake after the timer-throttling
grace period. Ordinary headless tests emulate focus and cannot establish this.
The grace period is shortened only in this test using Chromium's
[documented test flag](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#testing).
Browser freezing/discarding is still handled by expiring advice, not by claiming
that the website keeps running while suspended.
