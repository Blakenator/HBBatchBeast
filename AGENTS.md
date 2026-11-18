# HBBatchBeast

## Cross-platform paths (MUST)

HBBatchBeast ships for Linux, macOS, and Windows. All path handling MUST work on all three. The
full requirement lives in [.github/copilot-instructions.md](.github/copilot-instructions.md); the
non-negotiables are:

- Use `node:path` for every path; never concatenate `/` or `\`.
- Use Electron `app.getPath('userData')`, `app.getPath('logs')`, `app.getPath('home')`, and
  `process.resourcesPath` for app data and packaged resources.
- Resolve HandBrakeCLI and its preset files through the shared platform resolvers, and use the
  resolved executable for both discovery and conversion.
- Use `shell.openPath` / `shell.showItemInFolder` and surface failures.
- Renderer code must not import `node:path`; use `src/common` helpers instead.
- Normalize separators, compare whole path segments, and treat drive-letter/UNC paths
  case-insensitively.
- Expand leading `~` with `expandHomePath`.
- Spawn with argv arrays (no shell) and `windowsHide: true`.
- Keep the legacy `~/Documents/HBBatchBeast` migration intact; never delete old user files.
- Add POSIX and Windows-form tests (drive letters, UNC, `/`, `\`) for every path change.
- Treat Plex paths as host-native absolutes, convert external subtitle URLs with
  `pathToFileURL`/`fileURLToPath`, and never write `metadata_items`.
- Back up the Plex database before writing, keep the write in one transaction, and re-check that Plex
  is stopped.
- Watch state is GUID-keyed: move or merge history when an episode changes and queue pending transfers
  until Plex rescans.
- Sanitize generated names and compare collisions case-insensitively on Windows/macOS.

Validate with `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

Changes to `src/**`, the build configs, `packaging/**` or `index.html` need a changeset: run
`pnpm changeset` and commit the generated `.changeset/*.md` with the change. The husky pre-commit hook
only checks that one is present; the `Changesets` workflow consumes it after the merge by running
`changeset version` and opening the version pull request.

## Project Adapter

> Global methodology lives in the user-level agent kit (`~/.config/opencode`). This section supplies project
> facts. The global skills read it first. Do not add project-local copies of global skills or role agents.

### Identity
- **Name:** HBBatchBeast
- **One-line purpose:** Cross-platform Electron app for HandBrake batch conversion and Plex organization.
- **Primary users:** People converting and organizing local video libraries.

### Packages
| Path | Role | Test command |
|---|---|---|
| `src/` | Electron main, preload, renderer, shared helpers | `pnpm test` |
| `packaging/` | Packaging assets | — |

### Commands
- install: `pnpm install`
- typecheck: `pnpm typecheck`
- lint: `pnpm lint`
- test: `pnpm test`
- dev: `pnpm start`
- package: `pnpm package`
- changeset: `pnpm changeset`

### Knowledge base
- `AGENTS.md` and `.github/copilot-instructions.md` are the sources of truth.
- There is no `knowledge/` folder; durable decisions live in the change/PR and the project docs.

### Tracker
- Provider: GitHub
- Repo: `Blakenator/HBBatchBeast`
- Labels/branch/PR: use the repo's existing conventions.

### Quality gates
- Changesets: changes to `src/**`, build configs, `packaging/**`, or `index.html` need a changeset.
- Validate with `pnpm typecheck`, `pnpm lint`, `pnpm test`.

### Invariants
- Cross-platform paths: use `node:path`; never concatenate separators; use Electron path APIs.
- Never write Plex `metadata_items`; back up the Plex DB before writing; keep writes in one transaction.
- Watch state is GUID-keyed; move/merge history when an episode changes.
- Never delete legacy `~/Documents/HBBatchBeast` data; keep the one-time migration intact.
- Sanitize generated names; compare collisions case-insensitively on Windows/macOS.

### Role adaptations
- No feature team or marketing workflow is required; use the global review, testing, and completion skills.
- UX is desktop-first with a cross-platform constraint; no mobile surface.

### Triage
- Knowledge paths: `AGENTS.md`, `.github/copilot-instructions.md`, `README.md`.
- Design-system paths: existing renderer styles/components under `src/`.
- Package/version paths: `package.json`.
- Platform scope: Linux, macOS, Windows; Electron.
- Evidence recipe: screenshots of the affected dialog/flow; a short recording for progress/conversion states.
- Output directory: `.opencode/triage/`.
- Labels: `gh label list`; do not invent labels.
