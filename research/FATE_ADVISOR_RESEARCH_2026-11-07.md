# Fate Advisor — Covens of Umbra rules and the limits of their interpretation

Status: **11 November 2026**, updated with the official FAQ and 3.30.0 patch notes. Verification of the Q&A recording and the DatModz and Octavian showcase dates from 8 November. Pre-release material, without our own in-game tests of the mechanics. The filename retains the date of the initial investigation.

## Findings and verification scope

On 7 November, the automatic English captions for the entire PoE1 presentation in [GGG's official broadcast — day 1](https://www.youtube.com/watch?v=8FKW2rKJyxA) were read, approximately 03:08:45–03:35:25. The Fates segment was additionally checked against video frames, including tooltips and the duplicate-merging animation.

On 8 November, clarifications from the [original PoE1 Q&A panel — day 2](https://www.youtube.com/watch?v=8CEAhCzmXJM&t=11220s) were verified, particularly around **03:07:06–03:10:07**. The source was the automatic English captions downloaded directly from the Path of Exile channel's broadcast. A range covering the panel was downloaded and searched for statements about cards, merging, rewards and rarity; the entire Fates segment was read in context. Selected moments were also played in the YouTube player, and the displayed captions and timing were compared with the downloaded segments. A video frame confirmed that this was a discussion panel, rather than an in-game demonstration of merging cards.

This is direct verification of the caption content from the official recording, **not an independent transcription by ear or a test of the game's behavior**. The ASR contains errors, particularly in names; for example, it transcribes Fated as “faded”. The spelling of this label was not confirmed on a tooltip in the Q&A; it was later confirmed in the DatModz showcase footage. Timestamps refer to the entire broadcast; links start a few seconds before the statement. The range and segment identifiers are recorded in the [verification metadata](evidence/qa-2026-11-08-verification.json).

The [DatModz and Octavian showcase on day 1](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=25200s) was then checked. As YouTube captions were no longer available for the recording, the audio from **07:00:00–07:27:00** was transcribed locally using whisper.cpp 1.9.2 / base.en, and the entire transcription was read. Fate selection and invocation were compared with video frames, and the merging sequence was additionally checked at one-second intervals. This is automatic transcription and image analysis, without independent correction by ear. [Showcase metadata and saved frames](evidence/showcase-2026-11-08-verification.json).

The initial player error encountered during the first investigation was resolved by reading public captions and broadcast segments. Press materials and a later community report helped locate details; the Q&A findings below have since been checked against the primary source.

## Confirmed rules

- Regular Fates remain in the instance in which they were collected. The showcase mentions collecting as many as four–five cards in an area and invoking a maximum of three. Four–five was not presented as an absolute limit. Each card has at least one regular reward; it may also have a combo. [Segment](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=11590s).
- A combo requires the appropriate number of copies of **the same reward icon**, rather than a fixed set of Fate names. [Segment](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=11620s).

| Combo | Requirement | Effect | Evidence |
| --- | --- | --- | --- |
| Item Rarity | 3 copies of the appropriate icon | A very large increase to the boss's Item Rarity; no number given | [03:13:50](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=11630s), evidence/item-rarity-03h13m57.png |
| Exceptional Gem | 3 copies of the appropriate icon | An additional Exceptional Gem; the presenter describes it as an exceptional support | [03:14:30](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=11670s), evidence/exceptional-tooltip-03h14m37.png |
| Dreadmaidens' Sacrament | 2 copies of the appropriate icon | A specific unique Basalt Flask | [03:14:45](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=11685s), evidence/flask-tooltip-03h14m57.png |

The shown Bloodthirsty + Sanguine + Deathbringer activate Exceptional Gem. This is an example of specific cards with matching icons, rather than a universal recipe for those three names. Wildfire was shown with a flask icon.

## Duplicates: statement and interface observation

GGG announces that the rewards of **the first Fate played** are tripled after merging copies of the same type. [Presentation](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=11700s). The later Q&A explicitly states that **the second card's rewards are discarded**, and that cards can be withdrawn and played again in a different order. This does not mean tripling the combined rewards of both cards. [Q&A, from 03:09:45](https://www.youtube.com/watch?v=8CEAhCzmXJM&t=11385s).

The two-Conjurer sequence additionally shows that:

- the two cards become one card in the first slot;
- the first card's two regular icons each appear three times;
- the second card's separate icon does not appear in the result;
- the currency combo icon activates, while a greyed-out copy remains on the right;
- the merged card has more feathers indicating its tier.

Evidence: evidence/duplicates-before-03h15m02.png, evidence/duplicates-after-03h15m03.png, evidence/duplicates-sequence-03h15m00.png.

This confirms the interaction between duplicates and a combo in the example shown. The interpretation “triple the combo counter, then evaluate the threshold” fits the footage, but is not yet a verified general rule for all combos. It should not automatically be implemented for every reward.

The feather tooltip confirms that a higher tier increases Item Rarity and may strengthen dangerous effects. Evidence: evidence/fate-tier-03h15m02.png.

## Q&A clarifications — verified on 8 November

| Finding | Statement and limits of the conclusion | Day 2 source |
| --- | --- | --- |
| Rewards are not permanently assigned to a Fate name | Rewards are rolled independently of the card type; Rot is an example of a card that does not always have to give currency. This does not establish equal probabilities for all rewards or independence between individual icons. | [03:07:30](https://www.youtube.com/watch?v=8CEAhCzmXJM&t=11250s), statement around 03:07:36–03:07:56 |
| An icon's effect may also apply to the boss's other loot | Example: an effect that provides a speed mod on all boots dropped by the empowered monster also guarantees several pairs of boots. It also applies to other boots that the monster would have dropped anyway. This must not be reduced to one additional item. | [03:07:50](https://www.youtube.com/watch?v=8CEAhCzmXJM&t=11270s), statement around 03:07:56–03:08:11 |
| Items modified by the effect have the Fated label | The label distinguishes them when they drop, similarly to how Superior indicates quality. The Q&A describes its behavior; the spelling is confirmed by the later visual check of the DatModz showcase described below. | [03:08:05](https://www.youtube.com/watch?v=8CEAhCzmXJM&t=11285s), statement around 03:08:11–03:08:21 |
| The guaranteed mod is intended to be valuable | The explanation uses a physical mod as an example and indicates that it is high tier. No specific tier, value, mod list or promise of T1 on every item was given. | [03:08:20](https://www.youtube.com/watch?v=8CEAhCzmXJM&t=11300s), statement around 03:08:21–03:08:46 |
| Boss rarity also affects items from reward templates | Item templates can be modified by the assigned monster's rarity. In the example discussed, the item itself may also be more likely to have a higher tier. This partially resolves the earlier question about forced rewards; it does not establish how rarity affects every combo, currency, Exceptional Gems or a specific unique. | [03:08:45](https://www.youtube.com/watch?v=8CEAhCzmXJM&t=11325s), statement around 03:08:46–03:09:06 |
| Two tier 2 cards can produce tier 3 | In the context of duplicates and the example of two Rot cards, the explanation states that tier 2 and 3 versions exist in endgame, and tier 3 is obtained by merging two tier 2 cards. This is not evidence of a rule for any two names, mixed tiers or further merging with a tier 3 card. | [03:09:30](https://www.youtube.com/watch?v=8CEAhCzmXJM&t=11370s), statement around 03:09:36–03:09:51 |
| Duplicate order determines which rewards are retained | First card: rewards ×3. Second card: its rewards are discarded. Cards can be withdrawn and reordered before starting the fight. This confirms the earlier observation of the Conjurer animation, but does not reveal the full combo algorithm. | [03:09:45](https://www.youtube.com/watch?v=8CEAhCzmXJM&t=11385s), statement around 03:09:51–03:10:07 |

**Three distinct meanings of tier:** the Fate card's tier, the dropped item's tier and the tier of its specific mod. The Q&A distinguishes them within the same discussion; numbering and scaling rules should not be transferred from one to another.

## DatModz and Octavian showcase — three questions checked

Before invocation, the player has **Torchbearer T2 + Torchbearer T2 + Tempest T2**. After playing the two Torchbearers, the first card has three feathers (T3), and the middle slot is covered with black feathers. Tempest then goes into the right-hand slot; the player confirms the set. The sequence occurs around **07:24:51–07:25:08**. [Recording from 07:24:50](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=26690s).

| Question | What was actually shown | Conclusion |
| --- | --- | --- |
| Third duplicate | There are only two Torchbearers. Around 07:24:57–07:25:01, Octavian encourages playing the third card for its base rewards; on screen, this is **Tempest**. | “Third card” does not mean a third copy of Torchbearer. Further merging and another multiplier remain undetermined. |
| Mixed tiers | The Torchbearers being merged each have two feathers. The result has three; the remaining Tempest still has two. | The resulting set **Torchbearer T3 + Tempest T2** is confirmed, but merging cards with the same name and different tiers is not. |
| Card limit after merging | Three input cards were used, producing two active cards. The middle slot remains covered after adding Tempest, through to confirmation. There is no fourth card or attempt to play one. | Merging does not prevent adding the third input card. The footage **does not confirm that a slot is recovered** and suggests that the cost of two inputs is retained; the hard limit after merging remains unresolved. |

Comparison frames: [three cards before playing, around 07:24:51](evidence/showcase-before-07h24m51.png), [after merging the pair, around 07:24:55](evidence/showcase-merged-07h24m55.png), [after adding Tempest, around 07:25:00](evidence/showcase-third-card-07h25m00.png). The space left by the second card should no longer be described as a confirmed free slot.

The showcase again confirms the importance of order: around 07:23:55–07:24:09 and 07:24:50–07:24:56, Octavian talks about tripling the first Torchbearer's rewards. He does not present a rule for three duplicates or a mixed-tier table. [First explanation](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=26635s).

Additionally, the [tooltip from around 07:25:55](evidence/showcase-fated-07h25m55.png) clearly shows the spelling **Fated Apex Rapier**. Its visible “Tier 3” refers to the item, rather than the Fate card. [Loot segment](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=26735s).

## Update of 11 November 2026

The text of [GGG's official FAQ](https://www.pathofexile.com/forum/view-thread/4013527) and the “The Covens of Umbra Challenge League” and “Item Generation Changes” sections in the [3.30.0 patch notes](https://www.pathofexile.com/forum/view-thread/4013680) were checked again. Both sources were read on 11 November 2026. This verifies announcements, rather than game behavior.

### FAQ: selecting subsequent offers and sources of rarity

- The next set of Fates remains hidden until the player chooses a card from the previous offer. Interacting with another encounter may show the unresolved set again.
- Rarity from the player's equipment does not affect currency dropped by enemies; map and monster rarity may affect it. According to GGG, the contradictory card from the ExileCon card game was incorrect and outdated.

### Patch notes: general loot rules

- Monster or chest rarity affects the choice of drop pool. Currency has been divided into Magic Currency and Rare Currency, the latter including Chaos, Divine and Mirror. Previous restrictions on drops of items without rarity from magic, rare and unique monsters have been removed.
- From act 6, a magic or rare item may have **Item Tier 2–5**. This affects mods, base, quality, sockets and links. T5 may receive +1 to item level or drop as fractured magic. Ruthless does not have Item Tiers.
- Monster rarity affects the chance of tiered items and, at higher levels, of a rarer unique when a unique drops. Player rarity also affects the chance of tiered equipment.
- **Atlas Drops** replaces Item Quantity in map modifiers; it scales maps, Threads, specified additional drops and league resources, rather than all loot.

The patch notes do not provide the Fate-merging algorithm, a full combo catalogue or probabilities. General drop rules should not automatically be applied to every guaranteed Fate reward.

## Implications for Fate Advisor

The current implementation and limitations are described in the [Advisor guide](../docs/fate-advisor.md). The conclusions below define the scope for interpreting the evidence; they do not confirm that all proposed features have been implemented.

An advisor for choices within an area is worth building. Data for an individual card should include its type, tier, regular rewards and combo icons with thresholds. The name alone is insufficient.

The advisor should compare play orders, show activated combos and explain why the more beneficial copy should be invoked first. A comparison of the state before and after merging is needed; simply counting icons in the initial set may produce an incorrect result.

The Q&A supports keeping separate data on card tier, reward effects and resulting loot. The reward description should distinguish additional items from an effect applying to all items of a given type from the boss. For duplicates, information about which rewards belonged to the first card and which to the second must be retained; simply summing the set loses that distinction. The transition from two matching T2 cards to T3 can be recorded as an announced rule, without extrapolating to undocumented combinations.

The DatModz showcase supports counting **input cards** and **cards after merging** separately: three inputs produce two active cards here. The number of resulting cards should not be used to infer permission for a fourth input. Mixed tiers in the resulting set do not confirm that they can be merged further.

Profit optimization in divine/hour should not yet be promised. The first version can recommend variants based on the player's objective: a chosen item, reward category or difficulty limit. Unverified rules should return “undetermined”, rather than pretending there is no synergy.

**FAQ implications for planning and data collection:** the next-card recommendation can use the current offer and cards already collected, without knowing future offers. The invocation plan, meanwhile, concerns the collected set. An offer being shown again is not evidence of a new roll. A new capture ID or exceeding the 15-second duplicate-hint window does not prove that observations are independent; however, similar offers should not automatically be merged without evidence that they are the same offer.

**Implications for further loot research:** distinguish player, map and monster rarity, Atlas Drops and the actual fight outcome. Retain the patch and area level. The current contract does not have separate fields for these sources of rarity or the resulting equipment; additional observations can be described in `notes`, without adding unsupported fields. Item tier and mod tier do not belong in the card-tier field. Icon counts alone are insufficient for valuing rewards.

## Still undetermined

1. The full catalogue of icons, thresholds and rewards, and their frequencies.
2. Whether a third duplicate multiplies rewards again, what happens when attempting to merge a T3 card further, and how different tiers combine. The Q&A describes endgame T2/T3 and the T2 + T2 to T3 transition. The DatModz showcase contains only a T2 + T2 pair and another T2 card, so it does not resolve the remaining combinations.
3. Whether more than three input cards can be used after merging. The DatModz showcase confirms three inputs and two resulting cards, but the space left by the second card is covered with feathers, rather than visibly free. The hypothesis that the input cost is retained is consistent with the footage; no fourth input was attempted.
4. The full algorithm for how duplicates affect combos, multiple payouts and remaining icon copies.
5. Exact reward quantities, the Exceptional Gems pool and dependencies on area level.
6. The exact effect of rarity on each category of forced rewards, its quantity and combos. The Q&A confirms that monster rarity affects item templates and their tier, but provides no formulas, probabilities or universal multiplier for all rewards.
7. The exact catalogue of Fated effects, numbers of guaranteed items, their mod pools and tiers, and the effect of area level. The example of several pairs of boots provides neither a specific number nor a fixed mod tier.

## Supplementary sources

- [Official league page](https://www.pathofexile.com/covens).
- [GGG press kit](https://web.poecdn.com/public/news/2026-11-07/Kits_for_press_exc26/PoE1_CovensofUmbra_PressKit.zip): previously inspected files include Fates_UI.png, Fates_UI_2.png, InvokeFates_1.png and InvokeFates_2.png. They confirm different icon sets for the same Fate name.
- The [Output Lag report](https://outputlag.com/news/path-of-exile-3-30-covens-of-umbra-invoke-fate-cards-on-area-bosses-for-bigger-loot/) helped locate the recording. The main findings above have since been checked directly against GGG's material.
- The [Karui Polska Q&A report](https://karuipolska.pl/newsy/exilecon-2026-developer-panel-path-of-exile-1-q-a) identified clarifications to check. It is not the basis for the “verified” status — that basis is the original day 2 broadcast and its captions.

The documentation update of 11 November does not change the recommendation engine, recognition catalogue or data schema. No new in-game tests of the mechanics were performed. The undetermined rules listed above retain that status.
