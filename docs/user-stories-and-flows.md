# HBBatchBeast — User Stories & UX Flows

## How this document was derived

The legacy feature inventory (≈65 inputs across six tabs, plus the README) describes *what the tool can do*.
That is an implementation inventory, not a design. Working **backwards** from it yields a small set of
underlying intents; those intents are restated here as user stories, and then the document works **forward**
again into the flows a real user walks through.

- The inventory itself is **not** reproduced here. Slice IDs (S01–S35) in `MIGRATION_STATUS.md` remain the
  implementation mapping.
- Flows are the input to `ui-design-intent.md`, which turns them into design decisions.
- Anything marked **Non-goal** has been deliberately dropped and must not be reintroduced by accident.

## Personas

| ID | Persona | Context | What "good" means to them |
| --- | --- | --- | --- |
| **P1** | Library owner *(primary)* | 100–10,000 video files in nested folders on a personal machine. Converts in occasional long sittings, often overnight. Not an encoding expert. | "Point it at my folders, get smaller files, don't make me think." |
| **P2** | Server operator | Always-on machine, very large trees, may run multi-hour jobs. Cares about resilience and knowing what is happening. | "Show me status at a glance; let me pause/stop without wrecking the run." |
| **P3** | Encoding tinkerer | Knows HandBrake, custom/imported presets, hardware encoders, compares output sizes. | "Give me exact control per folder, and don't dumb it down." |

## Core intents

These are the *why* behind the inventory. Every feature must trace to one; anything that traces to none is a
candidate to cut.

| ID | Intent | In the inventory this appeared as… |
| --- | --- | --- |
| **I1** | *Convert everything under my folders and keep my layout.* | recursive scan, destination mirroring, "unconverted files" comparison, temp folders |
| **I2** | *Encode by my rules.* | HandBrake/FFmpeg toggle, presets, container, suffix, per-folder preset lists, filters |
| **I3** | *Show me what you're about to do.* | scan-only mode, source queue table, extra-action flags |
| **I4** | *Stay in control while it runs.* | pause/resume/stop, cancel item, worker count, low priority, queue table |
| **I5** | *Tell me what went wrong.* | error/cancelled/other row filters, per-item status, error log, console |
| **I6** | *Don't destroy my originals unless I said so.* | delete-source, replace-original (always / if smaller), caches |
| **I7** | *Reuse my setup.* | libraries, reusable presets, mapping rules, language, persisted config file |
| **I8** | *Help me understand a file.* | media info viewer |

## User stories

Format: **ID — story.** Acceptance criteria follow; slice references are in `MIGRATION_STATUS.md` terms.

### I1 — Convert and keep layout

**US-01 — Convert a folder tree.** *As a library owner, I want to point at source and destination folders and
have every media file under them converted, so that I don't manage files by hand.*
- Subfolders are scanned recursively; the destination mirrors the source structure.
- Non-media files are ignored; already-present destination files are not re-queued.
- Partial runs resume safely — re-running never duplicates work.

**US-02 — Multiple sources, each with its own destination.** *As a server operator, I want several
source→destination pairs, so that I can convert several libraries in one run.*
- Sources and destinations are edited as paired rows, not as two newline-aligned text boxes.
- A count mismatch blocks the run and names which row is missing its pair.
- A destination inside its source is rejected with an explanation of the infinite-recursion risk.

**US-03 — Stage conversions in a temp folder.** *As an encoding tinkerer, I want files written to a temp
folder and moved into the destination when finished, so that broken conversions never appear in my library.*
- One temp folder per source row; counts must match.
- A file that fails never reaches the destination.
- In-progress outputs carry a `.temp` marker (`movie.temp.mkv`) and are renamed only when complete, so a
  stopped run leaves the unfinished files visible. On by default; can be turned off in File handling.

### I2 — Encode by my rules

**US-04 — Choose encoder and output shape.** *As a library owner, I want to pick HandBrake or FFmpeg, a
preset, a container and an optional suffix, so that output matches my devices.*
- One choice applies to all rows unless overridden per row.
- The chosen preset is shown in plain language, not as raw CLI flags.

**US-05 — Per-folder presets.** *As an encoding tinkerer, I want a different preset per source row, so that
720p TV rips and 4K movies get different treatment.*
- Each source row carries its own preset and optional filename suffix.
- The review screen shows the resolved preset per file before anything runs.

