# Collector design

## Appearance and layout

The interface uses **Mineral Depth** by default. Its petrol shell, blue-green
surfaces and mint actions share a layout with **Light Trail**, which pairs an
olive shell and pale surfaces with violet actions. **More actions → Appearance**
is available on every screen. The choice is stored in the browser, restores
on reload and takes effect without replacing the active map or draft. If local
preference storage is unavailable, the change applies for the visit and the menu
reports the failure. See [DESIGN.md](../../DESIGN.md) for the implemented tokens.

- A sticky navigation rail leads to **Current map**, **Saved offers**, **Guide**
  and **Diagnostics**. It becomes a two-row top navigation at narrow widths.
- **Download Windows helper** stays visible beside **More actions** in the page
  header on every screen, with a direct ZIP download. The actions move below the
  title on mobile; setup instructions are available from **Guide**.
- The main decision panel sits beside the source capture and current collection
  on desktop. On tablet the decision comes first, followed by evidence and
  collection side by side. On mobile those supporting panels stack.
- Self-hosted upright Source Sans 3 serves headings and the wordmark. Body
  and controls use the Segoe UI stack. The page title is 30px on desktop and
  25px on mobile. Work surfaces use 14px corners and controls use 7px corners.
- The theme accent identifies primary actions and focus. Green identifies
  supported advice, amber marks provisional advice or confirmation, blue
  identifies review, and red identifies errors. Text labels accompany each
  state. Ordinary Fate names and secondary actions use neutral text.
- Use sourced game artwork to identify Fates and reward motifs, thin outlined
  icons for application controls, and original captures for evidence. Keep
  controls editable HTML; do not invent game graphics, badges or statistics.
- Empty states lead with import. On mobile the archived review shows detected
  Fates before the source image. Source previews open at full size. Keep
  table scrolling within the table container where needed.
- Supporting instructions and statuses use at least 13px text. Buttons have at least 36px targets on desktop and 44px targets on mobile.
  Keyboard focus stays visible.

## Interaction requirements

Minimize manual entry and keep the default capture and advice view read-only.
Show source evidence and extracted names and descriptions. Put card corrections,
the optional archived choice, context and a single **Review status** selector
under **Edit details**. Keep examples, new offers, individual offer export and
unreviewed saves under **More actions**. The journal keeps search and its main
offer filter visible, with additional filters, import, export, recovery and
sharing in named panels opened by buttons. Retain deletion confirmation, source
zoom, import guidance and actionable error feedback.
Area category is a separate Campaign / Map / Other / Unknown select under
**Edit details**, initialized from helper log context when available. Show the
original detection alongside corrections, and show the saved category in the
offer preview and archive. Archive **More filters** includes area category;
legacy records with no category behave as Unknown.
**Connect folder** links the local captures folder once. While connected, captures
and corrections save automatically; there is no per-capture confirmation or save
button. Display a compact connection status and local save state. New automatic
records stay unverified. **Confirm and save** remains in the manual import flow.
Support paste and drag/drop as fallbacks.
The folder connection is optional and explicitly labelled as local review. The
helper's independent cloud upload is configured in its tray menu and can work with
the website closed. Do not show a cloud connection or upload status the browser
cannot observe. **More actions → Connect captures folder** opens a dedicated local-review panel.
Only an active connection or a problem appears on the map. **More actions →
Setup & usage guide** opens the same guide as the main navigation. The guide is
a reading surface with four setup/use steps, backups/sharing and troubleshooting.
Its interactive F6/F7/F8 diagram is explicitly illustrative and controls no game
or helper state. Local review opens the existing folder panel; returning to the
map preserves the draft and collection. Chapter navigation moves keyboard focus
to the heading. The guide inherits both themes and uses no automatic animation.
Do not require typing modifiers, area, tier, or rewards just to preserve a sample.
Manual review means the user checked the extraction, not that every icon is known.
Known Fate names and descriptions are extracted from local Windows OCR. The local
visual matcher suggests supported tiers and icon shapes. Only sourced tooltip
meanings are suggested; unsupported rewards stay unknown and visual suggestions
require explicit review before firm advice.

The current-map workspace follows capture, reward review, choice and invocation.
Two pressed-state buttons switch between **Choose a Fate** and **Plan invocation**.
The preferred card contains the primary collect action; equal matches retain
their individual actions. Show the next missing-data check directly and open
the remaining checklist in a panel. Keep the best invocation visible and open alternatives on demand.
Reward symbols and counts replace repeated reward prose on the current-map view.
Unknown kinds or meanings retain an explicit unknown label and a review cue. A
recorded visual motif may show its sourced game image without implying known
meaning; otherwise use a question mark. Portraits show only verified artwork
for the exact Fate name, with an explicit fallback for absent/failed images.
Sources and coverage are recorded in [game-art.md](game-art.md). Modifiers open
a named panel for their specific card.
Invocation is a numbered picture guide with exact source references and reward
counts: select in order, see the pictured merge, then Confirm in game. It runs
left to right on desktop and top to bottom on mobile. Portfolio calculations
open in Reward breakdown; unresolved outcomes stay visible. Keep combo thresholds/activation and priority
point units distinct; never imply item quantities or resolved unknown mechanics.
Keep the recommendation and its gain over the existing collection prominent, with
equal matches and provisional results explicitly labelled. Missing data links to
the affected card. **Back to advice** closes current-offer editing and restores
focus to the decision. Open **Reward priorities** in a focused panel and keep
profile controls and advice notes available on demand. An active map offers
**Edit collected cards** even before an offer is imported so players can rebuild
their current collection.
The map editor has no archive choice control. Keep capture saving, reward checking
and local map choices distinct in the copy, without requiring duplicate input.

In the capture area, show **Your capture**, **Paste your capture with Ctrl+V**
and **Import capture** when manual import is available. Use **Connect folder**
and **Local review connected** for the local connection, and **Saved locally**
for a confirmed automatic save. **Confirm and save** or **Save offer** appears
for captures with an explicit save step. Unknown recognition and test-origin
notices remain visible where they affect the task.
After review is saved, the action band reports its complete/partial review status
instead of asking for confirmation again. Pending corrections never display a
saved claim. Automatic captures stay explicitly unreviewed until checked.

Paused folder connections retain Disconnect so the user can select another folder.
Sharing status shows Unsaved changes and disables Share while that offer has pending
corrections. Importing original evidence after a metadata backup restores the image
without replacing the user's corrected card data.

The empty state intentionally contains no invented observations. The example
state reproduces the two illustrative cards from the historical
`collector-concept-en.png` and stays test-only. Application copy is English.
