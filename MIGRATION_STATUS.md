# HBBatchBeast Migration Status

> Snapshot taken 2026-10-21 on branch `rewrite` (HEAD `73c9a8e`), with uncommitted work in the tree.
>
> Legacy app: [`HBBatchBeast/`](./HBBatchBeast) (vanilla HTML/JS, Electron 3)
> Rewrite: [`new/HBBatchBeast/`](./new/HBBatchBeast) (Electron Forge + Vite + React 18 + TypeScript, Electron 26)

---

## 1. TL;DR for the next agent

The rewrite **scaffolding is done and it packages successfully**, but the app is still a skeleton: only the
**Batch → Scan Only** path is wired end to end. Configuration load/save, a typed IPC layer, three settings
fields, a scan button and a scan-result table exist. Everything else in the old UI (conversion, worker pool,
queue controls, health check, scheduling, system settings, logs, tray, translations) is still living only in
[`HBBatchBeast/mainWindow.html`](./HBBatchBeast/mainWindow.html) (~292 KB of inline JS) and
[`HBBatchBeast/main.js`](./HBBatchBeast/main.js).

**Design work is specified elsewhere.** UI intent now lives in
[`docs/user-stories-and-flows.md`](./docs/user-stories-and-flows.md) (personas, intents I1–I8, stories
US-01–US-27, flows F1–F9, non-goals) and [`docs/ui-design-intent.md`](./docs/ui-design-intent.md) (principles
D1–D8, IA, per-screen states, interaction patterns, a11y). The slice tables below remain the implementation
inventory; where they disagree with the design intent on UI matters, the design intent wins.

**The current React UI is a placeholder, not a design.** It exists only to exercise the new backend while
the IPC/handler/module layer was rebuilt: three textareas, one button, one table. The legacy UI is
feature-complete but has genuinely poor UX — ~65 raw inputs across six cramped tabs, 33 tooltip blobs,
validation that only fires on submit, a 2,000-line scroll, and the DOM used as application state. Treat the
legacy UI as a **feature inventory**, not a layout to copy: the rewrite should target a modern aesthetic and
substantially better UX (see S32). Do not 1:1 port its markup or its tab structure.

**The fork/child-process layer is the weakest part of the backend and needs restructuring (S33).** It has no
lifecycle ownership (`error`/timeout/kill/restart), talks in positional arrays whose indices are duplicated
across files, resolves child entry points by bare filename from `__dirname`, performs sync FS writes inside
message handlers, and spawns more processes than it needs. Treat §3's target design as a prerequisite for the
worker pool rather than porting the legacy orchestration as-is.

Two things will bite you immediately:

1. `pnpm lint` and `npx tsc --noEmit` **both fail**. The `@superflag/super-ipc-*` packages are ESM-only
   (`"exports": { "import": ... }`, no `main`/`types`), which `tsconfig.json` (`module: commonjs`,
   `moduleResolution: node16`) and `eslint-plugin-import` cannot resolve. Vite still bundles them, so
   `pnpm package` succeeds — type safety is just silently off.
2. The ported child-process modules `require()` packages that are **not declared in `package.json`**
   (`fs-extra`) or **not installed at all** (`ffprobe`, `ffprobe-static`). Scan works in a dev checkout by
   accident (hoisted transitive dep) and **fails in the packaged build** (`fs-extra` is absent from
   `out/.../resources/app/node_modules`).

Do not port the "Drop candidate" slices in §7 (remote monitoring, status upload, email alerts, benchmark)
without a decision — the owner does not intend to keep several of them.

**The dependency stack is a year-plus stale and there is no test suite.** Electron 26 (latest 45), React 18
(latest 19), TypeScript 4.9 (latest 7), super-ipc 0.0.11 (latest 0.1.0), with Forge 6, Vite 4 and ESLint 8
behind them. Nothing verifies any of this: no test runner, no test files, and no CI workflow — the only files
under `.github/` are issue templates. See §2 for the matrix and slices S34/S35.

---

## 2. Verified state (commands actually run)

