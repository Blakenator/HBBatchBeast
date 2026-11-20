# hbbatchbeast

## 2.4.0

### Minor Changes

- 877d38c: Add bulk multi-episode handling to Organize. Select rows and choose **Multi-episode** to detect the run from the episode tag plus the joined episode titles in the filename, renumber the selection sequentially with a fixed number of episodes per file (each show/season starts at E01 and editing a start number cascades), or keep each file's current number and append the following episodes. The preview highlights what changes in each new filename, shows the current match confidence, and has a per-row **Fix match** button that opens the shared match dialog. Rows that would cross a season boundary or have no matched show are flagged, and the ranges are stored as per-file overrides.

  Scans also detect multi-episode files from joined episode titles (for example `S01E02 - The Deep and Coral Reefs` → `S01E02-E03`) and score the name evidence against every title in the run, so those files are not pushed below the confidence threshold.

  The review table also gains a **Multi-episode** filter chip that shows only files covering two or more episodes (including files with a queued split), and a **Select multi-episode** helper that selects every such file currently shown — or clears them when they are all selected.

- 877d38c: Add a **Split episodes** workflow to Organize. Select one or more TV rows and open the split editor to estimate cut points from TVDB episode runtimes (leftover runtime is spread evenly across the cuts), scrub a filmstrip of sampled frames to find title cards, nudge cuts against video keyframes, and assign or auto-match an episode to each segment. Splits are queued with the normal renames and apply together in one background job with a live result-file progress bar (for example 2 of 14 outputs), an accurate ETA and cancellation; stream-copy cuts are lossless by default, with an optional frame-exact re-encode. The original file can be backed up, deleted or kept per split, external text subtitles can be cut per segment, Plex parts are updated per episode, and Undo removes the split outputs and subtitle files and restores a backed-up original with its subtitles.

  The app now bundles `ffmpeg-static` and uses the resolved binary for FFmpeg conversions as well as splitting; Settings → Global can point at a custom executable. Library organizer settings gain defaults for the split editor (original-file policy, cut mode, subtitle sidecars and split concurrency). Lossless splits now map video, audio and subtitle streams explicitly instead of every stream, so sources with a data stream (for example some `.m4v` files) no longer fail at the muxer.

  The split editor preview shows the exact frame at the playhead while scrubbing or dragging a cut. Every segment card leads with its episode picker and a primary row of **Merge with next**, **Jump to start** and **Jump to end** (both center the pan on that segment's edges), while the cut time, filename override, **Split Segment** and **Remove split** controls sit under **Cut, filename & more**, and a segment with an episode assigned is tinted. Copy mode previews the frame each cut will actually land on, marks the five nearest alternative keyframes on the strip so a better split point is one click away, and a **Center on split** button recenters the pan. Copy cuts now use the keyframe chosen in the editor and normalize by the first video frame's timestamp, so the dotted landing line matches the timestamp ffmpeg actually cuts at. **Split file** is available on every TV row and **Split files** works on any TV selection, so a file whose episodes are non-contiguous in TVDB can still be separated: single-episode files open a two-segment plan, and cuts can be added at the playhead, snapped to the nearest all-black run, or generated for every black gap. Both black-frame tools also run across every file at once, one scan at a time, with a combined progress bar and ETA. Scan results are cached under the app data folder and reloaded when the editor opens, so the same discovery is never repeated: **Restore black frame splits** applies the saved runs instantly, while **Rescan black frames** replaces the saved result with a fresh scan. Every manual split decision is drafted in app storage as well, so closing the editor, restarting the app or hitting an error restores the cuts, matched episodes, filename overrides, skipped segments, policies and approvals; saving a split clears its draft. The single-file scan streams ffmpeg progress into a percentage on the button and a progress bar, since scanning a whole file can take a while. A segment's output filename can be overridden while its folder still comes from the naming rule, and **Merge with next** removes the following cut (or several cuts, chosen in a confirmation dialog) to join segments again. The confirmation pre-selects the number of segments whose combined length fits the matched episode's runtime and shows a segmented bar of the sections being merged next to the following ones. Controls explain themselves on hover or keyboard focus instead of carrying a separate info icon. Cut nudges of 1s or 0.1s update the timecode immediately, the filmstrip's keyframe ticks have a larger click target, and **Fix match** focuses its search box when it opens. Each segment's quick episode list is limited to the file's detected range, and **Other episode** opens the shared **Fix match** dialog. A split must be approved — individually or with **Approve all** — before **Save approved** queues it; unapproved edits stay as a draft while an already-queued split stays queued. An adjusted split carries a pending marker and reads **ready for review**, and an approved split is outlined in green.

  Target conflicts are detected while episodes are matched and shown inline per file and per segment. A queued split supersedes its row's rename target, so two split rows with distinct segments are not reported as conflicting, and queued splits count under the **Will rename** filter. A split can **Overwrite existing files** (the replaced file and its subtitle are backed up so Undo can restore them), drop only the conflicting segment while the other segments are still written, or skip the whole split. Dropping a segment leaves that episode in the source, then the split's original-file setting (back up, delete or keep) applies as usual. If approved splits still have conflicts when Save is pressed, the error alert keeps the full list and adds **Skip conflicts and save approved**, which drops the conflicting segments and saves the rest of the approved splits.

  The Fix match confidence badge now stays at its content width instead of stretching across the row.

### Patch Changes

- 03c975c: Refresh the app and tray icons. The new mark is a blue rounded tile with three queue lines and a play glyph for batch video conversion, simplified at 16–24px, and the tray keeps semantic running, paused and error badges. Icons are generated from `src/assets/icons/source` with `pnpm icons`. The unused legacy `icon2.*` copies were removed, and the Linux desktop entry now sets `StartupWMClass` to the executable name so the window matches its packaged icon.
- 0614ab1: Warn when a connected Plex TV library uses TMDB episode ordering, because the organizer renames episodes using TheTVDB (Aired) order and the two can disagree. The warning appears in the Plex status report and in TV organize plans. Older Plex databases without the `library_sections.user_fields` column are still supported.
- 1a315d2: Keep the open screen and its state when a renderer file changes. The Vite renderer now enables React Fast Refresh, so editing a component hot-updates the running window instead of reloading it back to the dashboard.
- 0918b54: Mark every row in a shared organize target as a conflict, not only the most recently planned one. Each row's reason now names the other files it would overwrite, so the whole group is easy to find in the **Conflicts** filter, and fixing or skipping one row releases the remaining rows immediately.
- 1a35688: Fix episode matching for shows that number seasons by year, such as Looney Tunes (`S1940E07`). Year-based season tags are now parsed from TVDB, filenames, season folders and the Fix match search, so those episodes match by tag or title instead of being dropped and leaving only specials. The TVDB episode cache key was bumped so previously cached, incomplete episode lists are refetched.

## 2.3.1

### Patch Changes

- 5bb0faa: Add a macOS DMG to the release build, alongside the existing ZIP.

## 2.3.0

### Minor Changes

- Add multi-episode file support to the organize review. Fix match can now select a consecutive
  episode range within one season, filenames such as `S01E02-E03` are detected and preserved, `{tag}`
  renders Plex's first/last range, and Plex updates every episode association while moving watch
  history for each covered episode. `{episode}` renders the numeric range by itself, with
  `{episode:start}`, `{episode:end}` and `{episode:separator}` (plus padded forms) available so single
  episodes never leave a trailing separator. `{name}` joins the titles of every episode in the file
  with a comma, and title matching compares the filename against those joined titles.
- Add a bulk **Rescan** action to the organize review: it walks the parent folders of the selected rows
  again, picks up files added, removed or renamed on disk, re-matches them, and splices the results back
  into the plan without rescanning the whole library.
- Improve organize review filters and layout: the review table gains a min/max confidence percentage
  range plus a **Clear filters** action, and the **Conflicts** filter now includes mixed-signal matches
  that are still above the threshold. In the show tree each group is a normal-flow section, so the real
  header row (select-all checkbox, collapse toggle and stats) is CSS-sticky under the column header
  while its files scroll, and the stats stay visible when the table is wider than the viewport. Add an
  **Approve** bulk action and a row-level **Approve match** action that keep a row as a rename across
  later replans, and make every row action affect only its own row. A new **Rename folder only** row
  action keeps the current file name while still applying the naming rule's folder, and toggles back to
  the template name with **Rename file too**. Apply results now surface failed moves in a red banner with
  each file path and error message, and failed rows stay in the review so they can be retried. The scan-limited show folders
  render as a bullet list with an “and N more…” summary after seven entries, a mixed-signal warning only
  counts rows that will actually be renamed, and every page now fills the window instead of centring in
  a fixed-width column.
- Improve the organize review with a collapsible show tree, row and group checkboxes with shift-range selection, bulk use-best-guess
  and skip actions, per-file skip/include actions, an in-memory review session that survives tab
  changes, local recalculation from cached matches, compact warning summaries, library-level name
  replacement rules, and parallel TV/movie matching with batched TVDB searches.
- Improve the TV show list in **What to organize** with search across show, series and folder names,
  match-status and folder filters, a **Selected only** view, leading scan checkboxes with per-folder
  select-all, **Select all shown** and **Clear** actions, and a compact scan-scope summary. Selected
  shows stay selected while filters change, and the scope still only affects the next scans.
- Improve the Plex integration with a structured issue list, copyable platform-specific fix
  commands, and an automatic stop/grant/restart fix that uses the native administrator prompt.
- Match Plex's resolution buckets in organizer naming rules and templates. `{resolution}` now renders
  `8K`, `4K`, `2K`, `1080p`, `720p`, `576p`, `480p` or `SD`, using either frame dimension to reach a
  bucket (so 1920x800 is `1080p` and 720x480 is `480p`), and dimensions within 5% below a threshold
  still count (1918x1072 is `1080p`). The former `1440p` bucket is now `2K`, and
  `8K` is new. Explicit filename tags such as `1440p`, `2k`, `4320p` and `8k` normalize to the same
  buckets.

### Patch Changes

- Make "Use best guess" (single row and bulk) use each file's top-ranked match and mark it as a rename
  even when it scored below the confidence threshold or was skipped, instead of reporting that there was
  nothing to clear.
- Clarify organize conflicts: when the target does not exist on disk but another file in the same review
  is already planned for that name, the reason now names that file instead of saying the target already
  exists.
- Fix organize scans failing with a generic "Organize scan failed" toast when the Plex database
  cannot be opened in place. Scans now read a temporary copy of the database and continue without
  Plex metadata (with a review warning) if it is unusable, log the failure to
  `OrganizeLog.txt` in the diagnostics logs, and surface the specific error message in the toast.
- Fix Plex updates that silently did nothing: the database folder is now checked for write access because
  SQLite keeps its `-wal`/`-shm` journal files next to the database, the status report names the folder
  as the problem, and organize failures (including Plex errors) are shown instead of being swallowed.

## 2.2.0

### Minor Changes

- Redesign the home screen around the two peer jobs. Convert and Organize are now equal doors; each opens a focused library picker with per-library readiness, one primary action per row, a one-off row, and a row overflow for one-off copies. Management moves to Settings, and the old Quick conversion/organize copy is renamed to One-off conversion/organize.
- Resolve TV episodes from independent `SxxEyy` tag, filename-title and air-date evidence, with a transparent weighted confidence and labeled conflicts instead of always trusting the tag. Filename, TVDB episode, movie and series titles are compared through the same case/punctuation/hyphen-insensitive key, and generated names strip filesystem-invalid characters. Specials use `S00`/`Season 00`, folder-only moves and already-correct names no longer produce false low-confidence or `target already exists` statuses, and each review row has a `…` menu with **Fix match** and **Open folder**. The Fix match modal previews the new filename for the current selection. The review table also shows a two-faced `strong`/`weak`/`conflict` match badge with a weighted evidence popover, merges the old `Why` column into it, and adds a **Match review** filter.
- Expand organizer naming variables: add `{width}`/`{height}`, multi-episode `{episodeEnd}`, and
  `{airDate}` with `:short`, `:year`, `:month`, `:day`, `:compact` and `:dot` formats. Number tokens
  are unpadded by default and the picker lists padded variants explicitly. Plex width and
  `originally_available_at` now feed templates, resolution buckets use inclusive thresholds
  (`4K`/`1440p`/`1080p`/`720p`/`576p`/`480p`/`SD`), and the token editor gains an **Insert variable**
  button. Scan failures now surface a meaningful message instead of an empty toast.
- Merge the Libraries and Organizer settings into one Libraries tab. The library picker, editable
  name, Movies/TV type and the create/duplicate/delete actions now sit in a shared header above
  Encoding and Organizer sub-tabs, with a summary of the active library and a confirmation step
  before a library is deleted.

### Patch Changes

- Adopt pnpm changesets for versioning and changelogs. Every change that touches the shipped app now
  needs a changeset entry, and a husky pre-commit hook flattens pending entries into `package.json` and
  `CHANGELOG.md` before the commit is created. `pnpm release` tags the released version.
