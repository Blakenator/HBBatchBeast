# HBBatchBeast

A desktop app for batch-converting video with **HandBrakeCLI** or **FFmpeg**. Point it at source
folders, choose a destination, pick a preset per folder, and it scans recursively, skips files that
already have output at the destination, and works through the queue with a configurable number of
workers.

This is a fork of [HaveAGitGat/HBBatchBeast](https://github.com/HaveAGitGat/HBBatchBeast). The original
single-file jQuery app has been replaced rather than patched: the Electron + React + TypeScript app lives at
the repository root.

## Requirements

- **Node.js 22+** and **pnpm 10** (development only).
- **HandBrakeCLI** on `PATH` (`apt install handbrake-cli`, `brew install handbrake`). Windows builds
  expect `HandBrakeCLI.exe` on `PATH` as well.
- **FFmpeg** on `PATH` (only needed for the FFmpeg encoder mode).
- ffprobe is bundled through `ffprobe-static`, so media inspection works without a system install.

## Using the app

1. Open **Settings** and add at least one source folder with its destination: each row pairs a source
   with a destination, the **…** buttons open the OS folder picker, and **Add folders…** adds several
   rows at once. Pasting multiple lines into a path field fills successive rows. With temp staging on,
   every row also gets a temp folder.
2. Adjust encoding, filters and file handling. The preset list is read from the HandBrakeCLI installed
   on your machine — including custom presets saved in the HandBrake app — one preset per source row;
   the custom path also accepts raw HandBrakeCLI arguments. FFmpeg mode takes its own arguments instead
   (the parts before and after `-i`). Advanced options are behind **Advanced options**.
3. Build scan rules in the **Filters** tab. Rules are a step-by-step AND/OR stack: add only the stages
   you need, combine them with **Match all** / **Match any** groups, and use the chip summary to review
   the whole expression. Media-property stages use searchable ffprobe property and value pickers.
4. **Scan** to build the queue — the table shows every file that does not already exist at the
   destination, with status chips, a path filter, and a **Filter** column. Click that column to see the
   stage-by-stage reason a file was included, copied or excluded.
5. **Start conversion**, then pause, resume or stop at any time. The header pill and the tray icon show
   the current state. Completed files are renamed into place only at the end: while a conversion runs,
   the output is written as `movie.temp.mkv`, so a stopped run leaves unfinished files clearly marked.
   This is on by default; turn it off under **File handling → Advanced options**.
6. Per-file **Info** opens the media-info viewer (container, duration, bit rate, per-stream codec,
   resolution/channels, language).

Destructive options (delete source, replace the original) are grouped and explained in the settings
drawer, and a single confirmation lists exactly what a run will do before it starts.

The settings drawer separates **Global settings**, **Profiles**, and **Filters** in tabs. Language,
worker count, verbose worker logs, and diagnostics/log locations apply to the whole app; folders,
encoding, filter rules, and file handling belong to the active profile. Create, duplicate, rename, and
delete profiles from the **Profiles** tab. Settings save automatically as you edit them.

### Where files live

| Path | Purpose |
| --- | --- |
| `~/Documents/HBBatchBeast/Config/Configuration.json` | profiles and app settings |
| `~/Documents/HBBatchBeast/Config/run-journal.json` | state of the last run, used to report an interrupted run |
| `~/Documents/HBBatchBeast/Logs/` | master, error, conversion and scan logs plus filter caches |

**Logs & diagnostics** in the settings drawer lists those logs, opens the folders, clears the filter
caches and clears a recovered run journal.

### Linux / Wayland

Electron draws no window decorations under native Wayland on GNOME, so the app runs on XWayland:
`scripts/start.mjs` passes `--ozone-platform=x11` in development, packaged builds re-exec once with
that flag, and the generated `.desktop` entry also carries it. Set `HBB_OZONE_PLATFORM=wayland` to
opt back into native Wayland.

## Development

```bash
pnpm install
pnpm start          # Electron Forge + Vite dev app
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint (flat config)
pnpm test           # vitest unit + fork-contract suites
pnpm package        # unpacked build in out/
pnpm make           # installers (deb/rpm/zip/squirrel) for the host platform
```

Useful extras:

- `HBB_DEBUG_PORT=9222 pnpm start` exposes a DevTools-protocol endpoint so UI flows can be driven by
  automation.
- `pnpm start -- --max-parallel 4` (or `HBB_MAX_PARALLEL=4`) refuses to start when more than four
  HandBrakeCLI/FFmpeg/ffprobe or worker processes are already running, and caps the worker count at the
  same number. Use it as a guard when other conversions or app instances may be active.
- `scripts/dev-smoke.sh 30` runs the app for 30 seconds and tears the whole process tree down again —
  Forge leaves zombie Electron windows behind otherwise.
- `HBB_INTEGRATION=1 pnpm test` adds a real HandBrake conversion of `tests/fixtures/sample.mp4`
  (requires HandBrakeCLI, takes a few seconds).

## Changes from the original app

Deliberately **removed** (the rewrite has no equivalent and legacy config keys are simply ignored):

- Remote monitoring / web view and API keys
- Scheduling: periodic re-scanning, daily run windows, folder watching
- Health check and repair
- Email notification settings
- h265 benchmarking
- Docker image and Travis CI

Also different:

- Settings are per **profile** with real create/duplicate/rename/delete instead of ten fixed slots.
- The UI is a single job-centric screen (choose folders → scan → review → run) rather than tabs.
- A cross-platform tray icon with status indicators, and an application menu with reload, zoom,
  devtools (development builds) and a bug-report link.
- A run journal means an interrupted run is reported as interrupted instead of looking completed.

## Documentation

- [`docs/user-stories-and-flows.md`](./docs/user-stories-and-flows.md) — personas, intents, user
  stories and the flows the UI is built around.
- [`docs/ui-design-intent.md`](./docs/ui-design-intent.md) — design principles, information
  architecture, screen states and accessibility notes.
- [`MIGRATION_STATUS.md`](./MIGRATION_STATUS.md) — feature-slice inventory, defect log and the current
  state of the migration.

## License

GPL-3.0, inherited from the original HBBatchBeast project. See [`LICENSE`](./LICENSE).