| Check | Command | Result |
| --- | --- | --- |
| Lint | `pnpm lint` | ✅ 0 errors, 15 pre-existing warnings |
| Typecheck | `pnpm typecheck` (`tsc --noEmit`) | ✅ clean (TypeScript 5.9 + `moduleResolution: "bundler"`, `paths` for the super-ipc ESM packages) |
| Build/package | `pnpm package` | ✅ Vite bundles + app packages for linux-x64 |
| Scan pipeline | forked `.vite/build/queueBuild.js` with a synthetic `queueInfoBomb` | ✅ finds files, builds queue, emits `complete` |
| Packaged runtime deps | inspect `out/.../resources/app/node_modules` | ❌ `fs-extra`, `ffprobe`, `ffprobe-static` absent; `shelljs` present |
| Tests | `pnpm test` (Vitest) | ✅ 8 tests: config/log-folder helpers + a real `queueBuild` fork contract suite (scan, destination diffing, title filter, file-type filter) |
| CI | `.github/workflows/ci.yml` | ✅ typecheck → lint → test → package on push/PR |

### Dependency & toolchain currency

Versions checked 2026-10-21 via `npm view <pkg> version`; "installed" read from `node_modules`.

| Package | Declared | Installed | Latest | Notes |
| --- | --- | --- | --- | --- |
| `electron` | `^45.0.0` | 45.0.0 | 45.0.0 | Upgraded from 26. Note `super-ipc-{backend,react,preloader}` declare `electron@^31` as a *direct* dependency, so pnpm still installs nested copies for them; consider `pnpm.overrides` to dedupe. |
| `@electron-forge/*` | `^8.0.1` | 8.0.1 | 8.0.1 | Upgraded. Forge 8 + Vite 8 emit bundles as **`.cjs`**, so `main` is `.vite/build/main.cjs` and child-module filenames changed from `.js` to `.cjs`. |
| `typescript` | `^5.9.0` | 5.9.3 | **7.0.2** | Upgraded in phase 0 (4.9 could not do `moduleResolution: "bundler"`). Moving to 7.x is still open. |
| `@superflag/super-ipc-{core,react}` | `^0.1.0` | 0.1.0 | 0.1.0 | Dual CJS/ESM with real type entries — this removed the need for `paths`/resolver hacks. |
| `@superflag/super-ipc-{backend,preloader}` | `^0.0.23` / `^0.0.22` | 0.0.23 / 0.0.22 | 0.0.23 / 0.0.22 | These packages are on their own 0.0.x line; `backend@0.0.23` depends on `core@0.1.0`, so the versions are paired deliberately, not stale. |
| `react` / `react-dom` | `^18.2.0` | 18.3.1 | **19.3.1** | Upgrade together with the S32 redesign — every UI component is being replaced anyway. |
| `@types/react` | *not declared* | 18.3.23 (hoisted peer), plus a duplicate 19.1.9 | 19.3.0 | Missing from `devDependencies`; resolved only by peer hoisting. |
| `@types/react-dom` | `^18.2.7` | 18.3.7 | 19.3.0 | Must move with React. |
| `vite` | `^8.3.5` | 8.3.5 | 8.3.5 | Upgraded (Rolldown-based). Node built-ins and runtime deps must now be externalised explicitly in `vite.main.config.ts` — `require('ffprobe')`-style imports are no longer externalised automatically. |
| `eslint` | `^9.39.5` | 9.39.5 | 10.13.0 | Migrated from 8 to 9 with flat config. ESLint 10 is blocked: `typescript-eslint` 8 builds a ScopeManager without `addGlobals`, which ESLint 10 calls, so linting crashes (`scopeManager.addGlobals is not a function`). Revisit when typescript-eslint supports it. |
| `@typescript-eslint/*` | `^8.72.0` | 8.72.0 | 8.72.0 | Upgraded. Peer range caps TypeScript at **<6.1**, so the TypeScript 7 move (S34) is blocked until this moves. |
| `@types/node` | `^24.19.2` | 24.19.2 | 26.6.5 | Raised for the Electron 45 / Vite 8 / Vitest 5 toolchain. |
| `react-intl` | `^6.4.4` | 6.8.9 | **12.1.5** | Pairs with React 19. |
| `react-toastify` | `^9.1.3` | 9.1.3 | **11.1.0** | Pairs with React 19. |
| `zustand` | `^4.4.1` | 4.5.7 | **5.0.15** | Store API changed in v5 (middleware/typing). |
| `react-bootstrap` | `^2.8.0` | 2.10.10 | 2.10.10 | Already current. |
| `styled-components` | `^6.0.7` | 6.1.19 | 6.6.0 | Minor bump only. |

