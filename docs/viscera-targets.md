# Viscera targets

The Viscera target picker stores the selected item name on the current device.
It uses the area name or internal ID saved in the current offer, once the offer
belongs to the current map. A match means the source lists that boss and area.
The planner reports missing or ambiguous matches and does not estimate drop odds
or availability of a specific item variant.

The snapshot checked on 18 November 2026 groups 166 [PoEDB Viscera
records](https://poedb.tw/us/Viscera) into 164 target names. Named bosses,
locations and encounter entry names come from their drop records. For area
matching, aliases come from the associated PoEDB WorldAreas records and the
[Atlas of Worlds](https://poedb.tw/us/Atlas_of_Worlds). Campaign matches require
the correct act. An encounter entry item can be listed without a verified area
ID. Legacy or ambiguous IDs must stay unknown unless verified.

Two guardian names are transposed in the Viscera table. The boss and area
records verify the [Lair of the Hydra](https://poedb.tw/us/Lair_of_the_Hydra) and
the [Pit of the Chimera](https://poedb.tw/us/Pit_of_the_Chimera). Bloodied Arm
retains PoEDB’s tentative boss attribution and unknown area.

Since [3.30.0c](https://www.pathofexile.com/forum/view-thread/4017172), a boss
spawned by Savage, Pestilent or Sadist always drops its own Viscera when killed.
The companion comes from a random pool of campaign bosses without Atlas
equivalents. The selected target and its listed area sources do not determine
which boss spawns or guarantee that it drops the selected item.

The planner counts the companion drop for the confirmed Tier 2 Pestilent and
Sadist and Tier 3 Savage, Pestilent and Sadist. The Tier 2 evidence comes from
the [screenshot catalog](../research/SCREENSHOT_CATALOG_2026-11-15.md), and the
Tier 3 effects come from [PoEDB](https://poedb.tw/us/Fates). The planner checks
the effective tier of a supported pair merge. Suggested or unknown tiers and
the unresolved output of a three-copy invocation get no guaranteed drop credit.
Build danger settings, modifier filters and card exclusions still apply.

Choose a Fate, Plan invocation and the overlay consider the companion drop
alongside the main boss’s Fate count and duplicate benefits. Options with
different advantages can remain available. Companion options appear first in
invocation advice, and reward priorities break ties when the Viscera factors
match. The planner reports the reward trade-off in priority points and assigns
no target odds or extra credit for multiple companion Fates.
