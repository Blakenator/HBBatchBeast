# App and tray icons

The icon is a rounded blue tile with three queue lines and a play mark: batch
video conversion in one glyph. The queue lines drop away at 16px so the play
mark stays readable.

## Sources

- `source/icon.svg` — the app icon, used at 32px and above.
- `source/icon-small.svg` — one queue line, used at 24px and for the tray.
- `source/icon-16.svg` — play only, used at 16px.

Edit those two files, not the generated PNG/ICO/ICNS files. The status badges
for running, paused and error are defined in `scripts/build-icons.cjs`, together
with the platform packers.

## Regenerating

```sh
pnpm icons
```

This uses the project's Electron dev dependency to rasterise the SVGs and then
writes:

| Path                   | Use                                  |
| ---------------------- | ------------------------------------ |
| `png/icon.png`         | Linux packaging, window icon, 1024px |
| `png/tray.png`         | Tray icon while idle, 64px           |
| `png/iconrunning.png`  | Tray icon while converting           |
| `png/iconwatching.png` | Tray icon while paused               |
| `png/iconerror.png`    | Tray icon after a run with errors    |
| `mac/icon.icns`        | macOS app icon                       |
| `win/icon.ico`         | Windows app icon                     |

The `iconrunning`, `iconwatching` and `iconerror` `.icns`/`.ico` files are
regenerated for consistency but the runtime tray uses the PNGs.