Upgrade notes:

- **Group the upgrades so nothing is rewritten twice.** TS + lint + super-ipc + Vite/Forge/Electron is one
  toolchain change; React 19 + `@types/react*` + react-intl + react-toastify + zustand is a second, and should
  land with the S32 redesign rather than after it.
- **Electron 45 before the fork restructure.** S33's supervisor design should target the final runtime
  (`utilityProcess`, ESM-capable main process), not one that is 19 majors old.
- **The child-process modules are the upgrade risk.** They are CommonJS, use `__dirname`, check
  `__dirname.includes('.asar')`, and assume the legacy file layout — exercise a real scan/convert before and
  after each bump.
- **No upgrade has any safety net.** With no tests, every dependency bump has to be verified by hand; see S35.

---

## 3. Architecture map (rewrite only)

```
new/HBBatchBeast/
├── forge.config.ts            # Forge + Vite plugin; one build entry per child-process module
├── vite.{main,preload,renderer}.config.ts
├── package.json               # scripts: start / package / make / publish / lint (no typecheck, no tests)
└── src/
    ├── main.ts                # BrowserWindow, tray (legacy, Windows-only), setupApiHandlers()
    ├── preload.ts             # registerElectronApiBridge(contextBridge, ipcRenderer)
    ├── renderer.ts            # bootstrap: bootstrap.css, toastify, App
    ├── common/                # channels.ts (channel enums + API types), types.ts (config schema)
    ├── backend/
    │   ├── handlers.ts        # LoadConfiguration, SaveConfiguration, RunBatchOperation
    │   ├── helpers/           # createLogFolders, saveAppConfig
    │   └── modules/           # copied child-process modules: queueBuild, worker1, worker2,
    │                          # scheduler, priorityModule, mediaAnalyser
    ├── frontend/
    │   ├── App.tsx            # IntlMessagesProvider → HomePage
    │   ├── core/              # zustand stores, react-intl provider, message helper, common messages
    │   ├── helpers/hooks.ts   # createUseBackendSyncHook / createUseBackendAsyncHook
    │   ├── home/              # HomePage, ScanButton, BatchOperationResults
    │   ├── settings/          # BatchTab (3 fields) + debounced save hook
    │   └── versionWarning/    # GitHub releases changelog modal
    └── translations/          # 64 locale JSON files copied from the legacy app
```

### IPC contract (already migrated)

| Channel | Kind | Props | Result |
| --- | --- | --- | --- |
| `LOAD_CONFIGURATION` | sync | — | `GlobalAppConfig` |
| `SAVE_CONFIGURATION` | sync | `GlobalAppConfig` | — |
| `RUN_BATCH_OPERATION` | async | `{ config, operationMode }` | init/progress/complete `RunBatchOperationResult` |

### Runtime layout / config

- `pnpm start` runs `scripts/start.mjs`, which adds `--ozone-platform=x11` on Linux because Electron 45 draws
  no window decorations on native Wayland (no titlebar buttons). Packaged builds re-exec themselves with the
  same flag; `HBB_OZONE_PLATFORM=wayland` opts out.

### Toolchain invariants (do not "simplify" these)

- Forge 8 + Vite 8 emit **`.cjs`**: `package.json` `main`, the preload path and every forked entry name.
- Vite 8 (Rolldown) does not externalise Node built-ins or deps for the main build — `vite.main.config.mts`
  lists them; a new child-module dependency must be added there.
- `.npmrc` sets `node-linker=hoisted` and `packagerConfig.ignore` keeps `package.json` + `node_modules` while
  skipping `**/.bin/**`; without both, the packaged app has no runtime dependencies.
- `pnpm.overrides.electron` pins the copy that `super-ipc` pulls in as a direct dependency (~260 MB).
- Vite configs stay `.mts` and read `package.json` through `fs`, otherwise the native config loader warns.
- `IntlMessagesProvider` merges the in-code catalogs into `messages`; removing the merge brings back a
  `MISSING_TRANSLATION` error per id per render.
- Config: `~/Documents/HBBatchBeast/Config/Configuration.json` (legacy path preserved).
- Logs and worker scratch dirs are created by `createLogFolders()` on every load/save.
- `GlobalAppConfig = { lang, selected_config, version_message, api_key, configs: BatchConfig[] }`;
  each config has `tab_health`, `tab_batch`, `tab_remote`, `tab_system` (all `Partial<>`) and optional `name`.
