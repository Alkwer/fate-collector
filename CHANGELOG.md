# Fate Collector releases

## 0.10.11 — 20 November 2026

- The Windows helper can recover a faint Fates digit or a digit touching the slash in compressed footage.
- Offer import keeps raised cards and ignores quest labels above the row. The helper rereads unclear names and short descriptions from their card columns, including in 720p captures.

## 0.10.10 — 20 November 2026

- The Windows helper reads the area counter from the Fates panel and the HUD and keeps its position in the OCR evidence.
- Offer import uses the card columns to associate wrapped descriptions with each name. A verified row can still be read when the pointer covers Confirm or a tooltip covers the title.

## 0.10.9 — 19 November 2026

- Select Divine Orb or Orb of Annulment in the tooltip catalog. Both planners complete each single-orb reward at two copies under PoE 3.30.0d.
- The Abomination map reference identifies Nightmare of the Depraved Trinity as the empowered boss.

## 0.10.8 — 19 November 2026

- Press F6 to start a gold outline that follows the pointer. Include the Fates
  title, all offered cards, reward icons and Confirm, then press F7 to save
  the frame. Press F8 to see the saved area again.

## 0.10.7 — 19 November 2026

- Isolated damaged local records, made capture ordering deterministic and made duplicate offer IDs visible before restoring backups. Dragging multiple backup parts now imports the complete selection.
- Retained fight outcome edits when switching fights or closing the journal. The offer editor and archive now load on demand.
- Website diagnostics report offer database availability and distinguish the Windows helper queue from browser storage.
- Added frame-based reward identification and independent validation of reward labels, kinds, combo thresholds and unknown answers.

## 0.10.6 — 18 November 2026

- Added the five high-tier Fate reward examples and four equipment modifier replacements from PoE 3.30.0c. Trade / mapping includes editable points for these rewards once their kind and any combo requirement are checked.
- The Viscera planner and overlay account for guaranteed drops from supported extra bosses. Historical offers retain their original equipment labels.

## 0.10.4 — 18 November 2026

- Offer deletion checks for pending edits and newer saved revisions. Invalid
  drafts can be exported privately for manual recovery, and local storage
  reconnects when the browser closes its database connection.
- Reimporting the original capture reconnects card crops for new data-only
  backups. Older cards without a reliable match retain the full screenshot.
- A manual campaign or map limit survives subsequent offers. Choose **Use
  offer context** to resume automatic selection.
- Export and restore the fight journal and league challenge progress with a
  preview of conflicts. The helper shows local instructions and diagnostics,
  and the Fate picker loads portraits when needed.

## 0.10.3 — 18 November 2026

- Campaign plans use two inputs and map plans use three. Matching Tier 1 Fates
  merge into Tier 2 and triple the first card’s regular rewards.
- Promised Profits includes Doedre’s Tongue under both its named objective and Unique Item.
- Mark the current offer as the last one in the area to compare active rewards.
  The overlay also supports this choice with Ctrl+Alt+Enter when prompted.
- Build dangers use full Tier 1 and Tier 2 tooltip references for checked tiers.
  Rot and Rotted share effect references and count as the same Fate in plans.
- The overlay points to a reward tooltip when checking it could change the pick
  or help identify a reward for the active Promised Profits goal.

## 0.10.2 — 18 November 2026

- Merging two same-name Tier 2 Fates can complete a recognized Currency combo
  from the retained card. With three copies, the first and third contribute
  rewards. The plan preview shows the resulting Currency sets and the solver
  scores each distinct Currency combo once.
- The advisor and the in-game overlay show when collecting a matching Tier 2
  Fate would make a different choice win.

## 0.10.1 — 18 November 2026

- The weighted overlay shows the best choice or a tie on current points,
  followed by the nearest winning combo, its missing reward icon and projected
  points. Compact mode retains both lines.

## 0.10.0 — 18 November 2026

- Compare current plan points and the matching icons that would put a different
  Fate ahead. The overlay shows the nearest qualifying completion.
- Match reward icons against 38 offline PoEDB images and their tooltip
  variants. Trade starts with editable priorities for 62 verified variants.
- Select a target Viscera, check listed sources and companion bosses, and
  filter fire damage over time or Brittle and critical strikes.
- Track Promised Profits and Overpowering Omens goals and optionally record
  the boss, patch, in-game preview and observed loot after an invocation.

Install the complete helper bundle to use the updated offline advisor.

## 0.9.0 — 17 November 2026

- Keep up to 20 named build profiles. Create, duplicate, rename and switch
  configurations with independent reward priorities, build filters, planning
  objectives, single-reward goals and personal templates. Existing settings
  migrate to the first profile; map state and collection undo stay unchanged.
- Back up the full library with Export library, or transfer one configuration
  with Export profile. Import and recovery protect other profiles, unreadable
  stored data and newer edits from another tab.

The website and Windows helper keep separate profile libraries. Exit the helper
before replacing the complete program bundle; retain `captures`, `symbol-reports`
and `fate-collector.ini`. Export the library before downgrading: older helpers use
the preserved original single profile and cannot read the new library.

In-game validation remains deferred at the owner's request.

## 0.8.0 — 17 November 2026

- Incomplete combos guide collection without being presented as active invocation
  rewards. Reward planning prefers fewer inputs when active rewards are equal.
- Six optional build-danger categories support Allow, Warn and Exclude. They use
  recorded modifiers and labelled Tier 3 PoEDB references, including supported
  T2 merges. Literal and individual-card exclusions apply in every planning mode.
- **Planning objective → Farm boss Viscera** compares input count and supported
  duplicates separately from reward priorities. It shows the reward trade-off;
  unknown drop chances and duplicate combo rules remain explicit.
- **Record a different invocation** records the exact cards used in game and
  supports collection undo even when no recommended reward plan is available.
- Existing profiles retain their priorities. The new objective and danger settings
  persist locally and travel with profile exports. The local advisor and website
  use the same planning rules; overlay choices respect the same exclusions.

Exit the helper before upgrading. Extract the entire new ZIP and replace the
program files, including `desktop` and `webview2`. Keep `captures`, `symbol-reports`
and `fate-collector.ini`; existing local advisor data stays in the Windows profile.
The website and local advisor have separate collections.

In-game validation is deferred at the owner's request. Automated checks do not
establish native recognition accuracy, combat safety or actual drop probabilities.