**US-06 — Filter what gets converted.** *As a server operator, I want to include or exclude files by type,
size, filename words and media properties, so that an unattended run does not do the wrong thing.*
- Filters are a step-by-step rule stack with nested **Match all** / **Match any** groups; unused filter
  types appear only in the Add-stage menu.
- Media-property rules use searchable ffprobe property and value pickers, while still accepting custom keys.
- The chip summary shows the whole expression, and every stage is evaluated at scan time.

**US-07 — Copy sidecar subtitles.** *As a library owner, I want `.srt` files copied next to converted output,
so that subtitles survive the conversion.*
- SRT copying is a single toggle with a clear effect on the review list.

**US-08 — Use a custom or imported preset.** *As an encoding tinkerer, I want to paste or import a HandBrake
preset, so that I can use my own tuning.*
- Imported JSON is validated before it can be used.
- Presets containing `nvenc` surface a warning about worker concurrency.

### I3 — Preview before committing

**US-09 — Preview the queue.** *As a library owner, I want to scan without converting and see exactly what
would happen, so that I can catch mistakes before a multi-hour run.*
- Scan-only produces, per file: path, resolved preset, any extra action (copy / skip / copy SRT), and a
  stage-by-stage filter trace reachable from the Filter column.
- Counts are summarised (found, to convert, already converted, filtered out, ignored by type).
- The preview can be cancelled instantly and leaves no partial output.

**US-10 — Catch misconfiguration while editing.** *As a library owner, I want problems flagged as I fill in
the form, so that I don't discover them after waiting for a scan.*
- Folder existence, source/destination/temp pairing, preset counts, suffix counts and file-type values are
  validated on blur with a fix-oriented message.
- A single "review problems" summary lists every blocking issue before a run starts.

### I4 — Control during a run

**US-11 — Pause and resume.** *As a server operator, I want to pause new work while letting in-flight items
finish, so that I can use the machine for something else.*
- Pause stops dispatching and reports the drain state; resume continues from the same queue position.

**US-12 — Stop cleanly.** *As a server operator, I want to stop a run and know what completed, so that I can
make a decision without guessing.*
- Stop terminates workers, marks in-flight items cancelled, and leaves a summary.

**US-13 — Cancel a single item.** *As a server operator, I want to drop one file from the run, so that a
problem file doesn't force me to stop everything.*
- Cancelling one item terminates only that item's process; the rest continue.

**US-14 — Bound resource usage.** *As an encoding tinkerer, I want to set the worker count and optionally run
at low priority, so that the machine stays usable.*
- Worker count is validated against a sane range and reflected immediately in the run view.

**US-15 — See per-worker progress.** *As a server operator, I want overall and per-worker progress, so that I
can tell the run is healthy and estimate completion.*
- Overall: done/total, failures, elapsed, ETA if derivable.
- Per worker: current file, stage, percentage.

### I5 — Failures are actionable

**US-16 — See per-item outcome.** *As a library owner, I want each file's result, so that I can confirm
success rather than assume it.*
- Every item ends in exactly one state: success, error, cancelled, skipped.
- Rows are filterable by state and searchable by path.

**US-17 — Understand a failure.** *As a server operator, I want the reason and the log for a failed item, so
that I can fix the cause.*
- The error text is attached to the row; opening the log jumps to that item's output.
- Raw console output is available without leaving the run.

**US-18 — Retry failed items.** *As a library owner, I want to re-queue failures without rescanning, so that a
transient problem doesn't cost a full rescan.*
- Retry operates on the filtered selection and never re-adds already-successful items.

### I6 — Protect source files

**US-19 — Safe defaults.** *As a library owner, I want destructive options off by default, so that a careless
click cannot delete my library.*
- Delete-source and replace-original default to off.
- Destructive controls are visually distinct and explain their effect in one sentence.

**US-20 — Replace originals deliberately.** *As an encoding tinkerer, I want to replace the original only when
the converted file is smaller, or always, with a confirmation.*
- Replacement is confirmed once per run setup, not per file.
- Replaced files are recorded in a list the user can review.

### I7 — Reuse my setup

