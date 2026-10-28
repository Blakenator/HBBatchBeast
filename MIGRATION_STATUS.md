# HBBatchBeast Migration Status

> Snapshot taken 2026-10-21 on branch `rewrite`. **Phases 0–7 of the rewrite are complete.** The legacy
> vanilla-JS app has been deleted and the Electron Forge + Vite + React 19 + TypeScript app now lives at the
> repository root.

---

## 1. TL;DR for the next agent

The app at the repo root is the only app. It loads and saves libraries, reusable presets and mapping rules,
scans source folders through the supervised `queueBuild` child, converts through a supervised worker pool,
reports progress and results in the UI, and packages as a Linux app plus a `.deb`. `src/backend` owns IPC,
child lifecycle and run state; `src/frontend` is the React UI (design tokens, launcher, run screen, queue
table, settings drawer, libraries, presets, diagnostics). `tests/` holds 300+ unit tests plus one opt-in
real-conversion integration test.

**What is verified** (§2): `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm package`, a deb build, and the
packaged binary driven over the DevTools protocol — scan, real conversion, pause/resume/stop wiring,
profile/language switching, both themes, media info, diagnostics.

**What is not done** (§5):
- Locale backfill — new UI strings exist only as in-code `defaultMessage`s, so non-English users still see
  English for everything new.
- Windows/macOS packages have never been built here; `HandBrakeCLI.exe` is resolved from `PATH` rather than
  bundled.
- TypeScript 7 and ESLint 10 stay blocked upstream (`typescript-eslint` peers).

**Where things are**: `src/main.ts` + `src/main/` (window, tray, menu, asset paths), `src/common/` (channel
contract, config types, defaults), `src/backend/` (`handlers.ts`, `processes/`, `run/`, `workers/`,
`scanner/`, `helpers/`), `src/frontend/` (`ui/`, `run/`, `settings/`, `diagnostics/`, `home/`, `core/`),
`docs/` (UX inputs), `packaging/` (desktop entry).

**Design intent wins over this inventory on UI questions**: [`docs/user-stories-and-flows.md`](./docs/user-stories-and-flows.md)
(personas, intents I1–I8, stories, flows) and [`docs/ui-design-intent.md`](./docs/ui-design-intent.md)
(principles, IA, per-screen states, a11y).

**History.** §7 is the slice inventory that drove the work (every kept slice is delivered; dropped ones are
marked `⛔` and stay dropped). §8 is the defect log — each entry says which phase fixed it. The phased plan
that sequenced this lives with the session, not in the repo.

**Deliberately dropped, do not resurrect without a decision**: remote monitoring/web view and API keys,
scheduling (periodic re-scan, daily windows, folder watching), health check/repair, email settings, h265
benchmarking, Docker, Travis.

## 1a. Library/preset model

The persisted conversion model is now three first-class concepts:

- **Library** (`src/common/library.ts`): folder pairs, scan filters, encoder, container, default preset,
  ordered mapping rules and run defaults.
- **Conversion preset**: a reusable HandBrake preset/arguments or FFmpeg input/output argument pair.
- **Mapping rule**: an ordered first-match condition tree (folder/path, media property, filename, file size,
  file type) that selects a preset. The default preset is rendered as a locked, un-deletable rule at the
  bottom of the stack.

Profiles are retired. The old v1 `configs[]` file is migrated on load to `schema_version: 2` and a
`.v1.bak` copy is written before replacement. The legacy `BatchTabConfig`/`GlobalAppConfig` types remain as a
runtime adapter only (`libraryToRuntimeConfig`) for the scanner and worker. The home screen offers a Quick
conversion setup page (folders, preset, mapping rules and filters); it never overwrites the selected library
and can be saved as a library after a run. A library can prefill that page with **Use as quick run**. Settings
is a persistent page with Global/Libraries/Presets tabs, reached from the header back button. Scan-side
preset resolution lives in `src/backend/scanner/presetResolution.ts`; the queue returns a preset trace
alongside the existing filter trace.

---

## 2. Verified state (commands actually run)

| Check | Command | Result |
| --- | --- | --- |
| Lint | `pnpm lint` | ✅ 0 errors, 26 pre-existing warnings |
| Typecheck | `pnpm typecheck` (`tsc --noEmit`) | ✅ clean (TypeScript 5.9 + `moduleResolution: "bundler"`, `paths` for the super-ipc ESM packages) |
| Build/package | `pnpm package` | ✅ Vite bundles + app packages for linux-x64 |
| Scan pipeline | forked `.vite/build/queueBuild.cjs` driven by a zod-validated `QueueBuildConfig` | ✅ finds files, builds queue, emits `complete` |
| Packaged runtime deps | inspect `out/.../resources/app.asar` | ✅ `fs-extra`, `zod`, `ffprobe-static` present; child bundles keep `zod` external |
| Tests | `pnpm test` (Vitest) | ✅ 224 tests + 1 opt-in integration test: worker/scanner codecs, argv, filters, telemetry, runtime, fork contracts, queueBuild, config, run manager, supervisor failure modes |
| CI | `.github/workflows/ci.yml` | ✅ typecheck → lint → test → package on push/PR |
| Packaged app (phase 7) | `out/HBBatchBeast-linux-x64/hbbatchbeast --remote-debugging-port=9222`: renders, loads config, probes media through the unpacked ffprobe, tray icon loads from `resources/icons` | ✅ |
| Debian package (phase 7) | `pnpm make --targets @electron-forge/maker-deb` → `out/make/deb/x64/hbbatchbeast_2.1.5_amd64.deb` (125 MB); its `.desktop` entry is `Exec=hbbatchbeast --ozone-platform=x11 %U` | ✅ |
| Package size | `du -sh out/HBBatchBeast-linux-x64` | ✅ 444 MB (was 680 MB); foreign `ffprobe-static` binaries pruned per target platform |
| Real run (phase 5) | dev app driven over the DevTools protocol: create profile → set folders → scan → convert 20 files → pause/resume/stop wiring, destructive confirmation, profile switch, language switch, both themes | ✅ scan/convert produce correct `.mkv` destinations, terminal status reaches the pill, queue clears on profile switch, 0 `MISSING_TRANSLATION` errors |
| Dev-loop cleanup | `scripts/dev-smoke.sh [seconds]` | ✅ runs the app for N seconds and tears down the whole process tree (Forge leaves zombie Electron windows behind otherwise, and they report `electronApi not found`) |

### Dependency & toolchain currency

Versions checked 2026-10-21 via `npm view <pkg> version`; "installed" read from `node_modules`.

