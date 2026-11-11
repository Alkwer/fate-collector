# Collector design

## Appearance and layout

The interface uses **Mineral Depth** by default. Its petrol shell, blue-green
surfaces and mint actions share a layout with **Light Trail**, which pairs an
olive shell and pale surfaces with violet actions. **More actions → Appearance**
is available on every screen. The choice is stored in the browser, restores
on reload and takes effect without replacing the active map or draft. If local
preference storage is unavailable, the change applies for the visit and the menu
reports the failure. See [DESIGN.md](../../DESIGN.md) for the implemented tokens.

- A sticky navigation rail leads to **Current map**, **Saved offers** and
  **Diagnostics**. It becomes a top navigation bar at narrow widths.
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
- Use thin outlined icons, editable HTML controls and original captures for
  evidence. Keep the workspace free of decorative game art, invented badges
  and statistics, gradients and rasterized controls.
- Empty states lead with import. On mobile the archived review shows detected
  Fates before the source image. Source previews open at full size. Keep
  table scrolling within the table container where needed.
- Supporting instructions and statuses use at least 13px text. Buttons and disclosure
  headers have at least 36px targets on desktop and 44px targets on mobile.
  Keyboard focus stays visible.

## Interaction requirements

Minimize manual entry and keep the default capture and advice view read-only.
Show source evidence and extracted names and descriptions. Put card corrections,
the optional archived choice, context and a single **Review status** selector
under **Edit details**. Keep examples, new offers, individual offer export and
unreviewed saves under **More actions**. The journal keeps search and its main
offer filter visible, with additional filters, import, export, recovery and
sharing under their labelled disclosures. Retain deletion confirmation, source
zoom, import guidance and actionable error feedback.
**Connect folder** links the local captures folder once. While connected, captures
and corrections save automatically; there is no per-capture confirmation or save
button. Display a compact connection status and local save state. New automatic
records stay unverified. **Confirm and save** remains in the manual import flow.
Support paste and drag/drop as fallbacks.
The folder connection is optional and explicitly labelled as local review. The
helper's independent cloud upload is configured in its tray menu and can work with
the website closed. Do not show a cloud connection or upload status the browser
cannot observe. The **Connect captures folder** disclosure is secondary to the capture
and extracted cards.
Do not require typing modifiers, area, tier, or rewards just to preserve a sample.
Manual review means the user checked the extraction, not that every icon is known.
Known Fate names and descriptions are extracted from local Windows OCR. The local
visual matcher suggests supported tiers and icon shapes. Only sourced tooltip
meanings are suggested; unsupported rewards stay unknown and visual suggestions
require explicit review before firm advice.

The current-map workspace follows capture, reward review, choice and invocation.
Two pressed-state buttons switch between **Choose a Fate** and **Plan invocation**.
The main result contains the single preferred card's action; equal matches retain
their individual actions. Show the next missing-data check directly and collapse
the remaining checklist. Keep the best invocation visible and alternatives collapsed.
Keep the recommendation and its gain over the existing collection prominent, with
equal matches and provisional results explicitly labelled. Missing data links to
the affected card. **Back to advice** closes current-offer editing and restores
focus to the decision. Summarize **Reward priorities** in a disclosure and keep
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
