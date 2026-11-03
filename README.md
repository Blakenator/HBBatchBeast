# HBBatchBeast

A desktop app for batch-converting video with **HandBrakeCLI** or **FFmpeg**. Libraries describe
your folders and scan filters, conversion presets describe the encoding recipes, and ordered mapping
rules choose a preset per file (for example 480p → mobile, 1080p → TV). It scans recursively, skips
files that already have output at the destination, and works through the queue with a configurable
number of workers. A one-off **conversion** flow handles a single folder without creating a
library.

This is a fork of [HaveAGitGat/HBBatchBeast](https://github.com/HaveAGitGat/HBBatchBeast). The original
single-file jQuery app has been replaced rather than patched: the Electron + React + TypeScript app lives at
the repository root.

## Requirements

- **Node.js 22+** and **pnpm 10** (development only).
- **HandBrakeCLI**. The app looks on `PATH` first and then in the platform's common
  install locations: `Program Files\HandBrake` and `%LOCALAPPDATA%\Programs\HandBrake` on Windows,
  `/Applications/HandBrake.app/Contents/MacOS` and Homebrew on macOS, and `/usr/bin`,
  `/usr/local/bin` and Snap on Linux. User presets are imported from the platform HandBrake config
  location (`%APPDATA%\HandBrake`, `~/Library/Application Support/HandBrake`, `~/.config/ghb`, and the
  Flatpak/Snap equivalents).
- **FFmpeg** on `PATH` (only needed for the FFmpeg encoder mode).
- ffprobe is bundled through `ffprobe-static`, so media inspection works without a system install.

## Using the app

1. On the home screen, choose **Convert** or **Organize**, then pick a saved library. Each picker
   also offers a one-off session — a temporary setup page with the same folders, preset, mapping-rule
   and scan-filter controls as a library — and each library row’s overflow menu can pre-fill that
   one-off from the library. Nothing is saved unless you choose **Save as library** after reviewing
   the queue.
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

## Organizing existing files

**Organize** is a peer mode to conversion, not a step that requires it. Most files only need to be
renamed into a library layout; conversion is optional. Libraries are not split by mode: every
library has a **media type** (Movies or TV) and is available from both the **Convert** and
**Organize** pickers with the same source folders. Organizer defaults — metadata source, naming
rules, confidence, sidecars, collisions and show matches — are saved on the library as you edit them.
The Plex database is one machine-wide setting shared by every library.

1. Choose **Movies** or **TV shows**, then add one or more source folders. A TV source folder is a
   *library root that contains shows*; a folder that directly contains media is treated as a single
   show.
2. For TV, choose **Detect & match shows**. Each first-level show folder is listed with its file
   count and matched to TVDB from the folder name (`Blue.Planet.II.2017.1080p` → *Blue Planet II*
   (2017)). Every match shows its cover art and can be changed or cleared; matches are persisted on
   the library. Opening the search pre-fills the folder-derived query and reuses the results from the
   automatic attempt, so a failed auto-match is one click away from a manual pick. A folder can also
   be declared **Whole folder is one show**, which is useful when the folder already contains a
   single show or for a one-off rename. Tick **Scan only** on one or more shows to limit discovery,
   probing and matching to that subset; “Scan the whole library” clears the selection. For movies, choose **Plex database** to reuse Plex's
   metadata, or **TVDB** to search without Plex. Resolution comes from ffprobe (with the filename as
   a fallback), so Plex is never required. TV episodes are resolved from two independent signals —
   the `SxxEyy` tag and the filename's episode title — with an embedded air date as a tiebreaker.
   Regional tags often disagree with the title, so conflicts are labeled and low-confidence rows stay
   in review instead of being guessed.
3. Edit the ordered **naming rules**. Rules are evaluated top to bottom and the first match wins; the
   last rule is a locked default. Conditions can use media type, path, filename, extension,
   resolution, season, episode, title and year with `is`, `is not`, `contains`, `does not contain`,
   `at least` and `at most`.
   - The default TV templates are `{tag} - {name}.{ext}` inside `{show}/Season {season:02}`. When the
     source folder *is* the show, the `{show}` segment is dropped, so single-show libraries keep a
     flat `Season NN` layout.
   - Templates are chip editors: typing `{` or pressing the **Insert variable** button (`{}`) opens a
     searchable list of variables with descriptions and examples, choosing one inserts a removable
     chip, and an example line under each field shows the rendered result for every token. Tokens
     include `{show}`, `{seriesYear}`, `{tag}`, `{name}`, `{season}`, `{episode}`, `{episodeEnd}`,
     `{title}`, `{year}`, `{airDate}`, `{resolution}`, `{width}`, `{height}`, `{ext}` and the source
     file tokens. Number tokens are unpadded by default; append `:02` for zero-padded values
     (`{season:02}`, `{episode:02}`). `{airDate}` renders `2017-10-29` and supports
     `:short` (2017-10), `:year`, `:month`, `:day`, `:compact` (20171029) and `:dot` (2017.10.29).
     `{resolution}` is the bucket label (`4K`, `1080p`, `576p`, `SD`), while `{width}`/`{height}` are
     the probed pixel dimensions. Compatibility aliases such as `{seriesName}`, `{episodeTag}`,
     `{episodeName}`, `{resolutionBucket}` and `{extension}` are accepted.
   - Windows reserved names, control characters, trailing dots/spaces, filesystem-invalid
     characters and over-long names are sanitized before anything moves.
   - Specials always use `S00` as the season, including TVDB `SPECIAL` labels, so a special renders
     as `S00E07` in `Season 00`.
4. The page is a three-step flow — **What to organize → Naming rules → Review and apply** — with one
   step visible at a time, so the scan results do not compete with the settings. **Scan files**
   builds a review plan and reports live progress from the scanner: a discovered-file count while
   walking the folders, then a real percentage with the file and show currently being probed and
   matched, plus elapsed time and an estimate of the remainder. Nothing changes on disk until
   **Apply**. The review table
   works like the conversion queue: sortable and resizable columns whose order and visibility are
   remembered, virtualized rows, status chips (all / will rename / skipped / conflicts / low
   confidence / match review) and search. Paths are not shown as long strings: the table uses
   structured `Show`, `Season`, `Folder`, `Current name` and `New name` columns (TV-only columns
   collapse for movies). The `Folder` column shows the folder before → after when a rename moves the
   file into a different show/season folder, and the changed parts of both the folder and the file
   name are highlighted. The **Match** column is a two-faced badge: `strong`, `weak` or `conflict` on
   the left and the confidence percentage on the right. Hover or focus it for the weighted breakdown
   of tag, title and air-date evidence together with the full reason. Each row has a `…` menu with
   **Fix match** and **Open folder**. Rows whose file and folder names are already identical are
   skipped automatically. Full paths stay in the tooltips, the table scrolls inside its panel, and
   the page itself never grows wider.
5. **Fix match** on any row overrides the show, episode or movie for that file. The search starts from
   the parsed title; **Use file name** drops the exact file name (without the extension) into the
   episode filter for TV (which then picks out its `S01E02` tag) or into the movie search; the chosen
   result carries a clear checkmark, and each result is a collapsible card — clicking it selects the
   match, while the chevron expands the full description without changing the selection. Episode
   results are ranked by the same tag/title evidence and show a compact match badge; the extracted
   filename title is displayed above the list, and the **New filename** preview updates with the
   selected episode or movie before saving. The fix is saved on the library (so a later scan keeps it)
   and re-plans only that row; **Use best guess** removes it.
6. **Apply** first shows a confirmation with the exact move count and whether Plex will be updated.
   **Undo last** reverses the previous file moves from its journal.

**One-off organize** starts from the Organize picker (blank) or from a library row’s overflow menu
(seeded with that library’s folders and organizer defaults). It works on an unsaved copy, so nothing
you do changes a saved library, and **Save as library** promotes the session afterwards.

TVDB search results show small cover art, a loading indicator, an inline error with retry, and an
explicit empty state.

### Plex updates and watch history

Updating Plex is optional per operation. When it is on, HBBatchBeast checks the database, checks
that Plex is stopped, writes a timestamped backup under `<userData>/backups`, and then updates
`media_parts.file`, the `directories` tree and external subtitle `media_streams.url` values in one
transaction. It never writes `metadata_items`.

Watch history is keyed by Plex's metadata GUID, not by path, so history follows the file: when a TV
file is matched to a different episode, the watch rows are moved or merged onto the correct episode.
If Plex has not created that episode yet, a pending transfer is recorded in
`<userData>/organize-pending.json`; rescan Plex, then choose **Complete pending history**.

When Plex is running, Apply offers three choices: **Stop Plex and continue** (best effort through
systemd, launchd or the Windows process), **Apply without Plex** (files only), or **Cancel**. Plex is
restarted after an apply attempt when HBBatchBeast stopped it. If Plex is managed by Docker or a
remote host, stop it there and use **Check** to recheck.

| OS | Plex database candidate | Service |
| --- | --- | --- |
| Windows | `%LOCALAPPDATA%\Plex Media Server\Plug-in Support\Databases\com.plexapp.plugins.library.db` | Plex tray icon, or `Plex Media Server.exe` |
| macOS | `~/Library/Application Support/Plex Media Server/Plug-in Support/Databases/com.plexapp.plugins.library.db` | launchd job `com.plexapp.plexmediaserver` |
| Linux | `/var/lib/plexmediaserver/Library/Application Support/Plex Media Server/Plug-in Support/Databases/com.plexapp.plugins.library.db` (or `~/.config/plex/...`) | `systemctl stop plexmediaserver` |

The Plex data directory is usually owned by the `plex` service account. On Linux, add your user to
the `plex` group (then sign in again) or grant an ACL; on Windows use `icacls`; on macOS adjust
Finder/Get Info permissions. The app shows the OS-specific remediation instead of asking for
elevation.

TVDB lookups use TVDB's public site search and all-seasons pages, so no API key is needed. Responses
are cached under `<userData>/cache/tvdb`. TVDB data is attributed to TheTVDB in the Organize
screen; the app stays GPL-3.0-only.

Settings is a full page rather than a drawer, with **Global settings**, **Libraries** and
**Presets** tabs. The **Libraries** tab opens with a shared header — library picker, the active
library's name and Movies/TV type, and the create/duplicate/delete actions — above two sub-tabs:
**Encoding** (folders, encoder, presets, mapping rules, scan filters and file handling) and
**Organizer** (metadata source, naming rules, confidence, sidecars, collisions and cleanup). The
header summary shows the selected library's type, folder count, mapping-rule count and default
preset, and deleting a library asks for confirmation first. Language, worker count, verbose worker
logs, the Plex database and diagnostics/log locations apply to the whole app; folders, encoding,
mapping rules, scan filters, file handling and organizer defaults belong to the active library.
Settings save automatically as you edit them. The header's back button returns to the previous screen
(the door’s library picker, the run you left, or the home screen).

### Where files live

Config, presets and run state live in Electron's `userData` directory; logs live in Electron's
`logs` directory. The exact paths follow the OS conventions:

| Location | Purpose |
| --- | --- |
| `<userData>/Configuration.json` | libraries, presets and app settings (a `.v1.bak` or `.v2.bak` copy is written before a schema migration) |
| `<userData>/run-journal.json` | state of the last run, used to report an interrupted run |
| `<userData>/organize-journal.json` | file moves and Plex changes from the last organize apply, used by **Undo last** |
| `<userData>/organize-pending.json` | watch-history transfers waiting for a Plex rescan |
| `<userData>/backups/` | timestamped Plex database backups taken before an update |
| `<userData>/cache/tvdb/` | cached TVDB search and episode pages |
| `<logs>/` | master, error, conversion and scan logs plus filter caches |

| OS | `userData` | `logs` |
| --- | --- | --- |
| Windows | `%APPDATA%\HBBatchBeast` | `%APPDATA%\HBBatchBeast\logs` |
| macOS | `~/Library/Application Support/HBBatchBeast` | `~/Library/Logs/HBBatchBeast` |
| Linux | `$XDG_CONFIG_HOME/HBBatchBeast` (or `~/.config/HBBatchBeast`) | `$XDG_CONFIG_HOME/HBBatchBeast/logs` |

On first launch after upgrading from a build that used `~/Documents/HBBatchBeast`, the existing
config, run journal and logs are copied into these locations. The old files are left untouched, so
downgrading remains safe.

**Logs & diagnostics** in Settings lists those logs, opens the folders, clears the filter and TVDB
caches, and clears a recovered run journal.

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

## Versioning and releases

Versions and changelog entries come from [changesets](https://changesets.dev). Any commit that changes
the shipped app (`src/**`, `forge.config.ts`, the Vite configs, `packaging/**`, `index.html`) needs a
pending changeset:

```bash
pnpm changeset          # describe the change and pick patch/minor/major
git add .changeset/… && git commit
```

The husky pre-commit hook refuses such a commit without a changeset, and otherwise flattens every
pending entry with `changeset version`, staging `package.json`, `CHANGELOG.md` and the consumed
changeset files in the same commit. Docs, tests, CI and tooling changes do not need one.

```bash
pnpm release:version    # manual flatten, if a commit bypassed the hook
pnpm release            # annotate v<version> at HEAD after merging
git push --follow-tags
pnpm make               # build installers, then publish them on GitHub
```

Set `HBB_SKIP_CHANGESET_FLATTEN=1` to skip the hook for a single commit (for example while resolving a
merge). Version tags are `v<version>`; tags from before changesets (`2.1.5`, `2.1.4`, …) keep their
original form.

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
- A home screen offers **Convert** and **Organize** doors; each opens a library picker with a one-off
  session alongside saved libraries, then flows into the run screen (scan → review → run) or the
  organizer.
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
