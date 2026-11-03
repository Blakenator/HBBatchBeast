# hbbatchbeast

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
