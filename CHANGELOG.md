# hbbatchbeast

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
