# Fate advisor

The **Current area** screen combines the current offer, next-Fate recommendation,
collected cards and the order of two campaign inputs or up to three map inputs. Ordinary Fates
can only be invoked in the instance where they were collected.
Everything runs locally, without an API, market prices or changes to observation
schemas. The rule baseline combines the [prerelease research](../research/FATE_ADVISOR_RESEARCH_2026-11-07.md)
with [3.30.0b Hotfix 3](https://www.pathofexile.com/forum/view-thread/4015683),
checked on 16 November 2026; the [planning follow-up](../research/ADVISOR_RULES_2026-11-17.md)
records the 17 November FAQ and community review. Advice uses the current rules, including three-copy
invocations; it does not simulate historical patches. See the
[post-launch evidence record](../research/PATCH_NOTES_2026-11-16.md).

## Use

The workflow strip follows Capture → Check rewards → Choose a Fate → Invoke.
The **Data to check** list names the missing fields on each offered or collected
card. **Review [name]** opens that card's reward editor and moves keyboard focus
to it. **Back to advice** closes the editor; recommendations update as you edit.
Saving a sample does not certify its reward data. Unknown rewards can stay unknown,
and any supported comparison remains provisional where the missing data matters.

1. Start a map session with **Start new map**, then capture/import an offer.
   Confirm **Use this offer in current map** before it enters advice. If no map
   is active, **Start map with this offer** performs both steps explicitly.
   Helper session IDs, timestamps and folder catch-up do not establish map identity.
   In **Edit details → Modifiers &
   rewards**, identify each visible reward's exact label, kind, count and, when
   known, combo threshold. Supported icon shapes and T2/T3 are now suggested locally
   from the image. Orange feathers are shared by several league uniques and need
   the exact tooltip, including in old captures. Rarity/currency kinds also remain
   unknown until identified. Use **Tooltip catalog**
   to select a verified matching combo, see its reference icon and open the GGG
   source. Exceptional Gem requires manual identification, not the three-gems motif.
   Check the tier and the full reward row using the two visual-review checkboxes.
   **Edit details** keeps the source image beside the selected card on desktop.
   Select a reward icon to open and focus its fields, or use **Next card to review**
   to move to another card with unknown or unchecked values. Selecting a catalog
   meaning does not check either visual-review box. On narrow screens the image
   appears above the fields and can be enlarged.
2. On the same screen, choose **Choose a Fate** and a **Reward goal**.
   The result names the matching Fate(s), shows icon progress and invocation order,
   and separates a supported recommendation from a provisional preference.
   Each candidate shows its gain over the best plan already available from your
   collection. Combo gains stop at the threshold; extra icons do not imply another
   payout. **No improvement for this goal** means the known alternatives do not
   improve it; missing evidence instead keeps the comparison unresolved.
3. After choosing in the game, use **Add … to collected** for that card. Only one
   card per imported offer can be added; remove it to change that planning choice.
   The result confirms the added choice and offers **Plan this collection**.
   The map editor has no second choice control. **Recorded choice** is an optional
   archive-only research note; it does not modify the map collection or control the game.
4. After the next capture, repeat. Choose **Plan invocation** for an invocation
   plan. Use **Edit collected cards** to enter earlier cards or correct these local
   snapshots. Later changes to an observed offer do not silently alter the snapshots.
5. Use **New map** when entering a different instance. It creates a new local map
   ID, clears collected cards and all offer bindings, resets the current draft and
   returns to offer mode. It preserves the reward goal and the observation archive.
   Leaving temporarily and returning to the same instance does not require a reset.
   Map changes are **not detected automatically**; the player establishes the boundary.
6. The collection survives navigation and reload in this tab through versioned
   `sessionStorage`. **Every active restored map**, including one without collected
   cards, requires **Continue this map** or **New map** before advice resumes. A separate
   browser tab has separate planning state; closing the tab normally ends its session.
   It is not part of observation backups or uploads. Storage failures are shown;
   invalid edits preserve the last valid stored map rather than overwriting it.
   Version 1 notes migrate to version 2 without deleting the original data. Old
   nonempty collections require confirmation and have an unknown map start time.
7. **Saved offers** and restored offer/export JSON open an independent archive
   editor. Opening or correcting an archive entry does not replace the current
   map's draft or include it in advice. An explicit **Use this offer in current map**
   transfer is available only after saving corrections and confirming the map.
   Use it only if the archived capture belongs to the currently played instance.
   If both editors show the same offer, clean copies follow each successful save.
   Pending corrections remain untouched and retain conflict protection.

## Combined priorities and reusable profiles

New profiles use the provisional [62-priority trade starter](trade-starter.md).
Campaign / SSF and Viscera starters are available through **Replace priorities**.
Existing saved profiles retain their mode and weights. **Use trade starter** updates
only the trade priorities, preserving other goals, filters and personal templates.
The **Unweighted rewards** panel lists identified rewards without positive weights.
Read-only PoEDB references provide possible effects and patch corrections; they never
identify the recorded reward or infer its kind or threshold.


Enable **Compare multiple rewards** to optimize several rewards together. Open
**Priorities, build filters & profile**, add observed, catalog or custom rewards,
and give each a relative weight (0 disables it). Regular icons earn that weight
per icon unit. A completed combo earns its weight once. For example, Currency
weight 1 and Armour weight 3 give 7 points to a plan with 1 Currency and 2 Armour
icons. These are configurable preferences or user estimates in a consistent unit,
not measured item quantities, market prices, expected value or profit.

A confirmed campaign offer sets a two-input limit for the area. Maps use three.
If the area type is unknown, the planner allows up to three inputs. Choose
**Edit collected cards → Planning area** to set the limit manually. The area
setting overrides subsequent offer categories until you select **Use offer
context** or start a new area. When restoring an area saved before 0.10.4, the
advisor preserves its last known campaign or map limit.

The search evaluates the supported subsets within that limit, both orders of a
matching T1 or T2 pair, all three choices of discarded middle card in a supported
three-copy invocation, and every eligible offered card against the collected-only
baseline. While collecting, it ranks total points, then weighted capped combo
progress, then fewer inputs. Invocation ranks active points, then fewer inputs;
incomplete combo progress never justifies consuming an extra card. Progress is
not an extra payout. Equal offered choices are
all shown; invocation shows the best plan and up to two alternatives. **All rewards
& invocation order** explains retained rewards, per-reward points, merge order,
consumed cards, and unresolved outcomes. Unlisted rewards remain visible with zero
weight. Relevant unknowns keep the result provisional instead of asserting a zero
return. **Mark this invocation completed** consumes exactly the listed inputs;
the existing collection undo also restores them.
In reward-priority mode, if no plan establishes positive points, invocation advice
abstains and offers no recommended completion action. Partial combos instead show
**Progress while collecting**. The single-goal engine likewise requires an active
combo with a known threshold. **Record a different invocation** separately records
the inputs actually used in game within the area limit, even when no recommendation is available;
collection undo restores exactly those inputs. Neutral cards can still enable
useful merges during the search, but zero-result reward plans are not suggested.

During collection, **Plan points now** is the active total for a legal plan
using that offered card. The signed difference compares it with the collection
alone. A conditional total shows how a different choice could take the lead
by completing a specific weighted combo. Each additional icon occupies one
future input on a distinct eligible Fate. The comparison counts only those
icons on the future Fates, and gives every alternative the same opportunity.
For a reviewed T2 Fate carrying an identified Currency combo, the advisor also
checks a future eligible T2 copy of that same Fate. It compares
every option and the collection under that same condition, credits no rewards
from the future card, and shows the condition only for a strict lead.
When later offers are possible, the overlay can show the nearest such condition. Unknown, conflicting or
duplicate-scaled counters cannot establish a conditional total. These scenarios
do not predict future offers or affect the current recommendation.

Select **Last offer in this area** while choosing at the final cauldron.
Both reward modes compare what each offered Fate can activate with the current
collection. Equal improvements tie and incomplete combos add no value to the choice.
The setting belongs to this offer. A different offer starts with the usual outlook.

Selecting an unknown reward in the editor opens the offline icon comparisons.
Select the matching PoEDB image, inspect the alternative wordings and optionally
filter using words from the captured OCR. Applying a catalog entry requires an
explicit tooltip match including any combo requirement. Source-only definitions
remain references. In Viscera farming, the [target picker](viscera-targets.md)
lists possible bosses and areas for the selected item.

Build filters exclude whole cards whose recorded modifiers contain any supplied
literal phrase (case-insensitive). Individual offered or collected cards can also
be excluded. These controls apply to single-goal, combined-priority and Viscera
planning, including overlay choice advice.

**Build dangers** adds Allow / Warn / Exclude for physical damage over time, chaos
and poison, bleeding, curses, boss life recovery and additional bosses. The matcher
uses recorded effects first. For a checked tier, it can also match a full Tier 1
or Tier 2 screenshot tooltip or the corrected Tier 3 PoEDB reference. Rot and
Rotted refer to the same Fate in risk checks and duplicate planning. The original
card name stays in the offer. Supported T2 merges check the resulting Tier 3 reference.
Source matches are labelled and never overwrite recorded modifiers. Missing effects
and unknown triple output effects remain unverified. Matching dangers appear beside
the plan or offer. Allow disables that category's filter; it does not establish a
safe encounter. This is a bounded effect filter, not a full build or difficulty model.

**Planning objective → Farm boss Viscera** compares the two factors established by
the GGG FAQ: input count and supported duplicate presence. Both nondecreasing with
one improving makes one factor combination preferable; a duplicate pair versus three
distinct Fates remains incomparable. Among plans with identical factors, reward
points break ties. This is an application policy, not an estimated drop formula.
Plans can have zero reward points and always remain provisional. The UI shows factors
and priority points below the best active reward plan. Verify that the boss drops the
desired Viscera; the app does not identify the encounter. Unknown duplicate mechanics
are not counted as confirmed duplicate bonuses. The Viscera reward starter still
values only the explicitly identified combo and is separate from this objective.

**Reward priorities → Build profiles** stores up to 20 named configurations.
The existing settings and single-reward goal become **My build** on first use.
**New profile** starts with the trade defaults; **Duplicate profile** copies the
active configuration. **Save name** renames it. Settings save automatically; each
profile keeps its weights, modifier filters, build dangers, planning objective,
single-reward goal, comparison mode and personal reward templates. Switching
profiles recomputes advice, including the overlay, without changing the current
map, collected cards, exclusions or undo history. Deletion requires confirmation
and leaves at least one profile. Pending modifier filters must be applied or
explicitly discarded before switching.

The library is stored separately in `localStorage` under
`fate-collector.solver-library.v1`, surviving new maps, reloads and browser restarts
unless browser data is cleared or evicted. Migration preserves the previous
`fate-collector.solver-profile.v1` bytes; once a library exists it takes precedence.
The website and local helper keep separate libraries.
**Export library** backs up every profile and the active selection in one validated
JSON file (1.5 MB maximum). **Import library** explicitly replaces the library after
confirmation. **Export profile** and **Import profile** transfer only the active
profile's settings (64 KiB maximum); import keeps its name and all other profiles.
Older single-profile exports remain supported; if they omit a single-reward goal,
import keeps the active profile's current goal. Library entries without that field
explicitly use no single-reward goal, independently of the current map.
The new fields are optional: existing profiles retain their weights and default to
reward planning with category filters disabled. Map state, individual
card exclusions, screenshots and observations are not included. New maps clear
individual exclusions. Corrupt libraries stay untouched until an explicit restore
or reset; **Export stored copy** preserves their original bytes for recovery.
Stale tabs must reload newer settings before overwriting them, and imports cannot
overwrite changes made while the file is being read. Failed saves warn the user
and keep the entire in-memory library available for export.

In the reward editor, **Save personal template** stores an explicitly identified
reward's label, kind and combo threshold. Applying a personal entry from **Tooltip
catalog** preserves the observed icon count and does not confirm visual review.
Personal templates are clearly distinguished from the source-backed catalog and
are never learned as automatic icon matches. They let players reuse newly verified
tooltip meanings without waiting for an application release.

## Rules and uncertainty

- The [GGG FAQ](https://www.pathofexile.com/forum/view-thread/4013527) confirms
  that the next offer stays hidden until the pending choice is made. Advice uses
  the current offer and explicitly collected cards; it does not forecast unseen offers.
  Do not add the same pending choice again from a separate capture: the per-offer
  guard recognizes an imported offer ID, not the identity of an in-game roll.
- Reward labels match after case, whitespace, Unicode and apostrophe normalization;
  regular and combo rewards remain separate. Names never imply a reward.
- A regular goal ranks matching icon units. Counts do not estimate item quantity,
  price, profit, modifier value, build suitability or fight difficulty.
  The [loot research update](../research/FATE_ADVISOR_RESEARCH_2026-11-07.md#update-of-11-november-2026)
  does not supply a conversion from rarity to reward value. No rarity or Atlas Drops
  multiplier is applied by this engine. Card tier remains separate from item/modifier tier.
- **Viscera and boss rewards** links the GGG FAQ: Grim-Fate empowered Pinnacles
  guarantee Viscera, while regular empowered bosses have better chances with more
  invoked Fates and duplicates. No probabilities or duplicate/combo formulas are
  given. The separate farming objective compares these factors without converting
  them to numerical reward points or drop probabilities.
- Combo goals use identified matching icons and a consistent threshold. The small
  verified catalog supplies Item Rarity (3), Exceptional Gem (3) and Dreadmaidens'
  Sacrament (2). A conflicting explicit threshold leaves activation unresolved.
  A threshold reached once is not assumed to pay multiple times.
- The search considers subsets of up to three input cards, including both orders
  of a supported duplicate pair. Two matching T1 cards merge to T2 and two matching T2 cards merge to T3. Regular
  rewards of the first card are tripled and the second card's rewards are discarded. Two inputs are
  still consumed. At equal active reward output, fewer invocation inputs are preferred.
- Next-card recommendations require improved target progress over the best plan
  available from the collection alone. A neutral reward can still help when the
  new card enables a confirmed duplicate merge. No improvement means no preference.
- Three copies of the same named Fate retain the first and third regular rewards
  at ×3 and discard the second card's rewards, using all three inputs. The engine
  requires equal known, reviewed tiers; it does not infer an output tier. Swapping
  the retained first/third cards is equivalent for the supported reward model.
- In Armoury on 18 November, adding a second Black Frost T2 completed the
  first card's three-segment Currency set. Adding a third Black Frost T2 with
  the same icon showed a second full set. The [two-Conjurer preview](../research/FATE_ADVISOR_RESEARCH_2026-11-07.md#duplicates-statement-and-interface-observation)
  also shows a Currency combo activating with a spare icon. Both planners apply
  the same-name duplicate rule to **Additional Currency Items** (two segments)
  and **Additional Valuable Currency Items** (three). A retained T2 Fate carrying
  one identified icon supplies three segments to its own combo. The middle card contributes
  no rewards. The combo earns its configured weight once even with two full
  sets. The four ShareX frames are `Awakened_PoE_Trade_7hP14yA4JG` (inputs),
  `ciFsUz5sGd` (1/3), `k5WyUVJYZ7` (3/3) and `Fn6Xloj4OP` (two full sets).
  The captures end before Confirm, so repeated payouts are unverified.
- T1 duplicate combo scaling, other duplicate combos, mixed tiers, and pairs starting at T3 remain unresolved.
  A generic Currency icon or a conflicting threshold cannot establish this combo.
- Hotfix 2 removed Crowkeeper T3 Culling Strike, reduced Crowkeeper/Wildfire damage
  and fixed Viscera from some Fate-spawned bosses. Historical source text remains
  intact. No damage coefficients, Viscera probabilities or weight changes are inferred.
- Empty reward lists, unread names or relevant unidentified icons prevent a firm
  ranking. Positive known progress can yield a provisional preference; no supported
  progress yields no recommendation. All tied offered cards are named.
- Automatic icon lists are partial until explicitly checked against the image.
  Unchecked lists keep advice provisional; unreviewed visual tiers cannot enable
  a duplicate merge. Neither saving an offer nor a shape match confirms these fields.
- Missing cards outside the supplied offer are not inferred. The collection is
  explicit and never assembled automatically from saved history or capture sessions.
  Up to 12 collected cards and 30 offered cards bound the search; 12 is an application
  limit, not a claim about the game. Invalid draft numbers abstain until corrected.

The engines are in `shared/advisor.ts` and `shared/solver.ts`, independent of React,
capture parsing and storage. They share supported input/order enumeration. Unit
tests cover weighted outcomes, baselines, ties, unknowns, thresholds, duplicate
order, exclusions, input limits, profile validation and stale-tab storage conflicts.
`e2e/advisor.spec.ts` covers both decisions, edits, map resets, archive isolation,
empty restored maps, explicit offer membership, local-only planning,
and desktop/tablet/mobile rendering alongside the existing collector regression suite.
`e2e/solver.spec.ts` covers combined weights, build filters, exclusions, invocation
and undo, profile persistence/import/export, personal templates, storage failure,
stale tabs, and desktop/tablet/mobile layouts.

The last ten collection edits and map resets can be undone during the visit.
Restoring another map requires explicit confirmation of the current instance.
After invoking in game, **Mark this invocation completed** removes exactly the
plan's cards and prevents selecting the same offer again. Undo restores that state.
Corrections in saved source offers are highlighted beside collected snapshots;
**Apply source correction** is explicit and can also be undone.

## Remaining game-data validation

The implementation supports manual reward entry, reusable definitions,
single and combined priorities, build filters, conservative exhaustive planning,
explanations and collection lifecycle. The following still need live evidence:

- Native Fate captures for recognition precision/recall, full reward-row coverage,
  tooltip mappings, HDR and UI-scale/resolution calibration. Synthetic tests and
  prerelease screenshots do not certify those properties.
- Rules for mixed tiers, pairs starting at T3, combo behavior after duplicate invocation,
  and whether merges alter the usable input-slot limit. Unsupported combinations
  remain explicit unknowns until those rules are established.
- Actual reward distributions, quantity/rarity effects, Viscera probabilities and
  league prices before any data-derived economic model can be claimed. User weights
  can express estimates but cannot replace these observations.

The pending offer is hidden until a choice is made according to the GGG FAQ; a
future-offer forecast cannot be inferred from the current capture. Confirming map
identity, visual review and the chosen/invoked cards remains a deliberate user step:
the app does not observe or control those game actions. The
[deployment record](deployment.md#pinned-fate-advisor-0103-exception) identifies
the 0.10.3 package covered by the owner's deferral of in-game checks. Native
recognition accuracy still requires validation against game captures.