**US-21 — Libraries.** *As a server operator, I want separate saved libraries (e.g. Movies vs TV), so that I
don't re-enter paths and presets each time.*
- Create, rename, duplicate and delete libraries; switching is immediate and applies to the run screen.
- The active library is visible in the header, never ambiguous.
- Presets and mapping rules are reusable building blocks, not part of the folder definition.

**US-22 — Language.** *As a library owner, I want the UI in my language, so that I can use it comfortably.*
- Language change applies without restart; missing strings fall back to English.

**US-23 — Survive restarts and bad config.** *As a library owner, I want my settings back when I reopen the
app, even if the config file was corrupted.*
- Settings persist on change; an unreadable config is archived rather than crashing, and the app explains
  what happened.

**US-28 — Convert one folder once.** *As a library owner, I want to convert a folder without creating or
editing a saved library, so that a one-off task stays a one-off.*
- The home screen offers Quick convert alongside saved libraries.
- Quick convert asks for source, destination and preset, then uses the normal scan/review/run flow.
- It never overwrites the last library; after a successful run the user may save it as a library.

**US-29 — Reuse encoding recipes and map by media.** *As an encoding tinkerer, I want named presets and
ordered rules such as “480p → mobile, 1080p → TV”, so that one library can serve several devices.*
- Presets are reusable across libraries and reference installed HandBrake presets or FFmpeg arguments.
- Mapping rules are evaluated top to bottom; the first match wins and the fallback is the library default.
- Rules can use folder/path, filename, file size, file type and media properties.

### I8 — Understand a file

**US-24 — Inspect media properties.** *As an encoding tinkerer, I want to inspect a file's streams before or
after conversion, so that I can verify the result.*
- Shows container, video stream (codec, resolution, bitrate, fps), audio and subtitle streams.
- Reachable from a converted item and from a file picker.

### Operational

**US-25 — Status while backgrounded.** *As a server operator, I want the tray/window to reflect idle,
running and error states, so that I notice failures without watching the app.*
- One glanceable state; a way to acknowledge an error and return to idle.

**US-26 — Know about updates.** *As a library owner, I want a changelog when the app updates, so that I know
what changed.*
- Shown once per version, dismissible, and does not block the run screen.

**US-27 — Find the logs.** *As a server operator, I want to open the log folder and clear the
replace-attempt cache, so that I can diagnose and reset state.*
- Log viewer lists the known logs with sensible empty states.

## Core flows

Each flow is the forward direction: what the user does, what the app shows, where it can go wrong.

### F1 — First run → first conversion *(P1, happy path)*

1. **Launch.** No configuration exists → run screen in an **empty state** that asks for a source folder and a
   destination folder, with the default preset preselected. No dead controls.
2. **Choose folders.** Folder picker plus paste; multiple rows can be added. Each row validates immediately
   (exists, not nested inside its source, paired with a destination).
3. **Pick encoding.** Default preset is preselected and named in plain language; container defaults to `.mp4`.
   Advanced options stay collapsed.
4. **Preview.** "Scan" runs without converting. Progress shows discovered files and a live count.
5. **Review.** A summarised queue appears: `N files · M to convert · K already present · F filtered`. A
   sample of rows shows resolved preset and extra actions. Blocking problems (if any) are listed here with
   fix links back to the offending field.
6. **Run.** Convert starts from the review state. The view switches to live progress with a per-worker
   breakdown.
7. **Completion.** The run summary states success/failure counts and offers "open destination", "review
   failures", and (if enabled) "replace originals".

**Failure branches:** scan finds nothing → empty state explains likely causes (wrong folder, all filtered,
all already converted); destination unwritable → inline error before the run starts, not mid-run.

### F2 — Repeat conversion on an existing library *(P1/P2)*

1. Launch → home screen lists the saved libraries; the last-used library is available to reopen.
2. Scan → only genuinely new/converted-missing files are queued; the summary proves the filtering worked.
3. Run → same monitoring as F1.
4. Optional: replace/delete originals if configured; otherwise nothing destructive happens.

### F3 — Large queue, long run *(P2)*

1. Scan a very large tree; the queue view virtualises and stays responsive as counts grow.
2. While running: pause to reclaim CPU, resume, cancel a specific problem file, stop entirely.
3. Switch to a filtered view (errors only) without losing the live progress context.
4. On completion: export/copy the list of failures.