- `BatchOperationMode` currently has `HealthCheck`, `ScanOnly`, `ScanAndConvert`; only `ScanOnly` has a UI.

### Child-process protocol (S33)

Children speak a versioned, typed protocol (`src/backend/processes/protocol.ts`); the positional
arrays it replaced are gone.

**Parent → child**

| Message | Payload |
| --- | --- |
| `configure` | `QueueBuildConfig` — sources, destinations, tempDestinations, useTempFolder, includedFileTypes, container, mode, presets, titleWordFilter, replaceIfSmaller, fileSuffixes, removeApostrophes, replaceAlways, reverseQueue |
| `shutdown` | — (child exits 0) |

**Child → parent**

| Message | Payload |
| --- | --- |
| `ready` | — (sent **after** the message listener is attached, which closes the old race, D19) |
| `log` | `level`, `message` |
| `progress` | `phase` (`discovered` \| `queued`), `count` — counters only, never the growing file list |
| `complete` | `QueueBuildResult` — total, sources, presets, skipOrCopy, destinations, destinationsFinal, notExists |
| `error` | `message`, optional `stack` |

Child entry points are resolved through `childEntries.ts` (name → emitted `.cjs` filename) and validated at
startup, so a stale build fails immediately with an actionable message instead of `MODULE_NOT_FOUND`.

The legacy worker protocol (`queueWorkerMessage()` at
[mainWindow.html:4916](./HBBatchBeast/mainWindow.html)) is **not** migrated; it is a 36-field array that
`worker1.js` consumes. Port it as a typed object rather than an index-based array.

### Fork / child-process architecture — restructured in S33

The process model was inherited straight from the legacy app and was the weakest part of the backend. It has
since been replaced by `src/backend/processes/` (supervisor + typed protocol + entry manifest). The original
analysis is kept below because the same rules apply to the worker pool that still has to be ported.

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

**Still to apply to the worker pool (S19) — the design it should follow**

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

Also carried over as-is: the six legacy child-process modules are now under
[`src/backend/modules/`](./new/HBBatchBeast/src/backend/modules) (only `queueBuild.js` was reformatted and
lightly adapted; the other five are byte-identical to the legacy copies).

---

## 5. In progress / currently blocking

| Slice | State and what remains |
| --- | --- |
| S34 | Remaining upgrade: React 19 (+ `@types/react*`, react-intl 12, react-toastify 11, zustand 5) is scheduled with S32. TypeScript 7 and ESLint 10 are blocked upstream (see §2). |
| S15 | Batch settings are 3 raw textareas (source, destination, custom preset) with debounced auto-save — placeholder UX, to be replaced by S32. Temp folders, auto-create folders, toggles and validation are missing. |
| S16 | Presets are passed to `queueBuild` but in the wrong shape (see defect D2). |
| S17 | File-type filtering and SRT copying are wired; size/title/property filters and copy-filtered-files are not. |
| S21 | Only the scan-result table exists. Conversion/session tables, counters, filters by status, cancel-item and select/deselect are missing. |
| S13 | Locale loading exists (`navigator.language` → dynamic import), but most new UI strings are not in the locale JSONs and there is no language selector. |
| S09 | Version changelog modal exists, but is a *new* implementation (GitHub Releases API) rather than the old server-version banner. Decide whether to keep. |
| S12 | Repo still contains the legacy app, `HandBrakeCLI.exe` (52 MB), test media, `.travis.yml` and old installer scripts. |
| — | Tooling: `yarn.lock` is staged for deletion, `pnpm-lock.yaml` + `pnpm-workspace.yaml` are untracked; `package.json` still has placeholder `description`/`productName` and no icons. No test runner or CI workflow exists, and the dependency stack is majors behind on Electron/React/TypeScript/super-ipc (S34, S35). |

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
| S06 | Tray icon & status icons | Tray menu (Show / Clear notification / Quit) and `iconrunning` / `iconwatching` / `iconerror` status swaps. | 🟡 | S01 | Keep, but rewrite: current code is Windows-only and points at non-existent `__dirname/assets` paths | `[x] yes  [ ] no` |
| S07 | App menu & devtools | File→Quit accelerator, dev-only devtools/reload menu. | 🟡 | S01 | Keep (small) | `[x] yes  [ ] no` |
| S08 | Autostart / launch behaviour | "Start scan+convert when opened", hide-to-tray on minimize, single-instance guard. | ⛔ | S05/S06 | Keep only launch-scan; drop hide-to-tray if S05 dropped | `[ ] yes  [x] no` |
| S09 | Version / changelog notice | Notify users of a new release and show the changelog. New impl uses GitHub Releases instead of `hbbatchbeast.io/api/version`. | 🟡 | S04 | Keep (already re-implemented) | `[x] yes  [ ] no` |
| S10 | Logs & cache tools | View master/error/conversion/scan logs, open log folder, clear healthy-file and replace-attempt caches. | ⛔ | S04 | Keep | `[x] yes  [ ] no` |
| S11 | Packaging & bundled binaries | Forge makers (squirrel/zip/rpm/deb), app icons/metadata, bundle `HandBrakeCLI.exe` + ffmpeg/ffprobe binaries. | 🟡 | S01 | Keep — required before release | `[x] yes  [ ] no` |
| S12 | Legacy cleanup | Delete `HBBatchBeast/` (`mainWindow.html`, `main.js`, old installers, 52 MB `HandBrakeCLI.exe`, test media), retire `.travis.yml`. | ⛔ | S11 | Keep — required for a coherent repo | `[x] yes  [ ] no` |
| S13 | Localization | 64 locale JSONs, localized messages, language selector; old app auto-extracted `en.json` from the DOM in dev. | 🟡 | S02 | Keep (backfill strings) | `[x] yes  [ ] no` |

