# HBBatchBeast — UI Design Intent

Derived from `user-stories-and-flows.md` (intents I1–I8, stories US-01–US-27, flows F1–F9). This document is
the design contract for slice **S32**. When a design question is not answered here, resolve it against the
stories — not against the legacy UI.

## 1. Principles

| # | Principle | Consequence for the build |
| --- | --- | --- |
| **D1** | **The run is the product.** Everything the user does converges on configuring, previewing and watching one run. | One primary screen. Settings stay in a drawer/route; Global and Profiles tabs organize settings inside the drawer, not as competing app navigation. |
| **D2** | **Preview before commit.** Nothing is converted until the user has seen what would happen. | Scan-only is the default first action; the run button lives in the review state, not the settings form. |
| **D3** | **Safe by default, explicit by exception.** Destructive actions are off, isolated and explained. | Delete/replace live in their own section, visually marked, with one plain-language sentence each and a run-level confirmation. |
| **D4** | **Progress is always visible and honest.** Long runs must never look stalled or finished-early. | Persistent run bar with counts, elapsed, per-worker state; cancellation and worker death are surfaced, not silent. |
| **D5** | **Errors are actionable.** A failure must tell the user which file, why, and what they can do. | Per-item state + reason, filter-to-errors, open log at that item, retry those items. |
| **D6** | **Density on demand.** Simple by default, exact when asked. | 6–8 visible controls; everything else behind collapsible "Advanced". No option is removed, just deferred. |
| **D7** | **Show the shape of the data.** Folder mappings and per-folder presets are paired structures. | Row-based editors, never newline-aligned textareas. Counts are validated against each other. |
| **D8** | **Native and quiet.** This is a utility, not a showcase. | Native window frame, OS menus, restrained motion, system-consistent controls, light + dark. |

## 2. Information architecture

```
App shell
├── Header: app name · active profile selector · status pill (idle/scanning/running/paused/error) · Settings button
├── Run screen  (default route)
│   ├── Setup summary cards: Folders · Encoding · Filters · File handling   [edit → settings drawer]
│   ├── Validation banner (only when blocking issues exist)
│   ├── Actions: [Scan] / [Scan & Convert] / [Stop]
│   └── Live view (appears after scan)
│       ├── Progress header: counts, failures, elapsed, worker chips
│       ├── Queue/results table: virtualized, filter chips (All / Remaining / Success / Error / Cancelled)
│       └── Row actions: cancel item · open log · reveal in folder · media info
├── Settings drawer
│   ├── Global tab   — language, worker count, verbose worker logs, log files and locations
│   └── Profiles tab — profile selector and per-profile conversion settings
│       ├── Folders       — source/destination/temp rows, auto-create, profile paths
│       ├── Encoding      — HandBrake/FFmpeg, preset per row, container, suffix
│       ├── Filters       — file types, size range, title words, media properties, SRT copying
│       └── File handling — delete source, replace original (always/if smaller), apostrophes, queue order
└── Secondary views (opened from row actions or header)
    ├── Log viewer
    ├── Media info
    └── Changelog modal
```

Rationale: the legacy app put six tabs of *configuration* in front of the user and left the actual job
(unattended conversion) implicit. Here configuration is condensed to summaries, and the run owns the screen.

## 3. Screens, states and acceptance criteria

### 3.1 Run screen

| State | What it shows | Acceptance criteria |
| --- | --- | --- |
| **Empty (first run)** | Two required inputs (source, destination), default preset named, single primary action. | No disabled-but-unexplained controls; one obvious next step (US-01, F1.1). |
| **Configured** | Summary cards of the active profile; validation banner if issues; `Scan` primary. | A user can tell, without opening settings, which folders, preset and filters are active (D1). |
| **Scanning** | Live discovered-file count + analysed count; cancel available immediately. | Cancel returns to **Configured** with no partial state (US-09). |
| **Review** | Summary line `N found · M to convert · K present · F filtered`; sample/virtualized rows with resolved preset and extra actions; blocking issues listed with links to the field. | Run button only enabled when there are zero blocking issues (US-09, US-10). |
| **Running** | Progress header (done/total, failures, elapsed), worker chips with current file + %, queue table auto-filtered to Remaining, pause/stop/cancel-item. | Pause/stop/continue reflect actual state within one UI tick; no dead buttons (US-11–US-15). |
| **Paused** | Same as running plus drained count and clear "Continue" affordance. | In-flight items complete visibly before "Paused (idle)" is claimed (US-11). |
| **Stopping** | Explicit transient state; items marked cancelled. | Never jumps straight from Running to Finished while processes are still alive (US-12). |
| **Completed** | Result summary, failures count with "review failures", open destination, replaced-files list if applicable. | Summary is reachable from any filter state and states "nothing was converted" when that is the case (F1.7, F7). |
| **Interrupted (recovered)** | Banner explaining the previous run did not finish, with counts. | App never silently presents a lost run as success (F3 branch). |

