# Fate advisor

The **Current map** screen combines the current offer, next-Fate recommendation,
collected cards and the order of up to three invocation inputs. Ordinary Fates
can only be invoked in the instance where they were collected.
Everything runs locally, without an API, market prices or changes to observation
schemas. The rule baseline is the [prerelease research updated on 11 November
2026](../research/FATE_ADVISOR_RESEARCH_2026-11-07.md). Video evidence was checked
on 8 November; the update adds FAQ and patch-note context, not live-game validation
or additional engine rules.

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
   from the image. The tooltip catalog suggests Dreadmaidens' Sacrament combo (2),
   while ambiguous rarity/currency kinds remain unknown. Use **Tooltip catalog**
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
  given, so this guidance does not change numerical icon ranking.
- Combo goals use identified matching icons and a consistent threshold. The small
  verified catalog supplies Item Rarity (3), Exceptional Gem (3) and Dreadmaidens'
  Sacrament (2). A conflicting explicit threshold leaves activation unresolved.
  A threshold reached once is not assumed to pay multiple times.
- The search considers subsets of up to three input cards, including both orders
  of a supported duplicate pair. Two identical named T2 cards merge to T3: regular
  rewards of the first ×3; the second card's rewards are discarded. Two inputs are
  still consumed. At equal target progress, fewer input cards are preferred.
- Next-card recommendations require improved target progress over the best plan
  available from the collection alone. A neutral reward can still help when the
  new card enables a confirmed duplicate merge. No improvement means no preference.
- Three duplicates, mixed-tier merges, merges involving T3 and duplicate/combo
  interactions are unresolved, not assigned a zero benefit. They produce warnings.
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

The engine is in `shared/advisor.ts`, independent of React, capture parsing and
storage. Unit tests cover ranking, unknowns, thresholds, duplicate order and limits.
`e2e/advisor.spec.ts` covers both decisions, edits, map resets, archive isolation,
empty restored maps, explicit offer membership, local-only planning,
and desktop/tablet/mobile rendering alongside the existing collector regression suite.

The last ten collection edits and map resets can be undone during the visit.
Restoring another map requires explicit confirmation of the current instance.
After invoking in game, **Mark this invocation completed** removes exactly the
plan's cards and prevents selecting the same offer again. Undo restores that state.
Corrections in saved source offers are highlighted beside collected snapshots;
**Apply source correction** is explicit and can also be undone.