### B. Batch pipeline

| ID | Feature slice | Short description | State | Depends on | Suggested | Keep? |
| --- | --- | --- | --- | --- | --- | --- |
| S14 | Scan / queue build | Recursively scan source folders, diff against destination, apply file-type + title filters, return queue with per-file preset and extra actions. | ✅ | S04 | Keep | `[x] yes  [ ] no` |
| S15 | Batch paths & folder options | Source/destination/temp folder lists (one per line), temp-conversion toggle, auto-create folders, folder validation. | 🟡 | S14 | Keep | `[x] yes  [ ] no` |
| S16 | Encoder & preset selection | HandBrake vs FFmpeg, standard preset dropdown vs custom preset lines, container, per-folder suffix, preset validation and NVENC/imported-preset warnings. | 🟡 | S15 | Keep | `[x] yes  [ ] no` |
| S17 | File selection filters | Included file types, min/max size, title word filter, include/exclude media-property filters (any/all), copy-filtered-files, copy SRT files. | 🟡 | S14 | Keep | `[x] yes  [ ] no` |
| S18 | File handling actions | Delete source, replace original (always / if smaller), remove apostrophes, reverse queue, custom batch-file hook, low process priority. | 🟡 | S16 | Keep | `[x] yes  [ ] no` |
| S19 | Worker pool execution | Fork N `worker1` processes, dispatch queue items, track per-worker status/percentages, progress, priority process, cancel item, error collection. | ⛔ | S14, S16 | Keep — core of the app | `[x] yes  [ ] no` |
| S20 | Queue controls | Start, pause, resume, stop, convert-selected; per-item select/deselect/invert in the queue view. | ⛔ | S19 | Keep | `[x] yes  [ ] no` |
| S21 | Results & status UI | Session conversion table with success/error/cancelled/remaining/other row filters, counters, last-completed time, per-worker graph. | 🟡 | S19 | Keep | `[ x] yes  [ ] no` |
| S22 | Scheduling | Periodic re-scan interval (min 5 s) and daily run window (start/end, handles cross-midnight); old "folder watching" is just periodic rescanning, not `fs.watch`. | ⛔ | S19 | Keep | `[ ] yes  [x] no` |
| S23 | Configuration profiles | Fixed 10-slot profile selector (`selected_config`) with per-profile settings. Legacy app had no create/rename/delete. | ⛔ | S15–S18 | Keep, but prefer real CRUD over 10 fixed slots | `[x] yes  [ ] no` |
| S24 | System settings | Worker instance count, queue-view size limit, run-on-startup, save verbose logs, queue table behaviour. | ⛔ | S19 | Keep | `[x] yes  [ ] no` |
| S25 | Email error alerts | SMTP/emailjs notification when a run ends with errors (plaintext password, no OAuth/2FA support). | ⛔ | S19 | **Drop candidate** — insecure credential handling and unmaintained deps | `[ ] yes  [x] no` |
| S26 | Health check tab | Quick HandBrake `--scan` vs thorough FFmpeg `-v error` check, optional repair (CRF), move corrupt files to folder, healthy-file cache + clear, health summary. | ⛔ | S19 | Undecided — feature is valuable but needs its own validation pass | `[ ] yes  [x] no` |
| S27 | Media info viewer | Standalone ffprobe browser to inspect a file's video/audio stream properties. | ⛔ | S11 | **Drop candidate** — side tool, unrelated to the rewrite goal | `[x] yes  [ ] no` |
| S28 | Benchmark tab | Download a 4K H.265 sample, run 4 HandBrake workers, show/upload results. | ⛔ | S19 | **Drop candidate** | `[ ] yes  [x] no` |
| S29 | Remote monitoring | Remote view toggle, generated API key, PUT status/metrics to `hbbatchbeast.io`, open browser status page. | ⛔ | S19 | **Drop** (owner stated intent) — also relies on a third-party service | `[ ] yes  [x] no` |
| S30 | Help tab & tooltips | In-app help tab plus 33 contextual tooltip blocks embedded in the old HTML. | ⛔ | S02 | Drop in-app help; link to docs/wiki instead | `[ ] yes  [x] no` |
| S31 | In-app console | Collapsible console bar streaming child-process messages, plus log shortcut. | 🟡 | S14 | Keep (replace `console.log` plumbing) | `[x] yes  [ ] no` |