**Failure branches:** worker dies → item marked error, run continues, failure is surfaced in the summary; app
quit mid-run → next launch clearly reports the interrupted run rather than pretending it finished.

### F4 — Failure triage *(P2)*

1. Error badge/count appears in the run view (and tray, if enabled).
2. Filter to errors; each row shows the failure reason.
3. Open the log for that item; read the tool output.
4. Choose retry (re-queue just those) or skip and move on.

### F5 — Multiple libraries *(P2)*

1. Settings → Libraries → create "Movies", configure folders and filters.
2. Duplicate to "TV", change paths, default preset and mapping rules, save.
3. Open either library from the home screen; the run screen updates immediately and scanning is scoped
   to that library.

### F6 — Reusable presets & mapping rules *(P3)*

1. Settings → Presets → create a HandBrake or FFmpeg recipe.
2. Choose a library default preset from the compatible presets.
3. Add mapping rules in order (folder/path, media property, filename, size or type) and assign a preset
   to each.
4. `nvenc` in a preset raises a concurrency warning.
5. Preview confirms the resolved preset per file before running; the queue shows which rule selected it.

### F7 — Post-run review *(P1)*

1. Summary shows counts and duration.
2. Review successful items; optionally open the destination folder or inspect a file's media info.
3. If replace-original was enabled, review the replaced-file list.

### F8 — Inspect a file *(P3)*

1. From a converted item or a file picker, open media info.
2. Read video/audio/subtitle stream details.
3. Close without leaving the run context.

### F9 — Background status & updates *(P2/P1)*

1. Minimise; tray reflects running/idle/error.
2. Error state is noticeable; acknowledging returns it to idle.
3. On a new version, a dismissible changelog appears once.

### F10 — One-off conversion *(P1)*

1. Launch → home screen with Quick convert and saved libraries.
2. Start a blank quick conversion, or press **Use as quick run** on a library to prefill its folders,
   preset, mapping rules and scan filters.
3. Adjust folders, preset, mapping rules and filters in the quick setup page, then continue to the
   normal scan/review screen.
4. Run and review as usual; the saved libraries and last active library are untouched.
5. Optionally save the quick job as a library for next time.

### F11 — Library with mapping rules *(P3)*

1. Open a library in settings; choose encoder and container.
2. Add ordered rules (for example resolution/height ranges) and pick a preset for each. The locked
   default preset at the bottom handles files that match no rule.
3. Scan; the queue shows the resolved preset and the rule that selected it.
4. Change a rule or preset and rescan; the previous queue is discarded because it no longer describes
   the current configuration.

## Non-goals (deliberately dropped)

| Capability | Why it is out |
| --- | --- |
| Periodic scanning, "folder watching", daily run windows (S22) | Runs are explicit and manual; no background scheduling. |
| Video health check / repair (S26) | Out of scope for this rewrite. |
| Remote monitoring, status upload, API keys (S29) | Depends on a third-party service and is unwanted. |
| Email error alerts (S25) | Insecure credential handling for little value. |
| Benchmark tab (S28) | Side utility unrelated to the rewrite goal. |
| In-app help tab and 33 tooltip blobs (S30) | Replaced by inline helper text and a docs link. |
| Custom frameless window chrome (S05) | Native frame on all platforms. |
| Autostart scan on launch, hide-to-tray on minimise (S08) | Removed with the custom window/tray behaviour. |

Implication for design: the app must be **good at the manual run**, because it is the only way work happens.

## Traceability

| Intent | Stories | Flows | Slices |
| --- | --- | --- | --- |
| I1 | US-01–03 | F1, F2 | S15, S14, S17 |
| I2 | US-04–08 | F1, F6 | S16, S17, S18 |
| I3 | US-09–10 | F1 step 4–5, F6 | S14, S15, S16 |
| I4 | US-11–15 | F3 | S19, S20, S24 |
| I5 | US-16–18 | F3, F4 | S19, S21, S31 |
| I6 | US-19–20 | F1, F7 | S18, S21 |
| I7 | US-21–23, US-28–29 | F2, F5, F10, F11 | S23, S13, S04 |
| I8 | US-24 | F8 | S27 |
| Operational | US-25–27 | F9 | S06, S09, S10 |