| Package | Declared | Installed | Latest | Notes |
| --- | --- | --- | --- | --- |
| `electron` | `^45.0.0` | 45.0.0 | 45.0.0 | Upgraded from 26. Note `super-ipc-{backend,react,preloader}` declare `electron@^31` as a *direct* dependency, so pnpm still installs nested copies for them; consider `pnpm.overrides` to dedupe. |
| `@electron-forge/*` | `^8.0.1` | 8.0.1 | 8.0.1 | Upgraded. Forge 8 + Vite 8 emit bundles as **`.cjs`**, so `main` is `.vite/build/main.cjs` and child-module filenames changed from `.js` to `.cjs`. |
| `typescript` | `^5.9.0` | 5.9.3 | **7.0.2** | Upgraded in phase 0 (4.9 could not do `moduleResolution: "bundler"`). Moving to 7.x is still open. |
| `@superflag/super-ipc-{core,react}` | `^0.1.0` | 0.1.0 | 0.1.0 | Dual CJS/ESM with real type entries — this removed the need for `paths`/resolver hacks. |
| `@superflag/super-ipc-{backend,preloader}` | `^0.0.23` / `^0.0.22` | 0.0.23 / 0.0.22 | 0.0.23 / 0.0.22 | These packages are on their own 0.0.x line; `backend@0.0.23` depends on `core@0.1.0`, so the versions are paired deliberately, not stale. |
| `react` / `react-dom` | `^19.3.1` | 19.3.1 | 19.3.1 | Upgraded in phase 5. |
| `@types/react` | `^19.3.0` | 19.3.0 | 19.3.0 | Declared in phase 5 (was peer-hoisted only, D16). |
| `@types/react-dom` | `^19.3.0` | 19.3.0 | 19.3.0 | Moved with React. |
| `vite` | `^8.3.5` | 8.3.5 | 8.3.5 | Upgraded (Rolldown-based). Node built-ins and runtime deps must now be externalised explicitly in `vite.main.config.ts` — `require('ffprobe')`-style imports are no longer externalised automatically. |
| `eslint` | `^9.39.5` | 9.39.5 | 10.13.0 | Migrated from 8 to 9 with flat config. ESLint 10 is blocked: `typescript-eslint` 8 builds a ScopeManager without `addGlobals`, which ESLint 10 calls, so linting crashes (`scopeManager.addGlobals is not a function`). Revisit when typescript-eslint supports it. |
| `@typescript-eslint/*` | `^8.72.0` | 8.72.0 | 8.72.0 | Upgraded. Peer range caps TypeScript at **<6.1**, so the TypeScript 7 move (S34) is blocked until this moves. |
| `@types/node` | `^24.19.2` | 24.19.2 | 26.6.5 | Raised for the Electron 45 / Vite 8 / Vitest 5 toolchain. |
| `react-intl` | `^12.1.5` | 12.1.5 | 12.1.5 | Upgraded in phase 5. |
| `react-toastify` | `^11.1.0` | 11.1.0 | 11.1.0 | Upgraded in phase 5. |
| `zustand` | `^5.0.15` | 5.0.15 | 5.0.15 | Upgraded in phase 5. Selectors must return stable references — returning a fresh object per render loops forever. |
| `react-bootstrap` | `^2.8.0` | 2.10.10 | 2.10.10 | Already current. |
| `styled-components` | `^6.0.7` | 6.1.19 | 6.6.0 | Minor bump only. |

Upgrade notes:

- **Group the upgrades so nothing is rewritten twice.** TS + lint + super-ipc + Vite/Forge/Electron is one
  toolchain change; React 19 + `@types/react*` + react-intl + react-toastify + zustand is a second, and should
  land with the S32 redesign rather than after it.
- **Electron 45 before the fork restructure.** S33's supervisor design should target the final runtime
  (`utilityProcess`, ESM-capable main process), not one that is 19 majors old.
- **Child-process modules remain the upgrade risk.** They are now TypeScript with validated protocols, but
  they still run under a forked Electron process and assume the Forge flat-entry layout — exercise a real
  scan/convert before and after each bump.
- **No upgrade has any safety net.** With no tests, every dependency bump has to be verified by hand; see S35.

---

## 3. Architecture map

```
HBBatchBeast/                      # repo root = the app
├── forge.config.ts                # Forge + Vite plugin, per-platform icon, ffprobe pruning hook,
│                                  # asar.unpack for binaries, makers (squirrel/zip/rpm/deb)
├── vite.{main,preload,renderer}.config.mts   # manual externals; emit .cjs
├── vitest.config.mts, tsconfig.json, eslint.config.mjs
├── package.json                   # scripts: start / package / make / lint / typecheck / test
└── src/
    ├── main.ts                    # window, ozone relaunch, tray + menu install, handler setup
    ├── main/                      # tray.ts (status icons), menu.ts, paths.ts (dev vs resources/icons)
    ├── preload.ts                 # registerElectronApiBridge(contextBridge, ipcRenderer)
    ├── renderer.ts                # bootstrap: bootstrap.css, toastify, App
    ├── types.d.ts                 # Forge magic constants + typings for untyped deps
    ├── common/                    # channels.ts (enums + API types), types.ts, defaults.ts
    ├── backend/
    │   ├── handlers.ts            # all promise channels + run control, activeRun singleton
    │   ├── helpers/               # buildQueueBuildConfig, createLogFolders, saveAppConfig,
    │   │                          # diagnostics, probeMedia (ffprobe)
    │   ├── processes/             # protocol.ts (zod envelopes), childSupervisor.ts, childEntries.ts
    │   ├── run/                   # runManager (state machine + journal), runService,
    │   │                          # buildWorkerItemConfig
    │   ├── workers/               # worker1.ts entry, protocol.ts (zod), runtime, command,
    │   │                          # media (probe/filters/telemetry), runner, files
    │   └── scanner/               # queueBuild.ts entry, scanQueue.ts, destination.ts
    ├── frontend/
    │   ├── App.tsx                # theme attributes + IntlMessagesProvider → HomePage
    │   ├── core/                  # zustand stores, intl provider, message helper
    │   ├── ui/                    # theme tokens, globalStyle, AppShell, Panel, Button, StatusPill
    │   ├── run/                   # RunScreen, QueueTable (virtualized), MediaInfoModal, validation
    │   ├── settings/              # schema.ts + SettingsForm, profile/ProfileBar, LanguageSelect, hooks
    │   ├── diagnostics/           # DiagnosticsPanel (logs, caches, run journal)
    │   ├── home/                  # HomePage (drawer, version notice, tray status)
    │   └── versionWarning/        # GitHub releases changelog
    └── translations/              # 64 locale JSON files (legacy keys, defaults merged at runtime)
```

### IPC contract

| Channel | Kind | Props | Result |
| --- | --- | --- | --- |
| `LOAD_CONFIGURATION` | sync | — | `GlobalAppConfig` |
| `SAVE_CONFIGURATION` | sync | `GlobalAppConfig` | — |
| `GET_RUN_STATE` | sync | — | `RunState \| null` |
| `PAUSE_RUN` / `RESUME_RUN` / `STOP_RUN` | sync | — | `RunState \| null` |
| `CANCEL_RUN_ITEM` | sync | `{ index }` | `RunState \| null` |
| `GET_DIAGNOSTICS` / `CLEAR_CACHES` / `CLEAR_RUN_JOURNAL` | sync | — | diagnostics payload / `{ cleared }` / — |
| `OPEN_APP_PATH` | sync | `{ path }` | — (guarded to the log/config folders) |
| `PROBE_MEDIA` | sync | `{ path }` | `MediaInfo` (ffprobe) |
| `SET_TRAY_STATUS` | sync | `{ status }` | — |
| `RUN_BATCH_OPERATION` | async | `{ config, operationMode }` | init/progress/complete `RunBatchOperationResult` |
| `RUN_CONVERSION` | async | `{ config, items }` | init/progress/complete `RunState` |

### Runtime layout / config

- `pnpm start` runs `scripts/start.mjs`, which adds `--ozone-platform=x11` on Linux because Electron 45 draws
  no window decorations on native Wayland (no titlebar buttons). Packaged builds re-exec themselves with the
  same flag, and the generated `.desktop` entry passes it too; `HBB_OZONE_PLATFORM=wayland` opts out.
- Tray icons and the window icon are read from `resources/icons` when packaged and `src/assets/icons` in
  development (`src/main/paths.ts`); a missing icon logs `Tray icon could not be loaded`.
- Tray status follows the run status the renderer reports over `SET_TRAY_STATUS`.
- Config: `~/Documents/HBBatchBeast/Config/Configuration.json` (legacy path preserved).
- Logs, worker scratch dirs and the filter-cache files are created by `createLogFolders()` on every load/save;
  the diagnostics panel lists and clears them.
