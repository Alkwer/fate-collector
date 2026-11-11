# Collector design

Original visual reference: `collector-concept-en.png`, generated with the built-in image tool.
The earlier Polish concept is superseded by the user's English-only requirement.

- Charcoal background `#111311`, surface `#191c19`, text `#eee9dc`, muted text
  `#a9afa4`, olive borders `#424b3c`, gold accent `#d3b775`.
- Gold identifies navigation. Green `#8dd5b1` identifies supported recommendations
  and the main choice action; amber `#ecc17a` marks provisional advice and required
  confirmation; blue `#9fc8ec` identifies data review. Text labels accompany each
  state. Ordinary Fate names and secondary actions use neutral text.
- Georgia title/wordmark, system sans body and explicit control typography.
- Compact header and 26–32px title, 40/60 source/preview columns, single-action save band.
- Four-pixel corners, no decorative game art, statistics, badges or gradients.
- Thin outlined upload icon, real editable HTML controls, no rasterized UI.
- Mobile: detected Fates precede the source image; the 144px preview opens at full size.
  Empty states keep the import control first. Tables scroll inside their containers.
- Supporting instructions and statuses use at least 13px text. Buttons and disclosure
  headers have at least 36px targets on desktop and 44px targets on mobile;
  keyboard focus stays visible.

Required extensions to the concept: saved-offer history, collection access panel,
reward details, error/status feedback, deletion confirmation, source zoom and
import guidance. These enable the requested capture/review/save/share workflow.

User steering: minimize manual entry and reduce visible options further. The main
screen contains no editable fields or checkboxes. Show source evidence and a read-only
list of extracted names/descriptions. Put card corrections, the optional choice,
context and a single Review status selector under one **Edit details** disclosure.
Move examples, new offers, exports and unreviewed saves to **More actions**.
**Connect folder** links the local captures folder once. While connected, captures
and corrections save automatically; there is no per-capture confirmation or save
button. Display a compact connection status and local save state. New automatic
records stay unverified. **Confirm and save** remains in the manual import flow.
Support paste and drag/drop as fallbacks.
The folder connection is optional and explicitly labelled as local review. The
helper's independent cloud upload is configured in its tray menu and can work with
the website closed. Do not show a cloud connection or upload status the browser
cannot observe. The connection strip is secondary to the capture and extracted cards.
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
the affected card rather than sending the user to an undirected form. Put the
capture above the collection in the secondary column; stack at tablet width.
The map editor has no archive choice control. Keep capture saving, reward checking
and local map choices distinct in the copy, without requiring duplicate input.

Visible primary copy: Fate Collector; Collector; Saved offers; Review your captures.;
Check detected Fates and correct any misreads.; More actions; Your capture;
Paste your capture with Ctrl+V; Import capture; Offered Fates; Edit details;
Connect folder; Local review connected; Saved locally. Confirm and save (or Save offer)
is shown for captures that have not already been saved automatically.
Unknown recognition and test-origin notices are functional.
After review is saved, the action band reports its complete/partial review status
instead of asking for confirmation again. Pending corrections never display a
saved claim. Automatic captures stay explicitly unreviewed until checked.

Paused folder connections retain Disconnect so the user can select another folder.
Sharing status shows Unsaved changes and disables Share while that offer has pending
corrections. Importing original evidence after a metadata backup restores the image
without replacing the user's corrected card data.

The empty state intentionally contains no invented observations. The example
state reproduces the two illustrative cards in the concept and stays test-only.
