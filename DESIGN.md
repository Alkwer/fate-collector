---
name: "Fate Collector"
description: "An evidence-led workbench for choosing and invoking Fates."
colors:
  background: "#0e1b22"
  surface: "#20353f"
  surface-raised: "#2a4651"
  surface-quiet: "#172b34"
  shell: "#142932"
  shell-text: "#e5f1f1"
  shell-muted: "#aec4ca"
  shell-active: "#2a4651"
  text: "#edf5f5"
  muted: "#aec2ca"
  border: "#3c535d"
  border-light: "#7d969f"
  accent: "#9be4d0"
  accent-ink: "#133b30"
  accent-hover: "#b9f0e1"
  success: "#9be4d0"
  success-surface: "#213e37"
  info: "#b1d6f3"
  info-surface: "#263e50"
  warning: "#f2cc91"
  warning-surface: "#443b2c"
  danger: "#ffbeb4"
  danger-surface: "#4a3031"
  input: "#172b34"
  evidence: "#10191e"
  selection: "#355f60"
  trail-background: "#edf1eb"
  trail-surface: "#ffffff"
  trail-surface-raised: "#e7ede4"
  trail-surface-quiet: "#f5f7f2"
  trail-shell: "#233b31"
  trail-shell-text: "#f6faf5"
  trail-shell-muted: "#c6d8ca"
  trail-shell-active: "#3b5747"
  trail-text: "#20362d"
  trail-muted: "#53685c"
  trail-border: "#cbd6c9"
  trail-border-light: "#819485"
  trail-accent: "#714791"
  trail-accent-ink: "#ffffff"
  trail-accent-hover: "#5b3478"
  trail-success: "#246b4e"
  trail-success-surface: "#e5f2e9"
  trail-info: "#315d87"
  trail-info-surface: "#e9f1f7"
  trail-warning: "#825514"
  trail-warning-surface: "#fbf0d9"
  trail-danger: "#a23730"
  trail-danger-surface: "#fbece8"
  trail-input: "#ffffff"
  trail-evidence: "#e2e9df"
  trail-selection: "#e4d7ed"
typography:
  display:
    fontFamily: "'Source Sans 3', 'Segoe UI', sans-serif"
    fontSize: "30px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-.025em"
  headline:
    fontFamily: "'Source Sans 3', 'Segoe UI', sans-serif"
    fontSize: "25px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-.02em"
  title:
    fontFamily: "'Source Sans 3', 'Segoe UI', sans-serif"
    fontSize: "21px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-.015em"
  subsection:
    fontFamily: "'Source Sans 3', 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.6
  wordmark:
    fontFamily: "'Source Sans 3', 'Segoe UI', sans-serif"
    fontSize: "18px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-.02em"
  body:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  control:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 600
  supporting:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
rounded:
  control: "7px"
  switch: "10px"
  surface: "14px"
spacing:
  compact: "8px"
  control: "12px"
  mobile: "16px"
  section: "20px"
  panel: "24px"
  workspace: "36px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.accent-ink}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "9px 15px"
  button-provisional:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.background}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
  input:
    backgroundColor: "{colors.input}"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
    height: "42px"
  nav-active:
    backgroundColor: "{colors.shell-active}"
    textColor: "{colors.shell-text}"
    rounded: "{rounded.control}"
    padding: "13px 12px"
  decision-switch:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    rounded: "{rounded.switch}"
    padding: "4px"
  review-panel:
    backgroundColor: "{colors.info-surface}"
    textColor: "{colors.info}"
    rounded: "{rounded.control}"
    padding: "18px"
  decision-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.surface}"
    padding: "0 26px 24px"
---

# Design System: Fate Collector

## Overview

**Creative North Star: "Mineral specimen catalog"**

Fate Collector presents advice like a specimen catalog. Align names, tiers and reward values for comparison, and keep the source capture nearby so players can inspect unfamiliar rewards.

Mineral Depth uses petrol and mint. Light Trail pairs an olive shell with pale neutral work surfaces and violet. Both use the same spacing, hierarchy and interactions.

**Key Characteristics**

- One decision surface with adjacent evidence
- Quiet navigation, visual reward comparisons and numbered invocation sequences
- Secondary tasks in named panels, opened by buttons; no accordion rows
- Uncertainty communicated in words and color

## Colors

- **Primary** uses Mineral Mint for actions and focus in Mineral Depth and Trail Violet in Light Trail. Pair each accent with its theme's action text and hover color.
- **State colors** pair supported green, review blue, caution amber and error red with quiet state surfaces. Light Trail distinguishes violet actions from green support.
- **Neutrals** frame the workspace with a petrol or olive navigation shell. Use the raised surface for evidence, regular dividers for rows, and the stronger border for interactive controls.

**The Semantic Color Rule.** Reserve green for supported advice, amber for provisional results or confirmation, and blue for review. Include the state in text.

The frontmatter uses the default values under the unprefixed keys and Light Trail under the matching trail-prefixed keys. Apply the semantic variables in src/tokens.css. The root theme attribute selects the palette.