- `GlobalAppConfig = { lang, app_settings, selected_config, version_message, configs: BatchConfig[] }`;
  each config has `tab_batch` plus optional `name`. Legacy `tab_system` worker/log settings are promoted
  from the active profile into shared `app_settings` when loading old configurations. Legacy keys such as `tab_health`,
  `tab_remote` and `api_key` remain in old files and are carried through untouched.
- `BatchOperationMode` has `ScanOnly` and `ScanAndConvert`; anything else throws before a child is forked.

### Toolchain invariants (do not "simplify" these)

- Forge 8 + Vite 8 emit **`.cjs`**: `package.json` `main`, the preload path and every forked entry name.
- Vite 8 (Rolldown) does not externalise Node built-ins or deps for the main build — `vite.main.config.mts`
  lists Node built-ins plus every `dependencies` entry (so adding a runtime dependency there is automatic).
- Forge emits main-process entries as `[name].cjs`; child entries keep the basenames `worker1` and
  `queueBuild`, and `vite.main.config.mts` must not set `build.lib` or that injection is lost.
- `.npmrc` sets `node-linker=hoisted` and `packagerConfig.ignore` keeps `package.json` + `node_modules` while
  skipping `**/.bin/**`; without both, the packaged app has no runtime dependencies.
- `pnpm.overrides.electron` pins the copy that `super-ipc` pulls in as a direct dependency (~260 MB).
- Vite configs stay `.mts` and read `package.json` through `fs`, otherwise the native config loader warns.
- `IntlMessagesProvider` merges the in-code catalogs into `messages`; removing the merge brings back a
  `MISSING_TRANSLATION` error per id per render.
- Packaging: `asar.unpack` keeps the ffprobe binary executable, `packageAfterCopy` prunes the ffprobe binaries
  for other platforms, `extraResource` ships only `icons`, `executableName` must equal the package `name`, and
  makers must be declared in object form (`{ name, config }`) or their `config.options` are ignored.

### Child-process protocol (S33)

Children speak versioned, zod-validated protocols. Both ends decode every message, so an unknown field,
wrong primitive or stale version is a loud error instead of plausible-but-wrong data.

`queueBuild` uses `src/backend/processes/protocol.ts`; `worker1` uses
`src/backend/workers/protocol.ts` (structured `configure` / `item` / `cancel-item` / `shutdown` commands and
`ready` / `request-item` / `started` / `progress` / `file-sizes` / `result` / `console` events).

**queueBuild parent → child**

| Message | Payload |
| --- | --- |
| `configure` | `QueueBuildConfig` — sources, destinations, tempDestinations, useTempFolder, includedFileTypes, container, mode, presets, titleWordFilter, replaceIfSmaller, fileSuffixes, removeApostrophes, replaceAlways, reverseQueue, logDirectory |
| `shutdown` | — (child exits 0) |

**queueBuild child → parent**

| Message | Payload |
| --- | --- |
| `ready` | — (sent **after** the message listener is attached, which closes the old race, D19) |
| `log` | `level`, `message` |
| `progress` | `phase` (`discovered` \| `queued`), `count` — counters only, never the growing file list |
| `complete` | `QueueBuildResult` — total, sources, presets, skipOrCopy, excluded, destinations, destinationsFinal, notExists |
| `error` | `message`, optional `stack` |

**worker1 parent → child**

| Message | Payload |
| --- | --- |
| `configure` | `{ logDirectory }` |
| `item` | `WorkerItemConfig` — action, source/output/final paths, encoder (kind, executable, preset, preset imports), copy/delete/replace flags, custom batch path, priority, inert filter block (scan owns filtering) |
| `cancel-item` | `{ queueNumber }` — kills the running encoder and reports `cancelled` |
| `shutdown` | — (child exits 0) |

**worker1 child → parent**

| Message | Payload |
| --- | --- |
| `ready` | — (listener is attached first) |
| `request-item` | — (sent whenever idle, including after pause resumes) |
| `started` | `{ queueNumber }` |
| `progress` | `{ queueNumber, telemetry, raw }` — percent/fps/frame/speed/ETA/bytes |
| `file-sizes` | `{ queueNumber, sourceBytes, outputBytes }` |
| `result` | `{ queueNumber, state: success \| error \| skipped \| excluded \| cancelled, detail, preset, reason? }` |
| `console` | `{ level, message }` |

Child entry points are resolved through `childEntries.ts` (name → emitted `.cjs` filename) and validated at
startup, so a stale build fails immediately with an actionable message instead of `MODULE_NOT_FOUND`.

There is no positional array left. `worker1` owns its encoder process (`spawn` with argv), ffprobe call, log
writes and file moves; `worker2`, `mediaAnalyser` and `priorityModule` were deleted. Pause/resume is decided by
`RunManager` (idle workers park until resume), and the worker always requests the next item when idle.

### Scan exclusions and destination ownership

A scan lists **every** matching file, including ones it will not convert, with an `excluded` entry
(`{ code, reason }`, `code` = `alreadyConverted` | `alreadyReplaced` | `filtered` | `subtitle`) and a
per-file `trace` of every filter stage. The queue shows excluded rows with the reason and a **Filter**
column that explains the pass/fail/skip status of each stage. `alreadyConverted`/`alreadyReplaced` are
always skipped; any `filtered` result is copied when `copy_filtered_files` is on; `subtitle` is copied.
Filter rules are persisted as a boolean `filter_expression`; legacy flat fields are compiled into an
equivalent expression on read and are no longer rendered.

A destination only counts as converted when it exists **and is non-empty**, and the scanner distrusts outputs
that the run journal records as `running`/`cancelled`/`error` (`QueueBuildConfig.untrustedOutputs`). Encoders
create the output file as soon as they start, so this is what makes a crashed or cancelled run re-queue its
files instead of treating the stub as finished. The worker also deletes its partial output on cancel/failure.

Each profile has a **Filters → Include files that are already converted** switch
(`advanced.include_converted_files_toggle`), which becomes `QueueBuildConfig.includeConverted`. When it is on
the `alreadyConverted` exclusion is not applied, so those files are converted and overwrite their existing
output.

### Fork / child-process architecture — restructured in S33

The process model was inherited straight from the (now deleted) legacy app and was the weakest part of the
backend. It has been replaced by `src/backend/processes/` (supervisor + typed protocol + entry manifest) and
`src/backend/run/` (worker dispatch). The original analysis is kept below because the same rules apply to any
future child process added to the app.

**How it worked before S33**

- `RunBatchOperation` (`handlers.ts:113`) does `childProcess.fork(path.join(__dirname, 'queueBuild.js'))`
  and talks to it with positional arrays tagged by a string in slot 0.
- Legacy orchestration forks **N × `worker1`** (one full Node/Electron process per worker), a **`worker2`**
  per shell command, a **`priorityModule`** to re-`nice` a PID, and a **`scheduler`** process that just runs
  an interval. All four are still built by Forge but are unreferenced by the new backend.
- The worker dispatch contract is a 36-element positional array (`queueWorkerMessage()`), read back by index
  inside `worker1.js`.

**Why it is fragile**

1. **No lifecycle ownership.** There is no `child.on('error')`, no timeout, no watchdog, no kill path and no
   restart policy anywhere in `src/**/*.ts`. If `queueBuild` hangs or dies before emitting `complete`, the
   async handler simply never settles — the renderer's promise stays pending forever. Nothing terminates
   children when the window closes or the app quits.
2. **Positional arrays as an API.** `handlers.ts` builds 15 slots; `queueBuild.js` reads `[1]`…`[14]`. There
   is no shared type, so a wrong index silently yields plausible-but-wrong data — D1 (`aundefined.mp4`) is
   exactly this class of bug, and the 36-field worker array is the same hazard ×2.4.
