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