### 3.2 Settings drawer

| Tab / group | Must contain | Notes |
| --- | --- | --- |
| Global | Language, worker count, verbose worker logs, log files and locations | Preferences shared by all profiles; legacy per-profile system values migrate to global settings. |
| Profiles | Profile selector and create/rename/duplicate/delete actions | Conversion settings below apply only to the active profile. |
| Folders | Paired source/destination rows, optional temp row per source, auto-create folders | Row editor; add/remove/reorder; paste-many support; per-row validation (US-02, US-03). |
| Encoding | Encoder switch, per-row preset selector populated from the installed HandBrakeCLI, custom argument editor, container select, per-row suffix | Preset labels in plain language; only the active encoder's controls are shown; NVENC warning inline; validation that preset count matches row count (US-04, US-05, US-08). |
| Filters | File-type token list, size min/max with units, title words, include/exclude property filters with any/all, SRT toggle | Live "matches N files" estimate shown after a scan; filters never silently override each other (US-06, US-07). |
| File handling | Delete source, replace original (always / if smaller), remove apostrophes, reverse order, custom batch hook, low priority | Destructive pair visually grouped and explained (US-19, US-20). |
| Profiles | List with create/rename/duplicate/delete, active marker | Deleting the last profile is blocked with an explanation (US-21). |
| System | Worker count, queue-view limit, verbose logs, language | Worker count shows the practical range; language applies immediately (US-14, US-22). |

Rules for the drawer: it must never trap unsaved work (changes persist on blur with a saved-indicator toast),
closing it returns focus to the run screen, and deep links from the validation banner open the exact group and
scroll to the field.

### 3.3 Queue / results table

- Virtualized; stable scroll and selection at 10k+ rows (US-15, F3). Implemented with TanStack Table (models, sorting,
  filtering, sizing, visibility) and TanStack Virtual (row windowing).
- Columns: `#`, file path (truncated middle, full on hover/copy), preset (resolved), state, progress, ETA, speed, size,
  reason, actions. Every data column is sortable (ascending → descending → unsorted), resizable (drag the header edge,
  or focus the separator and use arrow keys), reorderable (drag the grip or use the column menu arrows) and hideable.
  Widths, order and visibility persist per user; Actions stays visible.
- Filter chips: All / Remaining / Success / Error / Cancelled / Skipped; search by path substring.
- Per-row actions: log, media info, and cancel while the item is pending or in flight.
- Failure panel above the queue groups identical messages with counts; a group expands to its files, each opening the
  per-file log. "Copy all errors" produces a shareable aggregate.
- Per-file log dialog shows the full error detail and the worker console tail captured while that file ran, with copy.
- Live telemetry above the queue: status and completion donuts, files-per-minute bars, data-throughput and frame-rate
  line charts, plus remaining duration and estimated finish time. Charts update from the run's progress stream and use
  ECharts, so they re-render on theme changes.

### 3.4 Log viewer

- The per-file log dialog is the entry point from a row or a failure group; it shows error detail, timestamps, sizes and
  the worker console tail captured for that item.
- List of known logs with size and last-modified; empty states explain that a log appears after the first run.
- Per-item log link opens the log scrolled to that item's section.
- Copy affordance; no editing. Long error blocks scroll inside the dialog rather than expanding the row.

### 3.5 Media info

- Opened from a converted row or a file picker; sections for general/video/audio/subtitles.
- Loading and failure states are explicit (ffprobe unavailable, unreadable file).

## 4. Interaction patterns

**Folder rows (D7).** A table, not a textarea: each row = source picker + destination picker (+ temp when
enabled). "Add row" clones the last row's structure. Pasting multiple lines fills successive rows. A row is
never silently dropped; the validation banner names the incomplete row.