3. **Brittle module resolution.** Children are located by bare filename relative to `__dirname`. That only
   works while Vite emits one flat, unhashed file per entry next to `main.js`; any change to chunking,
   output format or `outDir` breaks the app at runtime, not at build time.
4. **Blocking I/O on the main process.** Child `writeRequest` / `appendRequest` messages are serviced with
   `fs.writeFileSync`/`fs.appendFileSync` (`handlers.ts:163,175`), so a slow log write stalls the main event
   loop and every IPC channel with it.
5. **Unbounded progress traffic.** Each `onProgress` call re-serializes the entire `completeResult`, including
   the growing `fileList`, so payload size grows with queue length — O(n²) bytes for a full scan.
6. **Orchestration currently sits in the wrong place.** The new backend owns the scan but not the worker
   pool; in the legacy app the queue index, pause/stop flags and worker status live in renderer globals and
   DOM nodes, so a reload loses a running job and the state cannot be tested.
7. **Process sprawl.** A run can mean 1 scanner + N workers + per-file shell processes + a priority process +
   a scheduler process, each a full runtime (~tens of MB RSS). `worker1.js` also contains a CPU-burning
   busy-wait `sleep()` instead of awaiting a timer.

**What S33 changed**

- `ChildSupervisor` owns spawn, the ready handshake, typed messages, timeouts, `error`/`exit` handling,
  SIGTERM→SIGKILL escalation, restart budgets and `will-quit` shutdown.
- `queueBuild` speaks the typed protocol and announces readiness only after its listener is attached.
- Progress is deltas/counters only; the file list travels once, in `complete`.
- No sync filesystem work happens in main while a child runs.

**The design the worker pool was migrated to (S19, delivered in phase 4)**

- One **process supervisor** module in main (`src/backend/processes/`) that owns every child: spawn, typed
  envelopes (`{ id, type, payload }` discriminated unions with a version), request/response correlation IDs,
  progress streamed as deltas, explicit timeouts, `error`/`exit` handling, SIGTERM→SIGKILL escalation,
  restart policy, and deterministic shutdown on `will-quit`.
- Resolve child entries from a **build-time manifest** (entry name → emitted filename) and fail fast with a
  clear error at startup if a required module is missing, instead of a runtime `MODULE_NOT_FOUND`.
- Move the queue/worker state machine into a main-process service with explicit events; the renderer
  subscribes through the existing typed IPC layer and holds no authoritative run state.
- Validate messages at the boundary (shared schema) so a protocol mismatch is a loud error, not corrupt paths.
- Let children do their own async log writes (pass a directory), or batch/queue writes — never sync FS in a
  message handler.
- Collapse the side processes: `worker2`/`priorityModule` become `execFile`/`spawn` calls, `scheduler` becomes
  a timer in main, `mediaAnalyser` becomes a promise-based ffprobe call. Prefer Electron's `utilityProcess`
  over `child_process.fork` for the remaining long-lived workers, and replace the busy-wait.

---

## 4. Completed

| Slice | Summary |
| --- | --- |
| S01 | Electron 26 + Electron Forge + Vite build pipeline, per-module build entries |
| S02 | React 18 + react-bootstrap shell; `index.html` → `renderer.ts` → `App.tsx` — **placeholder UI, replaced by S32** |
| S04 | Config load/save handlers, schema, defaults, corrupt-config archiving, log-dir bootstrap |
| S14 | Scan-only pipeline: React button → async IPC → supervised `queueBuild` → progress + result table |
| S33 | Typed process supervisor: versioned protocol, ready handshake, timeouts, kill escalation, restart budget, entry manifest, `will-quit` shutdown |
| S35 | Test infrastructure + CI: Vitest unit/integration suites (scan contract, config, supervisor failure modes) and a typecheck/lint/test/package workflow |
| S32 | UI foundation: design tokens with light/dark, app shell with status pill and settings drawer, run screen states, virtualized/filterable queue table, inline validation banner |
| S34 | React 19 stack upgraded (react-intl 12, react-toastify 11, zustand 5) |
| S19 | Worker pool: named worker item payload, typed event translation of worker1's arrays, `RunManager` dispatch over `ChildSupervisor` workers, verified with a real HandBrake conversion |
| S20 | Queue control core: start, pause, resume, stop and cancel-item with authoritative state in main |
| S21 | Run state UI: status pill, progress line, virtualized queue table with status filter chips and path search, run journal so an interrupted run is reported instead of looking completed |
| S15–S18 | Schema-driven settings drawer (`settings/schema.ts`): folders, encoder/preset/container, filters, file handling incl. destructive options, system settings; advanced fields behind a toggle; inline validation with blocking-vs-warning copy |
| S23 | Real profile CRUD (new/duplicate/rename/delete) replacing the fixed ten slots; new profiles seed the default file-type list and a `.mkv` container |
| S13 | Language selector (11 locales) wired to `localStorage` + persisted `lang`; see the backfill note in §5 |
| S32 | Phase 5c UI: themed Bootstrap surface (`--bs-*` mapped to tokens, `data-bs-theme`), token `Button`, first-run empty state, destructive-run confirmation, profile bar, language selector |
| S06 | Cross-platform tray: status icons (idle/running/paused/error) driven by the run status, Show/Quit menu, click to toggle the window. Icons ship via `extraResource` → `resources/assets` |
| S07 | Application menu: File/View/Window/Help with reload, zoom, devtools (dev builds), fullscreen and a "Report an issue" link |
| S10 | Logs & diagnostics panel in the settings drawer: log files with sizes, open log/config folders, clear the healthy-file and replaced-file caches, and clear the recovered run journal |
| S27 | Media info viewer: `PROBE_MEDIA` channel backed by ffprobe, with a per-row "Info" action showing container, duration, bit rate and per-stream codec/resolution/channels/language |
| S09 | Version/changelog notice kept on the GitHub Releases API, now reading this fork's releases and persisting the acknowledged version so it stops re-appearing |
| S11 | Packaging: real metadata/icons, per-platform icon selection, `packageAfterCopy` pruning of foreign `ffprobe-static` binaries (680 MB → 444 MB), ffprobe unpacked out of the asar so it can execute, makers configured (deb/rpm with a `--ozone-platform=x11` desktop entry, zip, squirrel) |
| S12 | Legacy app removed: `HBBatchBeast/` (including `HandBrakeCLI.exe` and test media) and `.travis.yml` are gone; a 184 KB sample for the integration test now lives in `tests/fixtures/sample.mp4`, and the README is rewritten for the rewrite |

The vendored CommonJS children were replaced by typed modules: [`src/backend/workers/`](./src/backend/workers)
(`worker1` runtime, command, media, runner, files) and [`src/backend/scanner/`](./src/backend/scanner)
(`queueBuild` entry, `scanQueue`, `destination`). `worker2`, `mediaAnalyser` and `priorityModule` were deleted.

---

## 5. In progress / currently blocking