## Typography

Self-hosted upright Source Sans 3 serves headings and the wordmark. Segoe UI Variable Text and Segoe UI serve body copy and controls.

- **Page heading** uses 30px at weight 650 and 25px on mobile. Recommendation headings use 25px at weight 600 and 23px on mobile.
- **Section heading** uses 21px at weight 650. Subsection headings start at 16px. Fate names use 20px and align with compact tier metadata.
- **Body** uses 15px with 1.6 line height. Controls use 15px with 1.4 line height. Supporting text starts at 13px. Use tabular numerals in comparisons and tables.

## Layout

The desktop shell has a 208px sticky navigation rail and a main workspace capped at 1480px. The decision panel takes the flexible column beside a 300px evidence column with a 26px gap. Evidence sits above the current collection. At 1200px, the rail narrows to 188px and the evidence column to 260px. At 1000px, the decision moves above the supporting row. At 760px, navigation moves to the top and support stacks in one column.

The empty state centers the capture action. In the archive, narrower layouts present journal records as stacked rows. Keep horizontal table overflow local to the table container.

## Elevation & Depth

Use the theme's ambient shadow for the decision panel, import and journal. The **More actions** menu and evidence or backup dialog use the stronger overlay shadow.

**The Functional Elevation Rule.** Lift the decision, import and journal surfaces and the overlays. Group nested detail with tone, spacing and dividers.

## Shapes

Work surfaces and overlays use a 14px radius. Controls and inline notices use a 7px radius. The mode switch groups two controls within a 10px track. Card comparisons, save feedback and panel content use straight dividers.

## Components

### Buttons and fields

- Primary actions use the theme accent. Provisional choice and invocation actions use amber with the provisional label nearby. Secondary actions use neutral text and a control border.
- The default button height is at least 40px. The interaction floor is 36px on desktop and 44px for buttons on mobile. Text fields have a 42px minimum.
- Focus is a 2px accent outline with a 4px offset. Use shell text for focus on navigation. Hover changes surface and border colors over 180ms. Honor reduced motion.

### Navigation and appearance

The active entry uses the raised shell tone, brighter text and a heavier weight. **More actions** houses **Appearance** on every screen. Mineral Depth is the default. The local preference restores on reload and the palette changes in place.

### Focused panels

Secondary actions open named native dialogs instead of accordion rows. Close, Done and Escape return to the task without discarding changes; focus returns to the entry action. The map's More actions groups manual editing, folder setup and capture help. Keep connection problems visible on the map. Editing retains save actions and feedback inside the panel. Modifiers, rewards and profile fields are directly visible within their editor rather than nested behind another disclosure.

Panel headings use 24px Source Sans 3 (21px on mobile). Headers and footers stay outside the scrolling body. Panels fit the viewport with 24px desktop and 8px mobile side margins; large editors can use 1180px. Text-only secondary actions use underlines, with no disclosure triangle.

### Decision and evidence

The mode switch presents **Choose a Fate** and **Plan invocation** with a persistent pressed state. Show the best recommendation or the next concrete check and reveal reward priorities, explanations and alternative plans as needed. The original capture opens at full size. Targeted review opens the relevant card and **Back to advice** returns focus to the decision.

The current-map offer presents up to three comparison columns, separated by rules rather than nested surfaces. Each shows the Fate name, tier diamonds with a text label, reward symbols and counts, a signed gain, and one collect action. On a phone these become compact rows with the gain beside the collect action. Repeated prose belongs in explanation panels; card modifiers remain available through a named Modifiers action. Provisional advice and unknown rewards remain explicit.

Invocation uses numbered input positions with connecting arrows, exact collection/offer references and the recorded rewards. Supported merges include a T2 + T2 → T3 diagram and short labels explaining which rewards survive. The primary action, **Done in game**, records completion in the local collection; it never implies game automation. Regular outcome totals are icon units, combo totals retain their threshold and activation state, and portfolio totals remain priority points.

Reward imagery combines the existing three sourced tooltip-reference images with neutral interface symbols for familiar categories. These interface symbols are reading aids, not claimed game artwork or new recognition evidence. Unknown kinds/meanings use a question mark with **Kind unknown** or **Unidentified** and a review cue; never infer meaning from a motif. Source evidence and the capture flow remain available. A filled map uses a compact import control.

Visual decision styles live in `src/decision-visuals.css`, loaded after the existing stylesheet. Reward symbols are 48px in comparison columns and 24px in collection/sequence summaries. Signed gains use 30px and plan totals use 40px (36px on mobile). Labels stay at least 13px. Large text and symbols use the existing semantic palette in both themes.

## Do's and Don'ts

- Do keep the next action and its supporting evidence easy to find.
- Do expose focus, pressed state and pending or saved status in both themes.
- Do use real captures and game terms when showing evidence.
- Don't use color alone to communicate confidence, selection or review status.
- Don't add decorative game artwork or invented observations.
