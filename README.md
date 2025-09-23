# Photo Selector (Electron)

Desktop app to browse a folder of photos, like/reject, set scores (1-5), and save CSV. Loads images into memory for fast navigation. RAW (NEF, ARW, etc.) supported via embedded previews.

## Prereqs
- Node.js 18+
- macOS 12+ recommended (works on other OSs with matching binaries)

## Setup
```bash
cd /Users/timnirmal/Desktop/my/select_images
npm install
```

## Run (development)
```bash
npm run dev
```

## Build

### macOS (arm64)
```bash
npm run build:mac    # Builds DMG/ZIP for Apple Silicon
# or
npm run pack:mac     # Same as build but without publishing
```
Artifacts: `dist/photo-selector-electron-<version>-arm64.dmg` and `...-arm64-mac.zip`

### Windows (.exe)
Run on Windows for best results.
```powershell
# From repo root
npm ci
npm run build:win    # Builds NSIS installer (.exe)
```
Artifacts:
- Installer: `dist/photo-selector-electron-Setup-<version>.exe`
- Unpacked: `dist/win-unpacked/photo-selector-electron.exe`

### Notes
- mac build unpacks `node_modules/exiftool-vendored/**` for RAW preview extraction.
- Windows build unpacks `node_modules/exiftool-vendored.exe/**`.
- A small prebuild step creates placeholders so cross-OS packaging won’t fail if optional platform packages are missing.
- Local mac builds are unsigned (non-notarized). You can open via context-menu → Open if Gatekeeper warns.

## Usage
- Click "Open Folder" and select the top-level directory. App recursively loads images and RAW previews into memory.
- Gallery: click a thumbnail to open viewer.
- Viewer shortcuts:
  - Left/Right: previous/next
  - Space: like/unlike
  - 1..5: set score (default 5)
  - n: reject
  - g: back to gallery
- Save CSV writes `image_selections.csv` to the opened folder.

## Troubleshooting
- If you see ENOENT for `node_modules\\exiftool-vendored.pl` or `.exe`, run `npm run build` once on that OS or re-install deps there; placeholders are created automatically during prebuild.
- If downloads are slow/failing during Electron fetch, rerun later or use a mirror and clear cache:
```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
rm -rf "$HOME/.cache/electron" "$HOME/.cache/electron-builder"
```
