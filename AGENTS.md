# Fate Collector: UI workflow

- For UI work, use the installed `impeccable` skill as the primary design
  workflow. Read `PRODUCT.md`, `DESIGN.md`, and the relevant source before
  editing. Follow the global collaboration rules; do not stack competing
  aesthetic skills by default.
- Improve the existing task-oriented interface unless the user requests a
  redesign. Preserve the product constraints in `PRODUCT.md`. User-facing
  application copy stays in English; conversation language follows the user.
- `docs/design/design-spec.md` records product and interaction requirements.
  `src/tokens.css`, the full cascade in `src/styles.css`, and current components
  show the implemented appearance. Earlier concept images and screenshots are
  historical references, not proof of the current UI.
- Use existing React components and plain CSS. Styling work must preserve
  collection, evidence, autosave, review, solver and upload behavior.
- Run the installed skill's launcher from this repository; on Windows use
  `scripts/impeccable.cmd` inside the skill directory. Automatic detector hooks
  are disabled in this setup. After UI edits, run `detect` on the changed UI
  files once and assess its findings against the product and design brief.
  Do not treat taste warnings as authority to replace the established style.
- Validate rendered UI and the affected flow as required by the global rules.
  Use the existing checks from `package.json`; setup and local verification
  commands are in `docs/design/impeccable.md`. A detector scan does not replace
  browser verification or native capture validation.
