# Impeccable setup

Configured on 2026-11-11 for this checkout of Fate Collector.

## Installation

The Codex user skill is installed globally at
`%USERPROFILE%\.codex\skills\impeccable` (or the equivalent custom Codex home).
It is available to new Codex turns; reopen the chat if the skill list has not
refreshed. No application dependency or build step is added.

- Skill: **4.8.2**, official `pbakaus/impeccable` repository, commit
  `c1e0e5492fbb524f5df84d635ecfae7dc438ec45`.
- Windows x64 engine: **0.1.22**, downloaded from the official release and
  checked against the bundled SHA-256 manifest.
- Launcher: `scripts/impeccable.cmd` within the installed skill.

Other machines need their own skill installation. Keep `AGENTS.md`, `PRODUCT.md`,
`DESIGN.md` and the shared `.impeccable` documents/config in version control;
do not commit the global binary or private local configuration.

## Using it in Codex

Examples of chat requests (not shell commands):

```text
$impeccable critique: oceń obecny Collector i wskaż najważniejsze problemy UX.
$impeccable audit: sprawdź dostępność i responsywność ekranu wyboru Fate.
$impeccable polish: dopracuj ekran wyboru Fate zgodnie z PRODUCT.md i DESIGN.md.
```

`critique` is a review; `polish` requests implementation. New visual directions
remain explicit user decisions. For routine refinements, use the existing
system and the task-oriented application workflow.

The skill reads product and design context from the repository root. It runs
`context --target <source-file>` once per session, from this repository. On
Windows, use its `.cmd` launcher.

## Detector and hooks

The setup uses a manual detector pass performed by the agent after UI changes.
Automatic hooks are explicitly off. The locally detected Codex CLI was
`0.130.0-alpha.5`; the official Impeccable Windows hook manifest uses
`commandWindows`, documented in its source for Codex 0.146.0+.
This is a setup-time compatibility observation, not a permanent product limit.

After upgrading, automatic hooks can be configured separately using the
official supported installation flow and `$impeccable hooks on`. A global
Codex skill alone is not the project `.agents/skills/impeccable` installation
expected by the current hook wiring. The user must also approve the hook via
`/hooks` the first time. Do not claim automatic checks are active before the
harness has loaded and trusted them.

Manual scan example in PowerShell:

```powershell
$impeccableRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
$impeccableLauncher = Join-Path $impeccableRoot 'skills\impeccable\scripts\impeccable.cmd'
& $impeccableLauncher detect --json src/tokens.css src/styles.css src/App.tsx src/components
```

For routine edits, pass only the affected UI files. Exit 0 means no primary
findings; 2 means findings were returned; 1 means a target could not be scanned.
Review findings against the brief and current rendered behavior. Do not disable
rules broadly just to get a clean result. Static scans do not prove visual or
behavioral correctness.

## Local UI validation

Use the current README and `package.json` as the command authority. The project
uses React, Vite, TypeScript and plain CSS, with a Cloudflare Worker and D1 API.

- For local development, prepare the local build/database as documented, run
  `npm run dev:api`, then `npm run dev` in another terminal.
- `npm run check` runs the repository's type, unit and build checks.
- `npm run test:e2e` builds and starts the existing local Worker/D1 Playwright
  test environment. Use relevant tests and inspect representative desktop,
  tablet and mobile layouts for UI changes.
- Test recognition with the separate helper/native workflow when that behavior
  changes; browser tests do not validate real game captures.

Live variant mode is optional and has not been started or injected into the app.
The project records `buildPath: "code"`: new promotional and showcase surfaces
start directly in code, following the established design system. An explicit
request can still use a generated comp. Application screens and documents use
the code-led workflow regardless of this setting.

When `DESIGN.md` changes, refresh `.impeccable/design.json` from the current
document and relevant component styles. Keep token primitives in `DESIGN.md`;
the sidecar carries preview snippets and extra metadata. Validate configuration
with `scripts/impeccable.cmd doctor --json` from the installed skill.
