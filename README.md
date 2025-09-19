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

## Build (macOS)
```bash
npm run build
```
Artifacts will be in `dist/`.

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