| Slice | State and what remains |
| --- | --- |
| S34 | TypeScript 7 and ESLint 10 remain blocked upstream (see §2); everything else is current. |
| S13 | Selector and loading are done, but the new UI strings only exist as in-code `defaultMessage`s — the 64 locale JSONs still hold the legacy sentences, so non-English users see English for the new UI. Needs a string-extraction pass (or `en.json` regeneration) plus translations. |
| S16–S18 | Rebuilt as real list editors: paired source/destination/temp rows with OS folder pickers, chip token lists for file types and title words, key/value property-filter rows with Off/any/all, per-folder preset and suffix rows, and a container select. Presets are scanned from the installed `HandBrakeCLI --preset-list` (categorised, with a manual fallback); stale values are flagged with recovery guidance, and hardware-encoder settings warn when multiple workers are configured. Missing destination folders are already created automatically by the queue builder, now called out in the UI. |
| — | Settings are split into Global and Profiles tabs. Language, worker count, verbose worker logs, and log/diagnostic locations are global; conversion folders, encoder, presets and file handling remain profile-scoped. Legacy `tab_system` settings migrate from the active profile on load. |
| S21 | Queue table covers scan + run rows, status chips and path search. Row actions (cancel item, open log, reveal, media info, retry) and bulk selection are still to come. |
| S32 | Row-level inputs now have explicit accessible labels. Remaining design work: keyboard-first navigation beyond native `<details>`/modal/segmented-switch behaviour and a dark/light contrast audit on real hardware. The row-editor rework landed with the settings UX pass. |
| — | Dropped-feature cleanup is complete: health-check/repair, corrupt-file moving, scheduler, remote, email and `api_key` are gone from the config and the rewritten worker/scanner. |
| — | `low_process_priority_toggle` is wired through the worker payload to `os.setPriority` on the encoder process (D29). |
| — | `--max-parallel <n>` (or `HBB_MAX_PARALLEL`) is a startup guard: the app counts existing HandBrakeCLI/FFmpeg/ffprobe and worker processes and refuses to start when the total exceeds the budget. The same limit caps the worker count, and preset scans are skipped while the budget is full. |
| — | Only the icon directory is shipped now (`resources/icons`), so the legacy fonts and promo images no longer travel with the app. |
| — | Windows `HandBrakeCLI.exe` is not bundled automatically: the packaged app resolves it from `PATH`, and `packaging/bin` is not wired into `extraResource`. Windows/macOS packages cannot be built or verified on this Linux host. |

---

## 6. Remaining (continue or not started)

Grouped by slice ID; descriptions are in §7.

- **Continue (partial):** S03, S06, S07, S09, S11, S13, S15, S16, S17, S18, S21, S31
- **Not started — shell/platform:** S05, S08, S10, S12
- **Not started — batch pipeline:** S19, S20, S22, S23, S24
- **Not started — supporting tools:** S25, S26, S27, S28, S29, S30
- **Not started — design (cross-cutting):** S32
- **Not started — architecture (cross-cutting):** S33
- **Not started — engineering health (cross-cutting):** S34, S35

---

## 7. Feature slices (decision list)

State: ✅ done · 🟡 partial · ⛔ not started.
"Suggested" is the audit recommendation, not a decision. Use the `Keep?` column to answer each slice.

### A. Platform & app shell

| ID | Feature slice | Short description | State | Depends on | Suggested | Keep? |
| --- | --- | --- | --- | --- | --- | --- |
| S01 | Modern build pipeline | Electron 26, Forge 6, Vite, TypeScript; one Vite entry per child-process module. | ✅ | — | Keep | `[x] yes  [ ] no` |
| S02 | React shell & theming | React 18 + react-bootstrap + react-toastify, `App` → `HomePage`. **Placeholder scaffolding only** — the visual layout is throwaway and gets replaced by S32. `styled-components` is installed but unused. | ✅ | S01 | Keep as scaffolding | `[x] yes  [ ] no` |
| S03 | Typed IPC layer | `super-ipc` sync/async hooks, typed channels/API, standardized `AppError`; replace bespoke wrapper. | ✅ | S01 | Keep — delivered | `[x] yes  [ ] no` |
| S04 | Config persistence | Load/save `Configuration.json`, defaults, version stamp, archive invalid file, create log dirs. | ✅ | — | Keep | `[x] yes  [ ] no` |
| S05 | Custom window chrome | Frameless window with drag region plus min/max/close buttons; old app also prevented real minimize. | ⛔ | S02 | Drop candidate — native frame is simpler and works on all 3 OSes | `[ ] yes  [x] no` |
| S06 | Tray icon & status icons | Tray menu (Show / Clear notification / Quit) and `iconrunning` / `iconwatching` / `iconerror` status swaps. | ✅ | S01 | Keep, but rewrite: current code is Windows-only and points at non-existent `__dirname/assets` paths | `[x] yes  [ ] no` |
| S07 | App menu & devtools | File→Quit accelerator, dev-only devtools/reload menu. | ✅ | S01 | Keep (small) | `[x] yes  [ ] no` |
| S08 | Autostart / launch behaviour | "Start scan+convert when opened", hide-to-tray on minimize, single-instance guard. | ⛔ | S05/S06 | Keep only launch-scan; drop hide-to-tray if S05 dropped | `[ ] yes  [x] no` |
| S09 | Version / changelog notice | Notify users of a new release and show the changelog. New impl uses GitHub Releases instead of `hbbatchbeast.io/api/version`. | ✅ | S04 | Keep (already re-implemented) | `[x] yes  [ ] no` |
| S10 | Logs & cache tools | View master/error/conversion/scan logs, open log folder, clear healthy-file and replace-attempt caches. | ✅ | S04 | Keep | `[x] yes  [ ] no` |
| S11 | Packaging & bundled binaries | Forge makers (squirrel/zip/rpm/deb), app icons/metadata, bundle `HandBrakeCLI.exe` + ffmpeg/ffprobe binaries. | ✅ | S01 | Keep — required before release | `[x] yes  [ ] no` |
| S12 | Legacy cleanup | Delete `HBBatchBeast/` (`mainWindow.html`, `main.js`, old installers, 52 MB `HandBrakeCLI.exe`, test media), retire `.travis.yml`. | ✅ | S11 | Keep — required for a coherent repo | `[x] yes  [ ] no` |
| S13 | Localization | 64 locale JSONs, localized messages, language selector; old app auto-extracted `en.json` from the DOM in dev. | 🟡 | S02 | Keep (backfill strings) | `[x] yes  [ ] no` |

### B. Batch pipeline

