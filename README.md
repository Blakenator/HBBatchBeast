# HBBatchBeast

A desktop app for batch-converting video with **HandBrakeCLI** or **FFmpeg**. Libraries describe
your folders and scan filters, conversion presets describe the encoding recipes, and ordered mapping
rules choose a preset per file (for example 480p → mobile, 1080p → TV). It scans recursively, skips
files that already have output at the destination, and works through the queue with a configurable
number of workers. A one-off **Quick convert** flow handles a single folder without creating a
library.

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

1. On the home screen, either start a **Quick conversion** or open a saved library. Quick conversion
   is a temporary setup page with the same folders, preset, mapping-rule and scan-filter controls as a
   library. You can also press **Use as quick run** on a library to pre-fill those fields from it;
   nothing is saved unless you choose **Save as library** after reviewing the queue.
2. Open **Settings → Libraries** to manage a library. Each folder row pairs a source with a
   destination; the **…** buttons open the OS folder picker, and multiple rows can be pasted or added
   at once. With temp staging on, every row also gets a temp folder.
3. Still in the library, choose the encoder (HandBrake or FFmpeg) and output container. Presets are
   shared across libraries and live in the **Presets** tab; each preset is a HandBrake preset name or
   raw arguments, or an FFmpeg `input,output` argument pair.
4. Build **Default mapping rules**. Rules are evaluated top to bottom and the first match chooses the
   preset. The bottom row is a locked **Default preset** used when no rule matches; it cannot be
   removed. Conditions can use folder/path, filename, file size, file type and media properties such
   as resolution or codec.
5. Build scan filters in the library's **Scan filters** section. Rules are a step-by-step AND/OR
   stack: add only the stages you need, combine them with **Match all** / **Match any** groups, and
   use the chip summary to review the whole expression. Media-property stages use searchable ffprobe
   property and value pickers.
6. **Scan** to build the queue — the table shows every file that does not already exist at the
   destination, with status chips, a path filter, resolved preset and a **Filter** column. Click that
   column to see the stage-by-stage reason a file was included, copied or excluded; hover the preset
   to see which mapping rule selected it.
7. **Start conversion**, then pause, resume or stop at any time. The header pill and the tray icon show
   the current state. Completed files are renamed into place only at the end: while a conversion runs,
   the output is written as `movie.temp.mkv`, so a stopped run leaves unfinished files clearly marked.
   This is on by default; turn it off under **File handling**.
8. Per-file **Info** opens the media-info viewer (container, duration, bit rate, per-stream codec,
   resolution/channels, language).

Destructive options (delete source, replace the original) are grouped and explained in the library
editor, and a single confirmation lists exactly what a run will do before it starts.

Settings is a full page rather than a drawer, with **Global settings**, **Libraries**, and
**Presets** tabs. Language, worker count, verbose worker logs, and diagnostics/log locations apply to
the whole app; folders, encoding, mapping rules, scan filters and file handling belong to the active
library. Create, duplicate, rename, and delete libraries from the **Libraries** tab. Settings save
automatically as you edit them. The header's back button returns to the home screen (or to the
library run you left).

### Where files live

| Path | Purpose |
| --- | --- |
| `~/Documents/HBBatchBeast/Config/Configuration.json` | libraries, presets and app settings (a `.v1.bak` copy is written on first migration from the profile format) |
| `~/Documents/HBBatchBeast/Config/run-journal.json` | state of the last run, used to report an interrupted run |
| `~/Documents/HBBatchBeast/Logs/` | master, error, conversion and scan logs plus filter caches |

**Logs & diagnostics** in Settings lists those logs, opens the folders, clears the filter caches and
clears a recovered run journal.

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

- Libraries, conversion presets and per-library mapping rules replace the old fixed profile slots;
  create, duplicate, rename and delete libraries from settings.
- A home screen offers Quick convert for one-off folders alongside saved libraries, then flows into
  the library run screen (scan → review → run).
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