**Progressive disclosure (D6).** Visible by default: source/destination, encoder, preset, container, scan
action. Behind Advanced: temp folders, custom preset JSON, suffix, filters, size bounds, property filters,
delete/replace, apostrophe handling, queue order, batch hook, priority, verbose logs.

**Validation (US-10).** Field-level, on blur, fix-oriented ("Destination is inside the source folder — choose a
location outside `/media/movies`"). Cross-field rules (counts, nesting) validated at the row group. A run is
blocked only by a list the user can click through; warnings never block.

**Progress model (D4).** Two levels: overall (`done/total`, failures, elapsed) and per worker (current file,
stage, %). Percentage is never shown for work whose total is unknown — use indeterminate state instead.

**Destructive confirmation (D3).** One run-level confirmation listing exactly what will happen ("Move 412
source files to the trash after successful conversion"). No per-file modals.

**Notifications.** Toasts for transient acknowledgements (config saved), inline banners for anything the user
must act on. Errors are never toast-only.

## 5. Visual system

- **Tokens, not ad-hoc styles.** Colour, spacing (4px scale), radius, typography and elevation as CSS
  variables consumed by styled-components/theme. `styled-components` is already a dependency.
- **Type:** one UI sans, 3–4 sizes, tabular numerals for counts and percentages.
- **Colour:** neutral surfaces; one accent for primary actions; semantic success/warning/error used only for
  state, never decoration. Light and dark from the same tokens.
- **Density:** comfortable default; table rows are compact. No nesting of cards inside cards.
- **Motion:** ≤150ms for state transitions; respect `prefers-reduced-motion`; no spinners where a determinate
  bar is possible.
- **Iconography:** a small consistent set for states and row actions; text labels for destructive actions.

## 6. Accessibility & platform

- Full keyboard path: configure → scan → review → run → triage, without a mouse; visible focus rings.
- Table is a real grid with row/column semantics; filter chips are toggle buttons with `aria-pressed`.
- Live regions announce scan counts and run-state changes at a throttled rate (not every tick).
- Contrast ≥ 4.5:1 for text in both themes; state is never conveyed by colour alone (icon + label).
- Native window frame and OS menus; tray status (where available) mirrors the in-app status pill.
- **Linux/Wayland caveat:** Electron 45 renders no window decorations when running natively on Wayland
  under GNOME, so the titlebar and its minimise/maximise/close buttons disappear. The app therefore runs on
  XWayland (`--ozone-platform=x11`) by default on Wayland; `HBB_OZONE_PLATFORM=wayland` opts back in. Dev uses
  `scripts/start.mjs` to pass the flag; packaged builds re-exec themselves with it.
- Localized strings via react-intl; no concatenated sentences; numbers/dates via `Intl`.

## 7. Explicitly rejected legacy patterns

| Legacy pattern | Replacement |
| --- | --- |
| Six top-level tabs of settings sharing one long scroll | Run screen + grouped settings drawer |
| Newline-aligned textareas for paired data | Row editor with pairing validation |
| `alert()`-style validation after submit | Inline, field-level, fix-oriented validation |
| 33 `?`-glyph tooltip blobs | Short inline helper text + docs link for anything non-obvious |
| Status rendered by injecting HTML into `div`s | State in a store, rendered by components |
| Queue view disabled above a configurable size limit | Virtualized table, no size cap |
| Destructive checkboxes beside benign ones | Destructive group, explanation, run-level confirmation |
| Spinner-and-text as the only progress signal | Overall + per-worker determinate progress |

## 8. Story traceability

| Screen / pattern | Serves |
| --- | --- |
| Run screen empty & configured states | US-01, US-02, F1.1–F1.3 |
| Review state + validation banner | US-09, US-10, F1.4–F1.5 |
| Running / paused / stopping states | US-11–US-15, F3 |
| Queue table filters + row actions | US-16–US-18, US-24, F4 |
| Settings → Folders | US-02, US-03 |
| Settings → Encoding | US-04, US-05, US-08 |
| Settings → Filters | US-06, US-07 |
| Settings → File handling | US-19, US-20 |
| Settings → Profiles | US-21, F5 |
| Settings → System / language | US-14, US-22 |
| Log viewer | US-17, US-27 |
| Media info | US-24, F8 |
| Status pill + tray | US-25 |
| Changelog modal | US-26 |