| ID | Feature slice | Short description | State | Depends on | Suggested | Keep? |
| --- | --- | --- | --- | --- | --- | --- |
| S14 | Scan / queue build | Recursively scan source folders, evaluate the boolean filter expression (type, name, size, output state, ffprobe properties), return queue with per-file preset, stage trace and extra actions. | ✅ | S04 | Keep | `[x] yes  [ ] no` |
| S15 | Batch paths & folder options | Paired source/destination rows with optional per-row temp folders (folder pickers, add/remove row, multi-line paste), temp-conversion toggle, auto-create folders, per-row validation. | ✅ | S14 | Keep | `[x] yes  [ ] no` |
| S16 | Encoder & preset selection | HandBrake vs FFmpeg segmented switch, per-folder preset rows populated from the installed HandBrakeCLI, per-folder FFmpeg/custom argument rows, container select, per-folder suffix, preset validation; NVENC/imported-preset warnings remain. | ✅ | S15 | Keep | `[x] yes  [ ] no` |
| S17 | File selection filters | Step-by-step AND/OR rule stack with file type, filename, size, output-state and ffprobe media-property stages; catalog-backed property/value pickers; copy-filtered-files and copy SRT actions; legacy flat fields migrate automatically. | ✅ | S14 | Keep | `[x] yes  [ ] no` |
| S18 | File handling actions | Delete source, replace original (always / if smaller), remove apostrophes, reverse queue, custom batch-file hook, low process priority. | ✅ | S16 | Keep | `[x] yes  [ ] no` |
| S19 | Worker pool execution | Fork N `worker1` processes, dispatch queue items, track per-worker status/percentages, progress, priority process, cancel item, error collection. | ⛔ | S14, S16 | Keep — core of the app | `[x] yes  [ ] no` |
| S20 | Queue controls | Start, pause, resume, stop, convert-selected; per-item select/deselect/invert in the queue view. | ⛔ | S19 | Keep | `[x] yes  [ ] no` |
| S21 | Results & status UI | Session conversion table with success/error/cancelled/remaining/other row filters, counters, last-completed time, per-worker graph. | 🟡 | S19 | Keep | `[ x] yes  [ ] no` |
| S22 | Scheduling | Periodic re-scan interval (min 5 s) and daily run window (start/end, handles cross-midnight); old "folder watching" is just periodic rescanning, not `fs.watch`. | ⛔ | S19 | Keep | `[ ] yes  [x] no` |
| S23 | Configuration profiles | Fixed 10-slot profile selector (`selected_config`) with per-profile settings. Legacy app had no create/rename/delete. | ✅ | S15–S18 | Keep, but prefer real CRUD over 10 fixed slots | `[x] yes  [ ] no` |
| S24 | System settings | Worker instance count, queue-view size limit, run-on-startup, save verbose logs, queue table behaviour. | ⛔ | S19 | Keep | `[x] yes  [ ] no` |
| S25 | Email error alerts | SMTP/emailjs notification when a run ends with errors (plaintext password, no OAuth/2FA support). | ⛔ | S19 | **Drop candidate** — insecure credential handling and unmaintained deps | `[ ] yes  [x] no` |
| S26 | Health check tab | Quick HandBrake `--scan` vs thorough FFmpeg `-v error` check, optional repair (CRF), move corrupt files to folder, healthy-file cache + clear, health summary. | ⛔ | S19 | Undecided — feature is valuable but needs its own validation pass | `[ ] yes  [x] no` |
| S27 | Media info viewer | Standalone ffprobe browser to inspect a file's video/audio stream properties. | ✅ | S11 | **Drop candidate** — side tool, unrelated to the rewrite goal | `[x] yes  [ ] no` |
| S28 | Benchmark tab | Download a 4K H.265 sample, run 4 HandBrake workers, show/upload results. | ⛔ | S19 | **Drop candidate** | `[ ] yes  [x] no` |
| S29 | Remote monitoring | Remote view toggle, generated API key, PUT status/metrics to `hbbatchbeast.io`, open browser status page. | ⛔ | S19 | **Drop** (owner stated intent) — also relies on a third-party service | `[ ] yes  [x] no` |
| S30 | Help tab & tooltips | In-app help tab plus 33 contextual tooltip blocks embedded in the old HTML. | ⛔ | S02 | Drop in-app help; link to docs/wiki instead | `[ ] yes  [x] no` |
| S31 | In-app console | Collapsible console bar streaming child-process messages, plus log shortcut. | 🟡 | S14 | Keep (replace `console.log` plumbing) | `[x] yes  [ ] no` |

### C. Design (cross-cutting)

| ID | Feature slice | Short description | State | Depends on | Suggested | Keep? |
| --- | --- | --- | --- | --- | --- | --- |
| S32 | UI/UX redesign | Replace both the placeholder React UI and the legacy layout with a purpose-built interface. Legacy UI supplies the feature inventory; none of its markup, tab structure or styling is carried over. See the design brief below. | 🟡 | S02 (can start now), S15–S21 for feature parity | Keep — this is the visible outcome of the rewrite | `[x] yes  [ ] no` |

#### S32 design brief

> Superseded in detail by [`docs/ui-design-intent.md`](./docs/ui-design-intent.md), which is derived from
> [`docs/user-stories-and-flows.md`](./docs/user-stories-and-flows.md). The summary below is kept as context
> for why S32 exists; use the design intent document for actual UI decisions.

**Starting point.** The legacy UI is not a benchmark to match, it is a list of things the tool must be able to
do. Known UX problems worth actively fixing:

- Six top-level tabs (`Health check`, `Batch conversion`, `Remote monitoring`, `Benchmark`, `System`, `Help`)
  all share one long scroll; related settings are far apart and a plain scan requires scrolling past the
  health-check and benchmark copy.
- ~65 unlabelled-feeling inputs, many free-text where a toggle/select/number would do (e.g. comma-separated
  file types, `hh:mm` typed by hand, per-folder newline-aligned suffix lists).
- Validation runs once, on submit, as `alert()`-style modal text; nothing is flagged inline while editing.
- The tooltip column is the only documentation, and the help lives behind `�` glyphs.
- Status is rendered by injecting HTML strings into `div`s and reading `.value` back out of the DOM, so
  "state" and "view" are the same thing (this is also why the ported backend logic is hard to reason about).
- Destructive options (delete source, replace original) sit next to benign ones with no hierarchy.
- No dark mode, no keyboard navigation, no visible focus states.

**Target direction.**

1. **Visual system first.** Pick a small design layer (tokens for color/space/type, light + dark, one accent)
   and use it everywhere; `styled-components` is already a dependency but unused. Prefer a component set over
   ad-hoc `style={{...}}` blocks. Keep react-bootstrap only if it is themed to match.
2. **Job-centric information architecture.** One primary screen = the run (pick folders → preview what will
   be converted → run → watch queue/progress/errors). Settings become a drawer or dedicated route, grouped as
   *Folders*, *Encoding*, *Filters*, *File handling*, *Scheduling*, *System* — with advanced options collapsed
   by default. No more "everything visible at once".
3. **Progressive disclosure.** Show the 6–8 options used by most people; put presets-vs-custom, property
   filters, size filters, custom batch hook, priority and logging behind "Advanced".
4. **Inline, actionable validation.** Validate on blur against the real rules (source exists, destination not
   inside source, temp/source counts must match, preset count must match folder count, interval ≥ 5 s, daily
   window cross-midnight). Show the fix, not just the failure. Keep `queueInfoBomb`'s assumptions in sync.
5. **Async-native run view.** Stream progress through typed IPC into a store; render queue rows as
   first-class objects with per-row status, selected/paused/cancelled state, and virtualize long queues
   instead of the legacy "queue size view limit" workaround (S24).
6. **Respect platform + accessibility.** Native window frame, OS-appropriate menus, keyboard reachable
   controls, sensible focus rings, reduced-motion-safe animations, localized strings via react-intl.
7. **Explanations, not tooltips.** Short inline helper text for hoisted options, with a link to the wiki;
   this replaces S30's 33 tooltip blobs.

**Sequencing note.** The design layer can be established immediately and grown slice by slice — do not wait
for S19. Build the shell (S32) alongside the settings schema (S15–S18) so controls and validation are written
once, then attach the worker/queue views to the same layout when S19 lands. Avoid building polished widgets
against placeholder data that the backend cannot yet produce.

### D. Architecture & engineering health (cross-cutting)

| ID | Feature slice | Short description | State | Depends on | Suggested | Keep? |
| --- | --- | --- | --- | --- | --- | --- |
| S33 | Process/fork supervisor | Replace today's ad-hoc `childProcess.fork` calls and positional-array messages with a single owned supervisor: typed message envelopes, correlation IDs and timeouts, `error`/`exit` handling with kill escalation and restart, manifest-based entry resolution, no sync FS on the main process, delta progress, and fewer long-lived processes. Full analysis in §3. | ✅ | S14 | Keep — delivered in phase 3 | `[ ] yes  [ ] no` |
| S34 | Dependency & toolchain upgrade | Bring the stack current: TypeScript 4.9 → 7 (or 5.x as a stepping stone), super-ipc 0.0.11 → 0.1.0, Electron 26 → 45, Forge 6 → 8, Vite 4 → 8, ESLint 8 → 10 with `typescript-eslint` 8, React 18 → 19 with `@types/react*`, react-intl 12, react-toastify 11, zustand 5. Matrix and ordering notes in §2. | ⛔ | S03 (same work for TS/resolution) | Keep — several fixes (D5, EOL lint stack) are blocked on it | `[ ] yes  [ ] no` |
| S35 | Test infrastructure & CI | Add a runner (Vitest for renderer/common units, node-based integration tests for backend handlers), a first real test for the `queueBuild` fork contract (the ad-hoc smoke test in §2 becomes a fixture), schema/validation tests for config, and at least one CI workflow running typecheck + lint + tests on push/PR. | ⛔ | S34 (toolchain), S33 (fork harness) | Keep — every upgrade and refactor is currently unguarded | `[ ] yes  [ ] no` |

