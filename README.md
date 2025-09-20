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

### macOS
```bash
npm run build   # Produces signed (non-notarized) DMG/ZIP locally
# or to build without publishing and keep artifacts locally
npm run pack
```
Artifacts will be in `dist/`.

### Windows
```powershell
# From repo root
npm ci

# Build Windows installer (.exe)
npm run build:win
```
Artifacts:
- Installer: `dist/photo-selector-electron-Setup-0.1.0.exe`
- Unpacked app: `dist/win-unpacked/photo-selector-electron.exe`

Troubleshooting:
- If you see ENOENT for `node_modules\\exiftool-vendored.pl`, the optional Perl package is not installed (it's optional on Windows). The build script now ensures an empty directory exists to satisfy the packager, and we include the Windows binary `exiftool-vendored.exe` via `asarUnpack`.
- If signing steps download tools, allow time for first-run. No code-signing cert is required for local builds.

## Usage
- Click "Open Folder" and select the top-level directory. App recursively loads images and RAW previews into memory.
- Gallery: click a thumbnail to open viewer.
- Viewer keyboard shortcuts:
  - Left/Right: previous/next
  - Space: like/unlike
  - 1..5: set score (default 5)
  - n: reject
  - g: back to gallery
- Save CSV writes `image_selections.csv` to the opened folder.

## Notes
- RAWs use embedded previews extracted via `exiftool-vendored`. If a RAW has no embedded preview, it is skipped.
- All images are normalized to JPEG in memory for consistent display; originals are untouched.
- For huge folders, initial loading may take time while building in-memory cache.