### C. Design (cross-cutting)

| ID | Feature slice | Short description | State | Depends on | Suggested | Keep? |
| --- | --- | --- | --- | --- | --- | --- |
| S32 | UI/UX redesign | Replace both the placeholder React UI and the legacy layout with a purpose-built interface. Legacy UI supplies the feature inventory; none of its markup, tab structure or styling is carried over. See the design brief below. | ⛔ | S02 (can start now), S15–S21 for feature parity | Keep — this is the visible outcome of the rewrite | `[x] yes  [ ] no` |

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
| D1 | 🔴 High | [buildQueueInfoBomb.ts](./new/HBBatchBeast/src/backend/helpers/buildQueueInfoBomb.ts) | `file_name_suffix_toggle === 1 ? ... : []` sent an **empty array** when the toggle was off, so `queueBuild` produced `aundefined.mp4` destinations. **Fixed in phase 2**: the builder always emits one suffix per source folder and pads partial lists. Covered by tests. |
| D2 | 🔴 High | [buildQueueInfoBomb.ts](./new/HBBatchBeast/src/backend/helpers/buildQueueInfoBomb.ts) | Standard presets are sent as plain names, but `queueBuild`/`worker1` expect HandBrake args. **Fixed in phase 2**: standard presets are wrapped as `-Z "…"` (already-argument presets are left alone) and the results table resolves labels from the active preset source. |
| D3 | 🔴 High | [types.ts](./new/HBBatchBeast/src/common/types.ts) | `HealthCheck` mode was accepted but never built the health-check preset, so a health run would have executed as a conversion. **Fixed in phase 2**: the mode is gone from the enum and any unsupported/absent mode throws before a child is forked. |
| D4 | 🔴 High | `package.json`, `forge.config.ts` | Runtime deps were missing/undeclared. **Fixed in phase 2**: `fs-extra`, `ffprobe` and `ffprobe-static` are declared, `node-linker=hoisted` keeps `node_modules` copyable, and `packagerConfig.ignore` keeps `package.json` + production `node_modules` in the package. Verified by running a scan from the extracted `app.asar`. Package size is still ~700 MB because `ffprobe-static` ships all three platforms — S11 tightens that. |
| D5 | 🟠 Medium | `tsconfig.json`, `.eslintrc.json` | `@superflag/super-ipc-*` are ESM-only with no `main`/`types`; `module: commonjs` + `moduleResolution: node16` cannot resolve them. **Fixed in phases 0–1**: TypeScript 5.9 + `moduleResolution: "bundler"`, and super-ipc 0.1.0 ships dual CJS/ESM with real type entries. |
| D6 | 🟠 Medium | [main.ts:19](./new/HBBatchBeast/src/main.ts) | `nodeIntegration: true` alongside a contextBridge preload. **Fixed in phase 1**: now `false`. |
| D7 | 🟠 Medium | [main.ts:36](./new/HBBatchBeast/src/main.ts) | Tray/icon paths use Windows separators (`.\assets\...`) relative to `__dirname`, but assets live in `src/assets` and are not copied to the build root. The tray is created only on Windows (so Linux/macOS get no tray at all), and the later per-platform `iconpath` assignments at lines 97–111 are dead code. |
| D8 | 🟡 Low | [main.ts:115](./new/HBBatchBeast/src/main.ts) | Leftover legacy listeners (`item:add`, `item:ready`, `mediaview:ready`, `benchstatus:ready`) that only echo `"Test"`. |
| D9 | 🟡 Low | [BatchOperationResults.tsx](./new/HBBatchBeast/src/frontend/home/BatchOperationResults.tsx) | Debug `console.log` plus unguarded config access. **Fixed in phase 2** while correcting preset labels. |
| D10 | 🟡 Low | `src/common/types.ts` | `BatchOperationMode.ScanOnly = 'scannonly'` (typo, and the comment says "replace this with flags"). `queueBuild` compares against `'healthCheck'` only, so the typo is currently harmless but confusing. |
| D11 | 🟡 Low | `new/HBBatchBeast/dist/` | Stale, untracked `tsc` output from the earlier build; safe to delete and add to `.gitignore`. |
| D12 | 🟡 Low | `package.json` | Placeholder `description` ("My Electron application description"), lowercase `productName`, no `icon` in `packagerConfig`, no `typecheck`/`test` scripts. |
| D13 | 🟠 Medium | `src/backend/processes/` | No child lifecycle management previously: no `error` listener, timeout, kill path or restart, so a hung child left the run pending forever. **Fixed in phase 3** by `ChildSupervisor` (ready timeout, run watchdog, SIGTERM→SIGKILL, restart budget, `will-quit` shutdown). |
| D14 | 🟠 Medium | `src/backend/handlers.ts` | Sync FS writes ran inside the child `message` handler, blocking the main event loop. **Fixed in phase 3**: the write/append message types are gone; children log through typed `log` messages only. |
| D15 | 🟠 Medium | `src/backend/handlers.ts` | Progress re-serialized the whole result including the growing file list. **Fixed in phase 3**: progress carries counters only; the file list is sent once in `complete`. |
| D16 | 🟡 Low | `package.json` | `@types/react` is not declared; it resolves only via peer hoisting, and the tree currently contains two incompatible copies (18.3.23 and 19.1.9). Declare it explicitly and keep it aligned with `react`/`react-dom` during the S34 upgrade. |
| D17 | 🟡 Low | whole repo | No automated verification of any kind: no test runner, no test files, no CI workflow. Every dependency bump and refactor is validated by hand. See S35. |
| D18 | 🟡 Low | [createLogFolders.ts](./new/HBBatchBeast/src/backend/helpers/createLogFolders.ts) | Assumed `~/Documents` already existed. **Fixed in phase 2**: all directory creation is recursive, covered by a fresh-home test. |
| D19 | 🟠 Medium | [queueBuild.js](<./new/HBBatchBeast/src/backend/modules/queueBuild.js>) | Startup race: the child announced readiness before attaching its message listener, so the parent's reply could be dropped and the run never settled. **Fixed in phase 3**: readiness is sent last, and the supervisor only configures after the handshake. |

---

## 9. Guidance for a future agent

### Order of work that avoids rework

1. **Upgrade and unbreak the toolchain (S03 + S34).** This is one job: TypeScript 4.9 → 5.x/7 (TS 4.9 cannot
   do `moduleResolution: "bundler"`), super-ipc 0.0.11 → 0.1.0, ESLint 10 + `typescript-eslint` 8, and
   Vite 8 + Forge 8 + Electron 45. Commit the `yarn → pnpm` switch and add `typecheck`/`test` scripts. Then
   get `tsc --noEmit` and `pnpm lint` green — do not patch `node_modules`. Verify each bump with a real
   `pnpm package` plus a manual scan, since the child modules are CommonJS and assume the legacy layout.
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
- Child-process module names (`queueBuild.js`, `worker1.js`, ...) must keep their Vite build entries; the
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