Rationale in one line: the fork layer has no lifecycle ownership, no message schema, brittle `__dirname`
path resolution and blocking I/O on the main process, so every feature built on top of it (worker pool,
health check, scheduling) inherits that fragility. Restructure it once, before S19 grows the surface area.

---

## 8. Known defects found during the audit

These are all in the migrated code, not legacy-only issues.

| # | Severity | Where | Problem |
| --- | --- | --- | --- |
| D1 | 🔴 High | [buildQueueInfoBomb.ts](./src/backend/helpers/buildQueueInfoBomb.ts) | `file_name_suffix_toggle === 1 ? ... : []` sent an **empty array** when the toggle was off, so `queueBuild` produced `aundefined.mp4` destinations. **Fixed in phase 2**: the builder always emits one suffix per source folder and pads partial lists. Covered by tests. |
| D2 | 🔴 High | [buildQueueInfoBomb.ts](./src/backend/helpers/buildQueueInfoBomb.ts) | Standard presets are sent as plain names, but `queueBuild`/`worker1` expect HandBrake args. **Fixed in phase 2**: standard presets are wrapped as `-Z "…"` (already-argument presets are left alone) and the results table resolves labels from the active preset source. |
| D3 | 🔴 High | [types.ts](./src/common/types.ts) | `HealthCheck` mode was accepted but never built the health-check preset, so a health run would have executed as a conversion. **Fixed in phase 2**: the mode is gone from the enum and any unsupported/absent mode throws before a child is forked. |
| D4 | 🔴 High | `package.json`, `forge.config.ts` | Runtime deps were missing/undeclared. **Fixed in phase 2**: `fs-extra`, `ffprobe` and `ffprobe-static` are declared, `node-linker=hoisted` keeps `node_modules` copyable, and `packagerConfig.ignore` keeps `package.json` + production `node_modules` in the package. Verified by running a scan from the extracted `app.asar`. **Shrunk in phase 7**: `packageAfterCopy` prunes the non-target `ffprobe-static` binaries and the package is now ~444 MB. |
| D5 | 🟠 Medium | `tsconfig.json`, `.eslintrc.json` | `@superflag/super-ipc-*` are ESM-only with no `main`/`types`; `module: commonjs` + `moduleResolution: node16` cannot resolve them. **Fixed in phases 0–1**: TypeScript 5.9 + `moduleResolution: "bundler"`, and super-ipc 0.1.0 ships dual CJS/ESM with real type entries. |
| D6 | 🟠 Medium | [main.ts:19](./src/main.ts) | `nodeIntegration: true` alongside a contextBridge preload. **Fixed in phase 1**: now `false`. |
| D7 | 🟠 Medium | [main.ts:36](./src/main.ts) | Tray/icon paths use Windows separators (`.\assets\...`) relative to `__dirname`, but assets live in `src/assets` and are not copied to the build root. The tray is created only on Windows (so Linux/macOS get no tray at all), and the later per-platform `iconpath` assignments at lines 97–111 are dead code. |
| D8 | 🟡 Low | [main.ts:115](./src/main.ts) | Leftover legacy listeners (`item:add`, `item:ready`, `mediaview:ready`, `benchstatus:ready`) that only echo `"Test"`. |
| D9 | 🟡 Low | [BatchOperationResults.tsx](./src/frontend/home/BatchOperationResults.tsx) | Debug `console.log` plus unguarded config access. **Fixed in phase 2** while correcting preset labels. |
| D10 | 🟡 Low | `src/common/types.ts` | `BatchOperationMode.ScanOnly = 'scannonly'` (typo, and the comment says "replace this with flags"). `queueBuild` compares against `'healthCheck'` only, so the typo is currently harmless but confusing. |
| D11 | 🟡 Low | `dist/` | Stale, untracked `tsc` output from the earlier build; safe to delete and add to `.gitignore`. |
| D12 | 🟡 Low | `package.json` | Placeholder `description` ("My Electron application description"), lowercase `productName`, no `icon` in `packagerConfig`, no `typecheck`/`test` scripts. |
| D13 | 🟠 Medium | `src/backend/processes/` | No child lifecycle management previously: no `error` listener, timeout, kill path or restart, so a hung child left the run pending forever. **Fixed in phase 3** by `ChildSupervisor` (ready timeout, run watchdog, SIGTERM→SIGKILL, restart budget, `will-quit` shutdown). |
| D14 | 🟠 Medium | `src/backend/handlers.ts` | Sync FS writes ran inside the child `message` handler, blocking the main event loop. **Fixed in phase 3**: the write/append message types are gone; children log through typed `log` messages only. |
| D15 | 🟠 Medium | `src/backend/handlers.ts` | Progress re-serialized the whole result including the growing file list. **Fixed in phase 3**: progress carries counters only; the file list is sent once in `complete`. |
| D16 | 🟡 Low | `package.json` | `@types/react` is not declared; it resolves only via peer hoisting, and the tree currently contains two incompatible copies (18.3.23 and 19.1.9). Declare it explicitly and keep it aligned with `react`/`react-dom` during the S34 upgrade. |
| D17 | 🟡 Low | whole repo | No automated verification of any kind: no test runner, no test files, no CI workflow. Every dependency bump and refactor is validated by hand. See S35. |
| D18 | 🟡 Low | [createLogFolders.ts](./src/backend/helpers/createLogFolders.ts) | Assumed `~/Documents` already existed. **Fixed in phase 2**: all directory creation is recursive, covered by a fresh-home test. |
| D19 | 🟠 Medium | [queueBuild.ts](./src/backend/scanner/queueBuild.ts) | Startup race: the child announced readiness before attaching its message listener, so the parent's reply could be dropped and the run never settled. **Fixed in phase 3**: readiness is sent last, and the supervisor only configures after the handshake. |

