# HBBatchBeast agent instructions

## Cross-platform paths (MUST)

HBBatchBeast ships for Linux, macOS, and Windows. Any change to path handling, external tool
discovery, file opening, or process launching MUST work on all three platforms. This is a strict
requirement, not a preference.

- MUST build filesystem paths with `node:path` (`join`, `resolve`, `dirname`, `basename`,
  `extname`). NEVER concatenate `/` or `\` or hardcode a separator.
- MUST use Electron's path APIs instead of hardcoded locations: `app.getPath('userData')` for
  config/run state, `app.getPath('logs')` for logs, `app.getPath('home')` for the home directory,
  `app.getPath('temp')` for temporary files, and `app.isPackaged` / `process.resourcesPath` for
  packaged resources.
- MUST keep app config and logs in those Electron directories. Do not add new files under
  `~/Documents`, `%APPDATA%` directly, or another hardcoded root.
- MUST resolve platform-specific external tools and config files through a shared resolver (see
  `src/backend/helpers/handBrakePresets.ts` for HandBrake). Add an equivalent resolver before
  introducing another external tool. The executable used for conversion MUST be the same one used
  for discovery.
- MUST open paths with Electron `shell.openPath` / `shell.showItemInFolder` and MUST surface
  failures to the user or log them; do not silently ignore an error string.
- Renderer code MUST NOT import `node:path`. Put separator-agnostic helpers in `src/common` (for
  example `pathUtils.ts`) and use them from both the renderer and main process.
- MUST compare paths after normalizing `\` and `/`, compare whole path segments (not raw
  `startsWith` on user input), and treat Windows drive-letter and UNC paths case-insensitively.
- MUST expand a leading `~` in user-entered paths with `expandHomePath` before resolving them.
- MUST spawn external programs with an argv array and no shell, pass `windowsHide: true`, and use
  `.exe` only where Windows actually requires it. Let `PATH` resolve bare command names.
- MUST preserve the legacy `~/Documents/HBBatchBeast` data through the one-time migration in
  `src/backend/helpers/appPaths.ts`; never delete a user's old files.
- Every path-related change MUST include tests covering POSIX forms (`/media/movies`) and Windows
  forms (`C:\Media`, `C:/Media`, `\\server\share`), and MUST NOT regress Linux, macOS, or Windows
  behaviour.

## Plex and organizer paths (MUST)

- Treat a Plex database as an external, absolute, host-native path. Resolve `~` with
  `expandHomePath`, but never rewrite it to an app-relative path or a URL.
- Plex stores `media_parts.file` as a native absolute path and `directories.path` as a path relative
  to the library root using host separators. Write both with `node:path` semantics.
- Plex stores external subtitle locations in `media_streams.url` as `file://` URLs. Convert with
  `pathToFileURL` / `fileURLToPath`; never hand-build a URL.
- Never write `metadata_items`: Plex's FTS4 ICU triggers make `node:sqlite` fail. Update
  `media_parts`, `directories`, `media_streams` and watch-state tables only.
- Always back up the Plex database before writing, use a single transaction, and re-check that Plex
  is stopped (it may restart between the preflight and the write).
- Watch state is keyed by metadata GUID (`metadata_item_settings.guid`,
  `metadata_item_views.guid`), not by file path. Move or merge rows when a file's episode changes,
  and queue a pending transfer when the target episode does not exist yet.
- Control Plex through argv arrays (`systemctl`, `launchctl`, `tasklist`/`taskkill`) with no shell and
  `windowsHide: true`; fall back to OS-specific instructions instead of elevating.
- Put organizer journals, pending transfers, TVDB caches and Plex backups under `AppPaths`
  (`configDir`, `cacheDir`, `backupDir`); never under `~/Documents`.
- Sanitize generated file and folder names for the target platform (reserved names, control
  characters, trailing dots/spaces, 255-byte limit) and compare collisions case-insensitively on
  Windows and macOS.
- Add simulated `linux`/`darwin`/`win32` tests for per-OS Plex database candidates and service
  commands; CI stays Ubuntu-only.

## Validation

Run the smallest relevant test first, then `pnpm typecheck`, `pnpm lint`, and `pnpm test` before
finishing.

Changes that touch `src/**`, `forge.config.ts`, the `vite.*.config.mts` files, `packaging/**` or
`index.html` need a changeset. Run `pnpm changeset`, commit the generated `.changeset/*.md`, and let
the husky pre-commit hook flatten it into `package.json` and `CHANGELOG.md`.
