# Electron build resources

`electron-builder.yml` points `buildResources` here. Drop platform icons in
this folder when ready:

- `icon.png` — 512×512 (or larger) PNG. Used as the dev dock tile (macOS) and
  as the source electron-builder rasterizes platform icons from.
- `icon.ico` — Windows installer/app icon (optional; derived from PNG otherwise).
- `icon.icns` — macOS bundle icon (optional; derived from PNG otherwise).

Until real icons are added, electron-builder falls back to the default Electron
icon and `app.dock.setIcon` is skipped (the path-exists guard in
`electron/main.ts` handles the missing `icon.png`).