| D20 | 🔴 High | [stores.ts](./src/frontend/core/stores.ts) | The "mirror this prop into the store" store helper (`useSetValue`) ran its effect with no argument, so any component that only wanted the setter reset the value to `undefined`. The scan result was stored and immediately wiped, leaving the queue permanently empty. **Fixed in phase 5**: the helper is gone; callers set the store explicitly (`useSetter`). |
| D21 | 🔴 High | [HomePage.tsx](./src/frontend/home/HomePage.tsx) | The loaded config was re-mirrored into the store on every render, so every settings/profile edit was silently undone by the next render. **Fixed in phase 5**: the store is seeded once per fetch result, and successful settings saves push the saved config back into the store. |
| D22 | 🟠 Medium | [globalStyle.ts](./src/frontend/ui/globalStyle.ts) | Bootstrap kept its stock light palette inside the dark shell, so the settings drawer rendered white-on-white. **Fixed in phase 5**: `--bs-*` variables are mapped to theme tokens and `data-theme`/`data-bs-theme` follow `prefers-color-scheme`. |
| D23 | 🟠 Medium | [buildQueueBuildConfig.ts](./src/backend/helpers/buildQueueBuildConfig.ts) | `queueBuild` concatenates the container onto the file name, so a profile storing `mkv` instead of `.mkv` produced `Episode 01mkv`. **Fixed in phase 5**: the container is normalised to a dotted extension (test added). |
| D24 | 🟠 Medium | [RunScreen.tsx](./src/frontend/run/RunScreen.tsx) | The status pill read the last *progress* frame, which still says `running`, so a finished run showed "Running" forever. **Fixed in phase 5**: the terminal payload wins. |
| D25 | 🟡 Low | [RunScreen.tsx](./src/frontend/run/RunScreen.tsx) | Switching profile kept the previous profile's queue and run rows on screen, so Start could have run files from another profile. **Fixed in phase 5**: queue and run state are keyed to a signature of the active profile's queue-relevant settings. |
| D26 | 🟡 Low | [LibraryBar.tsx](./src/frontend/settings/library/LibraryBar.tsx) | A newly created profile had an empty `included_file_types`, and an empty list matches no files, so new profiles scanned nothing with no explanation. **Fixed in phase 5 and carried into libraries**: new libraries seed the default file-type list/default preset, and an empty scan result now explains whether nothing matched or everything was already converted. |
| D27 | 🟡 Low | [Panel.tsx](./src/frontend/ui/Panel.tsx), [QueueTable.tsx](./src/frontend/run/QueueTable.tsx) | Long comma-separated filter values overflowed the panel grid horizontally, and the RTL ellipsis trick dropped the leading `/` from queue paths. **Fixed in phase 5**: grid columns can shrink below content, and paths render as directory + file name. |
| D28 | 🟡 Low | `src/frontend/ui/Button.tsx` | Bootstrap's `success`/`danger` buttons hard-code white labels, which fails contrast against the bright dark-theme tokens. **Fixed in phase 5**: a token-based `Button` supplies both background and label colour per theme. |
| D29 | 🟠 Medium | [schema.ts](./src/frontend/settings/schema.ts) | `low_process_priority_toggle` was persisted but unused. **Fixed in the worker overhaul**: the setting reaches `WorkerItemConfig.lowPriority` and the runner calls `os.setPriority` on the spawned encoder (POSIX nice 10, Windows below-normal). |
| D30 | 🟠 Medium | [VersionWarning.tsx](./src/frontend/versionWarning/VersionWarning.tsx) | The changelog notice read releases from the **upstream** repo (`HaveAGitGat/HBBatchBeast`) and never recorded that the user had seen it, so it reappeared every launch. **Fixed in phase 6**: it reads this fork's releases and persists the acknowledged version. |
| D32 | 🔴 High | `forge.config.ts` | `ffprobe-static`'s binary was packed **inside** `app.asar`, and binaries cannot be executed from an asar archive, so media info and the `mediaAnalyser` child would fail in packaged builds. **Fixed in phase 7**: `asar.unpack` extracts `ffprobe-static/bin/**`, verified by probing a file from the packaged app. |
| D33 | 🟠 Medium | `package.json` | `license: MIT` while `LICENSE` is GPL-3.0, and the metadata was still the Electron Forge placeholder (`productName: hbbatchbeast`, "My Electron application description'). **Fixed in phase 7**: GPL-3.0-only, real description/author/repo/keywords, `productName: HBBatchBeast`. |
| D31 | 🟡 Low | [tray.ts](./src/main/tray.ts) | Legacy tray code only ran on Windows and pointed at `__dirname/assets`, which does not exist in the build output, so Linux/macOS had no tray at all and Windows had broken icons. **Fixed in phase 6**: one cross-platform tray, assets resolved through `resources/assets`, with a logged warning when an icon cannot be loaded. |

---

## 9. Guidance for a future agent

### Order of work that avoids rework

1. **Upgrade and unbreak the toolchain (S03 + S34).** This is one job: TypeScript 4.9 → 5.x/7 (TS 4.9 cannot
   do `moduleResolution: "bundler"`), super-ipc 0.0.11 → 0.1.0, ESLint 10 + `typescript-eslint` 8, and
   Vite 8 + Forge 8 + Electron 45. Commit the `yarn → pnpm` switch and add `typecheck`/`test` scripts. Then
   get `tsc --noEmit` and `pnpm lint` green — do not patch `node_modules`. Verify each bump with a real
   `pnpm package` plus a manual scan, since the forked children assume Forge's flat `.cjs` entry layout.
2. **Stand up tests (S35) before changing more behaviour.** Turn the ad-hoc `queueBuild` fork smoke test into
   a fixture, add handler/config tests, and wire a CI workflow for typecheck + lint + tests. Without this,
   every later step (especially the fork restructure and the remaining upgrade half) is unverified.
3. **Fix the scan contract (D1, D2, D4).** Add `fs-extra`, `ffprobe`, `ffprobe-static` to `dependencies`,
   send one suffix per source folder, and normalize presets to the exact strings `worker1` expects. Cover it
   with the tests from step 2.
4. **Restructure the fork layer (S33) before growing it.** Introduce the process supervisor described in §3:
   typed envelopes with correlation IDs, timeouts, `error`/`exit`/kill/restart handling, manifest-based entry
   resolution, async log writes, and delta progress. Do this _before_ S19, otherwise the worker pool
   multiplies the existing fragility by N processes. Target Electron 45 + `utilityProcess` here.
5. **Worker pool (S19/S20/S21/S31)** is the critical path. Everything interesting (convert, health, schedule)
   depends on it. Port `queueWorkerMessage()` as a typed object, and model worker/queue state in a store
   rather than DOM reads. The legacy renderer is the specification:
   `convertFiles` (:1477), `runScan` (:3794), `launchWorkerModules` (:2939), `queueWorkerMessage` (:4916),
   `pauseQueue` (:4873), `continueQueue` (:4974), `stopQueue` (:4839), `cancelItemProcess` (:5056),
   `AllComplete` (:4039). Kept separate from the UI: run state must live in main, not the renderer.
6. **Settings UI (S15–S18, S23)**: build a schema-driven form instead of hand-writing ~65 controls, and
   style it from the S32 design layer. The config types in `src/common/types.ts` are already the desired
   shape. The three textareas in `BatchTab.tsx` are placeholders and should be replaced, not extended.
7. **UI/UX redesign (S32) + React 19.** The React UI is scaffolding, and the legacy UI is a feature inventory
   with poor UX — do not port `mainWindow.html` markup, its six-tab layout or its tooltip blobs. Establish the
   design tokens and layout shell early, then grow it slice by slice. Do the React 19 / `@types/react*` /
   react-intl 12 / react-toastify 11 / zustand 5 bump as part of this step so the new components are written
   against the final versions only once.
8. **Package & clean up (S11, S12)** only after the above, so the repo has one obvious app entry point.

### Invariants to preserve

- Config path and JSON shape (users have existing `Configuration.json` files).
- `~/Documents/HBBatchBeast/{Config,Logs}` layout and log file names — child modules read them directly.
- Child-process entry basenames (`worker1.ts`, `queueBuild.ts`) must keep their Forge build entries so the
  emitted `[name].cjs` still matches `childEntries.ts`; the
  backend forks them by path from `__dirname`.
- `queueBuild` positional protocol (see §3). If you refactor it, change both sides in one commit.
- `contextIsolation`/preload is the only renderer→main path; do not reintroduce `electron.remote`.
- **UI is not an invariant.** Neither the placeholder React screens nor `mainWindow.html` are a layout
  spec — keep the IPC contracts and config shape stable so the S32 redesign is free to change everything
  above them.

### Deliberately not migrated yet

No decision has been made on S25–S30. Before implementing any of them, check §7's `Keep?` column. Remote
monitoring (S29) and status upload are explicitly unwanted; benchmark (S28) and email alerts (S25) are strong
drop candidates.
